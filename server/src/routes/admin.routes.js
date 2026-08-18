import { Router } from 'express';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { pool } from '../db.js';
import { platformAuth, idempotencyKey } from '../security/platform-auth.js';
import { JWT_SECRET, STEP_UP_SECRET } from '../config.js';
import { publishPlatformEvent } from '../realtime/broker.js';
import {
  ADMIN_ROLES,
  ERROR_CODES,
  PERMISSIONS,
  ROLES,
  hasPermission,
  normalizeRole
} from '../../../shared/contract.js';
import { DomainError, parseJson } from '../domain/workflow.js';

const router = Router();
const jwtSecret = JWT_SECRET;
const stepUpSecret = STEP_UP_SECRET;
const PURPOSE_ROLES = [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN];
const ALL_GOVERNANCE_ROLES = [...ADMIN_ROLES];
const BREAK_GLASS_REQUEST_ROLES = [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.CONFLICT_OFFICER, ROLES.SECURITY_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER, ROLES.CUSTOMER_SUPPORT, ROLES.FINANCE_ADMIN];
const CASE_TYPES = ['COMPLIANCE', 'RISK', 'CONFLICT', 'SECURITY', 'INCIDENT', 'SUPPORT', 'FINANCE', 'DISPUTE'];
const CASE_STATES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'MONITOR', 'RESTRICTED', 'ESCALATED'];
const RULEPACK_STATES = ['DRAFT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED'];
const RULEPACK_TRANSITIONS = Object.freeze({
  DRAFT: ['REVIEW', 'ARCHIVED'],
  REVIEW: ['APPROVED', 'ARCHIVED'],
  APPROVED: ['SCHEDULED', 'ARCHIVED'],
  SCHEDULED: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['SUPERSEDED'],
  SUPERSEDED: ['ARCHIVED'],
  ARCHIVED: []
});
const ROLE_CASE_TYPES = Object.freeze({
  [ROLES.SUPER_ADMIN]: CASE_TYPES,
  [ROLES.MARKETPLACE_ADMIN]: CASE_TYPES,
  [ROLES.CONFLICT_OFFICER]: ['CONFLICT', 'INCIDENT'],
  [ROLES.SECURITY_ADMIN]: ['SECURITY', 'INCIDENT'],
  [ROLES.COMPLIANCE_OFFICER]: ['COMPLIANCE', 'INCIDENT'],
  [ROLES.RISK_MANAGER]: ['RISK', 'INCIDENT', 'DISPUTE'],
  [ROLES.CUSTOMER_SUPPORT]: ['SUPPORT', 'INCIDENT'],
  [ROLES.FINANCE_ADMIN]: ['FINANCE', 'DISPUTE'],
  [ROLES.GOVERNMENT_OBSERVER]: ['COMPLIANCE', 'INCIDENT'],
  [ROLES.DATA_GOVERNANCE_OFFICER]: ['SECURITY', 'SUPPORT', 'INCIDENT'],
  [ROLES.CRM_ADMIN]: ['SUPPORT', 'INCIDENT'],
  [ROLES.SUPPORT_LEAD]: ['SUPPORT', 'INCIDENT']
});
const COMMERCIAL_KEYS = new Set([
  'amount', 'price', 'rate', 'margin', 'quote', 'quotebody', 'terms', 'customerprice',
  'xyrate', 'ydriverrate', 'platformfee', 'currencyamount', 'contact', 'phone', 'email'
]);

function jsonResponse(body, status = 200) {
  return { body, status };
}

function problem(response, error, request) {
  const status = Number(error.status || error.statusCode || 500);
  return response.status(status).type('application/problem+json').json({
    type: `https://gomrok.org/problems/${error.code || 'ADM-500'}`,
    title: error.code || 'ADM-500',
    status,
    detail: error.message || 'عملیات مدیریتی انجام نشد.',
    code: error.code || 'ADM-500',
    details: error.details || undefined,
    correlationId: request.correlationId
  });
}

function actorRole(request) {
  return normalizeRole(request.actor?.role);
}

function requireRole(request, roles) {
  if (!roles.map(normalizeRole).includes(actorRole(request))) {
    throw new DomainError(ERROR_CODES.ADMIN_PERMISSION, 'این نقش ستادی به عملیات درخواستی دسترسی ندارد.', 403);
  }
}

function requirePurpose(request) {
  if (PURPOSE_ROLES.includes(actorRole(request)) && String(request.actor?.purpose || '').trim().length < 8) {
    throw new DomainError(ERROR_CODES.STEP_UP_REQUIRED, 'نمایش مدیریتی نیازمند محدوده هدف و ثبت دلیل است.', 428);
  }
}

function requireTraceableActor(request) {
  if (!Number.isInteger(Number(request.actor?.userId)) || Number(request.actor.userId) < 1) {
    throw new DomainError(ERROR_CODES.ADMIN_PERMISSION, 'این عملیات نیازمند نشست ستادی قابل انتساب است.', 403);
  }
}

function requireStepUp(request) {
  const stepUpToken = String(request.headers['x-step-up-token'] || request.headers['x-step-up'] || '').trim();
  if (!stepUpToken) throw new DomainError(ERROR_CODES.STEP_UP_REQUIRED, 'برای این اقدام حساس احراز هویت مرحله دوم لازم است.', 428);
  let claims;
  try {
    claims = jwt.verify(stepUpToken, stepUpSecret, { algorithms: ['HS256'], issuer: 'gomrok-iam', audience: 'gomrok-admin', clockTolerance: 5 });
  } catch (_error) {
    throw new DomainError(ERROR_CODES.STEP_UP_REQUIRED, 'نشست احراز هویت مرحله دوم معتبر یا فعال نیست.', 428);
  }
  const issuedAt = Number(claims.iat || 0);
  const expiresAt = Number(claims.exp || 0);
  const now = Math.floor(Date.now() / 1000);
  if (claims.scope !== 'admin_sensitive' || claims.typ !== 'step_up' || !claims.jti || !issuedAt || !expiresAt || expiresAt - issuedAt > 300 || issuedAt > now + 30 || String(claims.sub) !== String(request.actor.userId)) {
    throw new DomainError(ERROR_CODES.STEP_UP_REQUIRED, 'نشست مرحله دوم به همین کاربر و دامنه مدیریتی متصل نیست.', 428);
  }
  return true;
}

function parseId(value, label = 'شناسه') {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new DomainError('INPUT-400', `${label} معتبر نیست.`, 400);
  return id;
}

function parseText(value, label, { min = 1, max = 500 } = {}) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) throw new DomainError('INPUT-400', `${label} معتبر نیست.`, 400);
  return text;
}

function parseLimit(value, fallback = 50, maximum = 200) {
  return Math.min(Math.max(Number(value || fallback) || fallback, 1), maximum);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (COMMERCIAL_KEYS.has(normalized) || normalized.includes('rawcontact') || normalized.includes('customeridentity')) {
      return [key, '[REDACTED_BY_POLICY]'];
    }
    return [key, redact(item)];
  }));
}

function publicAudit(row) {
  return {
    id: row.id,
    actorId: row.actor_id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    payload: redact(parseJson(row.payload_json, {})),
    correlationId: row.correlation_id,
    eventVersion: row.event_version,
    createdAt: row.created_at
  };
}

