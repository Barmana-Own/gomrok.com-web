import { DomainError } from '../domain/workflow.js';
import {
  RFQ_READ_MODES,
  assertCarrierRfqListAccess,
  assertConfidentialRateAccess,
  isContextBoundRfqActor,
  mayLoadAllRfqQuotes,
  resolveRfqReadAccess
} from '../domain/rfq-context-access.js';

function assertExecutor(executor) {
  if (!executor || typeof executor.execute !== 'function') {
    throw new TypeError('A mysql2-compatible executor is required.');
  }
  return executor;
}

const quoteProjection = `q.id, q.bidder_org_id, o.display_name AS bidder_display_name,
       q.amount, q.currency, q.terms_json, q.qualification_state,
       q.state, q.submitted_at, q.is_ai_assisted`;

export function createContextScopedRfqRepository(executor) {
  const db = assertExecutor(executor);

  async function findLegacyOrganization(actor) {
    const [rows] = await db.execute(
      `SELECT organization_type, status, qualification_state
         FROM platform_organizations
        WHERE id = ? AND tenant_id = ?
        LIMIT 1`,
      [actor.organizationId, actor.tenantId]
    );
    return rows[0] || null;
  }

  async function resolveReadAccess(actor, rfq) {
    const isPublisher = actor?.organizationId !== null
      && actor?.organizationId !== undefined
      && rfq?.publisher_org_id !== null
      && rfq?.publisher_org_id !== undefined
      && String(actor.organizationId) === String(rfq.publisher_org_id);
    const legacyOrganization = isContextBoundRfqActor(actor) || isPublisher
      ? null
      : await findLegacyOrganization(actor);
    return resolveRfqReadAccess({ actor, rfq, legacyOrganization });
  }

  async function assertBidderInvitation(actor, rfq, access) {
    if (!isContextBoundRfqActor(actor) || access.mode !== RFQ_READ_MODES.BIDDER) return;
    const eventName = rfq.level === 'RFQ1' ? 'RFQPublished' : 'OperationalRFQPublished';
    const [rows] = await db.execute(
      `SELECT n.id
         FROM platform_notifications n
         JOIN platform_domain_events e
           ON e.id = n.event_id
          AND e.tenant_id = n.tenant_id
        WHERE n.tenant_id = ?
          AND n.recipient_org_id = ?
          AND e.entity_type = 'rfq'
          AND e.entity_id = ?
          AND e.event_name = ?
        LIMIT 1`,
      [actor.tenantId, actor.organizationId, rfq.id, eventName]
    );
    if (!rows[0]) throw new DomainError('RFQ-404', 'دفتر پیشنهاد پیدا نشد.', 404);
  }

  return Object.freeze({
    async findRfqById({ actor, rfqId }) {
      const [scopeRows] = await db.execute(
        `SELECT id, tenant_id, case_id, level, state, publisher_org_id,
                deadline_at
           FROM rfq_books
          WHERE id = ? AND tenant_id = ?
          LIMIT 1`,
        [rfqId, actor.tenantId]
      );
      const scopedRfq = scopeRows[0];
      if (!scopedRfq) throw new DomainError('RFQ-404', 'دفتر پیشنهاد پیدا نشد.', 404);

      const access = await resolveReadAccess(actor, scopedRfq);
      await assertBidderInvitation(actor, scopedRfq, access);
      const [detailRows] = await db.execute(
        `SELECT metadata_json
           FROM rfq_books
          WHERE id = ?
            AND tenant_id = ?
            AND case_id = ?
            AND level = ?
            AND publisher_org_id = ?
          LIMIT 1`,
        [rfqId, actor.tenantId, scopedRfq.case_id, scopedRfq.level, scopedRfq.publisher_org_id]
      );
      if (!detailRows[0]) throw new DomainError('RFQ-404', 'دفتر پیشنهاد پیدا نشد.', 404);
      return Object.freeze({ ...scopedRfq, ...detailRows[0] });
    },

    async listCarrierRfqs({ actor }) {
      if (isContextBoundRfqActor(actor)) {
        assertCarrierRfqListAccess(actor);
      } else {
        const organization = await findLegacyOrganization(actor);
        if (
          organization?.organization_type !== 'company_y'
          || organization.status !== 'active'
          || organization.qualification_state !== 'qualified'
        ) {
          throw new DomainError('QUA-423', 'صلاحیت شرکت Y برای دریافت RFQ2 معتبر نیست.', 423);
        }
      }

      const [rows] = await db.execute(
        `SELECT r.id, r.case_id, r.state, r.deadline_at, r.metadata_json,
                CASE WHEN r.state = 'AWARDED' AND r.awarded_org_id = ? THEN 1 ELSE 0 END AS awarded_to_me,
                c.origin_country, c.destination_country, c.origin_location, c.destination_location,
                c.cargo_type, c.cargo_weight, c.cargo_weight_unit, c.direction,
                q.id AS own_quote_id, q.amount AS own_quote_amount, q.currency AS own_quote_currency,
                q.state AS own_quote_state, q.submitted_at AS own_quote_submitted_at
           FROM rfq_books r
           JOIN shipment_cases c ON c.id = r.case_id AND c.tenant_id = r.tenant_id
           LEFT JOIN rfq_quotes q
             ON q.rfq_id = r.id
            AND q.tenant_id = r.tenant_id
            AND q.bidder_org_id = ?
          WHERE r.tenant_id = ?
            AND r.level = 'RFQ2'
            AND r.state IN ('OPEN', 'EXPIRED', 'AWARDED')
            AND (? = 0 OR r.publisher_org_id <> ?)
            AND (
              ? = 0
              OR EXISTS (
                SELECT 1
                  FROM platform_notifications n
                  JOIN platform_domain_events e
                    ON e.id = n.event_id
                   AND e.tenant_id = n.tenant_id
                 WHERE n.tenant_id = r.tenant_id
                   AND n.recipient_org_id = ?
                   AND e.entity_type = 'rfq'
                   AND e.entity_id = r.id
                   AND e.event_name = 'OperationalRFQPublished'
              )
            )
          ORDER BY r.deadline_at ASC, r.created_at DESC`,
        [
          actor.organizationId,
          actor.organizationId,
          actor.tenantId,
          isContextBoundRfqActor(actor) ? 1 : 0,
          actor.organizationId,
          isContextBoundRfqActor(actor) ? 1 : 0,
          actor.organizationId
        ]
      );
      return rows;
    },

    async readVisibleQuotes({ actor, rfq, now = new Date() }) {
      const access = await resolveReadAccess(actor, rfq);
      if (access.mode === RFQ_READ_MODES.PUBLISHER && !mayLoadAllRfqQuotes({ access, rfq, now })) {
        return Object.freeze({ access, rows: [] });
      }

      if (access.mode === RFQ_READ_MODES.BIDDER) {
        const [rows] = await db.execute(
          `SELECT ${quoteProjection}
             FROM rfq_quotes q
             JOIN platform_organizations o
               ON o.id = q.bidder_org_id
              AND o.tenant_id = q.tenant_id
            WHERE q.rfq_id = ?
              AND q.tenant_id = ?
              AND q.bidder_org_id = ?
            ORDER BY q.submitted_at ASC
            LIMIT 1`,
          [rfq.id, actor.tenantId, actor.organizationId]
        );
        return Object.freeze({ access, rows });
      }

      const [rows] = await db.execute(
        `SELECT ${quoteProjection}
           FROM rfq_quotes q
           JOIN platform_organizations o
             ON o.id = q.bidder_org_id
            AND o.tenant_id = q.tenant_id
          WHERE q.rfq_id = ?
            AND q.tenant_id = ?
          ORDER BY q.submitted_at ASC`,
        [rfq.id, actor.tenantId]
      );
      return Object.freeze({ access, rows });
    },

    async findOwnInternalPricing({ actor, rfq }) {
      assertConfidentialRateAccess(actor);
      const access = await resolveReadAccess(actor, rfq);
      if (access.mode !== RFQ_READ_MODES.BIDDER) {
        throw new DomainError('AUTH-403', 'قیمت داخلی فقط برای پیشنهاد همان زمینه قابل مشاهده است.', 403);
      }
      const [rows] = await db.execute(
        `SELECT id, amount, currency, terms_json, internal_pricing_json, submitted_at
           FROM rfq_quotes
          WHERE tenant_id = ?
            AND rfq_id = ?
            AND bidder_org_id = ?
          LIMIT 1`,
        [actor.tenantId, rfq.id, actor.organizationId]
      );
      return rows[0] || null;
    }
  });
}