function publicOrganization(row) {
  return {
    id: row.id,
    organizationType: row.organization_type,
    displayName: row.display_name,
    status: row.status,
    qualificationState: row.qualification_state,
    countryScope: parseJson(row.country_scope, []),
    cargoScope: parseJson(row.cargo_scope, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicAdminCase(row) {
  return {
    id: row.id,
    caseType: row.case_type,
    subjectTenantId: row.subject_tenant_id,
    subjectOrgId: row.subject_org_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    signal: row.signal,
    severity: row.severity,
    score: row.score,
    source: row.source,
    state: row.state,
    reason: row.reason,
    evidence: redact(parseJson(row.evidence_json, {})),
    reviewerUserId: row.reviewer_user_id,
    outcome: row.outcome,
    remediation: row.remediation,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicRulePack(row) {
  return {
    id: row.id,
    ruleKey: row.rule_key,
    versionNo: row.version_no,
    state: row.state,
    level: row.level,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    routeScope: parseJson(row.route_scope, {}),
    cargoScope: parseJson(row.cargo_scope, {}),
    rules: parseJson(row.rules_json, {}),
    hardGate: Boolean(row.hard_gate),
    createdByUserId: row.created_by_user_id,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at,
    activatedAt: row.activated_at,
    supersededAt: row.superseded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function audit(request, { eventType, subjectType, subjectId = null, payload = {} }) {
  await pool.execute(
    `INSERT INTO audit_events
      (actor_id, tenant_id, organization_id, event_type, subject_type, subject_id, payload_json, correlation_id, event_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [request.actor.userId || null, request.actor.tenantId, request.actor.organizationId, eventType, subjectType, subjectId, JSON.stringify(redact(payload)), request.correlationId]
  );
}

async function domainEvent(request, { eventName, entityType, entityId = null, payload = {} }) {
  const [result] = await pool.execute(
    `INSERT INTO platform_domain_events
      (tenant_id, event_name, event_version, entity_type, entity_id, actor_user_id, correlation_id, payload_json)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
    [request.actor.tenantId, eventName, entityType, entityId, request.actor.userId || null, request.correlationId, JSON.stringify(redact(payload))]
  );
  await audit(request, { eventType: eventName, subjectType: entityType, subjectId: entityId, payload });
  publishPlatformEvent({
    tenantId: request.actor.tenantId,
    eventName,
    entityType,
    entityId,
    actorOrganizationId: request.actor.organizationId,
    correlationId: request.correlationId,
    payload
  });
  return result.insertId;
}

async function runWrite(request, response, handler, { requireKey = true } = {}) {
  const key = idempotencyKey(request);
  if (requireKey && !key) return problem(response, new DomainError(ERROR_CODES.STEP_UP_REQUIRED, 'برای این عملیات حساس X-Idempotency-Key لازم است.', 428), request);
  if (key && request.actor.userId) {
    const [previousRows] = await pool.execute(
      `SELECT status_code, response_json FROM platform_idempotency_keys
       WHERE tenant_id = ? AND actor_user_id = ? AND idempotency_key = ? LIMIT 1`,
      [request.actor.tenantId, request.actor.userId, key]
    );
    if (previousRows[0]?.status_code) return response.status(previousRows[0].status_code).json(parseJson(previousRows[0].response_json, {}));
    if (!previousRows[0]) {
      try {
        await pool.execute(
          `INSERT INTO platform_idempotency_keys (tenant_id, actor_user_id, idempotency_key, route) VALUES (?, ?, ?, ?)`,
          [request.actor.tenantId, request.actor.userId, key, request.originalUrl]
        );
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const [retryRows] = await pool.execute(
          `SELECT status_code, response_json FROM platform_idempotency_keys
           WHERE tenant_id = ? AND actor_user_id = ? AND idempotency_key = ? LIMIT 1`,
          [request.actor.tenantId, request.actor.userId, key]
        );
        if (retryRows[0]?.status_code) return response.status(retryRows[0].status_code).json(parseJson(retryRows[0].response_json, {}));
        return problem(response, new DomainError(ERROR_CODES.STEP_UP_REQUIRED, 'درخواست تکراری هنوز در حال پردازش است.', 428), request);
      }
    }
  }
  try {
    const result = await handler();
    if (key && request.actor.userId) {
      await pool.execute(
        `UPDATE platform_idempotency_keys SET status_code = ?, response_json = ?
         WHERE tenant_id = ? AND actor_user_id = ? AND idempotency_key = ?`,
        [result.status, JSON.stringify(result.body), request.actor.tenantId, request.actor.userId, key]
      );
    }
    return response.status(result.status).json(result.body);
  } catch (error) {
    return problem(response, error, request);
  }
}

function caseTypesFor(request) {
  return ROLE_CASE_TYPES[actorRole(request)] || [];
}

function assertCaseType(request, caseType) {
  const normalized = String(caseType || '').trim().toUpperCase();
  if (!CASE_TYPES.includes(normalized) || !caseTypesFor(request).includes(normalized)) {
    throw new DomainError(ERROR_CODES.ADMIN_PERMISSION, 'این نقش به صف حاکمیتی درخواستی دسترسی ندارد.', 403);
  }
  return normalized;
}

function assertNotOwnOrganization(request, organizationId) {
  if (organizationId && String(organizationId) === String(request.actor.organizationId)) {
    throw new DomainError(ERROR_CODES.ADMIN_PERMISSION, 'تصمیم‌گیری حاکمیتی درباره سازمان خودکاربر مجاز نیست.', 403);
  }
}

function qualificationState(decision) {
  const states = {
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
    REQUEST_INFO: 'MORE_INFO',
    SUSPEND: 'SUSPENDED'
  };
  const value = states[String(decision || '').trim().toUpperCase()];
  if (!value) throw new DomainError('QUA-422', 'تصمیم احراز صلاحیت معتبر نیست.', 422);
  return value;
}

function assertRulePackTransition(from, to) {
  const current = String(from || '').toUpperCase();
  const next = String(to || '').toUpperCase();
  if (!RULEPACK_STATES.includes(current) || !RULEPACK_STATES.includes(next) || !RULEPACK_TRANSITIONS[current]?.includes(next)) {
    throw new DomainError(ERROR_CODES.RULEPACK_STATE, `انتقال RulePack از ${current} به ${next} مجاز نیست.`, 409);
  }
  return true;
}

function assertRulePackInput(body = {}) {
  const ruleKey = parseText(body.ruleKey, 'کلید RulePack', { min: 3, max: 120 });
  if (!/^[A-Za-z0-9_.:-]+$/.test(ruleKey)) throw new DomainError(ERROR_CODES.RULEPACK_INVALID, 'کلید RulePack فقط می‌تواند شامل حروف، عدد و جداکننده باشد.', 422);
  const level = String(body.level || '').toUpperCase();
  const sourceType = String(body.sourceType || '').toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(level) || !['A', 'B', 'C', 'D'].includes(sourceType)) throw new DomainError(ERROR_CODES.RULEPACK_INVALID, 'Level و Source Type RulePack معتبر نیست.', 422);
  if (level === 'C' && body.hardGate === true) throw new DomainError(ERROR_CODES.COMPLIANCE_BLOCK, 'Practice سطح C نمی‌تواند Hard Gate سطح A باشد.', 451);
  if (!body.rules || typeof body.rules !== 'object' || Array.isArray(body.rules)) throw new DomainError(ERROR_CODES.RULEPACK_INVALID, 'بدنه قواعد RulePack باید یک شیء ساختاری باشد.', 422);
  return { ruleKey, level, sourceType, hardGate: body.hardGate === true };
}

export { ADMIN_ROLES, assertRulePackInput, assertRulePackTransition, redact };

router.get('/dashboard', platformAuth({ roles: ALL_GOVERNANCE_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const tenantId = request.actor.tenantId;
    const [orgRows, membershipRows, casesRows, breakGlassRows, exportRows, rulePackRows, rfqRows, auditRows] = await Promise.all([
      pool.execute(`SELECT organization_type, status, qualification_state, COUNT(*) AS total FROM platform_organizations WHERE tenant_id = ? GROUP BY organization_type, status, qualification_state`, [tenantId]),
      pool.execute(`SELECT role, status, qualification_state, COUNT(*) AS total FROM organization_memberships WHERE tenant_id = ? GROUP BY role, status, qualification_state`, [tenantId]),
      pool.execute(`SELECT case_type, state, severity, COUNT(*) AS total FROM admin_governance_cases WHERE tenant_id = ? GROUP BY case_type, state, severity`, [tenantId]),
      pool.execute(`SELECT state, COUNT(*) AS total FROM admin_break_glass_requests WHERE tenant_id = ? GROUP BY state`, [tenantId]),
      pool.execute(`SELECT state, COUNT(*) AS total FROM platform_export_requests WHERE tenant_id = ? GROUP BY state`, [tenantId]),
      pool.execute(`SELECT state, COUNT(*) AS total FROM admin_rulepacks WHERE tenant_id = ? GROUP BY state`, [tenantId]),
      pool.execute(`SELECT level, state, COUNT(*) AS total, MAX(deadline_at) AS latest_deadline FROM rfq_books WHERE tenant_id = ? GROUP BY level, state`, [tenantId]),
      pool.execute(`SELECT COUNT(*) AS total FROM audit_events WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`, [tenantId])
    ]);
    const openCases = casesRows[0].filter((row) => ['OPEN', 'IN_REVIEW', 'ESCALATED', 'RESTRICTED'].includes(row.state)).reduce((sum, row) => sum + Number(row.total), 0);
    return response.json({
      actor: { role: actorRole(request), organizationId: request.actor.organizationId, tenantId },
      permissions: Object.values(PERMISSIONS).filter((permission) => hasPermission(actorRole(request), permission)),
      metrics: {
        organizations: orgRows[0].reduce((sum, row) => sum + Number(row.total), 0),
        openGovernanceCases: openCases,
        pendingBreakGlass: Number(breakGlassRows[0].find((row) => row.state === 'REQUESTED')?.total || 0),
        pendingExports: Number(exportRows[0].find((row) => row.state === 'REQUESTED')?.total || 0),
        activeRulePacks: Number(rulePackRows[0].find((row) => row.state === 'ACTIVE')?.total || 0),
        auditEvents24h: Number(auditRows[0][0]?.total || 0)
      },
      organizations: orgRows[0],
      memberships: membershipRows[0],
      cases: casesRows[0],
      breakGlass: breakGlassRows[0],
      exports: exportRows[0],
      rulePacks: rulePackRows[0],
      rfqs: rfqRows[0]
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/organizations', platformAuth({ roles: ALL_GOVERNANCE_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const search = String(request.query.search || '').trim().slice(0, 120);
    const type = String(request.query.type || '').trim().slice(0, 40);
    const limit = parseLimit(request.query.limit);
    const [rows] = await pool.execute(
      `SELECT id, organization_type, display_name, status, qualification_state, country_scope, cargo_scope, created_at, updated_at
         FROM platform_organizations
        WHERE tenant_id = ? AND (? = '' OR display_name LIKE CONCAT('%', ?, '%') OR id LIKE CONCAT('%', ?, '%'))
          AND (? = '' OR organization_type = ?)
        ORDER BY updated_at DESC LIMIT ${limit}`,
      [request.actor.tenantId, search, search, search, type, type]
    );
    return response.json({ organizations: rows.map(publicOrganization) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/users', platformAuth({ roles: ALL_GOVERNANCE_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const search = String(request.query.search || '').trim().slice(0, 120);
    const [rows] = await pool.execute(
      `SELECT m.id AS membership_id, m.organization_id, m.user_id, m.role, m.transaction_role, m.qualification_state, m.kyc_level, m.status,
              u.display_name, u.status AS user_status, o.organization_type
         FROM organization_memberships m
         JOIN platform_users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
         JOIN platform_organizations o ON o.id = m.organization_id AND o.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND (? = '' OR u.display_name LIKE CONCAT('%', ?, '%') OR m.role LIKE CONCAT('%', ?, '%'))
        ORDER BY m.updated_at DESC LIMIT ${limit}`,
      [request.actor.tenantId, search, search, search]
    );
    return response.json({ users: rows.map((row) => ({ membershipId: row.membership_id, userId: row.user_id, organizationId: row.organization_id, organizationType: row.organization_type, displayName: row.display_name, role: row.role, transactionRole: row.transaction_role, qualificationState: row.qualification_state, kycLevel: row.kyc_level, status: row.status, userStatus: row.user_status })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/users/:userId/sessions/revoke', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.SECURITY_ADMIN], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const userId = parseId(request.params.userId, 'شناسه کاربر');
    const [users] = await pool.execute(`SELECT id FROM platform_users WHERE id = ? AND tenant_id = ? LIMIT 1`, [userId, request.actor.tenantId]);
    if (!users[0]) throw new DomainError('IAM-404', 'کاربر در Tenant جاری پیدا نشد.', 404);
    const [result] = await pool.execute(`UPDATE platform_refresh_tokens SET revoked_at = NOW() WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL`, [request.actor.tenantId, userId]);
    await domainEvent(request, { eventName: 'SecurityIncidentOpened', entityType: 'platform_user_session', entityId: userId, payload: { action: 'SESSION_REVOKE', revokedCount: result.affectedRows } });
    return jsonResponse({ message: 'نشست‌های فعال کاربر لغو شد و رویداد امنیتی ثبت شد.', userId, revokedCount: result.affectedRows });
  });
});

router.patch('/memberships/:membershipId/status', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.SECURITY_ADMIN, ROLES.COMPLIANCE_OFFICER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const membershipId = parseId(request.params.membershipId, 'شناسه عضویت');
    const status = String(request.body?.status || '').toLowerCase();
    if (!['active', 'suspended', 'locked'].includes(status)) throw new DomainError('IAM-422', 'وضعیت عضویت معتبر نیست.', 422);
    const [rows] = await pool.execute(`SELECT id, user_id, organization_id FROM organization_memberships WHERE id = ? AND tenant_id = ? LIMIT 1`, [membershipId, request.actor.tenantId]);
    const item = rows[0];
    if (!item) throw new DomainError('IAM-404', 'عضویت پیدا نشد.', 404);
    assertNotOwnOrganization(request, item.organization_id);
    await pool.execute(`UPDATE organization_memberships SET status = ? WHERE id = ? AND tenant_id = ?`, [status, membershipId, request.actor.tenantId]);
    if (status !== 'active') await pool.execute(`UPDATE platform_refresh_tokens SET revoked_at = NOW() WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL`, [request.actor.tenantId, item.user_id]);
    await domainEvent(request, { eventName: 'SecurityIncidentOpened', entityType: 'organization_membership', entityId: membershipId, payload: { action: 'MEMBERSHIP_STATUS_CHANGED', status, userId: item.user_id, organizationId: item.organization_id } });
    return jsonResponse({ message: 'وضعیت عضویت به‌روزرسانی و حسابرسی شد.', membershipId, status });
  });
});

router.get('/marketplace', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.CONFLICT_OFFICER, ROLES.RISK_MANAGER, ROLES.SECURITY_ADMIN], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const [rows] = await pool.execute(
      `SELECT r.id, r.case_id, r.level, r.state, r.publisher_org_id, r.deadline_at, r.awarded_org_id, r.awarded_at,
              c.case_number, c.direction, c.origin_country, c.destination_country,
              (SELECT COUNT(*) FROM rfq_quotes q WHERE q.rfq_id = r.id AND q.tenant_id = r.tenant_id) AS quote_count
         FROM rfq_books r JOIN shipment_cases c ON c.id = r.case_id AND c.tenant_id = r.tenant_id
        WHERE r.tenant_id = ? ORDER BY r.updated_at DESC LIMIT ${limit}`,
      [request.actor.tenantId]
    );
    return response.json({ rfqs: rows.map((row) => ({ id: row.id, caseId: row.case_id, caseNumber: row.case_number, level: row.level, state: row.state, publisherOrgId: row.publisher_org_id, deadlineAt: row.deadline_at, awardedOrgId: row.awarded_org_id, awardedAt: row.awarded_at, direction: row.direction, route: { originCountry: row.origin_country, destinationCountry: row.destination_country }, quoteCount: Number(row.quote_count || 0), quoteBody: null })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/trips', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.SECURITY_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const [rows] = await pool.execute(
      `SELECT t.id, t.case_id, t.x_org_id, t.y_org_id, t.driver_id, t.vehicle_id, t.state, t.tracking_state, t.last_location_at, t.eta_at,
              t.last_milestone, c.case_number, c.direction, c.origin_country, c.destination_country, c.customs_state, c.tir_state, c.delivery_state
         FROM trip_cases t JOIN shipment_cases c ON c.id = t.case_id AND c.tenant_id = t.tenant_id
        WHERE t.tenant_id = ? ORDER BY t.updated_at DESC LIMIT ${limit}`,
      [request.actor.tenantId]
    );
    return response.json({ trips: rows.map((row) => ({ id: row.id, caseId: row.case_id, caseNumber: row.case_number, xOrgId: row.x_org_id, yOrgId: row.y_org_id, driverId: row.driver_id, vehicleId: row.vehicle_id, state: row.state, trackingState: row.tracking_state, lastLocationAt: row.last_location_at, etaAt: row.eta_at, lastMilestone: row.last_milestone, direction: row.direction, route: { originCountry: row.origin_country, destinationCountry: row.destination_country }, customsState: row.customs_state, tirState: row.tir_state, deliveryState: row.delivery_state, rawLocation: null })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/qualification', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.COMPLIANCE_OFFICER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const [organizations] = await pool.execute(
      `SELECT id, organization_type, display_name, status, qualification_state, created_at, updated_at
         FROM platform_organizations
        WHERE tenant_id = ? AND (qualification_state <> 'APPROVED' OR status IN ('suspended', 'inactive'))
        ORDER BY updated_at ASC LIMIT ${limit}`,
      [request.actor.tenantId]
    );
    const [memberships] = await pool.execute(
      `SELECT m.id AS membership_id, m.organization_id, m.user_id, m.role, m.qualification_state, m.kyc_level, m.status, u.display_name
         FROM organization_memberships m JOIN platform_users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND m.qualification_state <> 'APPROVED'
        ORDER BY m.updated_at ASC LIMIT ${limit}`,
      [request.actor.tenantId]
    );
    return response.json({ organizations: organizations.map(publicOrganization), memberships: memberships.map((row) => ({ membershipId: row.membership_id, organizationId: row.organization_id, userId: row.user_id, displayName: row.display_name, role: row.role, qualificationState: row.qualification_state, kycLevel: row.kyc_level, status: row.status })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/qualification/:kind/:id/decision', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.COMPLIANCE_OFFICER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requirePurpose(request);
    requireTraceableActor(request);
    const kind = String(request.params.kind || '').toLowerCase();
    const targetId = parseText(decodeURIComponent(String(request.params.id || '')), 'شناسه هدف', { min: 1, max: 128 });
    const state = qualificationState(request.body?.decision);
    const reason = parseText(request.body?.reason, 'دلیل تصمیم', { min: 8, max: 1000 });
    if (state === 'SUSPENDED' || state === 'REJECTED') requireStepUp(request);
    let targetOrganizationId = targetId;
    if (kind === 'organization') {
      const [rows] = await pool.execute(`SELECT id FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [targetId, request.actor.tenantId]);
      if (!rows[0]) throw new DomainError('QUA-404', 'سازمان در صف احراز صلاحیت پیدا نشد.', 404);
    } else if (kind === 'membership') {
      const membershipId = parseId(targetId, 'شناسه عضویت');
      const [rows] = await pool.execute(`SELECT id, organization_id FROM organization_memberships WHERE id = ? AND tenant_id = ? LIMIT 1`, [membershipId, request.actor.tenantId]);
      if (!rows[0]) throw new DomainError('QUA-404', 'عضویت در صف احراز صلاحیت پیدا نشد.', 404);
      targetOrganizationId = rows[0].organization_id;
    } else {
      throw new DomainError('QUA-400', 'نوع هدف احراز صلاحیت معتبر نیست.', 400);
    }
    assertNotOwnOrganization(request, targetOrganizationId);
    if (kind === 'organization') {
      await pool.execute(`UPDATE platform_organizations SET qualification_state = ?, status = CASE WHEN ? = 'SUSPENDED' THEN 'suspended' WHEN status = 'suspended' AND ? = 'APPROVED' THEN 'active' ELSE status END WHERE id = ? AND tenant_id = ?`, [state, state, state, targetId, request.actor.tenantId]);
    } else {
      await pool.execute(`UPDATE organization_memberships SET qualification_state = ?, status = CASE WHEN ? = 'SUSPENDED' THEN 'suspended' WHEN status = 'suspended' AND ? = 'APPROVED' THEN 'active' ELSE status END WHERE id = ? AND tenant_id = ?`, [state, state, state, Number(targetId), request.actor.tenantId]);
    }
    await domainEvent(request, { eventName: 'QualificationDecisionRecorded', entityType: `qualification_${kind}`, entityId: kind === 'membership' ? Number(targetId) : null, payload: { kind, targetId, targetOrganizationId, state, reason } });
    return jsonResponse({ message: 'تصمیم احراز صلاحیت ثبت و حسابرسی شد.', kind, targetId, targetOrganizationId, state }, 201);
  });
});

router.get('/cases', platformAuth({ roles: ALL_GOVERNANCE_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const requestedType = request.query.caseType ? String(request.query.caseType).toUpperCase() : '';
    const caseType = requestedType ? assertCaseType(request, requestedType) : null;
    const state = request.query.state ? String(request.query.state).toUpperCase() : '';
    if (state && !CASE_STATES.includes(state)) throw new DomainError('CASE-422', 'وضعیت صف حاکمیتی معتبر نیست.', 422);
    const limit = parseLimit(request.query.limit);
    const allowedTypes = caseType ? [caseType] : caseTypesFor(request);
    if (!allowedTypes.length) throw new DomainError(ERROR_CODES.ADMIN_PERMISSION, 'برای این نقش صف پرونده حاکمیتی تعریف نشده است.', 403);
    const typePlaceholders = allowedTypes.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `SELECT id, case_type, subject_tenant_id, subject_org_id, subject_type, subject_id, signal, severity, score, source, state, reason, evidence_json,
              reviewer_user_id, outcome, remediation, created_by_user_id, created_at, updated_at
         FROM admin_governance_cases
        WHERE tenant_id = ? AND case_type IN (${typePlaceholders}) AND (? = '' OR state = ?)
        ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low'), created_at DESC LIMIT ${limit}`,
      [request.actor.tenantId, ...allowedTypes, state, state]
    );
    return response.json({ cases: rows.map(publicAdminCase) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/cases', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.CONFLICT_OFFICER, ROLES.SECURITY_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    const caseType = assertCaseType(request, request.body?.caseType);
    const signal = parseText(request.body?.signal, 'سیگنال پرونده', { min: 3, max: 120 });
    const reason = parseText(request.body?.reason, 'دلیل پرونده', { min: 8, max: 1000 });
    const severity = String(request.body?.severity || 'medium').toLowerCase();
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) throw new DomainError('CASE-422', 'شدت پرونده معتبر نیست.', 422);
    const subjectOrgId = request.body?.subjectOrgId ? parseText(request.body.subjectOrgId, 'سازمان موضوع پرونده', { min: 1, max: 128 }) : null;
    if (subjectOrgId) {
      const [subjectRows] = await pool.execute(`SELECT id FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [subjectOrgId, request.actor.tenantId]);
      if (!subjectRows[0]) throw new DomainError('AUTH-403', 'سازمان موضوع پرونده خارج از Tenant جاری است.', 403);
    }
    assertNotOwnOrganization(request, subjectOrgId);
    const evidence = request.body?.evidence && typeof request.body.evidence === 'object' ? redact(request.body.evidence) : {};
    const [result] = await pool.execute(
      `INSERT INTO admin_governance_cases
        (tenant_id, case_type, subject_tenant_id, subject_org_id, subject_type, subject_id, signal, severity, score, source, state, reason, evidence_json, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
      [request.actor.tenantId, caseType, request.body?.subjectTenantId || request.actor.tenantId, subjectOrgId, request.body?.subjectType || null, request.body?.subjectId || null, signal, severity, request.body?.score ?? null, request.body?.source || 'manual', reason, JSON.stringify(evidence), request.actor.userId]
    );
    const eventName = caseType === 'CONFLICT' ? 'ConflictCaseUpdated' : caseType === 'SECURITY' ? 'SecurityIncidentOpened' : caseType === 'RISK' ? 'RiskFlagged' : 'ExceptionOpened';
    await domainEvent(request, { eventName, entityType: 'admin_governance_case', entityId: result.insertId, payload: { caseType, signal, severity, subjectOrgId } });
    return jsonResponse({ message: 'پرونده حاکمیتی ایجاد و حسابرسی شد.', caseId: result.insertId, caseType, state: 'OPEN' }, 201);
  });
});

router.patch('/cases/:caseId', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.CONFLICT_OFFICER, ROLES.SECURITY_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER, ROLES.CUSTOMER_SUPPORT, ROLES.FINANCE_ADMIN], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const caseId = parseId(request.params.caseId, 'شناسه پرونده');
    const [rows] = await pool.execute(`SELECT * FROM admin_governance_cases WHERE id = ? AND tenant_id = ? LIMIT 1`, [caseId, request.actor.tenantId]);
    const item = rows[0];
    if (!item) throw new DomainError('CASE-404', 'پرونده حاکمیتی پیدا نشد.', 404);
    assertCaseType(request, item.case_type);
    const nextState = String(request.body?.state || item.state).toUpperCase();
    if (!CASE_STATES.includes(nextState)) throw new DomainError('CASE-422', 'وضعیت پرونده معتبر نیست.', 422);
    if (['RESTRICTED', 'ESCALATED', 'RESOLVED'].includes(nextState)) requireStepUp(request);
    const outcome = request.body?.outcome === undefined ? item.outcome : parseText(request.body.outcome, 'نتیجه پرونده', { min: 3, max: 500 });
    const remediation = request.body?.remediation === undefined ? item.remediation : String(request.body.remediation || '').trim().slice(0, 1000);
    await pool.execute(`UPDATE admin_governance_cases SET state = ?, reviewer_user_id = ?, outcome = ?, remediation = ?, updated_by_user_id = ? WHERE id = ? AND tenant_id = ?`, [nextState, request.actor.userId || null, outcome, remediation, request.actor.userId || null, caseId, request.actor.tenantId]);
    await domainEvent(request, { eventName: item.case_type === 'CONFLICT' ? 'ConflictCaseUpdated' : item.case_type === 'SECURITY' ? 'SecurityIncidentOpened' : 'ExceptionUpdated', entityType: 'admin_governance_case', entityId: caseId, payload: { caseType: item.case_type, from: item.state, to: nextState, outcome, remediation } });
    return jsonResponse({ message: 'پرونده حاکمیتی به‌روزرسانی و حسابرسی شد.', caseId, state: nextState });
  });
});

router.get('/claims', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER, ROLES.CUSTOMER_SUPPORT, ROLES.FINANCE_ADMIN], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const [rows] = await pool.execute(`SELECT p.id, p.case_id, p.trip_id, p.case_type, p.status, p.opened_by_org_id, p.timing_warning, p.created_at, p.updated_at, c.case_number, c.direction, c.delivery_state, c.financial_state FROM platform_claims p JOIN shipment_cases c ON c.id = p.case_id AND c.tenant_id = p.tenant_id WHERE p.tenant_id = ? ORDER BY p.created_at DESC LIMIT ${limit}`, [request.actor.tenantId]);
    return response.json({ claims: rows.map((row) => ({ id: row.id, caseId: row.case_id, tripId: row.trip_id, caseNumber: row.case_number, caseType: row.case_type, status: row.status, openedByOrgId: row.opened_by_org_id, timingWarning: Boolean(row.timing_warning), direction: row.direction, deliveryState: row.delivery_state, financialState: row.financial_state, evidence: null, createdAt: row.created_at, updatedAt: row.updated_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

function auditQuery(request, extra = {}) {
  const where = ['tenant_id = ?'];
  const params = [request.actor.tenantId];
  const add = (sql, value) => { if (value !== undefined && value !== null && String(value) !== '') { where.push(sql); params.push(value); } };
  add('actor_id = ?', request.query.actorId ? parseId(request.query.actorId, 'شناسه کاربر') : null);
  add('organization_id = ?', request.query.organizationId ? String(request.query.organizationId).slice(0, 128) : null);
  add('event_type = ?', request.query.eventType ? String(request.query.eventType).slice(0, 80) : null);
  add('subject_type = ?', request.query.subjectType ? String(request.query.subjectType).slice(0, 80) : null);
  add('subject_id = ?', request.query.subjectId ? parseId(request.query.subjectId, 'شناسه موضوع') : null);
  add('correlation_id = ?', request.query.correlationId ? String(request.query.correlationId).slice(0, 128) : null);
  add('created_at >= ?', request.query.from ? new Date(request.query.from) : null);
  add('created_at <= ?', request.query.to ? new Date(request.query.to) : null);
  for (const [sql, value] of Object.entries(extra)) add(sql, value);
  return { where: where.join(' AND '), params };
}

router.get('/audit', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.CONFLICT_OFFICER, ROLES.SECURITY_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER, ROLES.FINANCE_ADMIN, ROLES.DATA_GOVERNANCE_OFFICER], permission: PERMISSIONS.SEE_AUDIT }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const query = auditQuery(request);
    const [rows] = await pool.execute(`SELECT id, actor_id, organization_id, event_type, subject_type, subject_id, payload_json, correlation_id, event_version, created_at FROM audit_events WHERE ${query.where} ORDER BY created_at DESC LIMIT ${limit}`, query.params);
    return response.json({ items: rows.map(publicAudit), appendOnly: true, deleteCapability: false });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/audit/:auditId', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.CONFLICT_OFFICER, ROLES.SECURITY_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER, ROLES.FINANCE_ADMIN, ROLES.DATA_GOVERNANCE_OFFICER], permission: PERMISSIONS.SEE_AUDIT }), async (request, response) => {
  try {
    requirePurpose(request);
    const auditId = parseId(request.params.auditId, 'شناسه حسابرسی');
    const [rows] = await pool.execute(`SELECT id, actor_id, organization_id, event_type, subject_type, subject_id, payload_json, correlation_id, event_version, created_at FROM audit_events WHERE id = ? AND tenant_id = ? LIMIT 1`, [auditId, request.actor.tenantId]);
    if (!rows[0]) throw new DomainError('AUD-404', 'رویداد حسابرسی پیدا نشد.', 404);
    return response.json({ item: publicAudit(rows[0]), appendOnly: true });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/break-glass', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.SECURITY_ADMIN, ROLES.CONFLICT_OFFICER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const ownOnly = ![ROLES.SUPER_ADMIN, ROLES.SECURITY_ADMIN, ROLES.CONFLICT_OFFICER].includes(actorRole(request)) ? ' AND requester_user_id = ?' : '';
    const params = [request.actor.tenantId];
    if (ownOnly) params.push(request.actor.userId || 0);
    const [rows] = await pool.execute(`SELECT id, requester_user_id, requester_org_id, target_tenant_id, target_type, target_id, scope_json, reason, incident_ref, duration_minutes, state, approved_by_user_id, approved_at, expires_at, revoked_by_user_id, revoked_at, created_at, updated_at FROM admin_break_glass_requests WHERE tenant_id = ?${ownOnly} ORDER BY created_at DESC LIMIT ${limit}`, params);
    return response.json({ requests: rows.map((row) => ({ id: row.id, requesterUserId: row.requester_user_id, requesterOrgId: row.requester_org_id, targetTenantId: row.target_tenant_id, targetType: row.target_type, targetId: row.target_id, scope: redact(parseJson(row.scope_json, {})), reason: row.reason, incidentRef: row.incident_ref, durationMinutes: row.duration_minutes, state: row.state, approvedByUserId: row.approved_by_user_id, approvedAt: row.approved_at, expiresAt: row.expires_at, revokedByUserId: row.revoked_by_user_id, revokedAt: row.revoked_at, createdAt: row.created_at, updatedAt: row.updated_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/break-glass', platformAuth({ roles: BREAK_GLASS_REQUEST_ROLES, permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const targetType = parseText(request.body?.targetType, 'نوع هدف دسترسی اضطراری', { min: 2, max: 64 });
    const targetId = request.body?.targetId ? parseText(request.body.targetId, 'شناسه هدف', { min: 1, max: 128 }) : null;
    const reason = parseText(request.body?.reason, 'دلیل دسترسی اضطراری', { min: 12, max: 1000 });
    const incidentRef = parseText(request.body?.incidentRef, 'مرجع حادثه یا پرونده', { min: 3, max: 160 });
    const durationMinutes = Math.min(Math.max(Number(request.body?.durationMinutes || 15), 5), 60);
    const scope = request.body?.scope && typeof request.body.scope === 'object' ? redact(request.body.scope) : {};
    const targetTenantId = request.body?.targetTenantId ? parseText(request.body.targetTenantId, 'Tenant هدف', { min: 1, max: 64 }) : request.actor.tenantId;
    if (targetTenantId !== request.actor.tenantId && actorRole(request) !== ROLES.SUPER_ADMIN) throw new DomainError(ERROR_CODES.ADMIN_PERMISSION, 'دسترسی اضطراری خارج از Tenant جاری مجاز نیست.', 403);
    const [result] = await pool.execute(`INSERT INTO admin_break_glass_requests (tenant_id, requester_user_id, requester_org_id, target_tenant_id, target_type, target_id, scope_json, reason, incident_ref, duration_minutes, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED')`, [request.actor.tenantId, request.actor.userId, request.actor.organizationId, targetTenantId, targetType, targetId, JSON.stringify(scope), reason, incidentRef, durationMinutes]);
    await domainEvent(request, { eventName: 'BreakGlassRequested', entityType: 'break_glass_request', entityId: result.insertId, payload: { targetType, targetId, targetTenantId, durationMinutes, incidentRef } });
    return jsonResponse({ message: 'درخواست Break-Glass برای تأیید دوم ثبت شد.', requestId: result.insertId, state: 'REQUESTED' }, 201);
  });
});

router.post('/break-glass/:requestId/approve', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.SECURITY_ADMIN, ROLES.CONFLICT_OFFICER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const requestId = parseId(request.params.requestId, 'شناسه درخواست Break-Glass');
    const [rows] = await pool.execute(`SELECT * FROM admin_break_glass_requests WHERE id = ? AND tenant_id = ? LIMIT 1`, [requestId, request.actor.tenantId]);
    const item = rows[0];
    if (!item) throw new DomainError('ADM-404', 'درخواست Break-Glass پیدا نشد.', 404);
    if (item.state !== 'REQUESTED') throw new DomainError('ADM-409', 'درخواست Break-Glass در وضعیت قابل تأیید نیست.', 409);
    if (String(item.requester_user_id) === String(request.actor.userId)) throw new DomainError('ADM-403', 'درخواست‌کننده نمی‌تواند تأییدکننده همان دسترسی اضطراری باشد.', 403);
    await pool.execute(`UPDATE admin_break_glass_requests SET state = 'APPROVED', approved_by_user_id = ?, approved_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL duration_minutes MINUTE) WHERE id = ? AND tenant_id = ? AND state = 'REQUESTED'`, [request.actor.userId, requestId, request.actor.tenantId]);
    await domainEvent(request, { eventName: 'BreakGlassApproved', entityType: 'break_glass_request', entityId: requestId, payload: { requesterUserId: item.requester_user_id, approvedBy: request.actor.userId, durationMinutes: item.duration_minutes } });
    return jsonResponse({ message: 'دسترسی اضطراری با کنترل دو نفره فعال شد.', requestId, state: 'APPROVED' });
  });
});

router.post('/break-glass/:requestId/revoke', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.SECURITY_ADMIN], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const requestId = parseId(request.params.requestId, 'شناسه درخواست Break-Glass');
    const [result] = await pool.execute(`UPDATE admin_break_glass_requests SET state = 'REVOKED', revoked_by_user_id = ?, revoked_at = NOW() WHERE id = ? AND tenant_id = ? AND state = 'APPROVED'`, [request.actor.userId, requestId, request.actor.tenantId]);
    if (!result.affectedRows) throw new DomainError('ADM-409', 'دسترسی اضطراری فعال پیدا نشد.', 409);
    await domainEvent(request, { eventName: 'BreakGlassRevoked', entityType: 'break_glass_request', entityId: requestId, payload: { revokedBy: request.actor.userId } });
    return jsonResponse({ message: 'دسترسی اضطراری لغو شد.', requestId, state: 'REVOKED' });
  });
});

router.get('/rulepacks', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const state = request.query.state ? String(request.query.state).toUpperCase() : '';
    if (state && !RULEPACK_STATES.includes(state)) throw new DomainError(ERROR_CODES.RULEPACK_STATE, 'وضعیت RulePack معتبر نیست.', 409);
    const [rows] = await pool.execute(`SELECT id, rule_key, version_no, state, level, source_type, source_ref, valid_from, valid_to, route_scope, cargo_scope, rules_json, hard_gate, created_by_user_id, approved_by_user_id, approved_at, activated_at, superseded_at, created_at, updated_at FROM admin_rulepacks WHERE tenant_id = ? AND (? = '' OR state = ?) ORDER BY updated_at DESC LIMIT ${limit}`, [request.actor.tenantId, state, state]);
    return response.json({ rulePacks: rows.map(publicRulePack), activeRulesAreVersioned: true });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/rulepacks', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.COMPLIANCE_OFFICER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    const input = assertRulePackInput(request.body);
    const sourceRef = parseText(request.body?.sourceRef, 'مرجع منبع RulePack', { min: 3, max: 500 });
    const versionNo = Number(request.body?.versionNo || 0);
    let nextVersion = versionNo;
    if (!Number.isInteger(nextVersion) || nextVersion < 1) {
      const [rows] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS version_no FROM admin_rulepacks WHERE tenant_id = ? AND rule_key = ?`, [request.actor.tenantId, input.ruleKey]);
      nextVersion = Number(rows[0]?.version_no || 0) + 1;
    }
    const [result] = await pool.execute(`INSERT INTO admin_rulepacks (tenant_id, rule_key, version_no, state, level, source_type, source_ref, valid_from, valid_to, route_scope, cargo_scope, rules_json, hard_gate, created_by_user_id) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [request.actor.tenantId, input.ruleKey, nextVersion, input.level, input.sourceType, sourceRef, request.body?.validFrom || null, request.body?.validTo || null, JSON.stringify(request.body?.routeScope || {}), JSON.stringify(request.body?.cargoScope || {}), JSON.stringify(request.body.rules), input.hardGate ? 1 : 0, request.actor.userId]);
    await domainEvent(request, { eventName: 'RulePackStateChanged', entityType: 'rulepack', entityId: result.insertId, payload: { ruleKey: input.ruleKey, versionNo: nextVersion, from: null, to: 'DRAFT', level: input.level, sourceType: input.sourceType } });
    return jsonResponse({ message: 'نسخه Draft RulePack ثبت شد.', rulePackId: result.insertId, ruleKey: input.ruleKey, versionNo: nextVersion, state: 'DRAFT' }, 201);
  });
});

router.post('/rulepacks/:rulePackId/transition', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.COMPLIANCE_OFFICER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const rulePackId = parseId(request.params.rulePackId, 'شناسه RulePack');
    const nextState = String(request.body?.state || '').toUpperCase();
    const [rows] = await pool.execute(`SELECT * FROM admin_rulepacks WHERE id = ? AND tenant_id = ? LIMIT 1`, [rulePackId, request.actor.tenantId]);
    const item = rows[0];
    if (!item) throw new DomainError('RULE-404', 'RulePack پیدا نشد.', 404);
    assertRulePackTransition(item.state, nextState);
    if (nextState === 'APPROVED' && String(item.created_by_user_id) === String(request.actor.userId)) throw new DomainError('ADM-403', 'ایجادکننده RulePack نمی‌تواند همان نسخه را تأیید کند.', 403);
    if (nextState === 'ACTIVE' && (!item.approved_by_user_id || (item.level === 'C' && item.hard_gate))) throw new DomainError(ERROR_CODES.COMPLIANCE_BLOCK, 'RulePack برای فعال‌سازی تأیید نشده یا Hard Gate نامعتبر دارد.', 451);
    const fields = ['state = ?'];
    const params = [nextState];
    if (nextState === 'APPROVED') { fields.push('approved_by_user_id = ?', 'approved_at = NOW()'); params.push(request.actor.userId); }
    if (nextState === 'ACTIVE') fields.push('activated_at = NOW()');
    if (nextState === 'SUPERSEDED') fields.push('superseded_at = NOW()');
    params.push(rulePackId, request.actor.tenantId);
    await pool.execute(`UPDATE admin_rulepacks SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    await domainEvent(request, { eventName: 'RulePackStateChanged', entityType: 'rulepack', entityId: rulePackId, payload: { ruleKey: item.rule_key, versionNo: item.version_no, from: item.state, to: nextState } });
    return jsonResponse({ message: `RulePack به وضعیت ${nextState} منتقل شد.`, rulePackId, state: nextState });
  });
});

router.get('/pricing', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.FINANCE_ADMIN], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const [rows] = await pool.execute(`SELECT id, policy_key, version_no, state, allowed_components_json, platform_fee_json, rate_range_json, fx_source_json, valid_until_rules_json, outlier_policy_json, created_by_user_id, approved_by_user_id, approved_at, activated_at, created_at, updated_at FROM admin_pricing_policies WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT ${limit}`, [request.actor.tenantId]);
    return response.json({ policies: rows.map((row) => ({ id: row.id, policyKey: row.policy_key, versionNo: row.version_no, state: row.state, allowedComponents: parseJson(row.allowed_components_json, []), platformFee: parseJson(row.platform_fee_json, {}), rateRange: parseJson(row.rate_range_json, {}), fxSource: parseJson(row.fx_source_json, {}), validUntilRules: parseJson(row.valid_until_rules_json, {}), outlierPolicy: parseJson(row.outlier_policy_json, {}), createdByUserId: row.created_by_user_id, approvedByUserId: row.approved_by_user_id, approvedAt: row.approved_at, activatedAt: row.activated_at, createdAt: row.created_at, updatedAt: row.updated_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/pricing', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.FINANCE_ADMIN], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    const policyKey = parseText(request.body?.policyKey, 'کلید سیاست قیمت', { min: 3, max: 120 });
    if (!/^[A-Za-z0-9_.:-]+$/.test(policyKey)) throw new DomainError('PRICE-422', 'کلید سیاست قیمت معتبر نیست.', 422);
    const allowedComponents = Array.isArray(request.body?.allowedComponents) ? request.body.allowedComponents.map((item) => String(item).trim()).filter(Boolean).slice(0, 100) : [];
    if (!allowedComponents.length) throw new DomainError('PRICE-422', 'اجزای مجاز قیمت‌گذاری الزامی است.', 422);
    const [versionRows] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS version_no FROM admin_pricing_policies WHERE tenant_id = ? AND policy_key = ?`, [request.actor.tenantId, policyKey]);
    const versionNo = Number(request.body?.versionNo || versionRows[0]?.version_no || 0) || 0;
    const nextVersion = versionNo > 0 ? versionNo : Number(versionRows[0]?.version_no || 0) + 1;
    const [result] = await pool.execute(`INSERT INTO admin_pricing_policies (tenant_id, policy_key, version_no, state, allowed_components_json, platform_fee_json, rate_range_json, fx_source_json, valid_until_rules_json, outlier_policy_json, created_by_user_id) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)`, [request.actor.tenantId, policyKey, nextVersion, JSON.stringify(allowedComponents), JSON.stringify(request.body?.platformFee || {}), JSON.stringify(request.body?.rateRange || {}), JSON.stringify(request.body?.fxSource || {}), JSON.stringify(request.body?.validUntilRules || {}), JSON.stringify(request.body?.outlierPolicy || {}), request.actor.userId]);
    await domainEvent(request, { eventName: 'RulePackStateChanged', entityType: 'pricing_policy', entityId: result.insertId, payload: { policyKey, versionNo: nextVersion, state: 'DRAFT' } });
    return jsonResponse({ message: 'نسخه Draft سیاست قیمت‌گذاری ثبت شد.', policyId: result.insertId, policyKey, versionNo: nextVersion, state: 'DRAFT' }, 201);
  });
});

router.post('/pricing/:policyId/approve', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.FINANCE_ADMIN], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const policyId = parseId(request.params.policyId, 'شناسه سیاست قیمت');
    const [rows] = await pool.execute(`SELECT * FROM admin_pricing_policies WHERE id = ? AND tenant_id = ? LIMIT 1`, [policyId, request.actor.tenantId]);
    const policy = rows[0];
    if (!policy) throw new DomainError('PRICE-404', 'سیاست قیمت پیدا نشد.', 404);
    if (policy.state !== 'DRAFT' || String(policy.created_by_user_id) === String(request.actor.userId)) throw new DomainError('ADM-403', 'تأیید سیاست باید روی Draft و توسط شخصی غیر از ایجادکننده انجام شود.', 403);
    await pool.execute(`UPDATE admin_pricing_policies SET state = 'APPROVED', approved_by_user_id = ?, approved_at = NOW() WHERE id = ? AND tenant_id = ? AND state = 'DRAFT'`, [request.actor.userId, policyId, request.actor.tenantId]);
    await domainEvent(request, { eventName: 'RulePackStateChanged', entityType: 'pricing_policy', entityId: policyId, payload: { policyKey: policy.policy_key, versionNo: policy.version_no, from: 'DRAFT', to: 'APPROVED' } });
    return jsonResponse({ message: 'سیاست قیمت توسط شخص دوم تأیید شد.', policyId, state: 'APPROVED' });
  });
});

router.post('/pricing/:policyId/activate', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.FINANCE_ADMIN], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const policyId = parseId(request.params.policyId, 'شناسه سیاست قیمت');
    const [rows] = await pool.execute(`SELECT * FROM admin_pricing_policies WHERE id = ? AND tenant_id = ? LIMIT 1`, [policyId, request.actor.tenantId]);
    const policy = rows[0];
    if (!policy || policy.state !== 'APPROVED') throw new DomainError('PRICE-409', 'فقط سیاست Approved قابل فعال‌سازی است.', 409);
    await pool.execute(`UPDATE admin_pricing_policies SET state = 'ACTIVE', activated_at = NOW() WHERE id = ? AND tenant_id = ? AND state = 'APPROVED'`, [policyId, request.actor.tenantId]);
    await domainEvent(request, { eventName: 'RulePackStateChanged', entityType: 'pricing_policy', entityId: policyId, payload: { policyKey: policy.policy_key, versionNo: policy.version_no, from: 'APPROVED', to: 'ACTIVE' } });
    return jsonResponse({ message: 'سیاست قیمت فعال شد و Price Book بازارها ادغام نشد.', policyId, state: 'ACTIVE' });
  });
});

router.get('/finance', platformAuth({ roles: [ROLES.FINANCE_ADMIN], permission: PERMISSIONS.SEE_SETTLEMENT }), async (request, response) => {
  try {
    const [rows] = await pool.execute(`SELECT relationship_type, currency, state, COUNT(*) AS ledger_count, SUM(amount) AS amount_total FROM relationship_ledgers WHERE tenant_id = ? GROUP BY relationship_type, currency, state ORDER BY relationship_type, currency, state`, [request.actor.tenantId]);
    return response.json({ relationships: rows.map((row) => ({ relationshipType: row.relationship_type, currency: row.currency, state: row.state, ledgerCount: Number(row.ledger_count || 0), amountTotal: row.amount_total })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/exports', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.SECURITY_ADMIN, ROLES.DATA_GOVERNANCE_OFFICER, ROLES.CRM_ADMIN, ROLES.SUPPORT_LEAD], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const [rows] = await pool.execute(`SELECT id, requested_by_user_id, organization_id, crm_scope, purpose, scope_json, state, approved_by_user_id, approved_at, executed_by_user_id, executed_at, created_at FROM platform_export_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ${limit}`, [request.actor.tenantId]);
    return response.json({ exports: rows.map((row) => {
      const scope = parseJson(row.scope_json, {});
      return { id: row.id, requestedByUserId: row.requested_by_user_id, organizationId: row.organization_id, crmScope: row.crm_scope, purpose: row.purpose, scopeSummary: { accountIds: Array.isArray(scope.accountIds) ? scope.accountIds.length : 0, caseIds: Array.isArray(scope.caseIds) ? scope.caseIds.length : 0, bookOfBusiness: Boolean(scope.bookOfBusinessId) }, state: row.state, approvedByUserId: row.approved_by_user_id, approvedAt: row.approved_at, executedByUserId: row.executed_by_user_id, executedAt: row.executed_at, createdAt: row.created_at };
    }) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/contact-reveals', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.SECURITY_ADMIN, ROLES.CONFLICT_OFFICER, ROLES.DATA_GOVERNANCE_OFFICER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const limit = parseLimit(request.query.limit);
    const [rows] = await pool.execute(`SELECT id, case_id, actor_user_id, organization_id, reason, expires_at, created_at FROM platform_contact_reveals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ${limit}`, [request.actor.tenantId]);
    return response.json({ reveals: rows.map((row) => ({ id: row.id, caseId: row.case_id, actorUserId: row.actor_user_id, organizationId: row.organization_id, reason: row.reason, expiresAt: row.expires_at, active: new Date(row.expires_at).getTime() > Date.now(), createdAt: row.created_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/crm-governance', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.DATA_GOVERNANCE_OFFICER, ROLES.CRM_ADMIN, ROLES.SUPPORT_LEAD], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const [accounts] = await pool.execute(`SELECT crm_scope, status, COUNT(*) AS total FROM crm_accounts WHERE tenant_id = ? AND is_deleted = 0 GROUP BY crm_scope, status`, [request.actor.tenantId]);
    const [reveals] = await pool.execute(`SELECT COUNT(*) AS total, SUM(expires_at > NOW()) AS active FROM platform_contact_reveals WHERE tenant_id = ?`, [request.actor.tenantId]);
    const [exports] = await pool.execute(`SELECT state, COUNT(*) AS total FROM platform_export_requests WHERE tenant_id = ? GROUP BY state`, [request.actor.tenantId]);
    return response.json({ scopes: accounts, contactReveal: { total: Number(reveals[0]?.total || 0), active: Number(reveals[0]?.active || 0), rawContacts: null }, exports, campaign: { consentRequired: true, dncRequired: true, quietHoursRequired: true, frequencyCapRequired: true, sendCapability: false } });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/bi', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER, ROLES.FINANCE_ADMIN, ROLES.SECURITY_ADMIN, ROLES.DATA_GOVERNANCE_OFFICER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    requirePurpose(request);
    const tenantId = request.actor.tenantId;
    const [cases] = await pool.execute(`SELECT direction, commercial_state, delivery_state, financial_state, COUNT(*) AS total FROM shipment_cases WHERE tenant_id = ? GROUP BY direction, commercial_state, delivery_state, financial_state`, [tenantId]);
    const [trips] = await pool.execute(`SELECT state, tracking_state, COUNT(*) AS total FROM trip_cases WHERE tenant_id = ? GROUP BY state, tracking_state`, [tenantId]);
    const [rfqs] = await pool.execute(`SELECT level, state, COUNT(*) AS total FROM rfq_books WHERE tenant_id = ? GROUP BY level, state`, [tenantId]);
    return response.json({ tenantId, aggregated: true, cases, trips, rfqs, rawBusinessRows: false });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/notification-policies', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.SECURITY_ADMIN], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const [rows] = await pool.execute(`SELECT id, policy_key, label, severity, critical, enabled, channels_json, rate_limit_json, updated_by_user_id, updated_at FROM admin_notification_policies WHERE tenant_id = ? ORDER BY critical DESC, policy_key`, [request.actor.tenantId]);
    return response.json({ policies: rows.map((row) => ({ id: row.id, policyKey: row.policy_key, label: row.label, severity: row.severity, critical: Boolean(row.critical), enabled: Boolean(row.enabled), channels: parseJson(row.channels_json, []), rateLimit: parseJson(row.rate_limit_json, {}), updatedByUserId: row.updated_by_user_id, updatedAt: row.updated_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.patch('/notification-policies/:policyId', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.SECURITY_ADMIN], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    requireTraceableActor(request);
    requireStepUp(request);
    const policyId = parseId(request.params.policyId, 'شناسه سیاست اعلان');
    const [rows] = await pool.execute(`SELECT * FROM admin_notification_policies WHERE id = ? AND tenant_id = ? LIMIT 1`, [policyId, request.actor.tenantId]);
    const policy = rows[0];
    if (!policy) throw new DomainError('NTF-404', 'سیاست اعلان پیدا نشد.', 404);
    const enabled = request.body?.enabled === undefined ? Boolean(policy.enabled) : Boolean(request.body.enabled);
    if (policy.critical && !enabled) throw new DomainError(ERROR_CODES.CRITICAL_NOTIFICATION, 'اعلان‌های بحرانی قابل خاموش‌کردن نیستند.', 403);
    const reason = parseText(request.body?.reason, 'دلیل تغییر سیاست اعلان', { min: 8, max: 500 });
    await pool.execute(`UPDATE admin_notification_policies SET enabled = ?, updated_by_user_id = ? WHERE id = ? AND tenant_id = ?`, [enabled ? 1 : 0, request.actor.userId, policyId, request.actor.tenantId]);
    await domainEvent(request, { eventName: 'NotificationPolicyChanged', entityType: 'notification_policy', entityId: policyId, payload: { policyKey: policy.policy_key, enabled, reason } });
    return jsonResponse({ message: 'سیاست اعلان به‌روزرسانی و حسابرسی شد.', policyId, enabled, critical: Boolean(policy.critical) });
  });
});

router.get('/integrations', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.SECURITY_ADMIN], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const [rows] = await pool.execute(`SELECT id, endpoint_name, endpoint_url, events_json, hmac_state, status, retry_count, last_delivery_at, last_failure_at, updated_at FROM admin_integration_endpoints WHERE tenant_id = ? ORDER BY endpoint_name`, [request.actor.tenantId]);
    return response.json({ integrations: rows.map((row) => ({ id: row.id, endpointName: row.endpoint_name, endpointUrl: row.endpoint_url.replace(/(https?:\/\/)([^/]+)/i, '$1[masked-host]'), events: parseJson(row.events_json, []), hmacState: row.hmac_state, status: row.status, retryCount: row.retry_count, lastDeliveryAt: row.last_delivery_at, lastFailureAt: row.last_failure_at, updatedAt: row.updated_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/ai-monitor', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN, ROLES.SECURITY_ADMIN, ROLES.COMPLIANCE_OFFICER, ROLES.RISK_MANAGER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const limit = parseLimit(request.query.limit);
    const [rows] = await pool.execute(`SELECT id, use_case, model_version, prompt_version, latency_ms, cost_minor_units, error_rate, quality_score, source_status, human_override, budget_state, created_at FROM admin_ai_runs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ${limit}`, [request.actor.tenantId]);
    return response.json({ runs: rows.map((row) => ({ id: row.id, useCase: row.use_case, modelVersion: row.model_version, promptVersion: row.prompt_version, latencyMs: row.latency_ms, costMinorUnits: row.cost_minor_units, errorRate: row.error_rate, qualityScore: row.quality_score, sourceStatus: row.source_status, humanOverride: Boolean(row.human_override), budgetState: row.budget_state, createdAt: row.created_at, bindingActionsAllowed: false })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/health', platformAuth({ roles: [ROLES.SUPER_ADMIN, ROLES.SECURITY_ADMIN], permission: PERMISSIONS.READ }), async (request, response) => {
  const components = {
    api: { state: 'ok' },
    database: { state: 'unknown' },
    queue: { state: process.env.QUEUE_URL ? 'configured' : 'not_configured' },
    objectStorage: { state: process.env.OBJECT_STORAGE_BUCKET ? 'configured' : 'not_configured' },
    notifications: { state: process.env.NOTIFICATION_PROVIDER ? 'configured' : 'not_configured' },
    gpsIngestion: { state: process.env.GPS_INGESTION_URL ? 'configured' : 'not_configured' },
    aiOcr: { state: process.env.AI_PROVIDER ? 'configured' : 'not_configured' },
    webhooks: { state: process.env.WEBHOOK_SIGNING_SECRET ? 'configured' : 'not_configured' },
    backup: { state: process.env.BACKUP_STATUS || 'not_configured', rpo: process.env.BACKUP_RPO || null, rto: process.env.BACKUP_RTO || null, lastRestoreTestAt: process.env.LAST_RESTORE_TEST_AT || null }
  };
  try {
    await pool.execute('SELECT 1');
    components.database.state = 'ok';
    return response.json({ generatedAt: new Date().toISOString(), components, rawBusinessDataRequired: false });
  } catch (_error) {
    components.database.state = 'degraded';
    return response.status(503).json({ generatedAt: new Date().toISOString(), components, rawBusinessDataRequired: false, code: 'SYS-503' });
  }
});

export default router;
