import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { platformAuth, idempotencyKey } from '../security/platform-auth.js';
import { publishPlatformEvent, redactRealtimePayload, subscribeRealtime } from '../realtime/broker.js';
import {
  ERROR_CODES,
  PERMISSIONS,
  RELATIONSHIPS,
  RFQ_LEVELS,
  ROLES,
  hasPermission,
  normalizeRole
} from '../../../shared/contract.js';
import {
  DomainError,
  assertContactReveal,
  assertDelegated,
  assertExportApproval,
  assertHumanAward,
  assertOrganizationScope,
  assertRelationshipAccess,
  assertTenantScope,
  assertTransition,
  assertTripStartReady,
  canReadQuote,
  maskEmail,
  maskPhone,
  parseJson,
  validatePodEvidence
} from '../domain/workflow.js';

const router = Router();

function jsonResponse(body, status = 200) {
  return { body, status };
}

function problem(response, error, request) {
  const status = Number(error.status || error.statusCode || 500);
  return response.status(status).type('application/problem+json').json({
    type: `https://gomrok.org/problems/${error.code || 'PLATFORM-500'}`,
    title: error.code || 'PLATFORM-500',
    status,
    detail: error.message || 'عملیات انجام نشد.',
    code: error.code || 'PLATFORM-500',
    details: error.details || undefined,
    correlationId: request.correlationId
  });
}

function parsePositiveId(value, label = 'شناسه') {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new DomainError('INPUT-400', `${label} معتبر نیست.`, 400);
  return id;
}

function randomCaseNumber() {
  return `GMRK-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60 * 1000);
}

async function audit(request, { eventType, subjectType, subjectId = null, payload = {} }) {
  await pool.execute(
    `INSERT INTO audit_events
      (actor_id, tenant_id, organization_id, event_type, subject_type, subject_id, payload_json, correlation_id, event_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [request.actor.userId || null, request.actor.tenantId, request.actor.organizationId, eventType, subjectType, subjectId, JSON.stringify(payload), request.correlationId]
  );
}

async function event(request, { eventName, entityType, entityId = null, payload = {}, recipientOrgId = null, recipientOrgIds = [] }) {
  const [result] = await pool.execute(
    `INSERT INTO platform_domain_events
      (tenant_id, event_name, event_version, entity_type, entity_id, actor_user_id, correlation_id, payload_json)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
    [request.actor.tenantId, eventName, entityType, entityId, request.actor.userId || null, request.correlationId, JSON.stringify(payload)]
  );
  const recipients = [...new Set([recipientOrgId, ...(Array.isArray(recipientOrgIds) ? recipientOrgIds : [])].filter(Boolean))];
  for (const recipient of recipients) {
    await pool.execute(
      `INSERT INTO platform_notifications
        (tenant_id, event_id, recipient_org_id, channel, state, payload_json)
       VALUES (?, ?, ?, 'in_app', 'pending', ?)`,
        [request.actor.tenantId, result.insertId, recipient, JSON.stringify({ eventName, entityType, entityId, payload: redactRealtimePayload(payload) })]
    );
  }
  await audit(request, { eventType: eventName, subjectType: entityType, subjectId: entityId, payload });
  publishPlatformEvent({
    tenantId: request.actor.tenantId,
    eventName,
    entityType,
    entityId,
    actorOrganizationId: request.actor.organizationId,
    correlationId: request.correlationId,
    payload,
    recipientOrgIds: recipients
  });
  return result.insertId;
}

async function runWrite(request, response, handler, { requireKey = false } = {}) {
  const key = idempotencyKey(request);
  if (requireKey && !key) {
    return problem(response, new DomainError('AUTH-428', 'برای این عملیات حساس X-Idempotency-Key لازم است.', 428), request);
  }

  if (key && request.actor.userId) {
    const [rows] = await pool.execute(
      `SELECT status_code, response_json FROM platform_idempotency_keys
       WHERE tenant_id = ? AND actor_user_id = ? AND idempotency_key = ? LIMIT 1`,
      [request.actor.tenantId, request.actor.userId, key]
    );
    const previous = rows[0];
    if (previous?.status_code) {
      return response.status(previous.status_code).json(parseJson(previous.response_json, {}));
    }
    if (!previous) {
      try {
        await pool.execute(
          `INSERT INTO platform_idempotency_keys
            (tenant_id, actor_user_id, idempotency_key, route)
           VALUES (?, ?, ?, ?)`,
          [request.actor.tenantId, request.actor.userId, key, request.originalUrl]
        );
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          const [retryRows] = await pool.execute(
            `SELECT status_code, response_json FROM platform_idempotency_keys
             WHERE tenant_id = ? AND actor_user_id = ? AND idempotency_key = ? LIMIT 1`,
            [request.actor.tenantId, request.actor.userId, key]
          );
          if (retryRows[0]?.status_code) return response.status(retryRows[0].status_code).json(parseJson(retryRows[0].response_json, {}));
          return problem(response, new DomainError('AUTH-428', 'درخواست تکراری هنوز در حال پردازش است.', 428), request);
        }
        throw error;
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
    if (key && request.actor.userId && error.code) {
      await pool.execute(
        `UPDATE platform_idempotency_keys SET status_code = ?, response_json = ?
         WHERE tenant_id = ? AND actor_user_id = ? AND idempotency_key = ?`,
        [Number(error.status || 422), JSON.stringify({ code: error.code, message: error.message, details: error.details || undefined }), request.actor.tenantId, request.actor.userId, key]
      );
    }
    return problem(response, error, request);
  }
}

async function loadCase(caseId, tenantId) {
  const [rows] = await pool.execute(
    `SELECT c.*, t.driver_id AS assigned_driver_id, t.authorized_agent_org_id AS assigned_agent_org_id
       FROM shipment_cases c LEFT JOIN trip_cases t ON t.case_id = c.id AND t.tenant_id = c.tenant_id
      WHERE c.id = ? AND c.tenant_id = ? LIMIT 1`,
    [caseId, tenantId]
  );
  if (!rows[0]) throw new DomainError('CASE-404', 'پرونده حمل پیدا نشد.', 404);
  return rows[0];
}

async function loadRfq(rfqId, tenantId) {
  const [rows] = await pool.execute('SELECT * FROM rfq_books WHERE id = ? AND tenant_id = ? LIMIT 1', [rfqId, tenantId]);
  if (!rows[0]) throw new DomainError('RFQ-404', 'دفتر پیشنهاد پیدا نشد.', 404);
  return rows[0];
}

async function loadTrip(tripId, tenantId) {
  const [rows] = await pool.execute(
    `SELECT t.*, c.case_number, c.direction, c.owner_org_id, c.x_org_id AS case_x_org_id, c.y_org_id AS case_y_org_id,
            c.origin_country, c.destination_country, c.origin_location, c.destination_location, c.cargo_type, c.cargo_weight, c.cargo_weight_unit, c.deadline_at,
            c.commercial_state, c.capacity_state, c.loading_state, c.customs_state, c.tir_state, c.tir_metadata_json, c.delivery_state,
            c.financial_state, c.payload_json AS case_payload_json
       FROM trip_cases t JOIN shipment_cases c ON c.id = t.case_id AND c.tenant_id = t.tenant_id
      WHERE t.id = ? AND t.tenant_id = ? LIMIT 1`,
    [tripId, tenantId]
  );
  if (!rows[0]) throw new DomainError('TRIP-404', 'سفر پیدا نشد.', 404);
  return rows[0];
}

function relatedToCase(actor, item) {
  if ([ROLES.CONSIGNEE, ROLES.AGENT_Z].includes(normalizeRole(actor.role))) {
    return String(item.assigned_agent_org_id || '') === String(actor.organizationId || '');
  }
  return [item.owner_org_id, item.x_org_id, item.y_org_id, item.assigned_agent_org_id, item.invited_rfq_publisher_org_id].filter(Boolean).includes(actor.organizationId)
    || (normalizeRole(actor.role) === ROLES.DRIVER && String(item.assigned_driver_id) === String(actor.externalId));
}

function relatedToTrip(actor, trip) {
  if ([ROLES.CONSIGNEE, ROLES.AGENT_Z].includes(normalizeRole(actor.role))) {
    return String(trip.authorized_agent_org_id || '') === String(actor.organizationId || '');
  }
  return [trip.owner_org_id, trip.x_org_id, trip.y_org_id, trip.authorized_agent_org_id].filter(Boolean).includes(actor.organizationId)
    || (normalizeRole(actor.role) === ROLES.DRIVER && String(trip.driver_id) === String(actor.externalId))
    || (['risk_manager', 'compliance_officer'].includes(normalizeRole(actor.role)) && Boolean(actor.purpose));
}

function scopeValues(scope) {
  if (Array.isArray(scope)) return scope.map((value) => String(value).toLowerCase());
  if (scope && typeof scope === 'object') {
    const values = scope.allowed || scope.values || scope.items || [];
    return Array.isArray(values) ? values.map((value) => String(value).toLowerCase()) : [];
  }
  return [];
}

function assertAbacCaseScope(actor, item) {
  const routeScope = scopeValues(actor.routeScope);
  const countryScope = scopeValues(actor.countryScope);
  const cargoScope = scopeValues(actor.cargoScope);
  const route = [item.origin_location, item.destination_location].filter(Boolean).map((value) => String(value).toLowerCase());
  const countries = [item.origin_country, item.destination_country].filter(Boolean).map((value) => String(value).toLowerCase());
  const cargo = String(item.cargo_type || '').toLowerCase();
  if (routeScope.length && route.length && !route.some((value) => routeScope.some((allowed) => value.includes(allowed)))) throw new DomainError('AUTH-403', 'کریدور پرونده خارج از route scope عضویت است.', 403, { attribute: 'routeScope' });
  if (countryScope.length && countries.length && !countries.every((value) => countryScope.includes(value))) throw new DomainError('AUTH-403', 'کشور پرونده خارج از country scope عضویت است.', 403, { attribute: 'countryScope' });
  if (cargoScope.length && cargo && !cargoScope.includes(cargo)) throw new DomainError('AUTH-403', 'نوع کالا خارج از cargo scope عضویت است.', 403, { attribute: 'cargoScope' });
}

function inAbacCaseScope(actor, item) {
  try {
    assertAbacCaseScope(actor, item);
    return true;
  } catch (error) {
    if (error.code === 'AUTH-403') return false;
    throw error;
  }
}

function assertCaseAccess(actor, item) {
  if (isShipperActor(actor)) assertShipperOrganization(actor);
  assertTenantScope(actor, item.tenant_id);
  assertAbacCaseScope(actor, item);
  const role = normalizeRole(actor.role);
  const governanceRead = ['super_admin', 'marketplace_admin', 'compliance_officer', 'risk_manager'].includes(role);
  if (!relatedToCase(actor, item) && !governanceRead) {
    throw new DomainError('AUTH-403', 'پرونده خارج از محدوده سازمانی شماست.', 403);
  }
  if (governanceRead && !relatedToCase(actor, item)) {
    const purpose = String(actor.purpose || '').trim().toLowerCase();
    if (purpose.length < 8) throw new DomainError('AUTH-428', 'دسترسی مدیریتی به پرونده نیازمند محدوده هدف و ثبت دلیل است.', 428);
    const references = [`case:${item.id}`, `shipment:${item.id}`, String(item.case_number || '').trim().toLowerCase()].filter((value) => value.length > 5);
    if (!references.some((reference) => purpose.includes(reference))) throw new DomainError('AUTH-403', 'دلیل دسترسی باید به همین پرونده یا شناسه محموله اشاره کند.', 403, { attribute: 'purposeScope' });
  }
}

function assertTripAccess(actor, trip) {
  assertTenantScope(actor, trip.tenant_id);
  assertAbacCaseScope(actor, trip);
  if (!relatedToTrip(actor, trip)) throw new DomainError('AUTH-403', 'سفر خارج از محدوده عملیاتی شماست.', 403);
}

function assertRelationshipCaseBoundary(item, trip, { relationshipType, payerOrgId, payeeOrgId }) {
  const validPairs = [
    [RELATIONSHIPS.CUSTOMER_X, item.owner_org_id, item.x_org_id],
    [RELATIONSHIPS.X_Y, item.x_org_id, item.y_org_id],
    [RELATIONSHIPS.X_AGENT, item.x_org_id, trip?.authorized_agent_org_id || item.assigned_agent_org_id],
    [RELATIONSHIPS.Y_DRIVER, item.y_org_id, trip?.driver_id ? `driver:${trip.driver_id}` : null],
    [RELATIONSHIPS.PLATFORM_FEE, 'platform', item.owner_org_id],
    [RELATIONSHIPS.CREDITS_ADJUSTMENTS, item.owner_org_id, item.x_org_id]
  ];
  const valid = validPairs.some(([type, first, second]) => type === relationshipType && first && second && new Set([first, second]).size === 2 && new Set([first, second]).has(payerOrgId) && new Set([first, second]).has(payeeOrgId));
  if (!valid) throw new DomainError('FIN-403', 'رابطه مالی با طرف‌های همین پرونده منطبق نیست.', 403);
}

async function organizationType(organizationId, tenantId) {
  const [rows] = await pool.execute('SELECT organization_type FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1', [organizationId, tenantId]);
  return rows[0]?.organization_type || null;
}

function publicCase(row) {
  return {
    id: row.id,
    caseNumber: row.case_number,
    direction: row.direction,
    state: row.state,
    commercialState: row.commercial_state,
    importState: row.import_state,
    capacityState: row.capacity_state,
    loadingState: row.loading_state,
    customsState: row.customs_state,
    tirState: row.tir_state,
    tripState: row.trip_state,
    deliveryState: row.delivery_state,
    financialState: row.financial_state,
    origin: { country: row.origin_country, location: row.origin_location },
    destination: { country: row.destination_country, location: row.destination_location },
    cargo: { type: row.cargo_type, description: row.cargo_description, weight: row.cargo_weight, unit: row.cargo_weight_unit },
    deadlineAt: row.deadline_at,
    riskFlags: parseJson(row.risk_flags, []),
    updatedAt: row.updated_at
  };
}

function publicCaseForActor(row, actor) {
  const value = publicCase(row);
  if (normalizeRole(actor?.role) === ROLES.SHIPPER_FINANCE_USER) {
    return {
      ...value,
      state: value.financialState || value.deliveryState || value.commercialState,
      capacityState: null,
      loadingState: null,
      customsState: null,
      tirState: null,
      tripState: null
    };
  }
  if (isShipperActor(actor)) {
    return {
      ...value,
      state: value.deliveryState || value.tripState || value.commercialState,
      capacityState: null
    };
  }
  if (isAgentActor(actor)) {
    return {
      ...value,
      state: value.deliveryState || value.tripState || value.loadingState || value.commercialState,
      commercialState: null,
      capacityState: null,
      financialState: null,
      riskFlags: []
    };
  }
  return { ...value, xOrgId: row.x_org_id, yOrgId: row.y_org_id, xAwardAcceptedAt: row.x_award_accepted_at || null };
}

function publicTrip(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    caseNumber: row.case_number,
    state: row.state,
    trackingState: row.tracking_state,
    carrierAwardAcceptedAt: row.y_award_accepted_at || null,
    driverAssigned: Boolean(row.driver_id),
    vehicleAssigned: Boolean(row.vehicle_id),
    authorizedAgentOrgId: row.authorized_agent_org_id,
    readiness: parseJson(row.readiness_json, {}),
    lastLocationAt: row.last_location_at,
    etaAt: row.eta_at || null,
    deadlineAt: row.deadline_at || null,
    lastMilestone: row.last_milestone || null,
    delayFlags: parseJson(row.delay_flags, [])
  };
}

function publicDriverTrip(row) {
  return {
    ...publicTrip(row),
    direction: row.direction,
    route: {
      originCountry: row.origin_country,
      destinationCountry: row.destination_country,
      origin: row.origin_location,
      destination: row.destination_location
    },
    cargo: { type: row.cargo_type, weight: row.cargo_weight, unit: row.cargo_weight_unit || null },
    yOrgId: row.y_org_id,
    yName: row.y_name || row.y_org_id,
    authorizedAgent: row.agent_name ? { organizationId: row.authorized_agent_org_id, name: row.agent_name } : (row.authorized_agent_org_id ? { organizationId: row.authorized_agent_org_id, name: row.authorized_agent_org_id } : null),
    loadingSchedule: parseJson(row.loading_schedule_json, {}),
    undertakingAcceptedAt: row.undertaking_accepted_at || null,
    undertakingVersion: row.undertaking_version || null,
    podState: row.pod_state || null,
    tirState: row.tir_state || 'NOT_APPLICABLE',
    customsState: row.customs_state || null,
    loadingState: row.loading_state || null
  };
}

function publicDriverOpportunityMetadata(value) {
  const metadata = parseJson(value, {});
  return {
    route: metadata.route || null,
    requiredVehicle: metadata.requiredVehicle || null,
    loadingWindow: metadata.loadingWindow || null,
    permitRules: metadata.permitRules || null,
    operationalInstructions: metadata.operationalInstructions || null,
    settlementConditions: metadata.settlementConditions && typeof metadata.settlementConditions === 'object'
      ? { requiredEvidence: metadata.settlementConditions.requiredEvidence || null, milestone: metadata.settlementConditions.milestone || null }
      : null
  };
}

const SHIPPER_ROLES = [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER, ROLES.SHIPPER_FINANCE_USER, ROLES.CONSIGNEE];
const COMPANY_X_ROLES = [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_X_PRICING_EXPERT, ROLES.COMPANY_X_DISPATCHER, ROLES.COMPANY_X_DOCUMENT_EXPERT];
const COMPANY_X_OPERATION_ROLES = [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_X_DISPATCHER];
const COMPANY_X_POD_ROLES = [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_X_DOCUMENT_EXPERT];
const COMPANY_Y_ROLES = [ROLES.COMPANY_Y_OWNER, ROLES.COMPANY_Y_DOCUMENT_ISSUER];
const COMPANY_Y_OWNER_ROLES = [ROLES.COMPANY_Y_OWNER];
const COMPANY_Y_DOCUMENT_ROLES = [ROLES.COMPANY_Y_DOCUMENT_ISSUER];
const LOADING_EVIDENCE_TYPES = new Set(['ARRIVAL', 'PRELOAD_CHECKLIST', 'LOADING_LIST', 'SCALE_TICKET', 'SEAL', 'LOADING_PHOTO']);
const EXCEPTION_TYPES = new Set(['DOCUMENT_MISMATCH', 'WEIGHT_MISMATCH', 'DRIVER_SUBSTITUTION', 'VEHICLE_SUBSTITUTION', 'SEAL_ISSUE', 'GPS_ISSUE', 'ROUTE_DEVIATION', 'BORDER_DELAY', 'WRONG_RECIPIENT', 'SHORTAGE', 'CARGO_DAMAGE', 'REFUSED_DELIVERY', 'DESTINATION_MISMATCH', 'PAYMENT_INSTRUCTION_CHANGE', 'OTHER']);
const CUSTOMER_DOCUMENT_TYPES = new Set([
  'INVOICE', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'EXPORT_PERMIT', 'IMPORT_PERMIT',
  'CUSTOMS_PERMIT', 'ROUTE_PERMIT', 'COMMERCIAL_DOC', 'CMR_DRAFT', 'CMR_FINAL',
  'TIR_CARNET', 'POD_EVIDENCE', 'WAREHOUSE_RECEIPT', 'RELEASE_DOCUMENT', 'CLEARANCE_DOCUMENT', 'DOMESTIC_POD'
]);
const CUSTOMER_UPLOAD_DOCUMENT_TYPES = new Set([
  'INVOICE', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'EXPORT_PERMIT', 'IMPORT_PERMIT',
  'CUSTOMS_PERMIT', 'ROUTE_PERMIT', 'COMMERCIAL_DOC'
]);
const COMPANY_Y_DOCUMENT_TYPES = new Set([
  'CMR_DRAFT', 'CMR_FINAL', 'TIR_CARNET', 'ROUTE_PERMIT', 'CUSTOMS_PERMIT', 'TRANSIT_PERMIT',
  'DRIVER_HANDOFF', 'VEHICLE_DOCUMENT', 'LOADING_EVIDENCE', 'SCALE_TICKET', 'SEAL_EVIDENCE',
  'POD_EVIDENCE', 'INCIDENT_DOCUMENT', 'WAREHOUSE_RECEIPT', 'RELEASE_DOCUMENT', 'CLEARANCE_DOCUMENT', 'DOMESTIC_POD'
]);
const COMPANY_Y_UPLOAD_DOCUMENT_TYPES = new Set([
  'TIR_CARNET', 'ROUTE_PERMIT', 'CUSTOMS_PERMIT', 'TRANSIT_PERMIT', 'DRIVER_HANDOFF',
  'VEHICLE_DOCUMENT', 'LOADING_EVIDENCE', 'SCALE_TICKET', 'SEAL_EVIDENCE', 'INCIDENT_DOCUMENT'
]);
const DRIVER_DOCUMENT_TYPES = new Set(['PASSPORT', 'DRIVER_LICENSE', 'DRIVER_CARD', 'INTERNATIONAL_TRAVEL_DOC', 'IDENTITY', 'SELFIE', 'VEHICLE_TECHNICAL', 'VEHICLE_INSURANCE']);
const DRIVER_TRAVEL_DOCUMENT_TYPES = new Set(['CMR_FINAL', 'TIR_CARNET', 'TRANSIT_PERMIT', 'ROUTE_PERMIT', 'CUSTOMS_PERMIT', 'DRIVER_HANDOFF']);
const DRIVER_BORDER_EVENTS = new Set(['ARRIVED_BORDER', 'QUEUE_WAITING', 'CUSTOMS_CHECK', 'SEAL_CHECK', 'DOCUMENTS_REQUESTED', 'FINE_FEE', 'ENTERED_COUNTRY', 'DEPARTED_CHECKPOINT']);
const DRIVER_INCIDENT_TYPES = new Set(['BREAKDOWN', 'ACCIDENT', 'ROAD_BORDER_CLOSED', 'ABNORMAL_STOP', 'CARGO_DAMAGE', 'TEMPERATURE_ISSUE', 'SEAL_ISSUE', 'SECURITY_ISSUE', 'OTHER']);
const DRIVER_EVIDENCE_TYPES = new Set(['ARRIVAL', 'PRELOAD_CHECKLIST', 'LOADING_LIST', 'SCALE_TICKET', 'SEAL', 'LOADING_PHOTO', 'INCIDENT']);
const AGENT_DOCUMENT_TYPES = new Set(['AGENT_AUTHORITY', 'CMR_FINAL', 'POD_EVIDENCE', 'SIGNED_CMR', 'WAREHOUSE_RECEIPT', 'UNLOADING_RECEIPT', 'DESTINATION_RECEIPT', 'RELEASE_DOCUMENT', 'CLEARANCE_DOCUMENT', 'DOMESTIC_POD', 'INCIDENT_DOCUMENT']);
const AGENT_EVIDENCE_TYPES = new Set(['VEHICLE_AT_DESTINATION', 'SEAL_BEFORE_OPENING', 'CARGO_BEFORE_UNLOAD', 'UNLOADING', 'CARGO_AFTER_UNLOAD', 'DAMAGE', 'WAREHOUSE', 'RECEIPT', 'SIGNATURE', 'STAMP']);
const AGENT_DEFAULT_ACTIONS = ['read_case', 'verify_delivery', 'upload_evidence', 'request_otp', 'verify_otp', 'submit_pod', 'read_settlement', 'open_claim'];
const DRIVER_UNDERTAKING_VERSION = 'driver-undertaking-v1';
const DRIVER_UNDERTAKING = Object.freeze([
  'صحت اطلاعات و مدارک',
  'حضور به‌موقع در محل بارگیری',
  'عدم حمل کالای اضافه، قاچاق یا مغایر',
  'همکاری صحیح در بارگیری',
  'ثبت عکس و مدارک لازم',
  'حفظ پلمب',
  'فعال نگه داشتن GPS در سفر فعال طبق سیاست',
  'حرکت در مسیر مجاز',
  'اعلام فوری حادثه یا خرابی',
  'تحویل فقط به گیرنده مجاز',
  'اخذ رسید معتبر',
  'پذیرش آثار قراردادی نقص شواهد تحویل',
  'محرمانگی اطلاعات مشتری',
  'منع دورزدن پلتفرم در حدود قرارداد معتبر'
]);

function isShipperActor(actor) {
  return SHIPPER_ROLES.includes(normalizeRole(actor?.role));
}

function isAgentActor(actor) {
  return normalizeRole(actor?.role) === ROLES.AGENT_Z;
}

function isCustomerCommercialActor(actor) {
  return [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER, ROLES.SHIPPER_FINANCE_USER].includes(normalizeRole(actor?.role));
}

function isCompanyYActor(actor) {
  return COMPANY_Y_ROLES.includes(normalizeRole(actor?.role));
}

function isCompanyYOwner(actor) {
  return normalizeRole(actor?.role) === ROLES.COMPANY_Y_OWNER;
}

function isCompanyYDocumentIssuer(actor) {
  return normalizeRole(actor?.role) === ROLES.COMPANY_Y_DOCUMENT_ISSUER;
}

function assertShipperOrganization(actor) {
  const role = normalizeRole(actor?.role);
  if (isCustomerCommercialActor(actor) && actor.organizationType !== 'shipper') {
    throw new DomainError('AUTH-403', 'این نقش باید به سازمان صاحب بار متصل باشد.', 403);
  }
  if (role === ROLES.CONSIGNEE && !['consignee', 'agent_z'].includes(actor.organizationType)) {
    throw new DomainError('AUTH-403', 'نقش گیرنده باید به سازمان گیرنده یا Agent/Z متصل باشد.', 403);
  }
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hashValue(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function driverIdFromActor(actor) {
  const driverId = Number(actor?.externalId);
  if (!Number.isInteger(driverId) || driverId < 1 || normalizeRole(actor?.role) !== ROLES.DRIVER) {
    throw new DomainError('AUTH-403', 'این عملیات فقط برای راننده صاحب نشست مجاز است.', 403);
  }
  return driverId;
}

function assertDriverTrip(actor, trip) {
  driverIdFromActor(actor);
  assertTripAccess(actor, trip);
  if (String(trip.driver_id) !== String(actor.externalId)) throw new DomainError('AUTH-403', 'این سفر به راننده فعلی اختصاص ندارد.', 403);
}

function driverDeviceId(request) {
  return String(request.headers['x-device-id'] || request.body?.deviceId || '').trim().slice(0, 180);
}

async function assertDriverDevice(request, { required = true } = {}) {
  const driverId = driverIdFromActor(request.actor);
  const deviceId = driverDeviceId(request);
  if (!deviceId) {
    if (required) throw new DomainError(ERROR_CODES.DRIVER_DEVICE_REQUIRED, 'اتصال دستگاه راننده پیش از این عملیات لازم است.', 403);
    return null;
  }
  const [rows] = await pool.execute(
    `SELECT id, device_id, platform, app_version, integrity_json, status
       FROM driver_devices
      WHERE tenant_id = ? AND driver_id = ? AND device_id = ? AND status = 'active' LIMIT 1`,
    [request.actor.tenantId, driverId, deviceId]
  );
  if (!rows[0] && required) throw new DomainError(ERROR_CODES.DRIVER_DEVICE_REQUIRED, 'این دستگاه برای راننده ثبت نشده یا نشست آن لغو شده است.', 403);
  if (rows[0]) await pool.execute(`UPDATE driver_devices SET last_seen_at = NOW() WHERE id = ? AND tenant_id = ?`, [rows[0].id, request.actor.tenantId]);
  return rows[0] || null;
}

async function assertDriverTripAccepted(request, tripId) {
  const driverId = driverIdFromActor(request.actor);
  const [rows] = await pool.execute(
    `SELECT id, undertaking_version, device_id, accepted_at
       FROM driver_trip_acceptances
      WHERE tenant_id = ? AND trip_id = ? AND driver_id = ?
      LIMIT 1`,
    [request.actor.tenantId, tripId, driverId]
  );
  if (!rows[0] || rows[0].undertaking_version !== DRIVER_UNDERTAKING_VERSION) throw new DomainError('DRIVER-409', 'ابتدا باید سفر و تعهدنامه نسخه جاری را قبول کنید.', 409);
  return rows[0];
}

function agentDeviceId(request) {
  return String(request.headers['x-device-id'] || request.body?.deviceId || '').trim().slice(0, 180);
}

async function assertAgentDevice(request, { required = true } = {}) {
  if (!isAgentActor(request.actor)) return null;
  const deviceId = agentDeviceId(request);
  if (!deviceId) {
    if (required) throw new DomainError('DEVICE-403', 'اتصال دستگاه Agent پیش از این عملیات لازم است.', 403);
    return null;
  }
  const [rows] = await pool.execute(
    `SELECT id, device_id, platform, app_version, integrity_json, status
       FROM agent_devices
      WHERE tenant_id = ? AND agent_org_id = ? AND user_id = ? AND device_id = ? AND status = 'active' LIMIT 1`,
    [request.actor.tenantId, request.actor.organizationId, request.actor.userId, deviceId]
  );
  if (!rows[0] && required) throw new DomainError('DEVICE-403', 'این دستگاه برای کاربر Agent ثبت نشده یا نشست آن لغو شده است.', 403);
  if (rows[0]) await pool.execute(`UPDATE agent_devices SET last_seen_at = NOW() WHERE id = ? AND tenant_id = ?`, [rows[0].id, request.actor.tenantId]);
  return rows[0] || null;
}

async function assertAgentAssignment(request, trip, requiredAction = 'read_case') {
  if (!isAgentActor(request.actor)) return null;
  if (String(trip.authorized_agent_org_id || '') !== String(request.actor.organizationId || '')) {
    throw new DomainError(ERROR_CODES.AGENT_ASSIGNMENT_MISSING, 'این سفر به Agent فعلی تخصیص داده نشده است.', 403);
  }
  if (!['qualified', 'verified', 'approved', 'valid'].includes(String(request.actor.qualificationState || '').toLowerCase())) {
    throw new DomainError(ERROR_CODES.AGENT_NOT_VERIFIED, 'احراز عضویت Agent برای این عملیات کامل نشده است.', 423);
  }
  const [rows] = await pool.execute(
    `SELECT a.*, o.display_name AS agent_name, o.status AS agent_org_status, o.qualification_state AS agent_qualification_state
       FROM agent_assignments a
       JOIN platform_organizations o ON o.id = a.agent_org_id AND o.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.trip_id = ? AND a.case_id = ? AND a.agent_org_id = ? AND a.assigned_by_org_id = ?
      ORDER BY a.id DESC LIMIT 1`,
    [request.actor.tenantId, trip.id, trip.case_id, request.actor.organizationId, trip.x_org_id]
  );
  const assignment = rows[0];
  if (!assignment) throw new DomainError(ERROR_CODES.AGENT_ASSIGNMENT_MISSING, 'تخصیص و اختیار مقصد برای این سفر ثبت نشده است.', 403);
  const now = new Date();
  if (assignment.valid_to && new Date(assignment.valid_to) <= now) throw new DomainError(ERROR_CODES.AUTHORITY_EXPIRED, 'اختیار تحویل Agent منقضی شده است.', 424);
  if (assignment.valid_from && new Date(assignment.valid_from) > now) throw new DomainError(ERROR_CODES.AGENT_NOT_VERIFIED, 'اختیار تحویل Agent هنوز فعال نشده است.', 423);
  if (assignment.state !== 'VERIFIED' || assignment.agent_org_status !== 'active' || !['qualified', 'verified', 'approved', 'valid'].includes(String(assignment.agent_qualification_state || '').toLowerCase())) {
    throw new DomainError(ERROR_CODES.AGENT_NOT_VERIFIED, 'احراز Agent یا اختیار تحویل هنوز تأیید نشده است.', 423);
  }
  const configuredActions = parseJson(assignment.permitted_actions_json, AGENT_DEFAULT_ACTIONS);
  const permittedActions = Array.isArray(configuredActions) ? configuredActions.map((value) => String(value)) : AGENT_DEFAULT_ACTIONS;
  if (requiredAction && permittedActions.length && !permittedActions.includes(requiredAction)) throw new DomainError('AUTH-403', 'این عمل در اختیارنامه Agent مجاز نشده است.', 403, { requiredAction });
  return assignment;
}

async function assertAgentTrip(request, trip, requiredAction = 'read_case', { device = false } = {}) {
  assertTripAccess(request.actor, trip);
  const assignment = await assertAgentAssignment(request, trip, requiredAction);
  if (device) await assertAgentDevice(request);
  return assignment;
}

function publicAgentAssignment(row) {
  return row ? {
    id: row.id,
    caseId: row.case_id,
    tripId: row.trip_id,
    agentOrgId: row.agent_org_id,
    agentName: row.agent_name || row.agent_org_id,
    authorityRef: row.authority_ref,
    authorityDocumentId: row.authority_document_id || null,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    scope: parseJson(row.scope_json, {}),
    permittedActions: parseJson(row.permitted_actions_json, AGENT_DEFAULT_ACTIONS),
    reportingOrgId: row.reporting_org_id || null,
    state: row.state,
    kycState: row.agent_qualification_state || 'pending',
    authorityStatus: row.valid_to && new Date(row.valid_to) <= new Date() ? 'EXPIRED' : row.state
  } : null;
}

function publicAgentNotification(row) {
  const payload = parseJson(row.payload_json, {});
  const safeRow = { ...row };
  delete safeRow.payload_json;
  return {
    ...safeRow,
    payload: {
      eventName: payload.eventName || null,
      entityType: payload.entityType || null,
      entityId: payload.entityId || null
    }
  };
}

function publicAgentTrip(row, assignment = null) {
  return {
    id: row.id,
    caseId: row.case_id,
    caseNumber: row.case_number,
    direction: row.direction,
    state: row.state,
    deliveryState: row.delivery_state,
    trackingState: row.tracking_state,
    route: { originCountry: row.origin_country, destinationCountry: row.destination_country, origin: row.origin_location, destination: row.destination_location },
    parties: { forwarderRef: row.x_org_id || null, carrierRef: row.y_org_id || null },
    cargo: { type: row.cargo_type, weight: row.cargo_weight, unit: row.cargo_weight_unit || null },
    destination: { country: row.destination_country, location: row.destination_location },
    driver: row.driver_id ? { id: row.driver_id, name: row.driver_name || null, status: row.driver_status || null } : null,
    vehicle: row.vehicle_id ? { id: row.vehicle_id, plateNumber: row.plate_number || null, type: row.vehicle_type || null } : null,
    etaAt: row.eta_at || null,
    lastMilestone: row.last_milestone || null,
    delayFlags: parseJson(row.delay_flags, []),
    readiness: publicAgentReadiness(row.readiness_json),
    assignment: publicAgentAssignment(assignment)
  };
}

function normalizeAgentAssignmentRow(row) {
  return {
    ...row,
    id: row.assignment_id,
    case_id: row.assignment_case_id,
    trip_id: row.assignment_trip_id,
    authority_document_id: row.assignment_authority_document_id,
    authority_ref: row.assignment_authority_ref,
    valid_from: row.assignment_valid_from,
    valid_to: row.assignment_valid_to,
    scope_json: row.assignment_scope_json,
    permitted_actions_json: row.assignment_permitted_actions_json,
    reporting_org_id: row.assignment_reporting_org_id,
    state: row.assignment_state,
    verified_by_user_id: row.assignment_verified_by_user_id,
    verified_at: row.assignment_verified_at,
    agent_name: row.agent_name,
    agent_qualification_state: row.agent_qualification_state
  };
}

async function queryAgentDeliveries(request, tripId = null) {
  const tripFilter = tripId ? ' AND t.id = ?' : '';
  const params = [request.actor.tenantId, request.actor.organizationId];
  if (tripId) params.push(tripId);
  const [rows] = await pool.execute(
    `SELECT
        a.id AS assignment_id, a.case_id AS assignment_case_id, a.trip_id AS assignment_trip_id,
        a.agent_org_id, a.assigned_by_org_id, a.authority_ref AS assignment_authority_ref,
        a.authority_document_id AS assignment_authority_document_id, a.valid_from AS assignment_valid_from,
        a.valid_to AS assignment_valid_to, a.scope_json AS assignment_scope_json,
        a.permitted_actions_json AS assignment_permitted_actions_json, a.reporting_org_id AS assignment_reporting_org_id,
        a.state AS assignment_state, a.verified_by_user_id AS assignment_verified_by_user_id, a.verified_at AS assignment_verified_at,
        t.id AS trip_id, t.case_id, t.x_org_id, t.y_org_id, t.driver_id, t.vehicle_id, t.authorized_agent_org_id,
        t.state, t.tracking_state, t.readiness_json, t.last_location_at, t.eta_at, t.last_milestone, t.delay_flags,
        c.case_number, c.direction, c.origin_country, c.destination_country, c.origin_location, c.destination_location,
        c.cargo_type, c.cargo_weight, c.cargo_weight_unit, c.deadline_at, c.delivery_state, c.payload_json AS case_payload_json,
        o.display_name AS agent_name, o.qualification_state AS agent_qualification_state,
        p.state AS pod_state, p.id AS pod_id, p.evidence_version_no AS pod_evidence_version,
        (SELECT v.outcome FROM agent_delivery_verifications v WHERE v.tenant_id = a.tenant_id AND v.trip_id = t.id AND v.assignment_id = a.id ORDER BY v.version_no DESC LIMIT 1) AS verification_outcome,
        (SELECT v.version_no FROM agent_delivery_verifications v WHERE v.tenant_id = a.tenant_id AND v.trip_id = t.id AND v.assignment_id = a.id ORDER BY v.version_no DESC LIMIT 1) AS verification_version
       FROM agent_assignments a
       JOIN trip_cases t ON t.id = a.trip_id AND t.case_id = a.case_id AND t.tenant_id = a.tenant_id AND t.authorized_agent_org_id = a.agent_org_id
       JOIN shipment_cases c ON c.id = t.case_id AND c.tenant_id = t.tenant_id
       JOIN platform_organizations o ON o.id = a.agent_org_id AND o.tenant_id = a.tenant_id
       LEFT JOIN pod_cases p ON p.trip_id = t.id AND p.tenant_id = t.tenant_id
      WHERE a.tenant_id = ? AND a.agent_org_id = ?
        AND a.id = (SELECT MAX(a2.id) FROM agent_assignments a2 WHERE a2.tenant_id = a.tenant_id AND a2.trip_id = a.trip_id AND a2.agent_org_id = a.agent_org_id)
        ${tripFilter}
      ORDER BY t.eta_at IS NULL, t.eta_at, t.updated_at DESC`,
    params
  );
  return rows.map((row) => ({ row, assignment: normalizeAgentAssignmentRow(row) }));
}

function publicDriverProfile(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    nationalId: row.national_id,
    phone: row.phone,
    province: row.province,
    city: row.city,
    status: row.status,
    kycState: row.kyc_state || 'pending',
    passportState: row.passport_state || 'pending',
    licenseState: row.license_state || 'pending',
    driverCardState: row.driver_card_state || 'pending',
    availabilityState: row.availability_state || 'available',
    operationallyEligible: row.status === 'active' && ['approved', 'verified', 'valid'].includes(String(row.kyc_state || '').toLowerCase()) && ['approved', 'verified', 'valid'].includes(String(row.license_state || '').toLowerCase())
  };
}

function publicDriverDocument(row) {
  return {
    id: row.id,
    docType: row.doc_type,
    versionNo: row.version_no,
    state: row.state,
    sensitivity: row.sensitivity,
    expiresAt: row.expires_at,
    fileRef: row.file_ref,
    fileHash: row.file_hash,
    metadata: parseJson(row.metadata_json, {}),
    lockedAt: row.locked_at,
    createdAt: row.created_at
  };
}

function distanceKm(first, second) {
  if (!first || !second) return null;
  const lat1 = Number(first.lat); const lng1 = Number(first.lng);
  const lat2 = Number(second.lat); const lng2 = Number(second.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1); const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function driverGeoFromPayload(payload) {
  const geo = payload?.geo || payload?.location || null;
  if (!geo || !Number.isFinite(Number(geo.lat)) || !Number.isFinite(Number(geo.lng))) throw new DomainError('GPS-400', 'مختصات موقعیت معتبر نیست.', 400);
  return { lat: Number(geo.lat), lng: Number(geo.lng), accuracy: geo.accuracy === undefined ? null : Number(geo.accuracy), timestamp: geo.timestamp || payload?.deviceTimestamp || null };
}

function mergeDraft(base, next) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(next || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = { ...result[key], ...value };
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function normalizeDraftInput(input = {}, existing = {}) {
  const draft = mergeDraft(existing, input);
  const allowed = ['direction', 'origin', 'destination', 'cargo', 'commercial', 'fleet', 'schedule', 'documents', 'contacts', 'notes', 'riskFlags', 'importerVerification', 'originAbroad', 'warehouse', 'release', 'tirRequired'];
  const normalized = {};
  for (const key of allowed) if (draft[key] !== undefined) normalized[key] = draft[key];
  if (normalized.direction) normalized.direction = String(normalized.direction).toUpperCase();
  if (normalized.documents && !Array.isArray(normalized.documents)) normalized.documents = [];
  if (normalized.riskFlags && !Array.isArray(normalized.riskFlags)) normalized.riskFlags = [];
  return normalized;
}

export function reviewShipperDraft(item, payload, { forPublish = false } = {}) {
  const draft = normalizeDraftInput(payload);
  const missingFields = [];
  const complianceBlocks = [];
  const conflicts = [];
    const required = [
    ['origin.country', draft.origin?.country],
    ['origin.location', draft.origin?.location],
    ['destination.country', draft.destination?.country],
    ['destination.location', draft.destination?.location],
    ['cargo.type', draft.cargo?.type],
    ['cargo.weight', draft.cargo?.weight],
    ['commercial.incoterm', draft.commercial?.incoterm],
    ['commercial.namedPlace', draft.commercial?.namedPlace],
    ['schedule.readyDate', draft.schedule?.readyDate]
  ];
  for (const [field, value] of required) if (value === undefined || value === null || String(value).trim() === '') missingFields.push(field);
  if (!['EXPORT', 'IMPORT'].includes(String(draft.direction || item.direction || '').toUpperCase())) missingFields.push('direction');
  if (String(draft.cargo?.condition || '').toLowerCase() === 'reefer' && !draft.cargo?.temperature) complianceBlocks.push({ code: 'REEFER_TEMPERATURE_REQUIRED', field: 'cargo.temperature' });
  if (String(draft.cargo?.condition || '').toLowerCase() === 'dangerous' && !draft.cargo?.permits?.length) complianceBlocks.push({ code: 'DANGEROUS_GOODS_PERMIT_REQUIRED', field: 'cargo.permits' });
  if (draft.fleet?.routePermitRequired === true && !draft.fleet?.routePermitRef) complianceBlocks.push({ code: 'ROUTE_PERMIT_REQUIRED', field: 'fleet.routePermitRef' });
  if (String(draft.direction || item.direction).toUpperCase() === 'IMPORT') {
    if (draft.importerVerification !== true) complianceBlocks.push({ code: 'IMPORTER_VERIFICATION_REQUIRED', field: 'importerVerification' });
    if (!draft.originAbroad?.confirmed) missingFields.push('originAbroad.confirmed');
  }
  const documentTypes = new Set((draft.documents || []).map((document) => String(typeof document === 'string' ? document : document.docType || document.type || '').toUpperCase()));
  if (draft.commercial?.customsScope && !documentTypes.has('INVOICE')) conflicts.push({ code: 'CUSTOMS_SCOPE_WITHOUT_INVOICE', field: 'documents.INVOICE' });
  const result = {
    ready: missingFields.length === 0 && complianceBlocks.length === 0 && conflicts.length === 0,
    missingFields,
    complianceBlocks,
    conflicts,
    rulePackVersion: 'rulepack-foundation-1',
    direction: String(draft.direction || item.direction || 'EXPORT').toUpperCase()
  };
  if (forPublish && !result.ready) {
    const code = complianceBlocks.length ? ERROR_CODES.COMPLIANCE_BLOCK : 'CASE-422';
    throw new DomainError(code, 'پرونده پیش از انتشار RFQ1 نیازمند تکمیل یا رفع تعارض است.', complianceBlocks.length ? 451 : 422, result);
  }
  return result;
}

function publicShipperDraft(item) {
  const payload = parseJson(item.payload_json, {});
  const { contacts: _contacts, ...safePayload } = payload;
  return { ...safePayload, direction: item.direction, deadlineAt: item.deadline_at || safePayload.deadlineAt || null };
}

function publicDocument(document) {
  return {
    id: document.id,
    caseId: document.case_id,
    tripId: document.trip_id,
    docType: document.doc_type,
    ownerOrgId: document.owner_org_id,
    uploaderUserId: document.uploader_user_id,
    approverUserId: document.approver_user_id,
    versionNo: document.version_no,
    state: document.state,
    sensitivity: document.sensitivity,
    deadlineAt: document.deadline_at || null,
    fileHash: document.file_hash,
    metadata: parseJson(document.metadata_json, {}),
    lockedAt: document.locked_at,
    createdAt: document.created_at
  };
}

function publicAgentDocument(document) {
  const value = publicDocument(document);
  const metadata = parseJson(document.metadata_json, {});
  const allowedMetadata = ['evidenceType', 'occurredAt', 'assignmentId', 'note', 'documentRole', 'receiptBox', 'releaseState', 'warehouseState'];
  return {
    ...value,
    metadata: Object.fromEntries(allowedMetadata.filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]))
  };
}

function publicQuoteTerms(value) {
  const terms = parseJson(value, {});
  const allowed = ['validUntil', 'transitTime', 'eta', 'paymentTerms', 'includedServices', 'excludedServices', 'services', 'sla', 'explanation'];
  return Object.fromEntries(allowed.filter((key) => terms[key] !== undefined).map((key) => [key, terms[key]]));
}

function normalizePricingInput(input = {}) {
  const allowed = ['route', 'border', 'cargo', 'vehicle', 'season', 'operationalCost', 'fxSource', 'fxDate', 'surcharges', 'companyPolicy', 'estimatedRate', 'suggestedRate', 'firmRate', 'conditionalRate', 'costComponents', 'xMargin', 'platformFee', 'priceRisk', 'validUntil', 'outlier', 'outlierReason', 'outlierApprovalRef'];
  const result = {};
  for (const key of allowed) {
    if (input[key] !== undefined) result[key] = input[key];
  }
  for (const key of ['operationalCost', 'estimatedRate', 'suggestedRate', 'firmRate', 'conditionalRate', 'xMargin', 'platformFee']) {
    if (result[key] !== undefined && result[key] !== null && (!Number.isFinite(Number(result[key])) || Number(result[key]) < 0)) throw new DomainError('PRICE-400', `مقدار قیمت ${key} معتبر نیست.`, 400);
    if (result[key] !== undefined && result[key] !== null) result[key] = Number(result[key]);
  }
  if (result.outlier === true && String(result.outlierReason || '').trim().length < 8) throw new DomainError('PRICE-422', 'برای نرخ خارج از محدوده، دلیل اجباری است.', 422);
  if (result.outlier === true && result.outlierApprovalRef !== undefined && String(result.outlierApprovalRef).length > 160) throw new DomainError('PRICE-400', 'مرجع تأیید Outlier معتبر نیست.', 400);
  return result;
}

function publicPricing(value) {
  const pricing = parseJson(value, {});
  return {
    estimatedRate: pricing.estimatedRate ?? null,
    suggestedRate: pricing.suggestedRate ?? null,
    firmRate: pricing.firmRate ?? null,
    conditionalRate: pricing.conditionalRate ?? null,
    costComponents: pricing.costComponents ?? [],
    xMargin: pricing.xMargin ?? null,
    platformFee: pricing.platformFee ?? null,
    priceRisk: pricing.priceRisk ?? null,
    outlier: Boolean(pricing.outlier),
    outlierReason: pricing.outlierReason ?? null,
    outlierApprovalRef: pricing.outlierApprovalRef ?? null,
    route: pricing.route ?? null,
    border: pricing.border ?? null,
    fxSource: pricing.fxSource ?? null,
    fxDate: pricing.fxDate ?? null,
    validUntil: pricing.validUntil ?? null
  };
}

function normalizeRfq2Metadata(input = {}) {
  const metadata = {
    shipment: input.shipment || null,
    route: input.route || null,
    cargoSummary: input.cargoSummary || null,
    requiredVehicle: input.requiredVehicle || null,
    loadingWindow: input.loadingWindow || null,
    permitRules: input.permitRules || null,
    operationalInstructions: input.operationalInstructions || null,
    settlementConditions: input.settlementConditions || null
  };
  return metadata;
}

function publicException(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    tripId: row.trip_id,
    exceptionType: row.exception_type,
    severity: row.severity,
    status: row.status,
    reason: row.reason,
    evidence: parseJson(row.evidence_json, {}),
    openedByOrgId: row.opened_by_org_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicAgentEvidence(value) {
  const source = parseJson(value, {});
  const allowed = ['fileRef', 'fileHash', 'evidenceRef', 'note', 'category', 'evidenceType', 'addedAt', 'assignmentId'];
  const sanitize = (item) => Object.fromEntries(allowed.filter((key) => item && item[key] !== undefined).map((key) => [key, item[key]]));
  return Array.isArray(source) ? source.map(sanitize) : sanitize(source);
}

function publicAgentPodEvidence(value) {
  const evidence = parseJson(value, {});
  const allowed = ['recipientOrgId', 'authorityRef', 'receivedAt', 'location', 'photos', 'signatureRef', 'stampRef', 'signedCmrRef', 'warehouseReceiptRef', 'remarks', 'otpVerified'];
  return Object.fromEntries(allowed.filter((key) => evidence[key] !== undefined).map((key) => [key, evidence[key]]));
}

function publicAgentReadiness(value) {
  const readiness = parseJson(value, {});
  const allowed = ['customsReady', 'routePermitReady', 'documentsReady', 'vehicleReady', 'driverReady', 'preloadState', 'commercialDocsReady', 'loadingState'];
  return Object.fromEntries(allowed.filter((key) => readiness[key] !== undefined).map((key) => [key, readiness[key]]));
}

function publicAgentException(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    tripId: row.trip_id,
    exceptionType: row.exception_type,
    severity: row.severity,
    status: row.status,
    reason: row.reason,
    evidence: publicAgentEvidence(row.evidence_json),
    openedByOrgId: row.opened_by_org_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicAgentIssue(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    tripId: row.trip_id,
    caseType: row.case_type,
    status: row.status,
    reason: row.reason,
    evidence: publicAgentEvidence(row.evidence_json),
    openedByOrgId: row.opened_by_org_id,
    timingWarning: Boolean(row.timing_warning),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicCoverage(row) {
  const driver = row.driver || row;
  const driverId = row.driver_id || driver.id;
  return {
    id: row.id,
    driverId,
    driver: {
      id: driverId,
      name: `${driver.first_name || ''} ${driver.last_name || ''}`.trim(),
      status: driver.status || null,
      kycState: driver.kyc_state || 'pending',
      passportState: driver.passport_state || 'pending',
      licenseState: driver.license_state || 'pending',
      driverCardState: driver.driver_card_state || 'pending',
      availabilityState: driver.availability_state || 'available'
    },
    vehicleId: row.vehicle_id || null,
    state: row.state,
    validFrom: row.valid_from || null,
    validTo: row.valid_to || null,
    routeScope: parseJson(row.route_scope, []),
    supportingDocs: parseJson(row.supporting_docs_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicVehicle(row) {
  return {
    id: row.id,
    plateNumber: row.plate_number,
    vehicleType: row.vehicle_type || null,
    capacity: row.capacity || null,
    cargoScope: parseJson(row.cargo_scope, []),
    reeferCapable: Boolean(row.reefer_capable),
    specialCapability: row.special_capability || null,
    ownerRelation: row.owner_relation || null,
    status: row.status,
    availabilityState: row.availability_state || 'available',
    insurance: parseJson(row.insurance_json, {}),
    technicalDocs: parseJson(row.technical_docs_json, {}),
    routePermits: parseJson(row.route_permits_json, {})
  };
}

function canCompanyYSeeDocument(document) {
  return COMPANY_Y_DOCUMENT_TYPES.has(String(document.doc_type || '').toUpperCase());
}

function publicSettlementEvidence(value) {
  const evidence = parseJson(value, {});
  const allowed = ['invoiceRef', 'receiptRef', 'paymentRef', 'milestone', 'adjustment', 'disputeHold', 'dueAt', 'confirmedAt', 'confirmedBy'];
  return Object.fromEntries(allowed.filter((key) => evidence[key] !== undefined).map((key) => [key, evidence[key]]));
}

async function assertImportSettlementReady(item) {
  if (String(item.direction).toUpperCase() !== 'IMPORT') return;
  const [documents] = await pool.execute(
    `SELECT doc_type FROM platform_documents
      WHERE tenant_id = ? AND case_id = ? AND state = 'APPROVED'
        AND doc_type IN ('WAREHOUSE_RECEIPT', 'RELEASE_DOCUMENT', 'CLEARANCE_DOCUMENT', 'DOMESTIC_POD')`,
    [item.tenant_id, item.id]
  );
  const approved = new Set(documents.map((document) => document.doc_type));
  const missing = [];
  if (!approved.has('WAREHOUSE_RECEIPT')) missing.push('WAREHOUSE_RECEIPT');
  if (!approved.has('RELEASE_DOCUMENT') && !approved.has('CLEARANCE_DOCUMENT')) missing.push('RELEASE_DOCUMENT');
  if (!approved.has('DOMESTIC_POD')) missing.push('DOMESTIC_POD');
  if (item.tir_state && item.tir_state !== 'NOT_APPLICABLE' && item.tir_state !== 'DISCHARGED') missing.push('TIR_DISCHARGED');
  if (missing.length) throw new DomainError(ERROR_CODES.SETTLEMENT_CONDITION_MISSING, 'تسویه واردات تا ثبت رسید انبار، ترخیص، POD داخلی و تخلیه TIR مجاز نیست.', 424, { missing });
}

router.use((request, _response, next) => {
  request.correlationId = request.headers['x-correlation-id'] || randomBytes(12).toString('hex');
  _response.setHeader('X-Correlation-Id', request.correlationId);
  next();
});

router.get('/realtime', platformAuth({ permission: PERMISSIONS.READ }), (request, response) => {
  try {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    let closed = false;
    const write = (event) => {
      if (closed || response.writableEnded) return;
      response.write(`id: ${event.id}\nevent: platform_event\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = subscribeRealtime(request.actor, write);
    const heartbeat = setInterval(() => {
      if (closed || response.writableEnded) return;
      response.write(`: heartbeat ${Date.now()}\n\n`);
    }, 20000);
    const realtimeTtlMs = Math.max(Number(process.env.REALTIME_CONNECTION_TTL_MS || 720000), 60000);
    const expiry = setTimeout(() => response.end(), realtimeTtlMs);
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(expiry);
      unsubscribe();
    };
    request.on('close', close);
    response.on('close', close);
    response.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString(), replayAvailable: false, expiresAt: new Date(Date.now() + realtimeTtlMs).toISOString() })}\n\n`);
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/context', platformAuth(), async (request, response) => {
  return response.json({
    tenantId: request.actor.tenantId,
    organizationId: request.actor.organizationId,
    membershipId: request.actor.membershipId,
    role: request.actor.role,
    organizationType: request.actor.organizationType || null,
    transactionRole: request.actor.transactionRole || null,
    delegation: request.actor.delegationScope || {},
    permissions: Object.values(PERMISSIONS).filter((permission) => hasPermission(request.actor.role, permission))
  });
});

router.get('/dashboard', platformAuth({ permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const actor = request.actor;
    if (isShipperActor(actor)) assertShipperOrganization(actor);
    if (['super_admin', 'marketplace_admin'].includes(normalizeRole(actor.role)) && String(actor.purpose || '').trim().length < 8) throw new DomainError('AUTH-428', 'نمایش مدیریتی نیازمند محدوده هدف و ثبت دلیل است.', 428);
    const [cases] = await pool.execute(
      `SELECT DISTINCT c.*, t.driver_id AS assigned_driver_id, t.authorized_agent_org_id AS assigned_agent_org_id,
              (SELECT r2.publisher_org_id FROM rfq_books r2 WHERE r2.case_id = c.id AND r2.tenant_id = c.tenant_id AND r2.publisher_org_id = ? LIMIT 1) AS invited_rfq_publisher_org_id
         FROM shipment_cases c
         LEFT JOIN rfq_books r ON r.case_id = c.id AND r.tenant_id = c.tenant_id
         LEFT JOIN trip_cases t ON t.case_id = c.id AND t.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
          AND (c.owner_org_id = ? OR c.x_org_id = ? OR c.y_org_id = ?
               OR r.publisher_org_id = ? OR r.awarded_org_id = ?
               OR t.x_org_id = ? OR t.y_org_id = ?
               OR (t.driver_id = ? AND ? = 'driver'))
        ORDER BY c.updated_at DESC LIMIT 50`,
      [actor.organizationId, actor.tenantId, actor.organizationId, actor.organizationId, actor.organizationId, actor.organizationId, actor.organizationId, actor.organizationId, actor.organizationId, actor.externalId || 0, normalizeRole(actor.role)]
    );
    const [trips] = await pool.execute(
      `SELECT t.*, c.case_number, c.owner_org_id, c.x_org_id AS case_x_org_id, c.y_org_id AS case_y_org_id,
              c.origin_country, c.destination_country, c.origin_location, c.destination_location, c.cargo_type,
              c.commercial_state, c.capacity_state, c.loading_state, c.customs_state, c.delivery_state,
              c.financial_state, c.payload_json AS case_payload_json
         FROM trip_cases t JOIN shipment_cases c ON c.id = t.case_id AND c.tenant_id = t.tenant_id
        WHERE t.tenant_id = ? AND (c.owner_org_id = ? OR t.x_org_id = ? OR t.y_org_id = ? OR t.authorized_agent_org_id = ? OR (t.driver_id = ? AND ? = 'driver'))
        ORDER BY t.updated_at DESC LIMIT 20`,
      [actor.tenantId, actor.organizationId, actor.organizationId, actor.organizationId, actor.organizationId, actor.externalId || 0, normalizeRole(actor.role)]
    );
    const [notifications] = await pool.execute(
      `SELECT id, event_id, channel, state, payload_json, created_at
         FROM platform_notifications
        WHERE tenant_id = ? AND (recipient_org_id = ? OR recipient_user_id = ?)
        ORDER BY created_at DESC LIMIT 20`,
      [actor.tenantId, actor.organizationId, actor.userId || 0]
    );
    const agentDeliveryRows = isAgentActor(actor) ? await queryAgentDeliveries(request) : [];
    const agentDeliveryIds = isAgentActor(actor) ? new Set(agentDeliveryRows.map(({ row }) => String(row.trip_id))) : null;
    const agentDeliveryCaseIds = isAgentActor(actor) ? new Set(agentDeliveryRows.map(({ row }) => String(row.case_id))) : null;
    const visibleCases = cases.filter((item) => relatedToCase(actor, item) && inAbacCaseScope(actor, item) && (!agentDeliveryCaseIds || agentDeliveryCaseIds.has(String(item.id))));
    const visibleTrips = trips.filter((trip) => relatedToTrip(actor, trip) && inAbacCaseScope(actor, trip) && (!agentDeliveryIds || agentDeliveryIds.has(String(trip.id))));
    return response.json({
      actor: { role: actor.role, organizationId: actor.organizationId },
      metrics: {
        cases: visibleCases.length,
        activeTrips: normalizeRole(actor.role) === ROLES.SHIPPER_FINANCE_USER ? 0 : visibleTrips.filter((trip) => trip.tracking_state === 'ACTIVE').length,
        pendingEvidence: normalizeRole(actor.role) === ROLES.SHIPPER_FINANCE_USER ? 0 : visibleTrips.filter((trip) => trip.delivery_state === 'POD_SUBMITTED' || trip.loading_state !== 'COMMERCIAL_DOCS_READY').length
      },
      cases: visibleCases.map((item) => publicCaseForActor(item, actor)),
      trips: normalizeRole(actor.role) === ROLES.SHIPPER_FINANCE_USER ? [] : visibleTrips.map(publicTrip),
      notifications: notifications.map((item) => isAgentActor(actor) ? publicAgentNotification(item) : ({ ...item, payload: parseJson(item.payload_json, {}) }))
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/agent/devices/bind', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const deviceId = agentDeviceId(request);
    if (deviceId.length < 12) throw new DomainError('DEVICE-400', 'شناسه دستگاه Agent معتبر نیست.', 400);
    const platform = String(request.body?.platform || 'web').trim().slice(0, 24);
    const appVersion = String(request.body?.appVersion || '').trim().slice(0, 40) || null;
    const integrity = request.body?.integrity && typeof request.body.integrity === 'object' ? request.body.integrity : {};
    await pool.execute(
      `INSERT INTO agent_devices (tenant_id, agent_org_id, user_id, device_id, platform, app_version, integrity_json, status, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NOW())
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), app_version = VALUES(app_version), integrity_json = VALUES(integrity_json), status = 'active', last_seen_at = NOW()`,
      [request.actor.tenantId, request.actor.organizationId, request.actor.userId, deviceId, platform, appVersion, JSON.stringify(integrity)]
    );
    await event(request, { eventName: 'AgentDeviceBound', entityType: 'agent_device', entityId: null, payload: { agentOrgId: request.actor.organizationId, deviceId, platform, appVersion } });
    return jsonResponse({ message: 'دستگاه برای نشست Agent ثبت شد.', deviceId, platform, status: 'active' }, 201);
  }, { requireKey: true });
});

router.get('/agent/profile', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const [rows] = await pool.execute(`SELECT id, display_name, organization_type, status, qualification_state, country_scope FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [request.actor.organizationId, request.actor.tenantId]);
    const organization = rows[0];
    if (!organization) throw new DomainError('AGT-404', 'سازمان Agent پیدا نشد.', 404);
    return response.json({
      organization: { id: organization.id, name: organization.display_name, type: organization.organization_type, status: organization.status, countryScope: parseJson(organization.country_scope, []) },
      kyc: { state: organization.qualification_state || 'pending', level: request.actor.kycLevel || null },
      actor: { userId: request.actor.userId, role: request.actor.role, organizationId: request.actor.organizationId }
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/agent/dashboard', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const deliveries = await queryAgentDeliveries(request);
    const [organizationRows] = await pool.execute(`SELECT id, display_name, status, qualification_state, country_scope FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [request.actor.organizationId, request.actor.tenantId]);
    const [settlementRows] = await pool.execute(
      `SELECT l.id, l.case_id, l.trip_id, l.relationship_type, l.payer_org_id, l.payee_org_id, l.amount, l.currency, l.state, l.evidence_json, l.created_at, l.updated_at, c.case_number
         FROM relationship_ledgers l
         JOIN shipment_cases c ON c.id = l.case_id AND c.tenant_id = l.tenant_id
         JOIN trip_cases t ON t.id = l.trip_id AND t.tenant_id = l.tenant_id AND t.authorized_agent_org_id = ?
        WHERE l.tenant_id = ? AND l.relationship_type = 'x_agent' AND (l.payer_org_id = ? OR l.payee_org_id = ?)
        ORDER BY l.updated_at DESC LIMIT 50`,
      [request.actor.organizationId, request.actor.tenantId, request.actor.organizationId, request.actor.organizationId]
    );
    const [notifications] = await pool.execute(`SELECT id, event_id, channel, state, payload_json, created_at FROM platform_notifications WHERE tenant_id = ? AND (recipient_org_id = ? OR recipient_user_id = ?) ORDER BY created_at DESC LIMIT 30`, [request.actor.tenantId, request.actor.organizationId, request.actor.userId || 0]);
    const deliveryItems = deliveries.map(({ row, assignment }) => ({
      ...publicAgentTrip(row, assignment),
      podId: row.pod_id || null,
      podState: row.pod_state || null,
      verificationState: row.verification_outcome || null,
      verificationVersion: row.verification_version || null,
      authorityStatus: assignment.valid_to && new Date(assignment.valid_to) <= new Date() ? 'EXPIRED' : assignment.state
    }));
    return response.json({
      actor: { role: request.actor.role, organizationId: request.actor.organizationId },
      organization: organizationRows[0] ? { id: organizationRows[0].id, name: organizationRows[0].display_name, status: organizationRows[0].status, kycState: organizationRows[0].qualification_state, countryScope: parseJson(organizationRows[0].country_scope, []) } : null,
      kyc: { state: organizationRows[0]?.qualification_state || 'pending', level: request.actor.kycLevel || null },
      metrics: { deliveries: deliveryItems.length, waiting: deliveryItems.filter((item) => !['POD_ACCEPTED', 'ACCEPTED'].includes(item.podState)).length, incompletePod: deliveryItems.filter((item) => item.podState === 'RETURNED' || (item.verificationState && item.verificationState !== 'VERIFIED')).length },
      deliveries: deliveryItems,
      settlements: settlementRows.map((row) => ({ id: row.id, caseId: row.case_id, tripId: row.trip_id, caseNumber: row.case_number, relationshipType: row.relationship_type, amount: row.amount, currency: row.currency, state: row.state, evidence: publicSettlementEvidence(row.evidence_json), createdAt: row.created_at, updatedAt: row.updated_at })),
      notifications: notifications.map(publicAgentNotification)
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/agent/deliveries', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const deliveries = await queryAgentDeliveries(request);
    return response.json({ deliveries: deliveries.map(({ row, assignment }) => ({ ...publicAgentTrip(row, assignment), podId: row.pod_id || null, podState: row.pod_state || null, verificationState: row.verification_outcome || null, verificationVersion: row.verification_version || null })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/agent/trips/:tripId', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    const assignment = await assertAgentTrip(request, trip, 'read_case');
    await audit(request, { eventType: 'CaseViewed', subjectType: 'trip_case', subjectId: tripId, payload: { caseId: trip.case_id, assignmentId: assignment.id, surface: 'agent_z' } });
    const deliveries = await queryAgentDeliveries(request, tripId);
    const row = deliveries[0]?.row || trip;
    const [podRows] = await pool.execute(`SELECT p.*, v.evidence_json AS current_evidence_json FROM pod_cases p LEFT JOIN pod_evidence_versions v ON v.pod_id = p.id AND v.tenant_id = p.tenant_id AND v.version_no = p.evidence_version_no WHERE p.trip_id = ? AND p.tenant_id = ? LIMIT 1`, [tripId, request.actor.tenantId]);
    const [verificationRows] = await pool.execute(`SELECT id, version_no, outcome, verification_json, device_ref, actor_user_id, created_at FROM agent_delivery_verifications WHERE tenant_id = ? AND trip_id = ? AND assignment_id = ? ORDER BY version_no DESC LIMIT 20`, [request.actor.tenantId, tripId, assignment.id]);
    const [documentRows] = await pool.execute(`SELECT id, case_id, trip_id, doc_type, version_no, state, sensitivity, deadline_at, owner_org_id, uploader_user_id, approver_user_id, file_hash, metadata_json, locked_at, created_at FROM platform_documents WHERE tenant_id = ? AND (trip_id = ? OR case_id = ?) AND doc_type IN (${[...AGENT_DOCUMENT_TYPES].map(() => '?').join(',')}) ORDER BY doc_type, version_no DESC`, [request.actor.tenantId, tripId, trip.case_id, ...AGENT_DOCUMENT_TYPES]);
    const [eventRows] = await pool.execute(`SELECT event_type, payload_json, created_at FROM platform_trip_events WHERE tenant_id = ? AND trip_id = ? AND event_type <> 'LOCATION_REPORTED' ORDER BY created_at DESC LIMIT 60`, [request.actor.tenantId, tripId]);
    const [issueRows] = await pool.execute(`SELECT id, case_id, trip_id, case_type, status, reason, evidence_json, opened_by_org_id, timing_warning, created_at, updated_at FROM platform_claims WHERE tenant_id = ? AND trip_id = ? AND opened_by_org_id IN (?, ?) ORDER BY created_at DESC`, [request.actor.tenantId, tripId, request.actor.organizationId, trip.x_org_id]);
    const [exceptionRows] = await pool.execute(`SELECT id, case_id, trip_id, exception_type, severity, status, reason, evidence_json, opened_by_org_id, created_at, updated_at FROM platform_exceptions WHERE tenant_id = ? AND trip_id = ? AND opened_by_org_id IN (?, ?) ORDER BY created_at DESC`, [request.actor.tenantId, tripId, request.actor.organizationId, trip.x_org_id]);
    const [settlementRows] = await pool.execute(`SELECT id, relationship_type, payer_org_id, payee_org_id, amount, currency, state, evidence_json, created_at, updated_at FROM relationship_ledgers WHERE tenant_id = ? AND trip_id = ? AND relationship_type = 'x_agent' AND (payer_org_id = ? OR payee_org_id = ?) ORDER BY created_at DESC`, [request.actor.tenantId, tripId, request.actor.organizationId, request.actor.organizationId]);
    const podRiskFlags = parseJson(podRows[0]?.risk_flags_json, []);
    const pod = podRows[0] ? { id: podRows[0].id, state: podRows[0].state, evidenceVersion: podRows[0].evidence_version_no, recipientOrgId: podRows[0].recipient_org_id, authorityRef: podRows[0].authority_ref, otpVerified: Boolean(podRows[0].otp_verified), evidence: publicAgentPodEvidence(podRows[0].current_evidence_json || podRows[0].evidence_json), riskFlagged: Array.isArray(podRiskFlags) && podRiskFlags.length > 0, reviewedAt: podRows[0].reviewed_at, createdAt: podRows[0].created_at } : null;
    const timeline = eventRows.map((entry) => { const payload = parseJson(entry.payload_json, {}); return { eventType: entry.event_type, createdAt: entry.created_at, detail: payload.geofence || payload.outcome || payload.borderEvent || payload.milestone || null, locationStatus: payload.geofence || null }; });
    return response.json({
      trip: publicAgentTrip(row, assignment),
      assignment: publicAgentAssignment(assignment),
      pod,
      verificationHistory: verificationRows.map((item) => ({ id: item.id, versionNo: item.version_no, outcome: item.outcome, verification: parseJson(item.verification_json, {}), deviceRef: item.device_ref, createdAt: item.created_at })),
      documents: documentRows.map(publicAgentDocument),
      timeline,
      issues: issueRows.map(publicAgentIssue),
      exceptions: exceptionRows.map(publicAgentException),
      settlements: settlementRows.map((item) => ({ ...item, evidence: publicSettlementEvidence(item.evidence_json) }))
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/agent/trips/:tripId/verify', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    const assignment = await assertAgentTrip(request, trip, 'verify_delivery', { device: true });
    if (!['AT_DESTINATION', 'READY_FOR_DELIVERY', 'DELIVERED'].includes(trip.state) && trip.delivery_state !== 'DELIVERED') throw new DomainError('POD-409', 'پرونده هنوز در مرحله احراز تحویل مقصد نیست.', 409);
    const outcome = String(request.body?.outcome || 'VERIFIED').trim().toUpperCase();
    if (!['VERIFIED', 'MISMATCH', 'HOLD', 'ESCALATE'].includes(outcome)) throw new DomainError('AGT-400', 'نتیجه احراز مقصد معتبر نیست.', 400);
    const location = request.body?.location || request.body?.geo;
    if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) throw new DomainError('GPS-400', 'موقعیت تحویل معتبر الزامی است.', 400);
    const casePayload = parseJson(trip.case_payload_json, {});
    const configuredGeo = casePayload.destination?.geo || casePayload.destination?.coordinates || null;
    const radiusMeters = Number(casePayload.destination?.geofenceRadiusMeters || 1000);
    const distance = configuredGeo ? distanceKm(location, configuredGeo) : null;
    const outsideLocation = distance !== null && distance * 1000 > radiusMeters;
    const outsideReason = String(request.body?.outsideReason || '').trim();
    if (outsideLocation && outsideReason.length < 8) throw new DomainError(ERROR_CODES.LOCATION_MISMATCH, 'موقعیت خارج از محدوده مقصد است؛ دلیل استثنا را ثبت کنید.', 422);
    const checklist = request.body?.checklist && typeof request.body.checklist === 'object' ? request.body.checklist : {};
    const correctRecipientOrgId = String(request.body?.recipientOrgId || request.actor.organizationId).trim();
    const authorityRef = String(request.body?.authorityRef || assignment.authority_ref).trim();
    const cmrRef = String(request.body?.cmrRef || request.body?.cmrNumber || '').trim();
    if (correctRecipientOrgId !== String(trip.authorized_agent_org_id) || authorityRef !== assignment.authority_ref) throw new DomainError(ERROR_CODES.RECIPIENT_MISMATCH, 'گیرنده یا مرجع اختیار با Assignment پرونده منطبق نیست.', 422);
    if (!cmrRef) throw new DomainError('DOC-422', 'مرجع CMR برای تطبیق تحویل الزامی است.', 422);
    const checksPassed = checklist.correctShipment === true && checklist.correctCmr === true && checklist.correctRecipient === true;
    const reason = String(request.body?.reason || '').trim();
    if (outcome === 'VERIFIED' && !checksPassed) throw new DomainError(ERROR_CODES.RECIPIENT_MISMATCH, 'برای احراز موفق، تطبیق محموله، CMR و گیرنده باید تأیید شود.', 422);
    if (outcome !== 'VERIFIED' && reason.length < 8) throw new DomainError('AGT-400', 'برای مغایرت یا Hold شرح کافی الزامی است.', 400);
    const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM agent_delivery_verifications WHERE tenant_id = ? AND trip_id = ?`, [request.actor.tenantId, tripId]);
    const versionNo = Number(versions[0]?.max_version || 0) + 1;
    const verification = {
      recipientOrgId: correctRecipientOrgId,
      consigneeRef: String(request.body?.consigneeRef || '').trim() || null,
      representativeRef: String(request.body?.representativeRef || '').trim() || null,
      authorityRef,
      cmrRef,
      checklist,
      packageCount: request.body?.packageCount ?? null,
      sealState: request.body?.sealState || null,
      damageNote: String(request.body?.damageNote || '').trim() || null,
      verificationMethod: request.body?.verificationMethod || 'manual_plus_document',
      location: { lat: Number(location.lat), lng: Number(location.lng), accuracy: location.accuracy ?? null, timestamp: location.timestamp || new Date().toISOString() },
      locationStatus: outsideLocation ? 'OUTSIDE_WARNING' : 'INSIDE',
      distanceMeters: distance === null ? null : Math.round(distance * 1000),
      radiusMeters,
      outsideReason: outsideReason || null,
      reason: reason || null,
      signatureRef: String(request.body?.signatureRef || '').trim() || null,
      stampRef: String(request.body?.stampRef || '').trim() || null
    };
    const [result] = await pool.execute(`INSERT INTO agent_delivery_verifications (tenant_id, case_id, trip_id, assignment_id, version_no, outcome, verification_json, device_ref, actor_user_id, actor_org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [request.actor.tenantId, trip.case_id, tripId, assignment.id, versionNo, outcome, JSON.stringify(verification), agentDeviceId(request), request.actor.userId, request.actor.organizationId]);
    await event(request, { eventName: 'AgentDeliveryVerified', entityType: 'agent_delivery_verification', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, assignmentId: assignment.id, outcome, versionNo, locationStatus: verification.locationStatus }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: outcome === 'VERIFIED' ? 'احراز تحویل با شواهد ثبت شد.' : 'مغایرت/وضعیت کنترل‌شده ثبت شد.', verificationId: result.insertId, versionNo, outcome, locationStatus: verification.locationStatus }, 201);
  }, { requireKey: true });
});

router.post('/agent/trips/:tripId/evidence', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    const assignment = await assertAgentTrip(request, trip, 'upload_evidence', { device: true });
    const evidenceType = String(request.body?.evidenceType || '').trim().toUpperCase();
    const fileRef = String(request.body?.fileRef || '').trim();
    const fileHash = String(request.body?.fileHash || '').trim().toLowerCase();
    if (!AGENT_EVIDENCE_TYPES.has(evidenceType)) throw new DomainError('POD-400', 'نوع شاهد مقصد معتبر نیست.', 400);
    if (!fileRef || !/^[a-f0-9]{64}$/.test(fileHash)) throw new DomainError('DOC-400', 'مرجع فایل و hash شصت‌وچهار رقمی شاهد الزامی است.', 400);
    const docType = evidenceType === 'WAREHOUSE' ? 'WAREHOUSE_RECEIPT' : evidenceType === 'RECEIPT' ? 'DESTINATION_RECEIPT' : evidenceType === 'DAMAGE' ? 'INCIDENT_DOCUMENT' : 'POD_EVIDENCE';
    const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM platform_documents WHERE tenant_id = ? AND trip_id = ? AND doc_type = ?`, [request.actor.tenantId, tripId, docType]);
    const versionNo = Number(versions[0]?.max_version || 0) + 1;
    const metadata = { evidenceType, deviceRef: agentDeviceId(request), occurredAt: request.body?.occurredAt || new Date().toISOString(), geo: request.body?.geo || request.body?.location || null, note: String(request.body?.note || '').trim() || null, assignmentId: assignment.id };
    const [result] = await pool.execute(`INSERT INTO platform_documents (tenant_id, case_id, trip_id, doc_type, owner_org_id, uploader_user_id, version_no, state, sensitivity, file_ref, file_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 'P2', ?, ?, ?)`, [request.actor.tenantId, trip.case_id, tripId, docType, request.actor.organizationId, request.actor.userId, versionNo, fileRef, fileHash, JSON.stringify(metadata)]);
    await event(request, { eventName: 'DeliveryEvidenceSubmitted', entityType: 'document', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, docType, evidenceType, versionNo }, recipientOrgId: trip.x_org_id });
    return jsonResponse({ message: 'شاهد مقصد به‌صورت نسخه جدید ثبت شد.', documentId: result.insertId, docType, evidenceType, versionNo, state: 'SUBMITTED' }, 201);
  }, { requireKey: true });
});

router.post('/agent/trips/:tripId/documents', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    const assignment = await assertAgentTrip(request, trip, 'upload_evidence', { device: true });
    const docType = String(request.body?.docType || '').trim().toUpperCase();
    const fileRef = String(request.body?.fileRef || '').trim();
    const fileHash = String(request.body?.fileHash || '').trim().toLowerCase();
    if (!AGENT_DOCUMENT_TYPES.has(docType) || docType === 'CMR_FINAL') throw new DomainError('DOC-403', 'این نوع سند در دامنه Agent مقصد نیست.', 403);
    if (!fileRef || !/^[a-f0-9]{64}$/.test(fileHash)) throw new DomainError('DOC-400', 'مرجع فایل و hash سند الزامی است.', 400);
    const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM platform_documents WHERE tenant_id = ? AND trip_id = ? AND doc_type = ?`, [request.actor.tenantId, tripId, docType]);
    const versionNo = Number(versions[0]?.max_version || 0) + 1;
    const metadata = { ...(request.body?.metadata && typeof request.body.metadata === 'object' ? request.body.metadata : {}), assignmentId: assignment.id, deviceRef: agentDeviceId(request) };
    const [result] = await pool.execute(`INSERT INTO platform_documents (tenant_id, case_id, trip_id, doc_type, owner_org_id, uploader_user_id, version_no, state, sensitivity, deadline_at, file_ref, file_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?)`, [request.actor.tenantId, trip.case_id, tripId, docType, request.actor.organizationId, request.actor.userId, versionNo, String(request.body?.sensitivity || 'P2'), safeDate(request.body?.deadlineAt), fileRef, fileHash, JSON.stringify(metadata)]);
    const eventName = docType === 'WAREHOUSE_RECEIPT' ? 'WarehouseReceiptRecorded' : 'DeliveryEvidenceSubmitted';
    await event(request, { eventName, entityType: 'document', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, docType, versionNo }, recipientOrgId: trip.x_org_id });
    return jsonResponse({ message: 'سند مقصد به‌صورت نسخه جدید ثبت شد.', documentId: result.insertId, docType, versionNo, state: 'SUBMITTED' }, 201);
  }, { requireKey: true });
});

router.post('/agent/trips/:tripId/delivery/otp/request', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    const assignment = await assertAgentTrip(request, trip, 'request_otp', { device: true });
    if (!['AT_DESTINATION', 'READY_FOR_DELIVERY', 'DELIVERED'].includes(trip.state) && trip.delivery_state !== 'DELIVERED') throw new DomainError('POD-409', 'OTP فقط در مرحله تحویل مقصد قابل درخواست است.', 409);
    const challenge = randomBytes(24).toString('base64url');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = addMinutes(new Date(), 10);
    await pool.execute(`UPDATE agent_delivery_otps SET state = 'EXPIRED' WHERE tenant_id = ? AND trip_id = ? AND assignment_id = ? AND state = 'SENT'`, [request.actor.tenantId, tripId, assignment.id]);
    const [result] = await pool.execute(`INSERT INTO agent_delivery_otps (tenant_id, trip_id, assignment_id, challenge_hash, code_hash, recipient_ref, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'SENT', ?)`, [request.actor.tenantId, tripId, assignment.id, hashValue(challenge), hashValue(`${challenge}:${code}`), String(request.body?.recipientRef || '').trim() || null, expiresAt]);
    await event(request, { eventName: 'DeliveryOtpRequested', entityType: 'agent_delivery_otp', entityId: result.insertId, payload: { tripId, caseId: trip.case_id, assignmentId: assignment.id, expiresAt }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'چالش OTP تحویل صادر شد.', challengeId: challenge, expiresAt, deliveryMethod: 'configured-provider', ...(process.env.NODE_ENV === 'production' ? {} : { devCode: code }) }, 201);
  }, { requireKey: true });
});

router.post('/agent/trips/:tripId/delivery/otp/verify', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    const assignment = await assertAgentTrip(request, trip, 'verify_otp', { device: true });
    const challengeId = String(request.body?.challengeId || '').trim();
    const code = String(request.body?.code || '').trim();
    if (!challengeId || !/^\d{6}$/.test(code)) throw new DomainError('OTP-400', 'چالش و کد یک‌بارمصرف معتبر لازم است.', 400);
    const [rows] = await pool.execute(`SELECT * FROM agent_delivery_otps WHERE tenant_id = ? AND trip_id = ? AND assignment_id = ? AND challenge_hash = ? LIMIT 1`, [request.actor.tenantId, tripId, assignment.id, hashValue(challengeId)]);
    const otp = rows[0];
    if (!otp) throw new DomainError('OTP-404', 'چالش یک‌بارمصرف پیدا نشد.', 404);
    if (otp.state !== 'SENT' || new Date(otp.expires_at) <= new Date()) {
      await pool.execute(`UPDATE agent_delivery_otps SET state = 'EXPIRED' WHERE id = ? AND tenant_id = ?`, [otp.id, request.actor.tenantId]);
      throw new DomainError(ERROR_CODES.OTP_EXPIRED, 'کد یک‌بارمصرف منقضی شده است.', 424);
    }
    if (Number(otp.attempts) >= 5) throw new DomainError('OTP-429', 'تعداد تلاش‌های کد یک‌بارمصرف به سقف رسیده است.', 429);
    if (hashValue(`${challengeId}:${code}`) !== otp.code_hash) {
      await pool.execute(`UPDATE agent_delivery_otps SET attempts = attempts + 1 WHERE id = ? AND tenant_id = ?`, [otp.id, request.actor.tenantId]);
      throw new DomainError('OTP-424', 'کد یک‌بارمصرف نادرست است.', 424);
    }
    await pool.execute(`UPDATE agent_delivery_otps SET state = 'VERIFIED', verified_at = NOW() WHERE id = ? AND tenant_id = ? AND state = 'SENT'`, [otp.id, request.actor.tenantId]);
    await event(request, { eventName: 'DeliveryOtpVerified', entityType: 'agent_delivery_otp', entityId: otp.id, payload: { tripId, caseId: trip.case_id, assignmentId: assignment.id }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'کد یک‌بارمصرف تحویل تأیید شد.', challengeId, state: 'VERIFIED', verifiedAt: new Date().toISOString() });
  }, { requireKey: true });
});

router.post('/agent/trips/:tripId/discrepancies', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    await assertAgentTrip(request, trip, 'verify_delivery', { device: true });
    const exceptionType = String(request.body?.exceptionType || '').trim().toUpperCase();
    const severity = String(request.body?.severity || 'high').trim().toLowerCase();
    const reason = String(request.body?.reason || '').trim();
    if (!EXCEPTION_TYPES.has(exceptionType) || reason.length < 8) throw new DomainError('EXC-400', 'نوع و شرح مغایرت مقصد الزامی است.', 400);
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) throw new DomainError('EXC-400', 'شدت مغایرت معتبر نیست.', 400);
    const geo = request.body?.geo || request.body?.location || null;
    const evidence = { ...(request.body?.evidence && typeof request.body.evidence === 'object' ? request.body.evidence : {}), geo, deviceRef: agentDeviceId(request) };
    const [result] = await pool.execute(`INSERT INTO platform_exceptions (tenant_id, case_id, trip_id, exception_type, severity, status, reason, evidence_json, opened_by_user_id, opened_by_org_id) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`, [request.actor.tenantId, trip.case_id, tripId, exceptionType, severity, reason, JSON.stringify(evidence), request.actor.userId, request.actor.organizationId]);
    await event(request, { eventName: 'ExceptionOpened', entityType: 'platform_exception', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, exceptionType, severity }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    if (['high', 'critical'].includes(severity)) await event(request, { eventName: 'RiskFlagged', entityType: 'platform_exception', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, exceptionType, severity }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'مغایرت مقصد ثبت و به شرکت X اطلاع داده شد.', exceptionId: result.insertId, state: 'OPEN' }, 201);
  }, { requireKey: true });
});

router.get('/agent/settlements', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.SEE_SETTLEMENT }), async (request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT l.id, l.case_id, l.trip_id, l.relationship_type, l.payer_org_id, l.payee_org_id, l.amount, l.currency, l.state, l.evidence_json, l.created_at, l.updated_at, c.case_number
         FROM relationship_ledgers l
         JOIN shipment_cases c ON c.id = l.case_id AND c.tenant_id = l.tenant_id
         JOIN trip_cases t ON t.id = l.trip_id AND t.tenant_id = l.tenant_id AND t.authorized_agent_org_id = ?
        WHERE l.tenant_id = ? AND l.relationship_type = 'x_agent' AND (l.payer_org_id = ? OR l.payee_org_id = ?)
        ORDER BY l.updated_at DESC`,
      [request.actor.organizationId, request.actor.tenantId, request.actor.organizationId, request.actor.organizationId]
    );
    await audit(request, { eventType: 'SettlementViewed', subjectType: 'relationship_ledger', payload: { relationshipType: RELATIONSHIPS.X_AGENT, surface: 'agent_z' } });
    return response.json({ relationship: RELATIONSHIPS.X_AGENT, settlements: rows.map((row) => ({ id: row.id, caseId: row.case_id, tripId: row.trip_id, caseNumber: row.case_number, relationshipType: row.relationship_type, amount: row.amount, currency: row.currency, state: row.state, evidence: publicSettlementEvidence(row.evidence_json), createdAt: row.created_at, updatedAt: row.updated_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/agent/settlements/:settlementId/dispute', platformAuth({ roles: [ROLES.AGENT_Z], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const settlementId = parsePositiveId(request.params.settlementId, 'شناسه تسویه');
    const [rows] = await pool.execute(`SELECT l.*, c.case_number, t.authorized_agent_org_id, t.x_org_id, t.y_org_id FROM relationship_ledgers l JOIN shipment_cases c ON c.id = l.case_id AND c.tenant_id = l.tenant_id JOIN trip_cases t ON t.id = l.trip_id AND t.tenant_id = l.tenant_id WHERE l.id = ? AND l.tenant_id = ? LIMIT 1`, [settlementId, request.actor.tenantId]);
    const ledger = rows[0];
    if (!ledger || ledger.relationship_type !== RELATIONSHIPS.X_AGENT || ledger.authorized_agent_org_id !== request.actor.organizationId || ![ledger.payer_org_id, ledger.payee_org_id].includes(request.actor.organizationId)) throw new DomainError('FIN-403', 'تسویه خارج از رابطه X-Agent شماست.', 403);
    const trip = await loadTrip(ledger.trip_id, request.actor.tenantId);
    await assertAgentTrip(request, trip, 'open_claim', { device: true });
    const reason = String(request.body?.reason || '').trim();
    if (reason.length < 8) throw new DomainError('DSP-400', 'دلیل اختلاف تسویه الزامی است.', 400);
    const evidence = request.body?.evidence && typeof request.body.evidence === 'object' ? request.body.evidence : {};
    const [result] = await pool.execute(`INSERT INTO platform_claims (tenant_id, case_id, trip_id, case_type, status, reason, evidence_json, opened_by_user_id, opened_by_org_id) VALUES (?, ?, ?, 'DISPUTE', 'OPEN', ?, ?, ?, ?)`, [request.actor.tenantId, ledger.case_id, ledger.trip_id, reason, JSON.stringify({ ...evidence, settlementId }), request.actor.userId, request.actor.organizationId]);
    await event(request, { eventName: 'DisputeOpened', entityType: 'settlement_dispute', entityId: result.insertId, payload: { caseId: ledger.case_id, tripId: ledger.trip_id, settlementId, relationshipType: RELATIONSHIPS.X_AGENT }, recipientOrgId: ledger.x_org_id });
    return jsonResponse({ message: 'اختلاف تسویه X-Agent ثبت شد.', claimId: result.insertId, settlementId, state: 'OPEN' }, 201);
  }, { requireKey: true });
});

router.get('/driver/undertaking', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (_request, response) => {
  return response.json({ version: DRIVER_UNDERTAKING_VERSION, items: DRIVER_UNDERTAKING, acceptanceRequired: true });
});

router.post('/driver/devices/bind', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const driverId = driverIdFromActor(request.actor);
    const deviceId = String(request.body?.deviceId || driverDeviceId(request)).trim();
    if (deviceId.length < 12) throw new DomainError('DEVICE-400', 'شناسه دستگاه معتبر نیست.', 400);
    const platform = String(request.body?.platform || 'web-mobile').trim().slice(0, 24);
    const appVersion = String(request.body?.appVersion || '').trim().slice(0, 40) || null;
    const integrity = request.body?.integrity && typeof request.body.integrity === 'object' ? request.body.integrity : {};
    await pool.execute(
      `INSERT INTO driver_devices (tenant_id, driver_id, device_id, platform, app_version, integrity_json, status, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())
       ON DUPLICATE KEY UPDATE platform = VALUES(platform), app_version = VALUES(app_version), integrity_json = VALUES(integrity_json), status = 'active', last_seen_at = NOW()`,
      [request.actor.tenantId, driverId, deviceId, platform, appVersion, JSON.stringify(integrity)]
    );
    await event(request, { eventName: 'DriverDeviceBound', entityType: 'driver_device', entityId: null, payload: { driverId, deviceId, platform, appVersion } });
    return jsonResponse({ message: 'دستگاه برای نشست راننده ثبت شد.', deviceId, platform, status: 'active' }, 201);
  }, { requireKey: true });
});

router.get('/driver/profile', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const driverId = driverIdFromActor(request.actor);
    const [driverRows] = await pool.execute(`SELECT * FROM drivers WHERE id = ? AND tenant_id = ? LIMIT 1`, [driverId, request.actor.tenantId]);
    const driver = driverRows[0];
    if (!driver) throw new DomainError('DRIVER-404', 'پروفایل راننده پیدا نشد.', 404);
    const [coverageRows] = await pool.execute(
      `SELECT a.*, o.display_name AS y_name
         FROM carrier_driver_assignments a
         LEFT JOIN platform_organizations o ON o.id = a.y_org_id AND o.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND a.driver_id = ?
        ORDER BY a.updated_at DESC`,
      [request.actor.tenantId, driverId]
    );
    const [vehicleRows] = await pool.execute(
      `SELECT DISTINCT v.*
         FROM vehicles v
         LEFT JOIN carrier_driver_assignments a ON a.vehicle_id = v.id AND a.tenant_id = v.tenant_id AND a.driver_id = ?
        WHERE v.tenant_id = ? AND (v.owner_org_id = ? OR a.driver_id = ?)
        ORDER BY v.updated_at DESC, v.id DESC`,
      [driverId, request.actor.tenantId, request.actor.organizationId, driverId]
    );
    const [documentRows] = await pool.execute(`SELECT * FROM driver_documents WHERE tenant_id = ? AND driver_id = ? ORDER BY doc_type, version_no DESC`, [request.actor.tenantId, driverId]);
    return response.json({
      profile: publicDriverProfile(driver),
      coverage: coverageRows.map((row) => ({ ...publicCoverage({ ...row, driver }), yOrgId: row.y_org_id, yName: row.y_name || row.y_org_id })),
      vehicles: vehicleRows.map(publicVehicle),
      documents: documentRows.map(publicDriverDocument)
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.patch('/driver/profile', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const driverId = driverIdFromActor(request.actor);
    await assertDriverDevice(request);
    const requested = String(request.body?.availabilityState || '').toLowerCase();
    const allowed = new Map([['free', 'available'], ['available', 'available'], ['in_trip', 'in_trip'], ['in-trip', 'in_trip'], ['inactive', 'inactive'], ['out_of_service', 'inactive'], ['out-of-service', 'inactive']]);
    const next = allowed.get(requested);
    if (!next) throw new DomainError('DRIVER-400', 'وضعیت دسترسی راننده معتبر نیست.', 400);
    const [activeTrips] = await pool.execute(`SELECT id FROM trip_cases WHERE tenant_id = ? AND driver_id = ? AND (tracking_state = 'ACTIVE' OR state IN ('DISPATCHED', 'AT_BORDER', 'EXITED_IRAN', 'IN_TRANSIT', 'AT_DESTINATION')) LIMIT 1`, [request.actor.tenantId, driverId]);
    if (activeTrips[0] && next !== 'in_trip') throw new DomainError('DRIVER-409', 'در سفر فعال، وضعیت راننده فقط توسط چرخه سفر مدیریت می‌شود.', 409);
    await pool.execute(`UPDATE drivers SET availability_state = ? WHERE id = ? AND tenant_id = ?`, [next, driverId, request.actor.tenantId]);
    await event(request, { eventName: 'DriverAvailabilityChanged', entityType: 'driver', entityId: driverId, payload: { driverId, availabilityState: next } });
    return jsonResponse({ message: 'وضعیت دسترسی راننده به‌روزرسانی شد.', availabilityState: next });
  }, { requireKey: true });
});

router.post('/driver/documents', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const driverId = driverIdFromActor(request.actor);
    await assertDriverDevice(request);
    const docType = String(request.body?.docType || '').trim().toUpperCase();
    const fileRef = String(request.body?.fileRef || '').trim();
    const fileHash = String(request.body?.fileHash || '').trim().toLowerCase();
    if (!DRIVER_DOCUMENT_TYPES.has(docType) || !fileRef || !/^[a-f0-9]{64}$/.test(fileHash)) throw new DomainError('DOC-400', 'نوع سند، مرجع فایل و hash معتبر الزامی است.', 400);
    const [versionRows] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM driver_documents WHERE tenant_id = ? AND driver_id = ? AND doc_type = ?`, [request.actor.tenantId, driverId, docType]);
    const versionNo = Number(versionRows[0]?.max_version || 0) + 1;
    const [result] = await pool.execute(
      `INSERT INTO driver_documents (tenant_id, driver_id, doc_type, version_no, state, sensitivity, expires_at, file_ref, file_hash, metadata_json)
       VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?)`,
      [request.actor.tenantId, driverId, docType, versionNo, String(request.body?.sensitivity || 'P2'), safeDate(request.body?.expiresAt), fileRef, fileHash, JSON.stringify(request.body?.metadata || {})]
    );
    await event(request, { eventName: 'DriverDocumentSubmitted', entityType: 'driver_document', entityId: result.insertId, payload: { driverId, docType, versionNo } });
    return jsonResponse({ message: 'نسخه جدید مدرک راننده ثبت شد.', document: { id: result.insertId, docType, versionNo, state: 'SUBMITTED' } }, 201);
  }, { requireKey: true });
});

router.post('/driver/vehicles', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const driverId = driverIdFromActor(request.actor);
    await assertDriverDevice(request);
    const plateNumber = String(request.body?.plateNumber || '').trim();
    if (!plateNumber) throw new DomainError('VEH-400', 'پلاک یا پلاک ترانزیت الزامی است.', 400);
    const capacity = request.body?.capacity === undefined || request.body?.capacity === null || request.body?.capacity === '' ? null : Number(request.body.capacity);
    if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0)) throw new DomainError('VEH-400', 'ظرفیت خودرو معتبر نیست.', 400);
    const [result] = await pool.execute(
      `INSERT INTO vehicles (tenant_id, owner_org_id, plate_number, cargo_scope, status, vehicle_type, capacity, reefer_capable, special_capability, owner_relation, insurance_json, technical_docs_json, route_permits_json, availability_state)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, 'available')`,
      [request.actor.tenantId, request.actor.organizationId, plateNumber, JSON.stringify(request.body?.cargoScope || []), request.body?.vehicleType || null, capacity, request.body?.reeferCapable ? 1 : 0, request.body?.specialCapability || null, request.body?.ownerRelation || 'driver_owned', JSON.stringify(request.body?.insurance || {}), JSON.stringify(request.body?.technicalDocs || {}), JSON.stringify(request.body?.routePermits || {})]
    );
    const [rows] = await pool.execute(`SELECT * FROM vehicles WHERE id = ? AND tenant_id = ? LIMIT 1`, [result.insertId, request.actor.tenantId]);
    await event(request, { eventName: 'VehicleIntroduced', entityType: 'vehicle', entityId: result.insertId, payload: { driverId, ownerOrgId: request.actor.organizationId, driverOwned: true } });
    return jsonResponse({ message: 'وسیله نقلیه راننده ثبت شد.', vehicle: publicVehicle(rows[0]) }, 201);
  }, { requireKey: true });
});

router.get('/driver/opportunities', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const driverId = driverIdFromActor(request.actor);
    const [rows] = await pool.execute(
      `SELECT DISTINCT r.id AS rfq_id, r.case_id, r.deadline_at, r.state AS rfq_state, r.metadata_json,
              c.case_number, c.direction, c.origin_country, c.destination_country, c.origin_location, c.destination_location,
              c.cargo_type, c.cargo_weight, c.cargo_weight_unit, a.y_org_id, o.display_name AS y_name,
              b.id AS bid_id, b.amount AS bid_amount, b.currency AS bid_currency, b.state AS bid_state, b.terms_json AS bid_terms_json
         FROM rfq_books r
         JOIN shipment_cases c ON c.id = r.case_id AND c.tenant_id = r.tenant_id
         JOIN platform_notifications n ON n.tenant_id = r.tenant_id
           AND n.recipient_org_id IS NOT NULL
           AND JSON_UNQUOTE(JSON_EXTRACT(n.payload_json, '$.entityId')) = CAST(r.id AS CHAR)
         JOIN carrier_driver_assignments a ON a.tenant_id = r.tenant_id AND a.y_org_id = n.recipient_org_id AND a.driver_id = ? AND a.state = 'active'
           AND (a.valid_from IS NULL OR a.valid_from <= NOW()) AND (a.valid_to IS NULL OR a.valid_to >= NOW())
         LEFT JOIN platform_organizations o ON o.id = a.y_org_id AND o.tenant_id = a.tenant_id
         LEFT JOIN driver_internal_bids b ON b.tenant_id = r.tenant_id AND b.rfq_id = r.id AND b.driver_id = ? AND b.y_org_id = a.y_org_id
        WHERE r.tenant_id = ? AND r.level = 'RFQ2' AND r.state = 'OPEN' AND r.deadline_at > NOW()
        ORDER BY r.deadline_at ASC, r.id DESC`,
      [driverId, driverId, request.actor.tenantId]
    );
    const opportunities = rows.map((row) => ({
      id: row.rfq_id,
      rfqId: row.rfq_id,
      caseId: row.case_id,
      caseNumber: row.case_number,
      direction: row.direction,
      route: { originCountry: row.origin_country, destinationCountry: row.destination_country, origin: row.origin_location, destination: row.destination_location },
      cargo: { type: row.cargo_type, weight: row.cargo_weight, unit: row.cargo_weight_unit },
      yOrgId: row.y_org_id,
      yName: row.y_name || row.y_org_id,
      deadlineAt: row.deadline_at,
      metadata: publicDriverOpportunityMetadata(row.metadata_json),
      ownBid: row.bid_id ? { id: row.bid_id, amount: row.bid_amount, currency: row.bid_currency, state: row.bid_state, terms: parseJson(row.bid_terms_json, {}) } : null
    }));
    return response.json({ opportunities });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/driver/opportunities/:rfqId/bid', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const driverId = driverIdFromActor(request.actor);
    await assertDriverDevice(request);
    const rfqId = parsePositiveId(request.params.rfqId, 'شناسه فرصت');
    const [rfqRows] = await pool.execute(
      `SELECT r.*, c.case_number FROM rfq_books r JOIN shipment_cases c ON c.id = r.case_id AND c.tenant_id = r.tenant_id WHERE r.id = ? AND r.tenant_id = ? LIMIT 1`,
      [rfqId, request.actor.tenantId]
    );
    const rfq = rfqRows[0];
    if (!rfq || rfq.level !== RFQ_LEVELS.MARKET_B) throw new DomainError('RFQ-404', 'فرصت داخلی راننده پیدا نشد.', 404);
    if (rfq.state !== 'OPEN' || !rfq.deadline_at || new Date(rfq.deadline_at) <= new Date()) throw new DomainError(ERROR_CODES.BID_OUTSIDE_WINDOW, 'مهلت پیشنهاد داخلی تمام شده است.', 409);
    const yOrgId = String(request.body?.yOrgId || '').trim();
    if (!yOrgId) throw new DomainError('BID-400', 'سازمان Y مقصد پیشنهاد الزامی است.', 400);
    const [coverageRows] = await pool.execute(
      `SELECT id FROM carrier_driver_assignments WHERE tenant_id = ? AND driver_id = ? AND y_org_id = ? AND state = 'active'
         AND (valid_from IS NULL OR valid_from <= NOW()) AND (valid_to IS NULL OR valid_to >= NOW()) LIMIT 1`,
      [request.actor.tenantId, driverId, yOrgId]
    );
    if (!coverageRows[0]) throw new DomainError(ERROR_CODES.CARRIER_COVERAGE_MISSING, 'Coverage معتبر برای این سازمان Y وجود ندارد.', 424);
    const [invitationRows] = await pool.execute(`SELECT id FROM platform_notifications WHERE tenant_id = ? AND recipient_org_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.entityId')) = CAST(? AS CHAR) LIMIT 1`, [request.actor.tenantId, yOrgId, rfqId]);
    if (!invitationRows[0]) throw new DomainError('AUTH-403', 'این فرصت برای Coverage فعلی راننده منتشر نشده است.', 403);
    const amount = Number(request.body?.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new DomainError('BID-400', 'مبلغ پیشنهاد داخلی معتبر نیست.', 400);
    const state = String(request.body?.state || (request.body?.submit === false ? 'DRAFT' : 'SUBMITTED')).toUpperCase();
    if (!['DRAFT', 'SUBMITTED'].includes(state)) throw new DomainError('BID-400', 'وضعیت پیشنهاد داخلی معتبر نیست.', 400);
    if (state === 'SUBMITTED' && String(request.body?.undertakingVersion || '') !== DRIVER_UNDERTAKING_VERSION) throw new DomainError('DRIVER-422', 'نسخه تعهدنامه راننده برای ارسال پیشنهاد الزامی است.', 422);
    const [result] = await pool.execute(
      `INSERT INTO driver_internal_bids (tenant_id, rfq_id, driver_id, y_org_id, amount, currency, terms_json, state, undertaking_version, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE amount = VALUES(amount), currency = VALUES(currency), terms_json = VALUES(terms_json), state = VALUES(state), undertaking_version = VALUES(undertaking_version), submitted_at = VALUES(submitted_at)`,
      [request.actor.tenantId, rfqId, driverId, yOrgId, amount, String(request.body?.currency || 'EUR').toUpperCase().slice(0, 3), JSON.stringify(request.body?.terms || {}), state, state === 'SUBMITTED' ? DRIVER_UNDERTAKING_VERSION : null, state === 'SUBMITTED' ? new Date() : null]
    );
    await event(request, { eventName: 'DriverBidSubmitted', entityType: 'driver_internal_bid', entityId: result.insertId || null, payload: { rfqId, caseId: rfq.case_id, driverId, yOrgId, state }, recipientOrgId: yOrgId });
    return jsonResponse({ message: state === 'DRAFT' ? 'پیشنهاد داخلی ذخیره شد.' : 'پیشنهاد داخلی برای شرکت Y ارسال شد.', rfqId, yOrgId, state }, 201);
  }, { requireKey: true });
});

router.get('/driver/trips', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const driverId = driverIdFromActor(request.actor);
    const [rows] = await pool.execute(
      `SELECT t.*, c.case_number, c.direction, c.origin_country, c.destination_country, c.origin_location, c.destination_location,
              c.cargo_type, c.cargo_weight, c.cargo_weight_unit, c.loading_state, c.customs_state, c.tir_state,
              c.delivery_state, c.financial_state, o.display_name AS y_name, ao.display_name AS agent_name,
              p.state AS pod_state, a.accepted_at AS undertaking_accepted_at, a.undertaking_version
         FROM trip_cases t
         JOIN shipment_cases c ON c.id = t.case_id AND c.tenant_id = t.tenant_id
         LEFT JOIN platform_organizations o ON o.id = t.y_org_id AND o.tenant_id = t.tenant_id
         LEFT JOIN platform_organizations ao ON ao.id = t.authorized_agent_org_id AND ao.tenant_id = t.tenant_id
         LEFT JOIN pod_cases p ON p.trip_id = t.id AND p.tenant_id = t.tenant_id
         LEFT JOIN driver_trip_acceptances a ON a.trip_id = t.id AND a.driver_id = ? AND a.tenant_id = t.tenant_id
        WHERE t.tenant_id = ? AND t.driver_id = ?
        ORDER BY t.updated_at DESC`,
      [driverId, request.actor.tenantId, driverId]
    );
    return response.json({ trips: rows.map(publicDriverTrip) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/driver/dashboard', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const driverId = driverIdFromActor(request.actor);
    const [driverRows] = await pool.execute(`SELECT * FROM drivers WHERE id = ? AND tenant_id = ? LIMIT 1`, [driverId, request.actor.tenantId]);
    if (!driverRows[0]) throw new DomainError('DRIVER-404', 'پروفایل راننده پیدا نشد.', 404);
    const [tripRows] = await pool.execute(
      `SELECT t.*, c.case_number, c.direction, c.origin_country, c.destination_country, c.origin_location, c.destination_location,
              c.cargo_type, c.cargo_weight, c.cargo_weight_unit, c.loading_state, c.customs_state, c.tir_state,
              c.delivery_state, c.financial_state, o.display_name AS y_name, ao.display_name AS agent_name,
              p.state AS pod_state, a.accepted_at AS undertaking_accepted_at, a.undertaking_version
         FROM trip_cases t JOIN shipment_cases c ON c.id = t.case_id AND c.tenant_id = t.tenant_id
         LEFT JOIN platform_organizations o ON o.id = t.y_org_id AND o.tenant_id = t.tenant_id
         LEFT JOIN platform_organizations ao ON ao.id = t.authorized_agent_org_id AND ao.tenant_id = t.tenant_id
         LEFT JOIN pod_cases p ON p.trip_id = t.id AND p.tenant_id = t.tenant_id
         LEFT JOIN driver_trip_acceptances a ON a.trip_id = t.id AND a.driver_id = ? AND a.tenant_id = t.tenant_id
        WHERE t.tenant_id = ? AND t.driver_id = ? ORDER BY t.updated_at DESC LIMIT 20`,
      [driverId, request.actor.tenantId, driverId]
    );
    const [opportunityRows] = await pool.execute(
      `SELECT COUNT(DISTINCT r.id) AS total
         FROM rfq_books r
         JOIN platform_notifications n ON n.tenant_id = r.tenant_id AND n.recipient_org_id IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(n.payload_json, '$.entityId')) = CAST(r.id AS CHAR)
         JOIN carrier_driver_assignments a ON a.tenant_id = r.tenant_id AND a.y_org_id = n.recipient_org_id AND a.driver_id = ? AND a.state = 'active'
        WHERE r.tenant_id = ? AND r.level = 'RFQ2' AND r.state = 'OPEN' AND r.deadline_at > NOW()`,
      [driverId, request.actor.tenantId]
    );
    const [settlementRows] = await pool.execute(`SELECT COUNT(*) AS total FROM relationship_ledgers WHERE tenant_id = ? AND relationship_type = 'y_driver' AND (payer_org_id = ? OR payee_org_id = ?)`, [request.actor.tenantId, `driver:${driverId}`, `driver:${driverId}`]);
    const [notifications] = await pool.execute(`SELECT id, payload_json, state, created_at FROM platform_notifications WHERE tenant_id = ? AND recipient_user_id = ? ORDER BY created_at DESC LIMIT 20`, [request.actor.tenantId, request.actor.userId || 0]);
    return response.json({
      profile: publicDriverProfile(driverRows[0]),
      trips: tripRows.map(publicDriverTrip),
      metrics: { activeTrips: tripRows.filter((row) => row.tracking_state === 'ACTIVE').length, assignedTrips: tripRows.length, opportunities: Number(opportunityRows[0]?.total || 0), settlements: Number(settlementRows[0]?.total || 0) },
      notifications: notifications.map((row) => ({ id: row.id, state: row.state, payload: parseJson(row.payload_json, {}), createdAt: row.created_at }))
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/driver/trips/:tripId', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    const [scheduleRows] = await pool.execute(`SELECT schedule_json, version_no, created_at FROM trip_loading_schedules WHERE tenant_id = ? AND trip_id = ? ORDER BY version_no DESC LIMIT 1`, [request.actor.tenantId, tripId]);
    const [eventRows] = await pool.execute(`SELECT id, event_type, location_json, payload_json, created_at FROM platform_trip_events WHERE tenant_id = ? AND trip_id = ? ORDER BY created_at DESC LIMIT 50`, [request.actor.tenantId, tripId]);
    const [documents] = await pool.execute(`SELECT id, case_id, trip_id, doc_type, version_no, state, sensitivity, deadline_at, owner_org_id, uploader_user_id, approver_user_id, file_hash, file_ref, metadata_json, locked_at, created_at FROM platform_documents WHERE tenant_id = ? AND trip_id = ? AND state = 'APPROVED' AND doc_type IN ('CMR_FINAL', 'TIR_CARNET', 'TRANSIT_PERMIT', 'ROUTE_PERMIT', 'CUSTOMS_PERMIT', 'DRIVER_HANDOFF') ORDER BY doc_type, version_no DESC`, [request.actor.tenantId, tripId]);
    const [podRows] = await pool.execute(`SELECT p.*, v.evidence_json AS current_evidence_json FROM pod_cases p LEFT JOIN pod_evidence_versions v ON v.pod_id = p.id AND v.tenant_id = p.tenant_id AND v.version_no = p.evidence_version_no WHERE p.tenant_id = ? AND p.trip_id = ? LIMIT 1`, [request.actor.tenantId, tripId]);
    const [acceptanceRows] = await pool.execute(`SELECT accepted_at, undertaking_version, device_id FROM driver_trip_acceptances WHERE tenant_id = ? AND trip_id = ? AND driver_id = ? LIMIT 1`, [request.actor.tenantId, tripId, request.actor.externalId]);
    const [agentRows] = trip.authorized_agent_org_id ? await pool.execute(`SELECT id, display_name, organization_type, status FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [trip.authorized_agent_org_id, request.actor.tenantId]) : [[]];
    const trackingActive = trip.tracking_state === 'ACTIVE';
    return response.json({
      trip: publicDriverTrip({ ...trip, y_org_id: trip.y_org_id, loading_schedule_json: scheduleRows[0]?.schedule_json || trip.loading_schedule_json, y_name: null, agent_name: agentRows[0]?.display_name || null, pod_state: podRows[0]?.state || null, undertaking_accepted_at: acceptanceRows[0]?.accepted_at || null, undertaking_version: acceptanceRows[0]?.undertaking_version || null }),
      readiness: parseJson(trip.readiness_json, {}),
      loadingSchedule: scheduleRows[0] ? { ...parseJson(scheduleRows[0].schedule_json, {}), versionNo: scheduleRows[0].version_no, createdAt: scheduleRows[0].created_at } : null,
      documents: documents.map(publicDocument),
      events: eventRows.map((row) => {
        const payload = parseJson(row.payload_json, {});
        if (trackingActive) return { id: row.id, type: row.event_type, location: parseJson(row.location_json, null), payload, createdAt: row.created_at };
        const { location: _location, geo: _geo, ...safePayload } = payload;
        return { id: row.id, type: row.event_type, location: null, payload: safePayload, createdAt: row.created_at };
      }),
      pod: podRows[0] ? { id: podRows[0].id, state: podRows[0].state, evidenceVersion: podRows[0].evidence_version_no, recipientOrgId: podRows[0].recipient_org_id, authorityRef: podRows[0].authority_ref, otpVerified: Boolean(podRows[0].otp_verified), evidence: parseJson(podRows[0].current_evidence_json || podRows[0].evidence_json, {}), riskFlags: parseJson(podRows[0].risk_flags_json, []) } : null,
      acceptance: acceptanceRows[0] ? { acceptedAt: acceptanceRows[0].accepted_at, undertakingVersion: acceptanceRows[0].undertaking_version, deviceId: acceptanceRows[0].device_id } : null,
      authorizedAgent: agentRows[0] ? { organizationId: agentRows[0].id, name: agentRows[0].display_name, type: agentRows[0].organization_type, status: agentRows[0].status } : null
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/driver/trips/:tripId/accept', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    const device = await assertDriverDevice(request);
    if (!trip.y_award_accepted_at) throw new DomainError('AWD-409', 'پذیرش Award شرکت Y پیش از قبول سفر راننده الزامی است.', 409);
    if (String(request.body?.undertakingVersion || '') !== DRIVER_UNDERTAKING_VERSION) throw new DomainError('DRIVER-422', 'قبول سفر با نسخه جاری تعهدنامه الزامی است.', 422);
    const [coverageRows] = await pool.execute(`SELECT id FROM carrier_driver_assignments WHERE tenant_id = ? AND driver_id = ? AND y_org_id = ? AND state = 'active' AND (valid_from IS NULL OR valid_from <= NOW()) AND (valid_to IS NULL OR valid_to >= NOW()) LIMIT 1`, [request.actor.tenantId, request.actor.externalId, trip.y_org_id]);
    if (!coverageRows[0]) throw new DomainError(ERROR_CODES.CARRIER_COVERAGE_MISSING, 'Coverage راننده برای این سفر معتبر نیست.', 424);
    const [existing] = await pool.execute(`SELECT id, accepted_at FROM driver_trip_acceptances WHERE tenant_id = ? AND trip_id = ? AND driver_id = ? LIMIT 1`, [request.actor.tenantId, tripId, request.actor.externalId]);
    if (existing[0]) return jsonResponse({ message: 'قبول سفر قبلاً ثبت شده است.', tripId, acceptedAt: existing[0].accepted_at, undertakingVersion: DRIVER_UNDERTAKING_VERSION });
    const [result] = await pool.execute(`INSERT INTO driver_trip_acceptances (tenant_id, trip_id, driver_id, coverage_id, undertaking_version, device_id, accepted_by_user_id, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`, [request.actor.tenantId, tripId, request.actor.externalId, coverageRows[0].id, DRIVER_UNDERTAKING_VERSION, device.device_id, request.actor.userId]);
    await event(request, { eventName: 'DriverTripAccepted', entityType: 'driver_trip_acceptance', entityId: result.insertId, payload: { tripId, driverId: request.actor.externalId, coverageId: coverageRows[0].id, undertakingVersion: DRIVER_UNDERTAKING_VERSION }, recipientOrgId: trip.y_org_id });
    return jsonResponse({ message: 'قبول سفر و تعهدنامه ثبت شد.', tripId, acceptedAt: new Date().toISOString(), undertakingVersion: DRIVER_UNDERTAKING_VERSION }, 201);
  }, { requireKey: true });
});

router.post('/cases', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    assertShipperOrganization(request.actor);
    const input = request.body || {};
    const direction = String(input.direction || 'EXPORT').toUpperCase();
    if (!['EXPORT', 'IMPORT'].includes(direction)) throw new DomainError('INPUT-400', 'جهت پرونده معتبر نیست.', 400);
    const payload = normalizeDraftInput({ ...input, direction });
    const origin = payload.origin || {};
    const destination = payload.destination || {};
    const cargo = payload.cargo || {};
    const schedule = payload.schedule || {};
    assertAbacCaseScope(request.actor, { origin_country: origin.country, destination_country: destination.country, origin_location: origin.location || origin.address, destination_location: destination.location || destination.address, cargo_type: cargo.type });
    const deadlineAt = safeDate(input.deadlineAt || schedule.rfqDeadline);
    const caseNumber = randomCaseNumber();
    const importState = direction === 'IMPORT' ? 'I01_IMPORT_REQUEST' : null;
    const [result] = await pool.execute(
      `INSERT INTO shipment_cases
        (tenant_id, case_number, owner_org_id, direction, state, commercial_state, import_state,
         origin_country, destination_country, origin_location, destination_location, cargo_type,
         cargo_description, cargo_weight, cargo_weight_unit, deadline_at, risk_flags, payload_json, created_by_user_id)
       VALUES (?, ?, ?, ?, 'DRAFT', 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.actor.tenantId, caseNumber, request.actor.organizationId, direction, importState,
        origin.country || null, destination.country || null, origin.location || origin.address || null, destination.location || destination.address || null,
        cargo.type || null, cargo.description || null, cargo.weight || null, cargo.unit || null,
        deadlineAt, JSON.stringify(payload.riskFlags || []), JSON.stringify(payload), request.actor.userId]
    );
    await event(request, { eventName: 'CargoRequestCreated', entityType: 'shipment_case', entityId: result.insertId, payload: { caseNumber, direction }, recipientOrgId: request.actor.organizationId });
    const review = reviewShipperDraft({ direction, deadline_at: deadlineAt }, payload);
    return jsonResponse({ message: 'درخواست بار ایجاد شد.', case: { id: result.insertId, caseNumber, state: 'DRAFT', direction }, review }, 201);
  }, { requireKey: true });
});

router.patch('/cases/:caseId/draft', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    assertShipperOrganization(request.actor);
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, item.owner_org_id);
    if (item.commercial_state !== 'DRAFT') throw new DomainError('CASE-409', 'فقط پرونده پیش‌نویس قابل ویرایش است.', 409);
    const current = parseJson(item.payload_json, {});
    const payload = normalizeDraftInput(request.body || {}, current);
    const direction = String(payload.direction || item.direction || 'EXPORT').toUpperCase();
    if (!['EXPORT', 'IMPORT'].includes(direction)) throw new DomainError('INPUT-400', 'جهت پرونده معتبر نیست.', 400);
    const origin = payload.origin || {};
    const destination = payload.destination || {};
    const cargo = payload.cargo || {};
    const schedule = payload.schedule || {};
    assertAbacCaseScope(request.actor, { origin_country: origin.country, destination_country: destination.country, origin_location: origin.location || origin.address, destination_location: destination.location || destination.address, cargo_type: cargo.type });
    const deadlineAt = safeDate(request.body?.deadlineAt || schedule.rfqDeadline || item.deadline_at);
    await pool.execute(
      `UPDATE shipment_cases SET direction = ?, import_state = ?, origin_country = ?, destination_country = ?,
         origin_location = ?, destination_location = ?, cargo_type = ?, cargo_description = ?, cargo_weight = ?,
         cargo_weight_unit = ?, deadline_at = ?, risk_flags = ?, payload_json = ?
       WHERE id = ? AND tenant_id = ? AND owner_org_id = ? AND commercial_state = 'DRAFT'`,
      [direction, direction === 'IMPORT' ? 'I01_IMPORT_REQUEST' : null, origin.country || null, destination.country || null,
        origin.location || origin.address || null, destination.location || destination.address || null, cargo.type || null,
        cargo.description || null, cargo.weight || null, cargo.unit || null, deadlineAt, JSON.stringify(payload.riskFlags || []), JSON.stringify(payload),
        caseId, request.actor.tenantId, request.actor.organizationId]
    );
    await event(request, { eventName: 'CargoRequestUpdated', entityType: 'shipment_case', entityId: caseId, payload: { caseId, action: 'draft_saved', direction }, recipientOrgId: item.owner_org_id });
    return jsonResponse({ message: 'پیش‌نویس درخواست ذخیره شد.', case: { ...publicCase({ ...item, direction, deadline_at: deadlineAt }), direction, state: 'DRAFT' }, review: reviewShipperDraft({ ...item, direction, deadline_at: deadlineAt }, payload) });
  }, { requireKey: true });
});

router.get('/cases/:caseId/review', platformAuth({ roles: SHIPPER_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    assertShipperOrganization(request.actor);
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    return response.json({ caseId, review: reviewShipperDraft(item, parseJson(item.payload_json, {})), editable: item.commercial_state === 'DRAFT' && item.owner_org_id === request.actor.organizationId });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/cases/:caseId/publish-rfq', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    assertShipperOrganization(request.actor);
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, item.owner_org_id);
    assertDelegated(request.actor, 'publishRfq');
    reviewShipperDraft(item, parseJson(item.payload_json, {}), { forPublish: true });
    assertTransition('commercial', item.commercial_state, 'RFQ_OPEN');
    const draft = parseJson(item.payload_json, {});
    const requestedDeadline = request.body?.deadlineAt || item.deadline_at || draft.schedule?.rfqDeadline;
    if (requestedDeadline && !safeDate(requestedDeadline)) throw new DomainError('INPUT-400', 'مهلت RFQ معتبر نیست.', 400);
    const deadlineAt = request.body?.deadlineAt
      ? safeDate(request.body.deadlineAt)
      : safeDate(item.deadline_at || draft.schedule?.rfqDeadline) || addMinutes(new Date(), 24 * 60);
    if (!deadlineAt) throw new DomainError('INPUT-400', 'مهلت RFQ معتبر نیست.', 400);
    if (deadlineAt <= new Date()) throw new DomainError(ERROR_CODES.BID_OUTSIDE_WINDOW, 'مهلت پیشنهاد باید در آینده باشد.', 409);
    const [result] = await pool.execute(
      `INSERT INTO rfq_books (tenant_id, case_id, level, state, publisher_org_id, deadline_at)
       VALUES (?, ?, 'RFQ1', 'OPEN', ?, ?)`,
      [request.actor.tenantId, caseId, request.actor.organizationId, deadlineAt]
    );
    await pool.execute(`UPDATE shipment_cases SET commercial_state = 'RFQ_OPEN', state = 'RFQ_OPEN', deadline_at = ? WHERE id = ? AND tenant_id = ?`, [deadlineAt, caseId, request.actor.tenantId]);
    if (item.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I04_RFQ_PUBLISHED' WHERE id = ? AND tenant_id = ?`, [caseId, request.actor.tenantId]);
    const eventId = await event(request, { eventName: 'RFQPublished', entityType: 'rfq', entityId: result.insertId, payload: { level: RFQ_LEVELS.MARKET_A, caseId, deadlineAt }, recipientOrgId: request.actor.organizationId });
    const [candidateOrganizations] = await pool.execute(`SELECT id FROM platform_organizations WHERE tenant_id = ? AND organization_type = 'company_x' AND status = 'active' AND qualification_state = 'qualified' AND id <> ?`, [request.actor.tenantId, request.actor.organizationId]);
    for (const candidate of candidateOrganizations) {
      await pool.execute(`INSERT INTO platform_notifications (tenant_id, event_id, recipient_org_id, channel, state, payload_json) VALUES (?, ?, ?, 'in_app', 'pending', ?)`, [request.actor.tenantId, eventId, candidate.id, JSON.stringify({ eventName: 'RFQPublished', entityType: 'rfq', entityId: result.insertId, payload: { level: RFQ_LEVELS.MARKET_A, caseId } })]);
    }
    return jsonResponse({ message: 'دفتر RFQ1 منتشر شد.', rfqId: result.insertId, level: RFQ_LEVELS.MARKET_A, deadlineAt });
  }, { requireKey: true });
});

router.get('/rfqs', platformAuth({ roles: COMPANY_Y_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const actor = request.actor;
    const level = String(request.query.level || RFQ_LEVELS.MARKET_B).toUpperCase();
    if (level !== RFQ_LEVELS.MARKET_B || !isCompanyYActor(actor)) throw new DomainError('AUTH-403', 'فقط دفتر RFQ2 در پنل شرکت Y قابل مشاهده است.', 403);
    const [organizations] = await pool.execute(
      `SELECT id FROM platform_organizations
        WHERE id = ? AND tenant_id = ? AND organization_type = 'company_y' AND status = 'active' AND qualification_state = 'qualified' LIMIT 1`,
      [actor.organizationId, actor.tenantId]
    );
    if (!organizations[0]) throw new DomainError(ERROR_CODES.QUALIFICATION_EXPIRED, 'صلاحیت شرکت Y برای دریافت RFQ2 معتبر نیست.', 423);
    const [rows] = await pool.execute(
      `SELECT r.id, r.case_id, r.state, r.publisher_org_id, r.awarded_org_id, r.deadline_at, r.metadata_json,
              c.origin_country, c.destination_country, c.origin_location, c.destination_location,
              c.cargo_type, c.cargo_weight, c.cargo_weight_unit, c.direction,
              q.id AS own_quote_id, q.amount AS own_quote_amount, q.currency AS own_quote_currency,
              q.state AS own_quote_state, q.submitted_at AS own_quote_submitted_at
         FROM rfq_books r
         JOIN shipment_cases c ON c.id = r.case_id AND c.tenant_id = r.tenant_id
         LEFT JOIN rfq_quotes q ON q.rfq_id = r.id AND q.tenant_id = r.tenant_id AND q.bidder_org_id = ?
        WHERE r.tenant_id = ? AND r.level = 'RFQ2' AND r.state IN ('OPEN', 'EXPIRED', 'AWARDED')
        ORDER BY r.deadline_at ASC, r.created_at DESC`,
      [actor.organizationId, actor.tenantId]
    );
    for (const row of rows) {
      if (row.own_quote_id) await audit(request, { eventType: 'QuoteRead', subjectType: 'rfq_quote', subjectId: row.own_quote_id, payload: { rfqId: row.id, level: RFQ_LEVELS.MARKET_B, ownQuote: true, sealed: row.state === 'OPEN' && new Date(row.deadline_at).getTime() > Date.now() } });
    }
    const now = Date.now();
    return response.json({
      rfqs: rows.map((row) => ({
        id: row.id,
        caseId: row.case_id,
        level: RFQ_LEVELS.MARKET_B,
        state: row.state === 'OPEN' && new Date(row.deadline_at).getTime() <= now ? 'EXPIRED' : row.state,
        deadlineAt: row.deadline_at,
        direction: row.direction,
        origin: { country: row.origin_country, location: row.origin_location },
        destination: { country: row.destination_country, location: row.destination_location },
        cargo: { type: row.cargo_type, weight: row.cargo_weight, unit: row.cargo_weight_unit },
        metadata: parseJson(row.metadata_json, {}),
        ownQuote: row.own_quote_id ? { id: row.own_quote_id, amount: row.own_quote_amount, currency: row.own_quote_currency, state: row.own_quote_state, submittedAt: row.own_quote_submitted_at } : null,
        awardedToMe: row.state === 'AWARDED' && row.awarded_org_id === actor.organizationId
      }))
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/rfqs/:rfqId', platformAuth({ permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const rfqId = parsePositiveId(request.params.rfqId, 'شناسه RFQ');
    const rfq = await loadRfq(rfqId, request.actor.tenantId);
    const caseItem = await loadCase(rfq.case_id, request.actor.tenantId);
    assertAbacCaseScope(request.actor, caseItem);
    const [bidderOrganizations] = await pool.execute('SELECT organization_type, status, qualification_state FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1', [request.actor.organizationId, request.actor.tenantId]);
    const bidderOrganization = bidderOrganizations[0];
    const bidderType = bidderOrganization?.organization_type;
    const isPublisher = request.actor.organizationId === rfq.publisher_org_id;
    if (isShipperActor(request.actor)) {
      assertShipperOrganization(request.actor);
      assertCaseAccess(request.actor, caseItem);
    }
    if (normalizeRole(request.actor.role) === ROLES.SHIPPER_FINANCE_USER) throw new DomainError('AUTH-403', 'دفتر پیشنهاد در دامنه کاربر مالی نیست.', 403);
    if (isShipperActor(request.actor) && rfq.level !== RFQ_LEVELS.MARKET_A) throw new DomainError('AUTH-403', 'RFQ2 و دفتر ظرفیت بازار B در پنل مشتری قابل مشاهده نیست.', 403);
    if (rfq.state === 'OPEN' && new Date(rfq.deadline_at).getTime() <= Date.now()) {
      const [closed] = await pool.execute(`UPDATE rfq_books SET state = 'EXPIRED' WHERE id = ? AND tenant_id = ? AND state = 'OPEN'`, [rfqId, request.actor.tenantId]);
      if (closed.affectedRows) await event(request, { eventName: 'OffersWindowClosed', entityType: 'rfq', entityId: rfqId, payload: { level: rfq.level, caseId: rfq.case_id }, recipientOrgId: rfq.publisher_org_id });
      rfq.state = 'EXPIRED';
    }
    const isEligibleMarketParticipant = bidderOrganization?.status === 'active'
      && bidderOrganization.qualification_state === 'qualified'
      && (rfq.level === RFQ_LEVELS.MARKET_A ? bidderType === 'company_x' : bidderType === 'company_y');
    if (!isPublisher && !isEligibleMarketParticipant) throw new DomainError('AUTH-403', 'این دفتر پیشنهاد خارج از بازار و عضویت شماست.', 403);
    const [quotes] = await pool.execute(
      `SELECT q.id, q.bidder_org_id, o.display_name AS bidder_display_name, q.amount, q.currency, q.terms_json, q.qualification_state,
              q.state, q.submitted_at, q.is_ai_assisted
         FROM rfq_quotes q JOIN platform_organizations o ON o.id = q.bidder_org_id AND o.tenant_id = q.tenant_id
        WHERE q.rfq_id = ? AND q.tenant_id = ? ORDER BY q.submitted_at ASC`,
      [rfqId, request.actor.tenantId]
    );
    const canSee = (quote) => canReadQuote({
      actor: request.actor,
      rfq: { ...rfq, tenantId: rfq.tenant_id, publisherOrgId: rfq.publisher_org_id, deadlineAt: rfq.deadline_at },
      quote: { bidderOrgId: quote.bidder_org_id },
      now: new Date()
    });
    const visibleQuotes = quotes.filter(canSee).map((quote) => ({
      id: quote.id,
      bidderOrgId: quote.bidder_org_id,
      companyName: quote.bidder_display_name || quote.bidder_org_id,
      amount: hasPermission(request.actor.role, PERMISSIONS.SEE_PRICE) ? quote.amount : null,
      currency: hasPermission(request.actor.role, PERMISSIONS.SEE_PRICE) ? quote.currency : null,
      terms: publicQuoteTerms(quote.terms_json),
      qualificationState: quote.qualification_state,
      state: quote.state,
      submittedAt: quote.submitted_at,
      isAiAssisted: Boolean(quote.is_ai_assisted)
    }));
    for (const quote of visibleQuotes) {
      await audit(request, { eventType: 'QuoteRead', subjectType: 'rfq_quote', subjectId: quote.id, payload: { rfqId, level: rfq.level, sealed: new Date(rfq.deadline_at).getTime() > Date.now() } });
    }
    return response.json({
      id: rfq.id,
      caseId: rfq.case_id,
      level: rfq.level,
      state: rfq.state,
      publisherOrgId: rfq.publisher_org_id,
      deadlineAt: rfq.deadline_at,
      metadata: isShipperActor(request.actor) ? undefined : parseJson(rfq.metadata_json, {}),
      quoteCount: visibleQuotes.length,
      quotes: visibleQuotes
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/rfqs/:rfqId/quotes', platformAuth({ roles: [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_PRICING_EXPERT, ROLES.COMPANY_Y_OWNER, ROLES.COMPANY_Y_DOCUMENT_ISSUER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const rfqId = parsePositiveId(request.params.rfqId, 'شناسه RFQ');
    const rfq = await loadRfq(rfqId, request.actor.tenantId);
    const caseItem = await loadCase(rfq.case_id, request.actor.tenantId);
    assertAbacCaseScope(request.actor, caseItem);
    if (rfq.state !== 'OPEN') throw new DomainError(ERROR_CODES.BID_OUTSIDE_WINDOW, 'دفتر پیشنهاد باز نیست.', 409);
    if (new Date(rfq.deadline_at).getTime() <= Date.now()) throw new DomainError(ERROR_CODES.BID_OUTSIDE_WINDOW, 'مهلت ارسال پیشنهاد تمام شده است.', 409);
    if (rfq.publisher_org_id === request.actor.organizationId) throw new DomainError('BID-403', 'ناشر RFQ نمی‌تواند برای دفتر خودش پیشنهاد بدهد.', 403);
    const role = normalizeRole(request.actor.role);
    const validRole = rfq.level === RFQ_LEVELS.MARKET_A
      ? [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_PRICING_EXPERT].includes(role)
      : [ROLES.COMPANY_Y_OWNER].includes(role);
    if (!validRole) throw new DomainError(ERROR_CODES.INELIGIBLE_CAPACITY, 'نقش شما برای این بازار واجد شرایط نیست.', 422);
    const [organizations] = await pool.execute(`SELECT organization_type, qualification_state, status FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [request.actor.organizationId, request.actor.tenantId]);
    const organization = organizations[0];
    const expectedType = rfq.level === RFQ_LEVELS.MARKET_A ? 'company_x' : 'company_y';
    if (!organization || organization.status !== 'active' || organization.organization_type !== expectedType || organization.qualification_state !== 'qualified') {
      throw new DomainError(ERROR_CODES.QUALIFICATION_EXPIRED, 'صلاحیت سازمان برای این دفتر معتبر نیست.', 423);
    }
    const amount = Number(request.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new DomainError('INPUT-400', 'مبلغ پیشنهاد معتبر نیست.', 400);
    const qualificationState = organization.qualification_state;
    const internalPricing = rfq.level === RFQ_LEVELS.MARKET_A && [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_PRICING_EXPERT].includes(role)
      ? normalizePricingInput(request.body?.pricing || {})
      : null;
    const quoteState = String(request.body?.state || '').toUpperCase() === 'DRAFT' || request.body?.submit === false ? 'DRAFT' : 'SUBMITTED';
    const quoteInput = [amount, String(request.body?.currency || 'EUR').toUpperCase().slice(0, 3), JSON.stringify(request.body?.terms || {}), internalPricing ? JSON.stringify(internalPricing) : null, qualificationState, request.body?.isAiAssisted ? 1 : 0, quoteState];
    const [existingQuotes] = await pool.execute(`SELECT id FROM rfq_quotes WHERE tenant_id = ? AND rfq_id = ? AND bidder_org_id = ? LIMIT 1`, [request.actor.tenantId, rfqId, request.actor.organizationId]);
    let quoteId = existingQuotes[0]?.id;
    if (quoteId) {
      await pool.execute(`UPDATE rfq_quotes SET bidder_user_id = ?, amount = ?, currency = ?, terms_json = ?, internal_pricing_json = ?, qualification_state = ?, is_ai_assisted = ?, state = ?, submitted_at = CASE WHEN ? = 'SUBMITTED' THEN CURRENT_TIMESTAMP ELSE submitted_at END WHERE id = ? AND tenant_id = ?`, [request.actor.userId, ...quoteInput, quoteState, quoteId, request.actor.tenantId]);
    } else {
      const [result] = await pool.execute(
        `INSERT INTO rfq_quotes
          (tenant_id, rfq_id, bidder_org_id, bidder_user_id, amount, currency, terms_json, internal_pricing_json, qualification_state, is_ai_assisted, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [request.actor.tenantId, rfqId, request.actor.organizationId, request.actor.userId, ...quoteInput]
      );
      quoteId = result.insertId;
    }
    if (quoteState === 'SUBMITTED' && rfq.level === RFQ_LEVELS.MARKET_A) {
      await pool.execute(`UPDATE shipment_cases SET commercial_state = 'OFFERS_RECEIVED', state = 'OFFERS_RECEIVED' WHERE id = ? AND tenant_id = ? AND commercial_state IN ('RFQ_OPEN', 'OFFERS_RECEIVED')`, [rfq.case_id, request.actor.tenantId]);
    } else if (quoteState === 'SUBMITTED') {
      await pool.execute(`UPDATE shipment_cases SET capacity_state = 'ELIGIBLE', state = 'ELIGIBLE' WHERE id = ? AND tenant_id = ? AND capacity_state IN ('CAPACITY_RFQ', 'ELIGIBLE')`, [rfq.case_id, request.actor.tenantId]);
    }
    await event(request, { eventName: 'QuoteSubmitted', entityType: 'rfq_quote', entityId: quoteId, payload: { rfqId, level: rfq.level, state: quoteState, sealed: quoteState === 'SUBMITTED' }, recipientOrgId: rfq.publisher_org_id });
    return jsonResponse({ message: quoteState === 'DRAFT' ? 'پیش‌نویس Bid ذخیره شد.' : 'پیشنهاد به‌صورت مهر و موم‌شده ثبت شد.', quoteId, state: quoteState, sealed: quoteState === 'SUBMITTED' }, quoteState === 'DRAFT' ? 200 : 201);
  }, { requireKey: true });
});

router.get('/rfqs/:rfqId/pricing', platformAuth({ roles: [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_PRICING_EXPERT], permission: PERMISSIONS.SEE_PRICE }), async (request, response) => {
  try {
    const rfqId = parsePositiveId(request.params.rfqId, 'شناسه RFQ');
    const rfq = await loadRfq(rfqId, request.actor.tenantId);
    if (rfq.level !== RFQ_LEVELS.MARKET_A) throw new DomainError('AUTH-403', 'قیمت داخلی فقط در Market A و برای شرکت X مجاز است.', 403);
    const item = await loadCase(rfq.case_id, request.actor.tenantId);
    const [quotes] = await pool.execute(`SELECT id, amount, currency, terms_json, internal_pricing_json, submitted_at FROM rfq_quotes WHERE tenant_id = ? AND rfq_id = ? AND bidder_org_id = ? LIMIT 1`, [request.actor.tenantId, rfqId, request.actor.organizationId]);
    if (!quotes[0]) throw new DomainError('PRICE-404', 'پیشنهاد داخلی این شرکت برای RFQ پیدا نشد.', 404);
    try {
      assertCaseAccess(request.actor, item);
    } catch (error) {
      if (!COMPANY_X_ROLES.includes(normalizeRole(request.actor.role)) || error.code !== 'AUTH-403') throw error;
      const [organizations] = await pool.execute(`SELECT id FROM platform_organizations WHERE id = ? AND tenant_id = ? AND organization_type = 'company_x' AND status = 'active' AND qualification_state = 'qualified' LIMIT 1`, [request.actor.organizationId, request.actor.tenantId]);
      if (!organizations[0]) throw error;
      assertAbacCaseScope(request.actor, item);
    }
    await audit(request, { eventType: 'QuotePricingRead', subjectType: 'rfq_quote', subjectId: quotes[0].id, payload: { rfqId, level: rfq.level } });
    return response.json({ rfqId, quoteId: quotes[0].id, amount: quotes[0].amount, currency: quotes[0].currency, terms: publicQuoteTerms(quotes[0].terms_json), pricing: publicPricing(quotes[0].internal_pricing_json), submittedAt: quotes[0].submitted_at });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/rfqs/:rfqId/award', platformAuth({ permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const rfqId = parsePositiveId(request.params.rfqId, 'شناسه RFQ');
    const rfq = await loadRfq(rfqId, request.actor.tenantId);
    const caseItem = await loadCase(rfq.case_id, request.actor.tenantId);
    assertCaseAccess(request.actor, caseItem);
    const winnerOrgId = String(request.body?.winnerOrgId || '').trim();
    const reason = String(request.body?.reason || '').trim();
    if (!winnerOrgId || reason.length < 8) throw new DomainError('AWD-400', 'برنده و دلیل انسانی اعطا الزامی است.', 400);
    const [quotes] = await pool.execute('SELECT * FROM rfq_quotes WHERE rfq_id = ? AND bidder_org_id = ? AND tenant_id = ? LIMIT 1', [rfqId, winnerOrgId, request.actor.tenantId]);
    if (!quotes[0]) throw new DomainError('AWD-404', 'پیشنهاد برنده پیدا نشد.', 404);
    if (quotes[0].state !== 'SUBMITTED') throw new DomainError('BID-409', 'فقط Bid ارسال‌شده و قفل‌شده قابل Award است.', 409);
    if (new Date(rfq.deadline_at).getTime() > Date.now()) throw new DomainError(ERROR_CODES.BID_OUTSIDE_WINDOW, 'اعطای برنده پیش از پایان پنجره پیشنهاد مجاز نیست.', 409);
    if (rfq.level === RFQ_LEVELS.MARKET_A) assertOrganizationScope(request.actor, rfq.publisher_org_id);
    if (rfq.level === RFQ_LEVELS.MARKET_B) assertOrganizationScope(request.actor, rfq.publisher_org_id);
    const winnerType = await organizationType(winnerOrgId, request.actor.tenantId);
    const [winnerOrganizations] = await pool.execute(`SELECT status, qualification_state FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [winnerOrgId, request.actor.tenantId]);
    if (!winnerOrganizations[0] || winnerOrganizations[0].status !== 'active' || winnerOrganizations[0].qualification_state !== 'qualified') throw new DomainError(ERROR_CODES.QUALIFICATION_EXPIRED, 'سازمان برنده صلاحیت فعال ندارد.', 423);
    assertHumanAward({ actor: request.actor, level: rfq.level, winnerOrganizationType: winnerType, isAiActor: Boolean(request.body?.aiActor) });
    if (!['OPEN', 'EXPIRED'].includes(rfq.state)) throw new DomainError('AWD-409', 'این دفتر قبلاً تعیین تکلیف شده است.', 409);
    const nextCaseState = rfq.level === RFQ_LEVELS.MARKET_A ? 'PROVIDER_AWARDED' : 'CARRIER_AWARDED';
    const domain = rfq.level === RFQ_LEVELS.MARKET_A ? 'commercial' : 'capacity';
    const fromState = rfq.level === RFQ_LEVELS.MARKET_A ? caseItem.commercial_state : (caseItem.capacity_state || 'CAPACITY_RFQ');
    assertTransition(domain, fromState, nextCaseState);
    await pool.execute(`UPDATE rfq_books SET state = 'AWARDED', awarded_org_id = ?, awarded_by_user_id = ?, award_reason = ?, awarded_at = NOW() WHERE id = ? AND tenant_id = ? AND state IN ('OPEN', 'EXPIRED')`, [winnerOrgId, request.actor.userId, reason, rfqId, request.actor.tenantId]);
    if (rfq.level === RFQ_LEVELS.MARKET_A) {
      await pool.execute(`UPDATE shipment_cases SET commercial_state = 'PROVIDER_AWARDED', state = 'PROVIDER_AWARDED', x_org_id = ? WHERE id = ? AND tenant_id = ?`, [winnerOrgId, rfq.case_id, request.actor.tenantId]);
      if (caseItem.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I05_COMPANY_X_SELECTED' WHERE id = ? AND tenant_id = ?`, [rfq.case_id, request.actor.tenantId]);
    } else {
      await pool.execute(`UPDATE shipment_cases SET capacity_state = 'CARRIER_AWARDED', state = 'CARRIER_AWARDED', y_org_id = ? WHERE id = ? AND tenant_id = ?`, [winnerOrgId, rfq.case_id, request.actor.tenantId]);
    }
    await event(request, { eventName: rfq.level === RFQ_LEVELS.MARKET_A ? 'ProviderAwarded' : 'CarrierAwarded', entityType: 'rfq', entityId: rfqId, payload: { level: rfq.level, caseId: rfq.case_id, winnerOrgId, reason }, recipientOrgId: winnerOrgId });
    return jsonResponse({ message: 'اعطای انسانی ثبت شد.', rfqId, winnerOrgId, state: nextCaseState });
  }, { requireKey: true });
});

router.post('/cases/:caseId/accept-award', platformAuth({ roles: [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, item.x_org_id);
    if (item.commercial_state !== 'PROVIDER_AWARDED') throw new DomainError('AWD-409', 'Award مشتری در وضعیت پذیرش شرکت X نیست.', 409);
    if (item.x_award_accepted_at) throw new DomainError('AWD-409', 'Award این پرونده قبلاً پذیرفته شده است.', 409);
    await pool.execute(`UPDATE shipment_cases SET x_award_accepted_at = NOW(), x_award_accepted_by = ? WHERE id = ? AND tenant_id = ? AND x_award_accepted_at IS NULL`, [request.actor.userId, caseId, request.actor.tenantId]);
    await event(request, { eventName: 'AwardAccepted', entityType: 'shipment_case', entityId: caseId, payload: { caseId, xOrgId: item.x_org_id, roleLockPending: true }, recipientOrgId: item.owner_org_id });
    return jsonResponse({ message: 'Award مشتری توسط شرکت X پذیرفته شد؛ قرارداد همچنان گام قفل‌کننده نقش است.', caseId, state: item.commercial_state, acceptedAt: new Date().toISOString() });
  }, { requireKey: true });
});

router.post('/cases/:caseId/customer-contract', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    assertShipperOrganization(request.actor);
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, item.owner_org_id);
    assertDelegated(request.actor, 'signContract');
    if (!item.x_org_id) throw new DomainError('CON-409', 'شرکت X برنده برای قرارداد مشخص نشده است.', 409);
    assertTransition('commercial', item.commercial_state, 'CUSTOMER_CONTRACTED');
    const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM platform_contracts WHERE tenant_id = ? AND case_id = ? AND contract_type = 'customer_x'`, [request.actor.tenantId, caseId]);
    const versionNo = Number(versions[0]?.max_version || 0) + 1;
    const requestedSnapshot = request.body?.contract && typeof request.body.contract === 'object' ? request.body.contract : {};
    const snapshot = {
      scope: parseJson(item.payload_json, {}),
      customerFreightPrice: request.body?.amount || null,
      currency: request.body?.currency || null,
      paymentMilestones: request.body?.paymentMilestones || [],
      insuranceResponsibility: request.body?.insuranceResponsibility || null,
      duties: request.body?.duties || {},
      claims: request.body?.claims || {},
      ...requestedSnapshot,
      parties: { customerOrgId: item.owner_org_id, xOrgId: item.x_org_id },
      roleLock: 'company_x',
      confidentiality: true
    };
    const documentHash = String(request.body?.documentHash || '').trim().toLowerCase();
    if (documentHash && !/^[a-f0-9]{64}$/.test(documentHash)) throw new DomainError('CON-400', 'hash قرارداد معتبر نیست.', 400);
    const [contractResult] = await pool.execute(
      `INSERT INTO platform_contracts
        (tenant_id, case_id, version_no, contract_type, state, customer_org_id, x_org_id, role_lock, snapshot_json, document_hash, signed_by_customer_user_id, signed_at, created_by_user_id)
       VALUES (?, ?, ?, 'customer_x', 'SIGNED', ?, ?, 'company_x', ?, ?, ?, NOW(), ?)`,
      [request.actor.tenantId, caseId, versionNo, item.owner_org_id, item.x_org_id, JSON.stringify(snapshot), documentHash || null, request.actor.userId, request.actor.userId]
    );
    await pool.execute(`UPDATE shipment_cases SET commercial_state = 'CUSTOMER_CONTRACTED', state = 'CUSTOMER_CONTRACTED' WHERE id = ? AND tenant_id = ?`, [caseId, request.actor.tenantId]);
    if (item.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I05_COMPANY_X_SELECTED' WHERE id = ? AND tenant_id = ?`, [caseId, request.actor.tenantId]);
    await event(request, { eventName: 'ContractSigned', entityType: 'contract', entityId: contractResult.insertId, payload: { contractType: 'customer_x', caseId, versionNo, roleLock: 'company_x' }, recipientOrgId: item.x_org_id });
    await event(request, { eventName: 'CustomerContracted', entityType: 'shipment_case', entityId: caseId, payload: { contractId: contractResult.insertId, versionNo, roleLock: 'company_x' }, recipientOrgId: item.x_org_id });
    return jsonResponse({ message: 'قرارداد مشتری و شرکت X ثبت شد.', caseId, contractId: contractResult.insertId, versionNo, state: 'CUSTOMER_CONTRACTED', roleLock: 'company_x' });
  }, { requireKey: true });
});

router.get('/cases/:caseId/contract', platformAuth({ permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    if (isCustomerCommercialActor(request.actor)) assertShipperOrganization(request.actor);
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    const [rows] = await pool.execute(`SELECT * FROM platform_contracts WHERE tenant_id = ? AND case_id = ? AND contract_type = 'customer_x' ORDER BY version_no DESC`, [request.actor.tenantId, caseId]);
    const contracts = rows.filter((contract) => isCustomerCommercialActor(request.actor) || [item.x_org_id, item.owner_org_id].includes(request.actor.organizationId)).map((contract) => ({
      id: contract.id,
      caseId: contract.case_id,
      versionNo: contract.version_no,
      contractType: contract.contract_type,
      state: contract.state,
      customerOrgId: contract.customer_org_id,
      xOrgId: contract.x_org_id,
      roleLock: contract.role_lock,
      snapshot: parseJson(contract.snapshot_json, {}),
      documentHash: contract.document_hash,
      signedAt: contract.signed_at,
      xSignedAt: contract.x_signed_at,
      createdAt: contract.created_at
    }));
    return response.json({ contracts, current: contracts[0] || null });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/contracts/:contractId/amend', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    assertShipperOrganization(request.actor);
    const contractId = parsePositiveId(request.params.contractId, 'شناسه قرارداد');
    const [rows] = await pool.execute(`SELECT * FROM platform_contracts WHERE id = ? AND tenant_id = ? LIMIT 1`, [contractId, request.actor.tenantId]);
    const current = rows[0];
    if (!current) throw new DomainError('CON-404', 'قرارداد پیدا نشد.', 404);
    const caseItem = await loadCase(current.case_id, request.actor.tenantId);
    assertCaseAccess(request.actor, caseItem);
    assertOrganizationScope(request.actor, current.customer_org_id);
    assertDelegated(request.actor, 'amendContract');
    if (current.state !== 'SIGNED') throw new DomainError('CON-409', 'فقط نسخه امضاشده قابل ایجاد Amendment است.', 409);
    const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM platform_contracts WHERE tenant_id = ? AND case_id = ? AND contract_type = 'customer_x'`, [request.actor.tenantId, current.case_id]);
    const versionNo = Number(versions[0]?.max_version || current.version_no) + 1;
    const requestedSnapshot = request.body?.contract && typeof request.body.contract === 'object' ? request.body.contract : parseJson(current.snapshot_json, {});
    const snapshot = {
      ...requestedSnapshot,
      parties: { customerOrgId: current.customer_org_id, xOrgId: current.x_org_id },
      roleLock: 'company_x',
      confidentiality: true
    };
    const [result] = await pool.execute(
      `INSERT INTO platform_contracts
        (tenant_id, case_id, version_no, contract_type, state, customer_org_id, x_org_id, role_lock, snapshot_json, created_by_user_id)
       VALUES (?, ?, ?, 'customer_x', 'AWAITING_SIGNATURE', ?, ?, 'company_x', ?, ?)`,
      [request.actor.tenantId, current.case_id, versionNo, current.customer_org_id, current.x_org_id, JSON.stringify(snapshot), request.actor.userId]
    );
    await event(request, { eventName: 'ContractAmended', entityType: 'contract', entityId: result.insertId, payload: { caseId: current.case_id, previousContractId: current.id, versionNo }, recipientOrgId: current.x_org_id });
    return jsonResponse({ message: 'نسخه Amendment ایجاد شد و نسخه قبلی حفظ شد.', contractId: result.insertId, versionNo, state: 'AWAITING_SIGNATURE', roleLock: 'company_x' }, 201);
  }, { requireKey: true });
});

router.post('/contracts/:contractId/sign', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    assertShipperOrganization(request.actor);
    const contractId = parsePositiveId(request.params.contractId, 'شناسه قرارداد');
    const [rows] = await pool.execute(`SELECT * FROM platform_contracts WHERE id = ? AND tenant_id = ? LIMIT 1`, [contractId, request.actor.tenantId]);
    const contract = rows[0];
    if (!contract) throw new DomainError('CON-404', 'قرارداد پیدا نشد.', 404);
    const caseItem = await loadCase(contract.case_id, request.actor.tenantId);
    assertCaseAccess(request.actor, caseItem);
    assertOrganizationScope(request.actor, contract.customer_org_id);
    assertDelegated(request.actor, 'signContract');
    if (contract.state !== 'AWAITING_SIGNATURE') throw new DomainError('CON-409', 'این نسخه قرارداد در صف امضای مشتری نیست.', 409);
    await pool.execute(`UPDATE platform_contracts SET state = 'SIGNED', signed_by_customer_user_id = ?, signed_at = NOW() WHERE id = ? AND tenant_id = ? AND state = 'AWAITING_SIGNATURE'`, [request.actor.userId, contractId, request.actor.tenantId]);
    await event(request, { eventName: 'ContractSigned', entityType: 'contract', entityId: contractId, payload: { caseId: contract.case_id, versionNo: contract.version_no, roleLock: contract.role_lock }, recipientOrgId: contract.x_org_id });
    return jsonResponse({ message: 'نسخه قرارداد امضا و قفل شد.', contractId, versionNo: contract.version_no, state: 'SIGNED', roleLock: contract.role_lock });
  }, { requireKey: true });
});

router.post('/contracts/:contractId/accept-x', platformAuth({ roles: [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const contractId = parsePositiveId(request.params.contractId, 'شناسه قرارداد');
    const [rows] = await pool.execute(`SELECT * FROM platform_contracts WHERE id = ? AND tenant_id = ? LIMIT 1`, [contractId, request.actor.tenantId]);
    const contract = rows[0];
    if (!contract) throw new DomainError('CON-404', 'قرارداد پیدا نشد.', 404);
    const item = await loadCase(contract.case_id, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, contract.x_org_id);
    if (contract.state !== 'SIGNED') throw new DomainError('CON-409', 'نسخه قرارداد هنوز توسط مشتری امضا نشده است.', 409);
    if (contract.x_signed_at) throw new DomainError('CON-409', 'این نسخه قبلاً توسط شرکت X پذیرفته شده است.', 409);
    await pool.execute(`UPDATE platform_contracts SET signed_by_x_user_id = ?, x_signed_at = NOW() WHERE id = ? AND tenant_id = ? AND x_signed_at IS NULL`, [request.actor.userId, contractId, request.actor.tenantId]);
    await event(request, { eventName: 'ContractSigned', entityType: 'contract', entityId: contractId, payload: { caseId: contract.case_id, versionNo: contract.version_no, roleLock: contract.role_lock, party: 'company_x' }, recipientOrgId: contract.customer_org_id });
    return jsonResponse({ message: 'نسخه قرارداد توسط شرکت X پذیرفته و قفل شد.', contractId, versionNo: contract.version_no, state: contract.state, roleLock: contract.role_lock, xSignedAt: new Date().toISOString() });
  }, { requireKey: true });
});

router.post('/cases/:caseId/capacity-rfq', platformAuth({ roles: COMPANY_X_OPERATION_ROLES, permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, item.x_org_id);
    if (item.commercial_state !== 'CUSTOMER_CONTRACTED') throw new DomainError('CAP-409', 'RFQ2 پس از قرارداد مشتری قابل انتشار است.', 409);
    if (item.capacity_state) throw new DomainError('CAP-409', 'دفتر ظرفیت این پرونده قبلاً ایجاد شده است.', 409);
    const deadlineAt = request.body?.deadlineAt ? safeDate(request.body.deadlineAt) : addMinutes(new Date(), 12 * 60);
    if (!deadlineAt) throw new DomainError('INPUT-400', 'مهلت RFQ2 معتبر نیست.', 400);
    if (deadlineAt <= new Date()) throw new DomainError(ERROR_CODES.BID_OUTSIDE_WINDOW, 'مهلت پیشنهاد باید در آینده باشد.', 409);
    const metadata = normalizeRfq2Metadata(request.body || {});
    const [result] = await pool.execute(
      `INSERT INTO rfq_books (tenant_id, case_id, level, state, publisher_org_id, deadline_at, metadata_json)
       VALUES (?, ?, 'RFQ2', 'OPEN', ?, ?, ?)`,
      [request.actor.tenantId, caseId, request.actor.organizationId, deadlineAt, JSON.stringify(metadata)]
    );
    await pool.execute(`UPDATE shipment_cases SET capacity_state = 'CAPACITY_RFQ', state = 'CAPACITY_RFQ' WHERE id = ? AND tenant_id = ?`, [caseId, request.actor.tenantId]);
    if (item.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I06_OPERATIONAL_DISPATCH' WHERE id = ? AND tenant_id = ?`, [caseId, request.actor.tenantId]);
    const eventId = await event(request, { eventName: 'OperationalRFQPublished', entityType: 'rfq', entityId: result.insertId, payload: { level: RFQ_LEVELS.MARKET_B, caseId, deadlineAt }, recipientOrgId: request.actor.organizationId });
    const [candidateOrganizations] = await pool.execute(`SELECT id FROM platform_organizations WHERE tenant_id = ? AND organization_type = 'company_y' AND status = 'active' AND qualification_state = 'qualified' AND id <> ?`, [request.actor.tenantId, request.actor.organizationId]);
    for (const candidate of candidateOrganizations) {
      await pool.execute(`INSERT INTO platform_notifications (tenant_id, event_id, recipient_org_id, channel, state, payload_json) VALUES (?, ?, ?, 'in_app', 'pending', ?)`, [request.actor.tenantId, eventId, candidate.id, JSON.stringify({ eventName: 'OperationalRFQPublished', entityType: 'rfq', entityId: result.insertId, payload: { level: RFQ_LEVELS.MARKET_B, caseId } })]);
    }
    return jsonResponse({ message: 'دفتر ظرفیت RFQ2 منتشر شد.', rfqId: result.insertId, level: RFQ_LEVELS.MARKET_B, deadlineAt, metadata }, 201);
  }, { requireKey: true });
});

router.get('/cases/:caseId', platformAuth({ permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    if (isShipperActor(request.actor)) assertShipperOrganization(request.actor);
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    let invitedX = false;
    try {
      assertCaseAccess(request.actor, item);
    } catch (error) {
      const xRole = COMPANY_X_ROLES.includes(normalizeRole(request.actor.role));
      if (!xRole || error.code !== 'AUTH-403') throw error;
      const [organizations] = await pool.execute(`SELECT id FROM platform_organizations WHERE id = ? AND tenant_id = ? AND organization_type = 'company_x' AND status = 'active' AND qualification_state = 'qualified' LIMIT 1`, [request.actor.organizationId, request.actor.tenantId]);
      const [invitations] = await pool.execute(`SELECT id FROM rfq_books WHERE tenant_id = ? AND case_id = ? AND level = 'RFQ1' AND publisher_org_id <> ? AND state IN ('OPEN', 'EXPIRED') LIMIT 1`, [request.actor.tenantId, caseId, request.actor.organizationId]);
      if (!organizations[0] || !invitations[0]) throw error;
      assertAbacCaseScope(request.actor, item);
      invitedX = true;
    }
    const [rfqs] = await pool.execute('SELECT id, level, state, publisher_org_id, deadline_at, awarded_org_id, awarded_at, metadata_json FROM rfq_books WHERE case_id = ? AND tenant_id = ? ORDER BY id', [caseId, request.actor.tenantId]);
    const [trips] = await pool.execute('SELECT * FROM trip_cases WHERE case_id = ? AND tenant_id = ? ORDER BY id DESC', [caseId, request.actor.tenantId]);
    let agentAssignment = null;
    if (isAgentActor(request.actor)) {
      const assignedTrip = trips[0] ? await loadTrip(trips[0].id, request.actor.tenantId) : null;
      if (!assignedTrip) throw new DomainError(ERROR_CODES.AGENT_ASSIGNMENT_MISSING, 'پرونده هنوز سفر و Assignment مقصد فعال ندارد.', 403);
      agentAssignment = await assertAgentTrip(request, assignedTrip, 'read_case');
      await audit(request, { eventType: 'CaseViewed', subjectType: 'shipment_case', subjectId: caseId, payload: { tripId: assignedTrip.id, assignmentId: agentAssignment.id, surface: 'agent_z' } });
    }
    const [documents] = await pool.execute('SELECT id, case_id, trip_id, doc_type, version_no, state, sensitivity, deadline_at, owner_org_id, uploader_user_id, approver_user_id, file_hash, metadata_json, locked_at, created_at FROM platform_documents WHERE case_id = ? AND tenant_id = ? ORDER BY doc_type, version_no DESC', [caseId, request.actor.tenantId]);
    const [timeline] = await pool.execute(
      `SELECT event_name, entity_type, entity_id, payload_json, occurred_at
         FROM platform_domain_events
        WHERE tenant_id = ?
          AND ((entity_type = 'shipment_case' AND entity_id = ?)
            OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.caseId')) = ?)
        ORDER BY occurred_at ASC LIMIT 100`,
      [request.actor.tenantId, caseId, String(caseId)]
    );
    const customerView = isShipperActor(request.actor);
    const financeView = normalizeRole(request.actor.role) === ROLES.SHIPPER_FINANCE_USER;
    const isXActor = COMPANY_X_ROLES.includes(normalizeRole(request.actor.role));
    const isYActor = [ROLES.COMPANY_Y_OWNER, ROLES.COMPANY_Y_DOCUMENT_ISSUER].includes(normalizeRole(request.actor.role));
    const visibleRfqs = isAgentActor(request.actor)
      ? []
      : customerView
      ? (financeView ? [] : rfqs.filter((rfq) => rfq.level === RFQ_LEVELS.MARKET_A))
      : isXActor && (invitedX || item.x_org_id !== request.actor.organizationId)
        ? rfqs.filter((rfq) => rfq.level === RFQ_LEVELS.MARKET_A)
        : isYActor
          ? rfqs.filter((rfq) => rfq.level === RFQ_LEVELS.MARKET_B)
          : rfqs;
    const visibleDocuments = hasPermission(request.actor.role, PERMISSIONS.SEE_DOCUMENTS) && !invitedX
      ? documents.filter((document) => !customerView || (CUSTOMER_DOCUMENT_TYPES.has(document.doc_type) && ['P0', 'P1', 'P2', 'P3'].includes(document.sensitivity)))
        .filter((document) => !isCompanyYActor(request.actor) || canCompanyYSeeDocument(document))
        .filter((document) => !isAgentActor(request.actor) || AGENT_DOCUMENT_TYPES.has(String(document.doc_type || '').toUpperCase()))
      : [];
    const visibleTimeline = timeline
      .filter((entry) => !isAgentActor(request.actor) || ['DestinationArrived', 'AgentAssignmentCreated', 'AgentDeliveryVerified', 'DeliveryEvidenceSubmitted', 'PODSubmitted', 'PODReturned', 'PODAccepted', 'ExceptionOpened', 'ClaimOpened', 'DisputeOpened', 'WarehouseReceiptRecorded'].includes(entry.event_name))
      .map((entry) => ({ ...entry, payload: isAgentActor(request.actor) ? {} : parseJson(entry.payload_json, {}) }))
      .filter((entry) => !customerView || (entry.payload.level !== RFQ_LEVELS.MARKET_B && entry.event_name !== 'OperationalRFQPublished' && entry.event_name !== 'DriverBidSubmitted'))
      .filter((entry) => !invitedX || (entry.payload.level !== RFQ_LEVELS.MARKET_B && entry.event_name !== 'OperationalRFQPublished' && entry.event_name !== 'CarrierAwarded'))
      .filter((entry) => !customerView || !entry.payload.relationshipType || entry.payload.relationshipType === RELATIONSHIPS.CUSTOMER_X)
      .filter((entry) => !isYActor || (entry.payload.level !== RFQ_LEVELS.MARKET_A && !['QuoteSubmitted', 'RFQPublished', 'OffersWindowClosed', 'ProviderAwarded', 'ContractSigned', 'CustomerContracted'].includes(entry.event_name)))
      .filter((entry) => !financeView || !['OperationalRFQPublished', 'DriverBidSubmitted', 'CarrierAwarded', 'VehicleIntroduced', 'TruckNominated', 'LoadingEvidenceSubmitted', 'TripStarted', 'BorderEventRecorded'].includes(entry.event_name));
    const contractRows = isCustomerCommercialActor(request.actor) || request.actor.organizationId === item.x_org_id
      ? (await pool.execute(`SELECT * FROM platform_contracts WHERE tenant_id = ? AND case_id = ? AND contract_type = 'customer_x' ORDER BY version_no DESC`, [request.actor.tenantId, caseId]))[0]
      : [];
    return response.json({
      case: publicCaseForActor(item, request.actor),
      draft: isCustomerCommercialActor(request.actor) ? publicShipperDraft(item) : undefined,
      review: isCustomerCommercialActor(request.actor) ? reviewShipperDraft(item, parseJson(item.payload_json, {})) : undefined,
      rfqs: visibleRfqs,
      trips: financeView ? [] : trips.filter((trip) => relatedToTrip(request.actor, { ...trip, owner_org_id: item.owner_org_id, x_org_id: item.x_org_id, y_org_id: item.y_org_id })).map(publicTrip),
      documents: visibleDocuments.map((document) => isAgentActor(request.actor) ? publicAgentDocument(document) : publicDocument(document)),
      contracts: isAgentActor(request.actor) ? [] : contractRows.map((contract) => ({ id: contract.id, versionNo: contract.version_no, state: contract.state, roleLock: contract.role_lock, snapshot: parseJson(contract.snapshot_json, {}), signedAt: contract.signed_at, xSignedAt: contract.x_signed_at, createdAt: contract.created_at })),
      timeline: visibleTimeline
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/trips', platformAuth({ roles: COMPANY_X_OPERATION_ROLES, permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const caseId = parsePositiveId(request.body?.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, item.x_org_id);
    if (item.capacity_state !== 'CARRIER_AWARDED' || !item.y_org_id) throw new DomainError(ERROR_CODES.CARRIER_COVERAGE_MISSING, 'ابتدا باید شرکت Y برای ظرفیت انتخاب شود.', 424);
    const [existing] = await pool.execute('SELECT id FROM trip_cases WHERE case_id = ? AND tenant_id = ? LIMIT 1', [caseId, request.actor.tenantId]);
    if (existing[0]) throw new DomainError('TRIP-409', 'سفر این پرونده قبلاً ایجاد شده است.', 409);
    const [result] = await pool.execute(
      `INSERT INTO trip_cases (tenant_id, case_id, x_org_id, y_org_id, state, tracking_state, readiness_json)
       VALUES (?, ?, ?, ?, 'DISPATCHED', 'INACTIVE', ?)`,
      [request.actor.tenantId, caseId, item.x_org_id, item.y_org_id, JSON.stringify({ customsReady: false, routePermitReady: false, documentsReady: false, vehicleReady: false, driverReady: false, preloadState: 'PRELOAD_ACCEPTED' })]
    );
    await pool.execute(`UPDATE shipment_cases SET trip_state = 'DISPATCHED', state = 'DISPATCHED' WHERE id = ? AND tenant_id = ?`, [caseId, request.actor.tenantId]);
    await event(request, { eventName: 'CarrierAwarded', entityType: 'trip', entityId: result.insertId, payload: { caseId, xOrgId: item.x_org_id, yOrgId: item.y_org_id }, recipientOrgId: item.y_org_id });
    return jsonResponse({ message: 'سفر عملیاتی ایجاد شد.', tripId: result.insertId, state: 'DISPATCHED' }, 201);
  }, { requireKey: true });
});

router.post('/trips/:tripId/accept-award', platformAuth({ roles: COMPANY_Y_OWNER_ROLES, permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, trip.y_org_id);
    if (trip.capacity_state !== 'CARRIER_AWARDED') throw new DomainError('AWD-409', 'Award ظرفیت در وضعیت پذیرش شرکت Y نیست.', 409);
    if (trip.y_award_accepted_at) throw new DomainError('AWD-409', 'Award این سفر قبلاً توسط شرکت Y پذیرفته شده است.', 409);
    await pool.execute(`UPDATE trip_cases SET y_award_accepted_at = NOW(), y_award_accepted_by = ? WHERE id = ? AND tenant_id = ? AND y_award_accepted_at IS NULL`, [request.actor.userId, tripId, request.actor.tenantId]);
    await event(request, { eventName: 'AwardAccepted', entityType: 'trip', entityId: tripId, payload: { caseId: trip.case_id, yOrgId: trip.y_org_id, role: 'carrier' }, recipientOrgId: trip.x_org_id });
    return jsonResponse({ message: 'Award ظرفیت توسط شرکت Y پذیرفته شد.', tripId, acceptedAt: new Date().toISOString(), state: trip.capacity_state });
  }, { requireKey: true });
});

router.post('/driver-assignments', platformAuth({ roles: [ROLES.COMPANY_Y_OWNER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const driverId = parsePositiveId(request.body?.driverId, 'شناسه راننده');
    const validFrom = request.body?.validFrom ? safeDate(request.body.validFrom) : new Date();
    const validTo = request.body?.validTo ? safeDate(request.body.validTo) : null;
    if (!validFrom || !validTo || validTo <= validFrom) throw new DomainError('COV-400', 'بازه اعتبار Coverage معتبر نیست.', 400);
    const [drivers] = await pool.execute(`SELECT id, status FROM drivers WHERE id = ? AND tenant_id = ? LIMIT 1`, [driverId, request.actor.tenantId]);
    if (!drivers[0] || drivers[0].status !== 'active') throw new DomainError(ERROR_CODES.QUALIFICATION_EXPIRED, 'راننده فعال و واجد شرایط پیدا نشد.', 423);
    const vehicleId = request.body?.vehicleId ? parsePositiveId(request.body.vehicleId, 'شناسه خودرو') : null;
    if (vehicleId) {
      const [vehicles] = await pool.execute(`SELECT id, status FROM vehicles WHERE id = ? AND tenant_id = ? AND (owner_org_id = ? OR owner_org_id = ?) LIMIT 1`, [vehicleId, request.actor.tenantId, request.actor.organizationId, `driver:${driverId}`]);
      if (!vehicles[0] || vehicles[0].status !== 'active') throw new DomainError(ERROR_CODES.VEHICLE_CARGO_MISMATCH, 'خودرو برای سازمان Y معتبر نیست.', 422);
    }
    const routeScope = request.body?.routeScope || [];
    const supportingDocs = Array.isArray(request.body?.supportingDocs) ? request.body.supportingDocs : [];
    const [result] = await pool.execute(
      `INSERT INTO carrier_driver_assignments
        (tenant_id, y_org_id, driver_id, introduced_by_user_id, state, valid_from, valid_to, route_scope, supporting_docs_json, vehicle_id)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE state = 'active', introduced_by_user_id = VALUES(introduced_by_user_id), valid_from = VALUES(valid_from), valid_to = VALUES(valid_to), route_scope = VALUES(route_scope), supporting_docs_json = VALUES(supporting_docs_json), vehicle_id = VALUES(vehicle_id)`,
      [request.actor.tenantId, request.actor.organizationId, driverId, request.actor.userId, validFrom, validTo, JSON.stringify(routeScope), JSON.stringify(supportingDocs), vehicleId]
    );
    const [assignmentRows] = await pool.execute(`SELECT * FROM carrier_driver_assignments WHERE tenant_id = ? AND y_org_id = ? AND driver_id = ? LIMIT 1`, [request.actor.tenantId, request.actor.organizationId, driverId]);
    await event(request, { eventName: 'VehicleIntroduced', entityType: 'driver_assignment', entityId: assignmentRows[0]?.id || result.insertId || null, payload: { yOrgId: request.actor.organizationId, driverId, vehicleId, validFrom, validTo, routeScope } });
    return jsonResponse({ message: 'رکورد DriverCarrierCoverage ثبت شد.', coverage: assignmentRows[0] ? publicCoverage({ ...assignmentRows[0], driver: drivers[0] }) : { driverId, organizationId: request.actor.organizationId } }, 201);
  }, { requireKey: true });
});

router.get('/carrier/network', platformAuth({ roles: COMPANY_Y_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const [drivers] = await pool.execute(
      `SELECT d.id, d.first_name, d.last_name, d.status, d.kyc_state, d.passport_state, d.license_state, d.driver_card_state, d.availability_state,
              a.id AS coverage_id, a.state AS coverage_state, a.valid_from, a.valid_to, a.route_scope, a.supporting_docs_json, a.vehicle_id
         FROM carrier_driver_assignments a
         JOIN drivers d ON d.id = a.driver_id AND d.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND a.y_org_id = ?
        ORDER BY a.updated_at DESC`,
      [request.actor.tenantId, request.actor.organizationId]
    );
    const [vehicles] = await pool.execute(
      `SELECT DISTINCT v.*
         FROM vehicles v
         LEFT JOIN carrier_driver_assignments a ON a.vehicle_id = v.id AND a.tenant_id = v.tenant_id AND a.y_org_id = ?
        WHERE v.tenant_id = ? AND (v.owner_org_id = ? OR a.y_org_id = ?)
        ORDER BY v.updated_at DESC, v.id DESC`,
      [request.actor.organizationId, request.actor.tenantId, request.actor.organizationId, request.actor.organizationId]
    );
    return response.json({
      drivers: drivers.map((row) => publicCoverage({ ...row, id: row.coverage_id, driver_id: row.id, vehicle_id: row.vehicle_id })),
      vehicles: vehicles.map(publicVehicle)
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/vehicles', platformAuth({ roles: COMPANY_Y_OWNER_ROLES, permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const plateNumber = String(request.body?.plateNumber || '').trim();
    if (!plateNumber) throw new DomainError('VEH-400', 'پلاک/Transit plate الزامی است.', 400);
    const capacity = request.body?.capacity === undefined || request.body?.capacity === '' ? null : Number(request.body.capacity);
    if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0)) throw new DomainError('VEH-400', 'ظرفیت خودرو معتبر نیست.', 400);
    const cargoScope = Array.isArray(request.body?.cargoScope) ? request.body.cargoScope.map((value) => String(value).trim().toLowerCase()).filter(Boolean) : String(request.body?.cargoScope || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    const [result] = await pool.execute(
      `INSERT INTO vehicles
        (tenant_id, owner_org_id, plate_number, cargo_scope, status, vehicle_type, capacity, reefer_capable, special_capability, owner_relation, insurance_json, technical_docs_json, route_permits_json, availability_state)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, 'available')`,
      [request.actor.tenantId, request.actor.organizationId, plateNumber, JSON.stringify(cargoScope), request.body?.vehicleType || null, capacity, request.body?.reeferCapable ? 1 : 0, request.body?.specialCapability || null, request.body?.ownerRelation || null, JSON.stringify(request.body?.insurance || {}), JSON.stringify(request.body?.technicalDocs || {}), JSON.stringify(request.body?.routePermits || {})]
    );
    await event(request, { eventName: 'VehicleIntroduced', entityType: 'vehicle', entityId: result.insertId, payload: { vehicleId: result.insertId, ownerOrgId: request.actor.organizationId, plateNumber } });
    return jsonResponse({ message: 'وسیله نقلیه در رجیستری شرکت Y ثبت شد.', vehicle: { id: result.insertId, plateNumber, cargoScope, capacity } }, 201);
  }, { requireKey: true });
});

router.patch('/vehicles/:vehicleId', platformAuth({ roles: COMPANY_Y_OWNER_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const vehicleId = parsePositiveId(request.params.vehicleId, 'شناسه خودرو');
    const [rows] = await pool.execute(`SELECT * FROM vehicles WHERE id = ? AND tenant_id = ? AND owner_org_id = ? LIMIT 1`, [vehicleId, request.actor.tenantId, request.actor.organizationId]);
    const vehicle = rows[0];
    if (!vehicle) throw new DomainError('VEH-404', 'خودرو در دامنه شرکت Y پیدا نشد.', 404);
    const cargoScope = request.body?.cargoScope === undefined ? parseJson(vehicle.cargo_scope, []) : (Array.isArray(request.body.cargoScope) ? request.body.cargoScope : String(request.body.cargoScope).split(','));
    const capacity = request.body?.capacity === undefined ? vehicle.capacity : Number(request.body.capacity);
    if (capacity !== null && (!Number.isFinite(Number(capacity)) || Number(capacity) <= 0)) throw new DomainError('VEH-400', 'ظرفیت خودرو معتبر نیست.', 400);
    await pool.execute(
      `UPDATE vehicles SET plate_number = ?, cargo_scope = ?, vehicle_type = ?, capacity = ?, reefer_capable = ?, special_capability = ?, owner_relation = ?, insurance_json = ?, technical_docs_json = ?, route_permits_json = ?, availability_state = ? WHERE id = ? AND tenant_id = ? AND owner_org_id = ?`,
      [String(request.body?.plateNumber || vehicle.plate_number).trim(), JSON.stringify(cargoScope.map((value) => String(value).trim().toLowerCase()).filter(Boolean)), request.body?.vehicleType ?? vehicle.vehicle_type, capacity, request.body?.reeferCapable === undefined ? vehicle.reefer_capable : (request.body.reeferCapable ? 1 : 0), request.body?.specialCapability ?? vehicle.special_capability, request.body?.ownerRelation ?? vehicle.owner_relation, JSON.stringify(request.body?.insurance ?? parseJson(vehicle.insurance_json, {})), JSON.stringify(request.body?.technicalDocs ?? parseJson(vehicle.technical_docs_json, {})), JSON.stringify(request.body?.routePermits ?? parseJson(vehicle.route_permits_json, {})), request.body?.availabilityState || vehicle.availability_state, vehicleId, request.actor.tenantId, request.actor.organizationId]
    );
    await event(request, { eventName: 'VehicleIntroduced', entityType: 'vehicle', entityId: vehicleId, payload: { vehicleId, ownerOrgId: request.actor.organizationId, action: 'updated' } });
    return jsonResponse({ message: 'اطلاعات وسیله نقلیه به‌روزرسانی شد.', vehicleId });
  }, { requireKey: true });
});

router.post('/trips/:tripId/nominate', platformAuth({ roles: COMPANY_Y_OWNER_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, trip.y_org_id);
    if (!trip.y_award_accepted_at) throw new DomainError('AWD-409', 'ابتدا باید Award ظرفیت توسط شرکت Y پذیرفته شود.', 409);
    const driverId = parsePositiveId(request.body?.driverId, 'شناسه راننده');
    const [drivers] = await pool.execute(`SELECT id, first_name, last_name, status, kyc_state, passport_state, license_state, driver_card_state, availability_state FROM drivers WHERE id = ? AND tenant_id = ? LIMIT 1`, [driverId, request.actor.tenantId]);
    if (!drivers[0] || drivers[0].status !== 'active') throw new DomainError(ERROR_CODES.QUALIFICATION_EXPIRED, 'راننده فعال و واجد شرایط پیدا نشد.', 423);
    const [assignments] = await pool.execute(`SELECT * FROM carrier_driver_assignments WHERE tenant_id = ? AND y_org_id = ? AND driver_id = ? AND state = 'active' LIMIT 1`, [request.actor.tenantId, request.actor.organizationId, driverId]);
    const assignment = assignments[0];
    if (!assignment) throw new DomainError(ERROR_CODES.CARRIER_COVERAGE_MISSING, 'راننده ابتدا باید در شبکه شرکت Y معرفی و فعال شود.', 424);
    const now = Date.now();
    if ((assignment.valid_from && new Date(assignment.valid_from).getTime() > now) || (assignment.valid_to && new Date(assignment.valid_to).getTime() < now)) throw new DomainError(ERROR_CODES.CARRIER_COVERAGE_MISSING, 'Coverage راننده منقضی یا هنوز فعال نشده است.', 424);
    const driverDocs = [drivers[0].kyc_state, drivers[0].passport_state, drivers[0].license_state, drivers[0].driver_card_state];
    if (drivers[0].availability_state && drivers[0].availability_state !== 'available') throw new DomainError(ERROR_CODES.QUALIFICATION_EXPIRED, 'راننده در حال حاضر در دسترس نیست.', 423);
    if (driverDocs.some((state) => !['approved', 'verified', 'valid'].includes(String(state || '').toLowerCase()))) throw new DomainError(ERROR_CODES.QUALIFICATION_EXPIRED, 'مدرک KYC یا مجوز راننده تأییدشده نیست.', 423);
    const routeScope = scopeValues(parseJson(assignment.route_scope, []));
    const routeValues = [trip.origin_country, trip.destination_country, trip.origin_location, trip.destination_location].filter(Boolean).map((value) => String(value).toLowerCase());
    if (routeScope.length && routeValues.length && !routeValues.some((value) => routeScope.some((allowed) => value.includes(allowed)))) throw new DomainError(ERROR_CODES.CARRIER_COVERAGE_MISSING, 'کریدور سفر خارج از Coverage راننده است.', 424);
    const vehicleId = request.body?.vehicleId ? parsePositiveId(request.body.vehicleId, 'شناسه خودرو') : (assignment.vehicle_id ? parsePositiveId(assignment.vehicle_id, 'شناسه خودرو') : null);
    if (!vehicleId) throw new DomainError(ERROR_CODES.VEHICLE_CARGO_MISMATCH, 'خودرو/تریلر برای Nomination الزامی است.', 422);
    if (vehicleId) {
      const [vehicles] = await pool.execute(`SELECT * FROM vehicles WHERE id = ? AND tenant_id = ? AND (owner_org_id = ? OR owner_org_id = CONCAT('driver:', ?)) LIMIT 1`, [vehicleId, request.actor.tenantId, request.actor.organizationId, driverId]);
      if (!vehicles[0] || vehicles[0].status !== 'active') throw new DomainError(ERROR_CODES.VEHICLE_CARGO_MISMATCH, 'خودرو برای این شرکت معتبر نیست.', 422);
      const vehicleScope = scopeValues(parseJson(vehicles[0].cargo_scope, []));
      if (vehicleScope.length && trip.cargo_type && !vehicleScope.includes(String(trip.cargo_type).toLowerCase()) && !vehicleScope.includes('all')) throw new DomainError(ERROR_CODES.VEHICLE_CARGO_MISMATCH, 'نوع خودرو با دامنه کالای این سفر منطبق نیست.', 422);
      if (trip.case_payload_json && parseJson(trip.case_payload_json, {}).fleet?.routePermitRequired && !parseJson(vehicles[0].route_permits_json, {}).valid) throw new DomainError(ERROR_CODES.COMPLIANCE_BLOCK, 'مجوز مسیر خودرو برای این سفر تأیید نشده است.', 451);
    }
    assertTransition('capacity', trip.capacity_state || 'CARRIER_AWARDED', 'TRUCK_NOMINATED');
    await pool.execute(`UPDATE trip_cases SET driver_id = ?, vehicle_id = ? WHERE id = ? AND tenant_id = ?`, [driverId, vehicleId, tripId, request.actor.tenantId]);
    await pool.execute(`UPDATE shipment_cases SET capacity_state = 'TRUCK_NOMINATED', state = 'TRUCK_NOMINATED' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    await event(request, { eventName: 'TruckNominated', entityType: 'trip', entityId: tripId, payload: { caseId: trip.case_id, driverId, vehicleId, coverageId: assignment.id }, recipientOrgId: trip.x_org_id });
    return jsonResponse({ message: 'راننده و خودرو پس از اعتبارسنجی Coverage معرفی شدند.', tripId, driverId, vehicleId, state: 'TRUCK_NOMINATED' });
  }, { requireKey: true });
});

router.get('/trips/:tripId/nomination', platformAuth({ roles: [...COMPANY_X_OPERATION_ROLES, ...COMPANY_Y_ROLES], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    const yActor = isCompanyYActor(request.actor);
    assertOrganizationScope(request.actor, yActor ? trip.y_org_id : trip.x_org_id);
    const [driverRows] = trip.driver_id
      ? await pool.execute(`SELECT id, first_name, last_name, status, phone FROM drivers WHERE id = ? AND tenant_id = ? LIMIT 1`, [trip.driver_id, request.actor.tenantId])
      : [[]];
    const [assignmentRows] = trip.driver_id
      ? await pool.execute(`SELECT id, state, valid_from, valid_to, route_scope, supporting_docs_json, created_at FROM carrier_driver_assignments WHERE tenant_id = ? AND y_org_id = ? AND driver_id = ? LIMIT 1`, [request.actor.tenantId, trip.y_org_id, trip.driver_id])
      : [[]];
    const [vehicleRows] = trip.vehicle_id
      ? await pool.execute(`SELECT id, plate_number, cargo_scope, status, owner_org_id, vehicle_type, capacity, reefer_capable, route_permits_json FROM vehicles WHERE id = ? AND tenant_id = ? LIMIT 1`, [trip.vehicle_id, request.actor.tenantId])
      : [[]];
    const driver = driverRows[0];
    const vehicle = vehicleRows[0];
    return response.json({
      tripId,
      yOrgId: trip.y_org_id,
      driver: driver ? { id: driver.id, name: `${driver.first_name} ${driver.last_name}`.trim(), status: driver.status, qualificationState: driver.status === 'active' && assignmentRows[0]?.state === 'active' ? 'qualified' : 'blocked', coverageState: assignmentRows[0]?.state || 'missing', validFrom: assignmentRows[0]?.valid_from || null, validTo: assignmentRows[0]?.valid_to || null, routeScope: parseJson(assignmentRows[0]?.route_scope, []), phone: hasPermission(request.actor.role, PERMISSIONS.SEE_CONTACT) ? maskPhone(driver.phone) : null } : null,
      vehicle: vehicle ? { id: vehicle.id, plateNumber: vehicle.plate_number, status: vehicle.status, ownerOrgId: vehicle.owner_org_id, cargoScope: parseJson(vehicle.cargo_scope, []), vehicleType: vehicle.vehicle_type || null, capacity: vehicle.capacity || null, reeferCapable: Boolean(vehicle.reefer_capable), routePermits: parseJson(vehicle.route_permits_json, {}) } : null,
      routeEligibility: inAbacCaseScope(request.actor, trip),
      nominationState: trip.driver_id && trip.vehicle_id ? 'TRUCK_NOMINATED' : 'PENDING',
      audience: yActor ? 'carrier' : 'forwarder'
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/trips/:tripId/agent', platformAuth({ roles: COMPANY_X_OPERATION_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, trip.x_org_id);
    const organizationId = String(request.body?.authorizedAgentOrgId || '').trim();
    const authorityRef = String(request.body?.authorityRef || '').trim();
    if (!organizationId || !authorityRef) throw new DomainError('AGT-400', 'سازمان Agent/Z و مرجع اختیار الزامی است.', 400);
    const [organizationRows] = await pool.execute(`SELECT id, display_name, organization_type, status, qualification_state FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [organizationId, request.actor.tenantId]);
    const organization = organizationRows[0];
    const type = organization?.organization_type;
    if (type !== 'agent_z' && type !== 'consignee') throw new DomainError('AGT-422', 'گیرنده باید Agent/Z یا Consignee مجاز باشد.', 422);
    if (organization.status !== 'active') throw new DomainError('AGT-423', 'سازمان گیرنده فعال نیست.', 423);
    const validFrom = safeDate(request.body?.validFrom) || new Date();
    const validTo = request.body?.validTo ? safeDate(request.body.validTo) : null;
    if (!validFrom || (request.body?.validTo && !validTo) || (validTo && validTo <= validFrom)) throw new DomainError('AGT-400', 'بازه اعتبار اختیارنامه معتبر نیست.', 400);
    const authorityDocumentId = request.body?.authorityDocumentId ? parsePositiveId(request.body.authorityDocumentId, 'شناسه سند اختیار') : null;
    if (authorityDocumentId) {
      const [authorityRows] = await pool.execute(
        `SELECT id FROM platform_documents
          WHERE id = ? AND tenant_id = ? AND doc_type = 'AGENT_AUTHORITY'
            AND owner_org_id = ? AND (case_id = ? OR trip_id = ?) AND state IN ('SUBMITTED', 'APPROVED')
          LIMIT 1`,
        [authorityDocumentId, request.actor.tenantId, organizationId, trip.case_id, tripId]
      );
      if (!authorityRows[0]) throw new DomainError('DOC-403', 'سند اختیار باید متعلق به Agent همین پرونده و در وضعیت قابل استناد باشد.', 403);
    }
    const reportingOrgId = String(request.body?.reportingOrgId || trip.x_org_id).trim();
    if (![request.actor.organizationId, organizationId].includes(reportingOrgId)) throw new DomainError('AUTH-403', 'رابطه گزارش‌دهی Agent خارج از دو طرف مجاز است.', 403);
    const scope = request.body?.scope && typeof request.body.scope === 'object' ? request.body.scope : {
      countryScope: [trip.destination_country].filter(Boolean),
      destination: trip.destination_location || null
    };
    const permittedActions = Array.isArray(request.body?.permittedActions) && request.body.permittedActions.length
      ? [...new Set(request.body.permittedActions.map((value) => String(value).trim()).filter(Boolean))]
      : AGENT_DEFAULT_ACTIONS;
    const state = ['qualified', 'verified', 'approved', 'valid'].includes(String(organization.qualification_state || '').toLowerCase()) ? 'VERIFIED' : 'PENDING';
    const [result] = await pool.execute(
      `INSERT INTO agent_assignments
        (tenant_id, case_id, trip_id, agent_org_id, assigned_by_org_id, authority_ref, authority_document_id, valid_from, valid_to, scope_json, permitted_actions_json, reporting_org_id, state, verified_by_user_id, verified_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.actor.tenantId, trip.case_id, tripId, organizationId, request.actor.organizationId, authorityRef, authorityDocumentId, validFrom, validTo, JSON.stringify(scope), JSON.stringify(permittedActions), reportingOrgId, state, state === 'VERIFIED' ? request.actor.userId : null, state === 'VERIFIED' ? new Date() : null, request.actor.userId]
    );
    await pool.execute(`UPDATE trip_cases SET authorized_agent_org_id = ? WHERE id = ? AND tenant_id = ?`, [organizationId, tripId, request.actor.tenantId]);
    await event(request, { eventName: 'AgentAssignmentCreated', entityType: 'agent_assignment', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, authorizedAgentOrgId: organizationId, authorityRef, state, validFrom, validTo }, recipientOrgId: organizationId });
    return jsonResponse({ message: state === 'VERIFIED' ? 'اختیار تحویل برای Agent ثبت و تأیید شد.' : 'اختیار تحویل ثبت شد و در انتظار احراز سازمان گیرنده است.', tripId, assignmentId: result.insertId, authorizedAgentOrgId: organizationId, authorityRef, authorityDocumentId, scope, reportingOrgId, state, validFrom, validTo, permittedActions }, 201);
  }, { requireKey: true });
});

router.post('/trips/:tripId/readiness', platformAuth({ roles: [...COMPANY_X_OPERATION_ROLES, ROLES.COMPANY_X_DOCUMENT_EXPERT, ROLES.COMPANY_Y_OWNER, ROLES.COMPANY_Y_DOCUMENT_ISSUER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    const current = parseJson(trip.readiness_json, {});
    const allowed = ['customsReady', 'routePermitReady', 'documentsReady', 'vehicleReady', 'driverReady', 'preloadState', 'commercialDocsReady', 'loadingState'];
    const incoming = request.body?.readiness || request.body || {};
    for (const key of Object.keys(incoming)) if (!allowed.includes(key)) throw new DomainError('INPUT-400', `فیلد آمادگی ${key} مجاز نیست.`, 400);
    if (isCompanyYDocumentIssuer(request.actor) && Object.keys(incoming).some((key) => key !== 'documentsReady')) {
      throw new DomainError('AUTH-403', 'متخصص اسناد شرکت Y فقط گیت اسناد را به‌روزرسانی می‌کند.', 403);
    }
    const next = { ...current, ...incoming };
    if (next.customsReady === true) {
      const [documents] = await pool.execute(`SELECT id FROM platform_documents WHERE tenant_id = ? AND case_id = ? AND doc_type = 'CUSTOMS_PERMIT' AND state = 'APPROVED' LIMIT 1`, [request.actor.tenantId, trip.case_id]);
      if (!documents[0]) throw new DomainError(ERROR_CODES.COMPLIANCE_BLOCK, 'گیت گمرکی بدون مجوز تأییدشده باز نمی‌شود.', 451);
    }
    if (next.routePermitReady === true) {
      const [documents] = await pool.execute(`SELECT id FROM platform_documents WHERE tenant_id = ? AND case_id = ? AND doc_type = 'ROUTE_PERMIT' AND state = 'APPROVED' LIMIT 1`, [request.actor.tenantId, trip.case_id]);
      if (!documents[0]) throw new DomainError(ERROR_CODES.COMPLIANCE_BLOCK, 'گیت مجوز مسیر بدون سند تأییدشده باز نمی‌شود.', 451);
    }
    if (next.documentsReady === true) {
      const [documents] = await pool.execute(`SELECT id FROM platform_documents WHERE tenant_id = ? AND (case_id = ? OR trip_id = ?) AND doc_type IN ('CMR_FINAL', 'COMMERCIAL_DOC') AND state = 'APPROVED' LIMIT 1`, [request.actor.tenantId, trip.case_id, trip.id]);
      if (!documents[0]) throw new DomainError(ERROR_CODES.DOCUMENT_LOCKED, 'مدارک سفر هنوز نسخه تأییدشده ندارند.', 423);
    }
    if (next.vehicleReady === true && !trip.vehicle_id) throw new DomainError(ERROR_CODES.VEHICLE_CARGO_MISMATCH, 'خودروی معتبر هنوز برای سفر معرفی نشده است.', 422);
    if (next.driverReady === true && !trip.driver_id) throw new DomainError(ERROR_CODES.CARRIER_COVERAGE_MISSING, 'راننده معتبر هنوز برای سفر معرفی نشده است.', 424);
    if (next.preloadState === 'CHECKED_IN') assertTransition('capacity', trip.capacity_state || 'TRUCK_NOMINATED', 'CHECKED_IN');
    if (next.loadingState) {
      const currentLoadingState = trip.loading_state || 'PRELOAD_ACCEPTED';
      if (!['PRELOAD_ACCEPTED', 'LOADED', 'WEIGHT_CONFIRMED', 'COMMERCIAL_DOCS_READY'].includes(next.loadingState)) throw new DomainError('LOAD-400', 'وضعیت بارگیری معتبر نیست.', 400);
      if (next.loadingState !== currentLoadingState) assertTransition('loading', currentLoadingState, next.loadingState);
    }
    await pool.execute(`UPDATE trip_cases SET readiness_json = ? WHERE id = ? AND tenant_id = ?`, [JSON.stringify(next), tripId, request.actor.tenantId]);
    if (next.preloadState === 'CHECKED_IN') await pool.execute(`UPDATE shipment_cases SET capacity_state = 'CHECKED_IN', state = 'CHECKED_IN' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    if (next.loadingState && next.loadingState !== trip.loading_state) {
      await pool.execute(`UPDATE shipment_cases SET loading_state = ? WHERE id = ? AND tenant_id = ?`, [next.loadingState, trip.case_id, request.actor.tenantId]);
      if (trip.direction === 'IMPORT' && next.loadingState === 'LOADED') await pool.execute(`UPDATE shipment_cases SET import_state = 'I07_LOADING_ABROAD' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
      if (trip.direction === 'IMPORT' && next.loadingState === 'COMMERCIAL_DOCS_READY') await pool.execute(`UPDATE shipment_cases SET import_state = 'I08_CMR_TIR_ACTIVE' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    }
    const eventName = next.loadingState === 'LOADED' ? 'LoadingCompleted' : next.loadingState === 'WEIGHT_CONFIRMED' ? 'WeightConfirmed' : 'LoadingEvidenceSubmitted';
    await event(request, { eventName, entityType: 'trip', entityId: tripId, payload: { readiness: next, loadingState: next.loadingState || null }, recipientOrgId: trip.x_org_id === request.actor.organizationId ? trip.y_org_id : trip.x_org_id });
    return jsonResponse({ message: 'گیت‌های آمادگی به‌روزرسانی شد.', tripId, readiness: next });
  }, { requireKey: true });
});

router.post('/trips/:tripId/loading-schedule', platformAuth({ roles: COMPANY_X_OPERATION_ROLES, permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, trip.x_org_id);
    const schedule = request.body?.schedule && typeof request.body.schedule === 'object' ? request.body.schedule : request.body || {};
    if (!schedule.checkInAt && !schedule.loadingWindow) throw new DomainError('LOAD-400', 'زمان ورود یا بازه بارگیری الزامی است.', 400);
    const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM trip_loading_schedules WHERE tenant_id = ? AND trip_id = ?`, [request.actor.tenantId, tripId]);
    const versionNo = Number(versions[0]?.max_version || 0) + 1;
    await pool.execute(`INSERT INTO trip_loading_schedules (tenant_id, trip_id, version_no, schedule_json, created_by_user_id) VALUES (?, ?, ?, ?, ?)`, [request.actor.tenantId, tripId, versionNo, JSON.stringify(schedule), request.actor.userId]);
    await pool.execute(`UPDATE trip_cases SET loading_schedule_json = ? WHERE id = ? AND tenant_id = ?`, [JSON.stringify({ ...schedule, versionNo }), tripId, request.actor.tenantId]);
    await event(request, { eventName: 'LoadingScheduleCreated', entityType: 'trip_loading_schedule', entityId: tripId, payload: { tripId, caseId: trip.case_id, versionNo, schedule }, recipientOrgId: trip.y_org_id });
    return jsonResponse({ message: 'برنامه بارگیری به‌صورت نسخه جدید ثبت شد.', tripId, versionNo, schedule }, 201);
  }, { requireKey: true });
});

router.get('/trips/:tripId/loading-schedule', platformAuth({ roles: [...COMPANY_X_OPERATION_ROLES, ROLES.COMPANY_X_DOCUMENT_EXPERT, ...COMPANY_Y_ROLES, ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    if (normalizeRole(request.actor.role) === ROLES.DRIVER) assertDriverTrip(request.actor, trip);
    else assertOrganizationScope(request.actor, isCompanyYActor(request.actor) ? trip.y_org_id : trip.x_org_id);
    const [rows] = await pool.execute(`SELECT id, trip_id, version_no, schedule_json, created_by_user_id, created_at FROM trip_loading_schedules WHERE tenant_id = ? AND trip_id = ? ORDER BY version_no DESC`, [request.actor.tenantId, tripId]);
    return response.json({ schedules: rows.map((row) => ({ id: row.id, tripId: row.trip_id, versionNo: row.version_no, schedule: parseJson(row.schedule_json, {}), createdByUserId: row.created_by_user_id, createdAt: row.created_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/trips/:tripId/loading-evidence', platformAuth({ roles: [...COMPANY_X_OPERATION_ROLES, ROLES.COMPANY_X_DOCUMENT_EXPERT, ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    const driverActor = normalizeRole(request.actor.role) === ROLES.DRIVER;
    if (driverActor) {
      assertDriverTrip(request.actor, trip);
      await assertDriverTripAccepted(request, tripId);
      await assertDriverDevice(request);
    } else {
      assertTripAccess(request.actor, trip);
      assertOrganizationScope(request.actor, trip.x_org_id);
    }
    const evidenceType = String(request.body?.evidenceType || '').trim().toUpperCase();
    if (!(driverActor ? DRIVER_EVIDENCE_TYPES : LOADING_EVIDENCE_TYPES).has(evidenceType)) throw new DomainError('LOAD-400', 'نوع شاهد بارگیری معتبر نیست.', 400);
    const fileHash = request.body?.fileHash ? String(request.body.fileHash).trim().toLowerCase() : null;
    if (fileHash && !/^[a-f0-9]{64}$/.test(fileHash)) throw new DomainError('DOC-400', 'hash شاهد بارگیری معتبر نیست.', 400);
    const occurredAt = request.body?.occurredAt ? safeDate(request.body.occurredAt) : new Date();
    if (!occurredAt) throw new DomainError('INPUT-400', 'زمان شاهد معتبر نیست.', 400);
    const location = request.body?.geo || request.body?.location || null;
    if (location && (!Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng)))) throw new DomainError('GPS-400', 'مختصات شاهد معتبر نیست.', 400);
    const mismatch = Boolean(request.body?.mismatch);
    const metadata = request.body?.metadata && typeof request.body.metadata === 'object' ? request.body.metadata : {};
    const [result] = await pool.execute(
      `INSERT INTO trip_loading_evidence (tenant_id, trip_id, evidence_type, owner_org_id, uploader_user_id, device_ref, occurred_at, geo_json, file_ref, file_hash, metadata_json, mismatch_flag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.actor.tenantId, tripId, evidenceType, driverActor ? trip.y_org_id : trip.x_org_id, request.actor.userId, request.body?.deviceRef || driverDeviceId(request) || null, occurredAt, location ? JSON.stringify({ lat: Number(location.lat), lng: Number(location.lng), accuracy: location.accuracy || null }) : null, request.body?.fileRef || null, fileHash, JSON.stringify(metadata), mismatch ? 1 : 0]
    );
    await event(request, { eventName: 'LoadingEvidenceSubmitted', entityType: 'trip_loading_evidence', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, evidenceType, mismatch }, recipientOrgIds: driverActor ? [trip.x_org_id, trip.y_org_id] : [trip.y_org_id] });
    if (mismatch) {
      const reason = String(request.body?.mismatchReason || `عدم تطابق شاهد ${evidenceType}`).trim();
      const [exception] = await pool.execute(`INSERT INTO platform_exceptions (tenant_id, case_id, trip_id, exception_type, severity, status, reason, evidence_json, opened_by_user_id, opened_by_org_id) VALUES (?, ?, ?, ?, 'high', 'OPEN', ?, ?, ?, ?)`, [request.actor.tenantId, trip.case_id, tripId, evidenceType === 'SCALE_TICKET' ? 'WEIGHT_MISMATCH' : 'OTHER', reason, JSON.stringify({ evidenceId: result.insertId, evidenceType }), request.actor.userId, request.actor.organizationId]);
      await event(request, { eventName: 'ExceptionOpened', entityType: 'platform_exception', entityId: exception.insertId, payload: { caseId: trip.case_id, tripId, exceptionType: evidenceType === 'SCALE_TICKET' ? 'WEIGHT_MISMATCH' : 'OTHER', evidenceId: result.insertId }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    }
    return jsonResponse({ message: 'شاهد بارگیری به‌صورت immutable ثبت شد.', evidenceId: result.insertId, tripId, evidenceType, mismatch }, 201);
  }, { requireKey: true });
});

router.get('/trips/:tripId/loading-evidence', platformAuth({ roles: [...COMPANY_X_OPERATION_ROLES, ROLES.COMPANY_X_DOCUMENT_EXPERT, ...COMPANY_Y_ROLES, ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    if (normalizeRole(request.actor.role) === ROLES.DRIVER) assertDriverTrip(request.actor, trip);
    else assertOrganizationScope(request.actor, isCompanyYActor(request.actor) ? trip.y_org_id : trip.x_org_id);
    const [rows] = await pool.execute(`SELECT * FROM trip_loading_evidence WHERE tenant_id = ? AND trip_id = ? ORDER BY created_at DESC`, [request.actor.tenantId, tripId]);
    return response.json({ evidence: rows.map((row) => ({ id: row.id, tripId: row.trip_id, evidenceType: row.evidence_type, ownerOrgId: row.owner_org_id, uploaderUserId: row.uploader_user_id, deviceRef: row.device_ref, occurredAt: row.occurred_at, geo: parseJson(row.geo_json, null), fileRef: row.file_ref, fileHash: row.file_hash, metadata: parseJson(row.metadata_json, {}), mismatch: Boolean(row.mismatch_flag), createdAt: row.created_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/driver/trips/:tripId/check-in', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    const geo = driverGeoFromPayload(request.body || {});
    const casePayload = parseJson(trip.case_payload_json, {});
    const configuredGeo = casePayload.origin?.geo || casePayload.origin?.coordinates || casePayload.loading?.geo || null;
    const radiusMeters = Number(casePayload.origin?.geofenceRadiusMeters || casePayload.loading?.geofenceRadiusMeters || 1000);
    const distance = configuredGeo ? distanceKm(geo, configuredGeo) : null;
    const valid = distance !== null && distance * 1000 <= radiusMeters;
    const reason = String(request.body?.outsideReason || '').trim();
    if (!valid && reason.length < 8) throw new DomainError('GEO-422', 'ورود خارج از محدوده یا بدون مختصات مرجع است؛ دلیل استثنا را ثبت کنید.', 422, { distanceMeters: distance === null ? null : Math.round(distance * 1000), radiusMeters });
    const metadata = { category: 'origin-arrival', geofence: valid ? 'INSIDE' : 'OUTSIDE_WARNING', distanceMeters: distance === null ? null : Math.round(distance * 1000), radiusMeters, reason: reason || null, deviceTimestamp: geo.timestamp || null };
    const fileHash = hashValue(JSON.stringify({ tripId, geo, metadata, device: driverDeviceId(request) }));
    const [result] = await pool.execute(
      `INSERT INTO trip_loading_evidence (tenant_id, trip_id, evidence_type, owner_org_id, uploader_user_id, device_ref, occurred_at, geo_json, file_hash, metadata_json, mismatch_flag)
       VALUES (?, ?, 'ARRIVAL', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.actor.tenantId, tripId, trip.y_org_id, request.actor.userId, driverDeviceId(request), safeDate(geo.timestamp) || new Date(), JSON.stringify(geo), fileHash, JSON.stringify(metadata), valid ? 0 : 1]
    );
    const readiness = parseJson(trip.readiness_json, {});
    const nextReadiness = { ...readiness, preloadState: valid ? 'CHECKED_IN' : readiness.preloadState || 'PRELOAD_ACCEPTED' };
    await pool.execute(`UPDATE trip_cases SET readiness_json = ? WHERE id = ? AND tenant_id = ?`, [JSON.stringify(nextReadiness), tripId, request.actor.tenantId]);
    if (valid) await pool.execute(`UPDATE shipment_cases SET capacity_state = 'CHECKED_IN' WHERE id = ? AND tenant_id = ? AND capacity_state = 'TRUCK_NOMINATED'`, [trip.case_id, request.actor.tenantId]);
    await event(request, { eventName: 'CheckInRecorded', entityType: 'trip_loading_evidence', entityId: result.insertId, payload: { tripId, caseId: trip.case_id, geo, geofence: valid ? 'INSIDE' : 'OUTSIDE_WARNING', reason: reason || null }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: valid ? 'رسیدن به مبدأ ثبت شد.' : 'رسیدن خارج از محدوده با هشدار ثبت شد.', evidenceId: result.insertId, geofence: valid ? 'INSIDE' : 'OUTSIDE_WARNING', readiness: nextReadiness }, 201);
  }, { requireKey: true });
});

router.post('/driver/trips/:tripId/preload-checklist', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    const checks = request.body?.checks && typeof request.body.checks === 'object' ? request.body.checks : {};
    const critical = ['correctVehicle', 'cleanFit', 'capacity', 'securement'];
    const missing = critical.filter((key) => checks[key] !== true);
    const casePayload = parseJson(trip.case_payload_json, {});
    if (String(casePayload.cargo?.condition || '').toLowerCase() === 'reefer' && checks.temperatureReady !== true) missing.push('temperatureReady');
    if (missing.length) throw new DomainError(ERROR_CODES.COMPLIANCE_BLOCK, 'چک‌لیست پیش‌بارگیری کامل نیست.', 451, { missing });
    const geo = request.body?.geo ? driverGeoFromPayload(request.body) : null;
    const metadata = { checks, remarks: String(request.body?.remarks || '').trim().slice(0, 1000), capturedAt: new Date().toISOString() };
    const fileHash = String(request.body?.fileHash || '').trim().toLowerCase() || hashValue(JSON.stringify({ tripId, checks, metadata, device: driverDeviceId(request) }));
    if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new DomainError('DOC-400', 'hash چک‌لیست معتبر نیست.', 400);
    const [result] = await pool.execute(
      `INSERT INTO trip_loading_evidence (tenant_id, trip_id, evidence_type, owner_org_id, uploader_user_id, device_ref, occurred_at, geo_json, file_ref, file_hash, metadata_json, mismatch_flag)
       VALUES (?, ?, 'PRELOAD_CHECKLIST', ?, ?, ?, NOW(), ?, ?, ?, ?, 0)`,
      [request.actor.tenantId, tripId, trip.y_org_id, request.actor.userId, driverDeviceId(request), geo ? JSON.stringify(geo) : null, request.body?.fileRef || null, fileHash, JSON.stringify(metadata)]
    );
    const readiness = parseJson(trip.readiness_json, {});
    const nextReadiness = { ...readiness, vehicleReady: true, driverReady: true, preloadState: readiness.preloadState === 'CHECKED_IN' ? 'CHECKED_IN' : readiness.preloadState || 'PRELOAD_ACCEPTED' };
    await pool.execute(`UPDATE trip_cases SET readiness_json = ? WHERE id = ? AND tenant_id = ?`, [JSON.stringify(nextReadiness), tripId, request.actor.tenantId]);
    await event(request, { eventName: 'PreloadChecklistSubmitted', entityType: 'trip_loading_evidence', entityId: result.insertId, payload: { tripId, caseId: trip.case_id, checks }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'چک‌لیست پیش‌بارگیری ثبت شد.', evidenceId: result.insertId, readiness: nextReadiness }, 201);
  }, { requireKey: true });
});

router.post('/trips/:tripId/start', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    if (String(trip.driver_id) !== String(request.actor.externalId)) throw new DomainError('AUTH-403', 'این سفر به راننده فعلی اختصاص ندارد.', 403);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    assertTripStartReady({ readiness: trip.readiness_json });
    assertTransition('trip', trip.state, 'AT_BORDER');
    await pool.execute(`UPDATE trip_cases SET state = 'AT_BORDER', tracking_state = 'ACTIVE' WHERE id = ? AND tenant_id = ?`, [tripId, request.actor.tenantId]);
    await pool.execute(`UPDATE shipment_cases SET trip_state = 'AT_BORDER', state = 'AT_BORDER' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    await pool.execute(`UPDATE drivers SET availability_state = 'in_trip' WHERE id = ? AND tenant_id = ?`, [request.actor.externalId, request.actor.tenantId]);
    if (trip.vehicle_id) await pool.execute(`UPDATE vehicles SET availability_state = 'in_trip' WHERE id = ? AND tenant_id = ?`, [trip.vehicle_id, request.actor.tenantId]);
    await event(request, { eventName: 'TripStarted', entityType: 'trip', entityId: tripId, payload: { caseId: trip.case_id, tracking: 'active' }, recipientOrgId: trip.x_org_id });
    return jsonResponse({ message: 'سفر پس از تکمیل گیت‌ها آغاز شد.', tripId, state: 'AT_BORDER', trackingState: 'ACTIVE' });
  }, { requireKey: true });
});

router.post('/trips/:tripId/status', platformAuth({ roles: [...COMPANY_X_OPERATION_ROLES, ROLES.COMPANY_Y_OWNER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    const nextTripState = request.body?.tripState ? String(request.body.tripState).toUpperCase() : null;
    const nextDeliveryState = request.body?.deliveryState ? String(request.body.deliveryState).toUpperCase() : null;
    if (!nextTripState && !nextDeliveryState) throw new DomainError('INPUT-400', 'وضعیت جدید الزامی است.', 400);
    if (nextTripState) {
      assertTransition('trip', trip.state, nextTripState);
      await pool.execute(`UPDATE trip_cases SET state = ? WHERE id = ? AND tenant_id = ?`, [nextTripState, tripId, request.actor.tenantId]);
      await pool.execute(`UPDATE shipment_cases SET trip_state = ?, state = ? WHERE id = ? AND tenant_id = ?`, [nextTripState, nextTripState, trip.case_id, request.actor.tenantId]);
      if (trip.direction === 'IMPORT' && nextTripState === 'AT_BORDER') await pool.execute(`UPDATE shipment_cases SET import_state = 'I09_ENTRY_BORDER_EVENT' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
      if (trip.direction === 'IMPORT' && nextTripState === 'AT_DESTINATION') await pool.execute(`UPDATE shipment_cases SET import_state = 'I12_DOMESTIC_DELIVERY' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    }
    if (nextDeliveryState) {
      if (nextDeliveryState !== 'DELIVERED') throw new DomainError('POD-400', 'POD فقط از مسیر ثبت و پذیرش شواهد تغییر می‌کند.', 400);
      await pool.execute(`UPDATE shipment_cases SET delivery_state = ?, state = ? WHERE id = ? AND tenant_id = ?`, [nextDeliveryState, nextDeliveryState, trip.case_id, request.actor.tenantId]);
    }
    const eventName = nextDeliveryState === 'DELIVERED' || nextTripState === 'AT_DESTINATION' ? 'DestinationArrived' : 'BorderEventRecorded';
    await event(request, { eventName, entityType: 'trip', entityId: tripId, payload: { caseId: trip.case_id, tripState: nextTripState, deliveryState: nextDeliveryState } });
    return jsonResponse({ message: 'وضعیت سفر ثبت شد.', tripId, tripState: nextTripState || trip.state, deliveryState: nextDeliveryState || trip.delivery_state });
  }, { requireKey: true });
});

router.post('/trips/:tripId/tir', platformAuth({ roles: [ROLES.COMPANY_X_DOCUMENT_EXPERT, ROLES.COMPANY_Y_DOCUMENT_ISSUER, ROLES.CUSTOMS_BROKER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    const nextState = String(request.body?.state || '').toUpperCase();
    const currentState = trip.tir_state || 'NOT_APPLICABLE';
    if (!['NOT_APPLICABLE', 'CARNET_ISSUED', 'OPENED', 'CHECKPOINTS', 'DISCHARGED'].includes(nextState)) throw new DomainError('TIR-400', 'وضعیت TIR معتبر نیست.', 400);
    const existingMetadata = parseJson(trip.tir_metadata_json, {});
    let tirMetadata = existingMetadata;
    if (nextState !== 'NOT_APPLICABLE') {
      const holderOrgId = String(request.body?.holderOrgId || existingMetadata.holderOrgId || '').trim();
      const holderAuthorizationRef = String(request.body?.holderAuthorizationRef || existingMetadata.holderAuthorizationRef || '').trim();
      if (!holderOrgId || !holderAuthorizationRef) throw new DomainError(ERROR_CODES.TIR_UNAUTHORIZED_HOLDER, 'هر اقدام TIR به Holder معتبر و مرجع اختیار نیاز دارد.', 424);
      if (existingMetadata.holderOrgId && existingMetadata.holderOrgId !== holderOrgId) throw new DomainError(ERROR_CODES.TIR_UNAUTHORIZED_HOLDER, 'Holder در طول چرخه TIR قابل تعویض بدون مسیر اصلاح کنترل‌شده نیست.', 424);
      const [holders] = await pool.execute(`SELECT id FROM platform_organizations WHERE id = ? AND tenant_id = ? AND organization_type = 'company_y' AND status = 'active' AND qualification_state = 'qualified' LIMIT 1`, [holderOrgId, request.actor.tenantId]);
      if (!holders[0]) throw new DomainError(ERROR_CODES.TIR_UNAUTHORIZED_HOLDER, 'Holder شرکت Y واجد شرایط پیدا نشد.', 424);
      if (isCompanyYDocumentIssuer(request.actor) && holderOrgId !== request.actor.organizationId) throw new DomainError(ERROR_CODES.TIR_UNAUTHORIZED_HOLDER, 'صادرکننده اسناد Y فقط با Holder معتبر سازمان خودش اقدام می‌کند.', 403);
      tirMetadata = {
        ...existingMetadata,
        holderOrgId,
        holderAuthorizationRef,
        carnetNo: request.body?.carnetNo || existingMetadata.carnetNo || null,
        vehicleId: trip.vehicle_id,
        route: request.body?.route || existingMetadata.route || null,
        manifestRef: request.body?.manifestRef || existingMetadata.manifestRef || null
      };
      if (nextState === 'CARNET_ISSUED' && currentState !== 'NOT_APPLICABLE') throw new DomainError('TIR-409', 'Carnet فقط از وضعیت اولیه صادر می‌شود.', 409);
      if (nextState !== 'CARNET_ISSUED') assertTransition('tir', currentState, nextState);
    } else if (currentState !== 'NOT_APPLICABLE') {
      throw new DomainError('TIR-409', 'بازگرداندن TIR فعال به Not Applicable مجاز نیست.', 409);
    }
    await pool.execute(`UPDATE shipment_cases SET tir_state = ?, tir_metadata_json = ? WHERE id = ? AND tenant_id = ?`, [nextState, nextState === 'NOT_APPLICABLE' ? null : JSON.stringify(tirMetadata), trip.case_id, request.actor.tenantId]);
    const eventName = nextState === 'CARNET_ISSUED' ? 'TIRIssued' : nextState === 'OPENED' ? 'TIROpened' : nextState === 'DISCHARGED' ? 'TIRDischarged' : 'TIRStateChanged';
    await event(request, { eventName, entityType: 'trip', entityId: tripId, payload: { caseId: trip.case_id, from: currentState, to: nextState, holderOrgId: tirMetadata.holderOrgId || null }, recipientOrgId: trip.x_org_id === request.actor.organizationId ? trip.y_org_id : trip.x_org_id });
    return jsonResponse({ message: 'وضعیت مستقل TIR ثبت شد.', tripId, tirState: nextState });
  }, { requireKey: true });
});

router.get('/trips/:tripId/tir', platformAuth({ roles: [...COMPANY_X_ROLES, ...COMPANY_Y_ROLES], permission: PERMISSIONS.SEE_DOCUMENTS }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, isCompanyYActor(request.actor) ? trip.y_org_id : trip.x_org_id);
    return response.json({ tripId, tirState: trip.tir_state || 'NOT_APPLICABLE', metadata: parseJson(trip.tir_metadata_json, {}) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/driver/trips/:tripId/location-batch', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.SEE_LOCATION }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    if (trip.tracking_state !== 'ACTIVE') throw new DomainError('GPS-409', 'ارسال موقعیت فقط در سفر فعال مجاز است.', 409);
    const points = Array.isArray(request.body?.points) ? request.body.points.slice(0, 100) : [];
    if (!points.length) throw new DomainError('GPS-400', 'صف موقعیت خالی است.', 400);
    let previous = parseJson(trip.last_location_json, null);
    let previousAt = trip.last_location_at ? new Date(trip.last_location_at) : null;
    let accepted = 0;
    let anomalous = 0;
    const anomalySignals = [];
    for (const point of points) {
      const location = driverGeoFromPayload({ location: point.location || point, deviceTimestamp: point.deviceTimestamp });
      const timestamp = safeDate(point.deviceTimestamp || location.timestamp) || new Date();
      const explicitSignals = Array.isArray(point.spoofSignals) ? point.spoofSignals.map((value) => String(value).slice(0, 60)) : [];
      const deltaHours = previousAt ? Math.max((timestamp.getTime() - previousAt.getTime()) / 3600000, 0.001) : null;
      const distance = previous ? distanceKm(previous, location) : null;
      const derivedSpeed = distance !== null && deltaHours ? distance / deltaHours : null;
      const speed = Number.isFinite(Number(point.speed)) ? Number(point.speed) * 3.6 : derivedSpeed;
      const signals = [...explicitSignals];
      if (speed !== null && speed > 140) signals.push('IMPOSSIBLE_SPEED');
      if (distance !== null && deltaHours !== null && distance > 250 && deltaHours < 1.5) signals.push('TELEPORT');
      if (timestamp.getTime() > Date.now() + 5 * 60 * 1000) signals.push('FUTURE_TIMESTAMP');
      const spoofed = [...new Set(signals)];
      const payload = { location, speedKmh: speed, localSequence: point.localSequence ?? null, deviceTimestamp: point.deviceTimestamp || null, source: point.source || 'driver_phone_gps', spoofSignals: spoofed, syncReceivedAt: new Date().toISOString() };
      await pool.execute(`INSERT INTO platform_trip_events (tenant_id, trip_id, event_type, actor_user_id, location_json, payload_json) VALUES (?, ?, 'LOCATION_REPORTED', ?, ?, ?)`, [request.actor.tenantId, tripId, request.actor.userId, JSON.stringify(location), JSON.stringify(payload)]);
      accepted += 1;
      if (spoofed.length) {
        anomalous += 1;
        anomalySignals.push(...spoofed);
      } else {
        await pool.execute(`UPDATE trip_cases SET last_location_json = ?, last_location_at = ?, eta_at = ?, last_milestone = ?, delay_flags = ? WHERE id = ? AND tenant_id = ?`, [JSON.stringify(location), timestamp, safeDate(point.eta), point.milestone || null, JSON.stringify(Array.isArray(point.delayFlags) ? point.delayFlags : []), tripId, request.actor.tenantId]);
        previous = location;
        previousAt = timestamp;
      }
    }
    const uniqueSignals = [...new Set(anomalySignals)];
    if (uniqueSignals.length) {
      await event(request, { eventName: 'GPSAnomalyDetected', entityType: 'trip', entityId: tripId, payload: { tripId, caseId: trip.case_id, signals: uniqueSignals, anomalousPoints: anomalous, totalPoints: points.length }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    }
    return jsonResponse({ message: anomalous ? 'موقعیت‌ها ثبت شد؛ بخشی از سیگنال‌ها برای بررسی ریسک علامت‌گذاری شد.' : 'صف موقعیت‌ها با موفقیت همگام شد.', tripId, accepted, anomalous, spoofSignals: uniqueSignals }, 201);
  }, { requireKey: true });
});

router.post('/driver/trips/:tripId/border-events', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.SEE_LOCATION }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    if (trip.tracking_state !== 'ACTIVE') throw new DomainError('GPS-409', 'رویداد مرزی فقط در سفر فعال ثبت می‌شود.', 409);
    const eventType = String(request.body?.eventType || '').trim().toUpperCase();
    if (!DRIVER_BORDER_EVENTS.has(eventType)) throw new DomainError('BORDER-400', 'نوع رویداد مرزی معتبر نیست.', 400);
    const geo = request.body?.geo || request.body?.location ? driverGeoFromPayload(request.body) : null;
    const payload = { borderEvent: eventType, note: String(request.body?.note || '').trim().slice(0, 1000), geo, fileRef: request.body?.fileRef || null, documentRef: request.body?.documentRef || null, deviceTimestamp: request.body?.deviceTimestamp || null };
    const [result] = await pool.execute(`INSERT INTO platform_trip_events (tenant_id, trip_id, event_type, actor_user_id, location_json, payload_json) VALUES (?, ?, 'BORDER_EVENT', ?, ?, ?)`, [request.actor.tenantId, tripId, request.actor.userId, geo ? JSON.stringify(geo) : null, JSON.stringify(payload)]);
    let nextState = trip.state;
    if (eventType === 'ENTERED_COUNTRY' && trip.state === 'AT_BORDER') {
      assertTransition('trip', trip.state, 'EXITED_IRAN');
      nextState = 'EXITED_IRAN';
      await pool.execute(`UPDATE trip_cases SET state = ? WHERE id = ? AND tenant_id = ?`, [nextState, tripId, request.actor.tenantId]);
      await pool.execute(`UPDATE shipment_cases SET trip_state = ?, state = ? WHERE id = ? AND tenant_id = ?`, [nextState, nextState, trip.case_id, request.actor.tenantId]);
      if (trip.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I09_ENTRY_BORDER_EVENT' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    }
    await event(request, { eventName: 'BorderEventRecorded', entityType: 'trip_event', entityId: result.insertId, payload: { tripId, caseId: trip.case_id, borderEvent: eventType, tripState: nextState }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'رویداد مرزی ثبت شد.', eventId: result.insertId, eventType, tripState: nextState }, 201);
  }, { requireKey: true });
});

router.post('/driver/trips/:tripId/incidents', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    const incidentType = String(request.body?.incidentType || '').trim().toUpperCase();
    const severity = String(request.body?.severity || (['ACCIDENT', 'SECURITY_ISSUE', 'SEAL_ISSUE'].includes(incidentType) ? 'critical' : 'high')).toLowerCase();
    const reason = String(request.body?.reason || '').trim();
    if (!DRIVER_INCIDENT_TYPES.has(incidentType) || reason.length < 8) throw new DomainError('INC-400', 'نوع و شرح حادثه الزامی است.', 400);
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) throw new DomainError('INC-400', 'شدت حادثه معتبر نیست.', 400);
    const geo = request.body?.geo || request.body?.location ? driverGeoFromPayload(request.body) : null;
    const evidence = { incidentType, geo, fileRef: request.body?.fileRef || null, fileHash: request.body?.fileHash || null, note: reason, deviceId: driverDeviceId(request) };
    const [result] = await pool.execute(`INSERT INTO platform_exceptions (tenant_id, case_id, trip_id, exception_type, severity, status, reason, evidence_json, opened_by_user_id, opened_by_org_id) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`, [request.actor.tenantId, trip.case_id, tripId, incidentType, severity, reason, JSON.stringify(evidence), request.actor.userId, request.actor.organizationId]);
    await event(request, { eventName: 'IncidentReported', entityType: 'platform_exception', entityId: result.insertId, payload: { tripId, caseId: trip.case_id, incidentType, severity }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    if (['critical', 'high'].includes(severity)) await event(request, { eventName: 'RiskFlagged', entityType: 'platform_exception', entityId: result.insertId, payload: { tripId, caseId: trip.case_id, incidentType, severity }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'حادثه ثبت شد و به شرکت‌های مرتبط اطلاع داده شد.', incidentId: result.insertId, severity, state: 'OPEN' }, 201);
  }, { requireKey: true });
});

router.get('/driver/trips/:tripId/incidents', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    const [rows] = await pool.execute(`SELECT * FROM platform_exceptions WHERE tenant_id = ? AND trip_id = ? ORDER BY created_at DESC`, [request.actor.tenantId, tripId]);
    return response.json({ incidents: rows.map(publicException) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/driver/trips/:tripId/destination-arrival', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    if (trip.tracking_state !== 'ACTIVE') throw new DomainError('GPS-409', 'رسیدن به مقصد فقط در سفر فعال مجاز است.', 409);
    const geo = driverGeoFromPayload(request.body || {});
    const casePayload = parseJson(trip.case_payload_json, {});
    const configuredGeo = casePayload.destination?.geo || casePayload.destination?.coordinates || null;
    const radiusMeters = Number(casePayload.destination?.geofenceRadiusMeters || 1000);
    const distance = configuredGeo ? distanceKm(geo, configuredGeo) : null;
    const valid = distance !== null && distance * 1000 <= radiusMeters;
    const reason = String(request.body?.outsideReason || '').trim();
    if (!valid && reason.length < 8) throw new DomainError('GEO-422', 'رسیدن خارج از محدوده مقصد است؛ دلیل استثنا را ثبت کنید.', 422);
    if (trip.state !== 'AT_DESTINATION') {
      assertTransition('trip', trip.state, 'AT_DESTINATION');
      await pool.execute(`UPDATE trip_cases SET state = 'AT_DESTINATION', last_milestone = 'DESTINATION_ARRIVED' WHERE id = ? AND tenant_id = ?`, [tripId, request.actor.tenantId]);
      await pool.execute(`UPDATE shipment_cases SET trip_state = 'AT_DESTINATION', state = 'AT_DESTINATION' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
      if (trip.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I12_DOMESTIC_DELIVERY' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    }
    const payload = { destinationArrival: true, geofence: valid ? 'INSIDE' : 'OUTSIDE_WARNING', distanceMeters: distance === null ? null : Math.round(distance * 1000), radiusMeters, reason: reason || null, geo };
    const [result] = await pool.execute(`INSERT INTO platform_trip_events (tenant_id, trip_id, event_type, actor_user_id, location_json, payload_json) VALUES (?, ?, 'DESTINATION_ARRIVAL', ?, ?, ?)`, [request.actor.tenantId, tripId, request.actor.userId, JSON.stringify(geo), JSON.stringify(payload)]);
    await event(request, { eventName: 'DestinationArrived', entityType: 'trip_event', entityId: result.insertId, payload: { tripId, caseId: trip.case_id, geofence: payload.geofence, reason: reason || null }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: valid ? 'رسیدن به مقصد ثبت شد.' : 'رسیدن به مقصد با هشدار ثبت شد.', eventId: result.insertId, tripState: 'AT_DESTINATION', geofence: payload.geofence }, 201);
  }, { requireKey: true });
});

router.post('/trips/:tripId/location-events', platformAuth({ roles: [ROLES.DRIVER, ...COMPANY_X_OPERATION_ROLES, ROLES.COMPANY_Y_OWNER], permission: PERMISSIONS.SEE_LOCATION }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    if (normalizeRole(request.actor.role) === ROLES.DRIVER) {
      assertDriverTrip(request.actor, trip);
      await assertDriverTripAccepted(request, tripId);
      await assertDriverDevice(request);
    }
    if (trip.tracking_state !== 'ACTIVE') throw new DomainError('GPS-409', 'ارسال موقعیت فقط در سفر فعال مجاز است.', 409);
    const location = request.body?.location;
    if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) throw new DomainError('GPS-400', 'مختصات موقعیت معتبر نیست.', 400);
    const type = String(request.body?.eventType || 'LOCATION_REPORTED');
    const payload = { location: { lat: Number(location.lat), lng: Number(location.lng), accuracy: location.accuracy || null }, eta: request.body?.eta || null, milestone: request.body?.milestone || null, delayFlags: Array.isArray(request.body?.delayFlags) ? request.body.delayFlags : [], source: 'driver_phone_gps' };
    await pool.execute(`INSERT INTO platform_trip_events (tenant_id, trip_id, event_type, actor_user_id, location_json, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, [request.actor.tenantId, tripId, type, request.actor.userId, JSON.stringify(payload.location), JSON.stringify(payload)]);
    await pool.execute(`UPDATE trip_cases SET last_location_json = ?, last_location_at = NOW(), eta_at = ?, last_milestone = ?, delay_flags = ? WHERE id = ? AND tenant_id = ?`, [JSON.stringify(payload.location), safeDate(payload.eta), payload.milestone, JSON.stringify(payload.delayFlags), tripId, request.actor.tenantId]);
    const eventName = type === 'GPS_INTERRUPTED' ? 'GPSInterrupted' : type === 'ROUTE_DEVIATION' ? 'RouteDeviationDetected' : type === 'BORDER_EVENT' ? 'BorderEventRecorded' : 'BorderEventRecorded';
    await event(request, { eventName, entityType: 'trip', entityId: tripId, payload: { eventType: type, location: payload.location }, recipientOrgId: trip.x_org_id });
    return jsonResponse({ message: 'رویداد موقعیت ثبت شد.', tripId, eventType: type, receivedAt: new Date().toISOString() });
  }, { requireKey: true });
});

router.get('/trips/:tripId/tracking', platformAuth({ permission: PERMISSIONS.SEE_LOCATION }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    if (isAgentActor(request.actor)) await assertAgentAssignment(request, trip, 'read_case');
    const raw = parseJson(trip.last_location_json, null);
    const canSeeRaw = trip.tracking_state === 'ACTIVE' && ([trip.x_org_id, trip.y_org_id].includes(request.actor.organizationId) || (normalizeRole(request.actor.role) === ROLES.DRIVER && String(trip.driver_id) === String(request.actor.externalId)) || normalizeRole(request.actor.role) === ROLES.RISK_MANAGER);
    const [events] = await pool.execute(`SELECT event_type, payload_json, created_at FROM platform_trip_events WHERE tenant_id = ? AND trip_id = ? ORDER BY created_at DESC LIMIT 50`, [request.actor.tenantId, tripId]);
    const timeline = events.map((entry) => ({ eventType: entry.event_type, payload: parseJson(entry.payload_json, {}), createdAt: entry.created_at })).map((entry) => ({ ...entry, payload: isAgentActor(request.actor) ? { milestone: entry.payload.milestone || entry.payload.borderEvent || entry.payload.geofence || null } : canSeeRaw || isShipperActor(request.actor) ? { ...entry.payload, location: isShipperActor(request.actor) ? undefined : entry.payload.location } : { ...entry.payload, location: undefined } }));
    return response.json({
      trip: publicTrip(trip),
      state: trip.state,
      eta: trip.eta_at || null,
      lastMilestone: trip.last_milestone || null,
      delayFlags: parseJson(trip.delay_flags, []),
      timeline,
      location: canSeeRaw ? raw : null,
      locationAvailable: Boolean(raw && trip.tracking_state === 'ACTIVE'),
      masked: !canSeeRaw
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

async function assertDocumentScope(request, { caseId = null, tripId = null, ownerOrgId = null, docType = null } = {}) {
  if (caseId) {
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
  }
  if (tripId) {
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
  }
  if (ownerOrgId && ownerOrgId !== request.actor.organizationId && normalizeRole(request.actor.role) !== ROLES.DRIVER && !['compliance_officer', 'finance_admin'].includes(normalizeRole(request.actor.role))) {
    throw new DomainError('AUTH-403', 'مالک سند در محدوده سازمانی شما نیست.', 403);
  }
  if (isCompanyYActor(request.actor) && docType && !canCompanyYSeeDocument({ doc_type: docType })) {
    throw new DomainError('AUTH-403', 'این سند خارج از دامنه اسناد عملیاتی شرکت Y است.', 403);
  }
  if (normalizeRole(request.actor.role) === ROLES.DRIVER && (!tripId || !DRIVER_TRAVEL_DOCUMENT_TYPES.has(String(docType || '').toUpperCase()))) {
    throw new DomainError('AUTH-403', 'راننده فقط نسخه‌های سفر و اسناد لازم برای حرکت را می‌بیند.', 403);
  }
  if (isAgentActor(request.actor)) {
    if (!tripId || !AGENT_DOCUMENT_TYPES.has(String(docType || '').toUpperCase())) throw new DomainError('AUTH-403', 'Agent فقط اسناد مقصد در سفر تخصیص‌یافته را می‌بیند.', 403);
    const trip = await loadTrip(tripId, request.actor.tenantId);
    await assertAgentTrip(request, trip, 'read_case');
  }
  if (isShipperActor(request.actor) && docType && !CUSTOMER_DOCUMENT_TYPES.has(String(docType).toUpperCase())) {
    throw new DomainError('AUTH-403', 'این سند داخلی بازار یا سازمان دیگری است.', 403);
  }
}

router.post('/documents', platformAuth({ permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const input = request.body || {};
    const caseId = input.caseId ? parsePositiveId(input.caseId, 'شناسه پرونده') : null;
    const tripId = input.tripId ? parsePositiveId(input.tripId, 'شناسه سفر') : null;
    const docType = String(input.docType || '').trim().toUpperCase();
    const fileRef = String(input.fileRef || '').trim();
    const fileHash = String(input.fileHash || '').trim().toLowerCase();
    if (!caseId && !tripId) throw new DomainError('DOC-400', 'سند باید به پرونده یا سفر متصل باشد.', 400);
    if (!docType || !fileRef || !/^[a-f0-9]{64}$/.test(fileHash)) throw new DomainError('DOC-400', 'نوع سند، مرجع فایل و hash شصت‌وچهار رقمی الزامی است.', 400);
    if (['CMR_DRAFT', 'CMR_FINAL'].includes(docType)) throw new DomainError('DOC-403', 'CMR Draft و CMR نهایی فقط از workflow اختصاصی خود صادر می‌شوند.', 403);
    if (isShipperActor(request.actor) && !CUSTOMER_UPLOAD_DOCUMENT_TYPES.has(docType)) throw new DomainError('DOC-403', 'این نوع سند از پنل مشتری قابل صدور نیست.', 403);
    if (isCompanyYActor(request.actor) && (!isCompanyYDocumentIssuer(request.actor) || !COMPANY_Y_UPLOAD_DOCUMENT_TYPES.has(docType))) throw new DomainError('DOC-403', 'این نوع سند فقط توسط صادرکننده اسناد شرکت Y و در دامنه عملیاتی آن قابل ثبت است.', 403);
    if (isAgentActor(request.actor) && (!tripId || !AGENT_DOCUMENT_TYPES.has(docType) || docType === 'CMR_FINAL')) throw new DomainError('DOC-403', 'این نوع سند در دامنه Agent مقصد قابل ثبت نیست.', 403);
    await assertDocumentScope(request, { caseId, tripId, docType });
    const ownerOrgId = request.actor.organizationId;
    const [versionRows] = await pool.execute(
      `SELECT COALESCE(MAX(version_no), 0) AS max_version FROM platform_documents
       WHERE tenant_id = ? AND doc_type = ? AND ((case_id = ? AND ? IS NOT NULL) OR (trip_id = ? AND ? IS NOT NULL))`,
      [request.actor.tenantId, docType, caseId, caseId, tripId, tripId]
    );
    const versionNo = Number(versionRows[0]?.max_version || 0) + 1;
    const state = String(input.state || 'DRAFT').toUpperCase();
    if (!['DRAFT', 'SUBMITTED'].includes(state)) throw new DomainError(ERROR_CODES.DOCUMENT_LOCKED, 'سند جدید فقط می‌تواند در وضعیت پیش‌نویس یا ارسال‌شده ایجاد شود.', 423);
    const [result] = await pool.execute(
      `INSERT INTO platform_documents
        (tenant_id, case_id, trip_id, doc_type, owner_org_id, uploader_user_id, version_no, state, sensitivity, deadline_at, file_ref, file_hash, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.actor.tenantId, caseId, tripId, docType, ownerOrgId, request.actor.userId, versionNo, state, String(input.sensitivity || 'P1'), safeDate(input.deadlineAt), fileRef, fileHash, JSON.stringify(input.metadata || {})]
    );
    await event(request, { eventName: docType === 'CMR_DRAFT' ? 'CMRDraftCreated' : 'LoadingEvidenceSubmitted', entityType: 'document', entityId: result.insertId, payload: { caseId, tripId, docType, versionNo }, recipientOrgId: ownerOrgId });
    return jsonResponse({ message: 'نسخه جدید سند ثبت شد.', document: { id: result.insertId, docType, versionNo, state, locked: false } }, 201);
  }, { requireKey: true });
});

router.get('/documents/:documentId', platformAuth({ permission: PERMISSIONS.SEE_DOCUMENTS }), async (request, response) => {
  try {
    const documentId = parsePositiveId(request.params.documentId, 'شناسه سند');
    const [rows] = await pool.execute('SELECT * FROM platform_documents WHERE id = ? AND tenant_id = ? LIMIT 1', [documentId, request.actor.tenantId]);
    const document = rows[0];
    if (!document) throw new DomainError('DOC-404', 'سند پیدا نشد.', 404);
    await assertDocumentScope(request, { caseId: document.case_id, tripId: document.trip_id, docType: document.doc_type });
    if (isAgentActor(request.actor)) await audit(request, { eventType: 'DocumentViewed', subjectType: 'document', subjectId: documentId, payload: { caseId: document.case_id, tripId: document.trip_id, docType: document.doc_type, versionNo: document.version_no, surface: 'agent_z' } });
    return response.json({
      id: document.id,
      caseId: document.case_id,
      tripId: document.trip_id,
      docType: document.doc_type,
      versionNo: document.version_no,
      state: document.state,
      sensitivity: document.sensitivity,
      ownerOrgId: document.owner_org_id,
      uploaderUserId: document.uploader_user_id,
      approverUserId: document.approver_user_id,
      deadlineAt: document.deadline_at,
      fileHash: document.file_hash,
      fileRef: document.file_ref,
      metadata: isAgentActor(request.actor) ? publicAgentDocument(document).metadata : parseJson(document.metadata_json, {}),
      lockedAt: document.locked_at,
      createdAt: document.created_at
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/documents/:documentId/approve', platformAuth({ permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const documentId = parsePositiveId(request.params.documentId, 'شناسه سند');
    const [rows] = await pool.execute('SELECT * FROM platform_documents WHERE id = ? AND tenant_id = ? LIMIT 1', [documentId, request.actor.tenantId]);
    const document = rows[0];
    if (!document) throw new DomainError('DOC-404', 'سند پیدا نشد.', 404);
    await assertDocumentScope(request, { caseId: document.case_id, tripId: document.trip_id, docType: document.doc_type });
    if (document.state === 'APPROVED' || document.locked_at) throw new DomainError(ERROR_CODES.DOCUMENT_LOCKED, 'نسخه تأییدشده قفل است و قابل تغییر نیست.', 423);
    const actorRole = normalizeRole(request.actor.role);
    if (isCompanyYActor(request.actor) && (!isCompanyYDocumentIssuer(request.actor) || document.owner_org_id !== request.actor.organizationId || !canCompanyYSeeDocument(document))) {
      throw new DomainError('DOC-403', 'تأیید این سند در دامنه صادرکننده اسناد شرکت Y نیست.', 403);
    }
    if (document.doc_type === 'CMR_DRAFT') {
      const caseItem = await loadCase(document.case_id, request.actor.tenantId);
      if (request.actor.organizationId !== caseItem.owner_org_id || ![ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER].includes(actorRole)) {
        throw new DomainError('DOC-403', 'تأیید Draft CMR فقط توسط مشتری صاحب پرونده انجام می‌شود.', 403);
      }
      assertDelegated(request.actor, 'approveCmr');
    }
    if (request.actor.organizationType === 'shipper' && ![ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER].includes(actorRole)) throw new DomainError('DOC-403', 'تأیید اسناد در پنل مشتری برای کاربر مالی یا گیرنده مجاز نیست.', 403);
    if (!['CMR_DRAFT', 'COMMERCIAL_DOC', 'POD_EVIDENCE'].includes(document.doc_type) && !['compliance_officer', 'company_x_document_expert', 'company_y_document_issuer'].includes(normalizeRole(request.actor.role))) {
      throw new DomainError('DOC-403', 'این نقش اجازه تأیید نوع سند را ندارد.', 403);
    }
    await pool.execute(`UPDATE platform_documents SET state = 'APPROVED', approver_user_id = ?, locked_at = NOW() WHERE id = ? AND tenant_id = ? AND state <> 'APPROVED' AND locked_at IS NULL`, [request.actor.userId, documentId, request.actor.tenantId]);
    const eventName = document.doc_type === 'CMR_DRAFT' ? 'CMRDraftApproved' : 'CMRIssued';
    await event(request, { eventName, entityType: 'document', entityId: documentId, payload: { docType: document.doc_type, versionNo: document.version_no }, recipientOrgId: document.owner_org_id });
    return jsonResponse({ message: 'نسخه سند تأیید و قفل شد.', documentId, state: 'APPROVED', locked: true });
  }, { requireKey: true });
});

router.post('/documents/:documentId/reject', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const documentId = parsePositiveId(request.params.documentId, 'شناسه سند');
    const [rows] = await pool.execute('SELECT * FROM platform_documents WHERE id = ? AND tenant_id = ? LIMIT 1', [documentId, request.actor.tenantId]);
    const document = rows[0];
    if (!document) throw new DomainError('DOC-404', 'سند پیدا نشد.', 404);
    if (document.doc_type !== 'CMR_DRAFT') throw new DomainError('DOC-403', 'رد این نوع سند از پنل مشتری مجاز نیست.', 403);
    const item = await loadCase(document.case_id, request.actor.tenantId);
    assertOrganizationScope(request.actor, item.owner_org_id);
    assertDelegated(request.actor, 'approveCmr');
    if (document.state === 'APPROVED' || document.locked_at) throw new DomainError(ERROR_CODES.DOCUMENT_LOCKED, 'نسخه تأییدشده Draft CMR قابل رد یا تغییر نیست.', 423);
    if (!['SUBMITTED', 'DRAFT', 'RETURNED'].includes(document.state)) throw new DomainError('DOC-409', 'این نسخه در صف بررسی مشتری نیست.', 409);
    const reason = String(request.body?.reason || '').trim();
    if (reason.length < 8) throw new DomainError('DOC-400', 'دلیل رد Draft CMR الزامی است.', 400);
    await pool.execute(`UPDATE platform_documents SET state = 'RETURNED', metadata_json = JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.rejectionReason', ?, '$.rejectedBy', ?) WHERE id = ? AND tenant_id = ? AND locked_at IS NULL`, [reason, request.actor.userId, documentId, request.actor.tenantId]);
    await event(request, { eventName: 'CMRDraftRejected', entityType: 'document', entityId: documentId, payload: { caseId: document.case_id, versionNo: document.version_no, reason }, recipientOrgId: item.x_org_id });
    return jsonResponse({ message: 'Draft CMR برای اصلاح برگشت داده شد.', documentId, versionNo: document.version_no, state: 'RETURNED' });
  }, { requireKey: true });
});

router.get('/documents/:documentId/download', platformAuth({ permission: PERMISSIONS.DOWNLOAD }), async (request, response) => {
  try {
    const documentId = parsePositiveId(request.params.documentId, 'شناسه سند');
    const [rows] = await pool.execute('SELECT * FROM platform_documents WHERE id = ? AND tenant_id = ? LIMIT 1', [documentId, request.actor.tenantId]);
    const document = rows[0];
    if (!document) throw new DomainError('DOC-404', 'سند پیدا نشد.', 404);
    await assertDocumentScope(request, { caseId: document.case_id, tripId: document.trip_id, docType: document.doc_type });
    const expiresAt = addMinutes(new Date(), 5);
    const downloadToken = randomBytes(24).toString('base64url');
    await audit(request, { eventType: 'DocumentDownloaded', subjectType: 'document', subjectId: documentId, payload: { caseId: document.case_id, tripId: document.trip_id, versionNo: document.version_no, expiresAt } });
    return response.json({ documentId, versionNo: document.version_no, fileRef: document.file_ref, downloadToken, expiresAt });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/cases/:caseId/cmr-draft', platformAuth({ roles: [ROLES.COMPANY_X_DOCUMENT_EXPERT, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_X_OWNER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, item.x_org_id);
    if (item.commercial_state !== 'CUSTOMER_CONTRACTED') throw new DomainError('DOC-409', 'CMR Draft پس از قرارداد مشتری ایجاد می‌شود.', 409);
    const sourceSnapshot = request.body?.sourceSnapshot || { caseNumber: item.case_number, cargo: { type: item.cargo_type, weight: item.cargo_weight }, route: [item.origin_location, item.destination_location] };
    const sourceConflicts = [];
    if (sourceSnapshot.caseNumber && sourceSnapshot.caseNumber !== item.case_number) sourceConflicts.push('caseNumber');
    if (sourceSnapshot.cargo?.type && sourceSnapshot.cargo.type !== item.cargo_type) sourceConflicts.push('cargo.type');
    if (sourceSnapshot.cargo?.weight !== undefined && Number(sourceSnapshot.cargo.weight) !== Number(item.cargo_weight)) sourceConflicts.push('cargo.weight');
    if (Array.isArray(sourceSnapshot.route) && sourceSnapshot.route.length >= 2 && (sourceSnapshot.route[0] !== item.origin_location || sourceSnapshot.route[1] !== item.destination_location)) sourceConflicts.push('route');
    if (sourceConflicts.length) throw new DomainError('DOC-422', 'Draft CMR با SourceDocs پرونده سازگار نیست.', 422, { conflicts: sourceConflicts });
    const fileHash = String(request.body?.fileHash || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new DomainError('DOC-400', 'hash نسخه CMR Draft الزامی است.', 400);
    const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM platform_documents WHERE tenant_id = ? AND case_id = ? AND doc_type = 'CMR_DRAFT'`, [request.actor.tenantId, caseId]);
    const versionNo = Number(versions[0]?.max_version || 0) + 1;
    const [result] = await pool.execute(
      `INSERT INTO platform_documents
        (tenant_id, case_id, doc_type, owner_org_id, uploader_user_id, version_no, state, sensitivity, file_ref, file_hash, metadata_json)
       VALUES (?, ?, 'CMR_DRAFT', ?, ?, ?, 'SUBMITTED', 'P2', ?, ?, ?)`,
      [request.actor.tenantId, caseId, request.actor.organizationId, request.actor.userId, versionNo, String(request.body?.fileRef || `cmr-draft/${item.case_number}/${versionNo}`), fileHash, JSON.stringify({ sourceSnapshot, consistency: 'passed' })]
    );
    await event(request, { eventName: 'CMRDraftCreated', entityType: 'document', entityId: result.insertId, payload: { caseId, versionNo, sourceSnapshot }, recipientOrgId: item.owner_org_id });
    return jsonResponse({ message: 'پیش‌نویس CMR برای بررسی مشتری ایجاد شد.', documentId: result.insertId, versionNo, state: 'SUBMITTED' }, 201);
  }, { requireKey: true });
});

router.post('/trips/:tripId/final-cmr', platformAuth({ roles: COMPANY_Y_DOCUMENT_ROLES, permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, trip.y_org_id);
    if (!trip.y_award_accepted_at) throw new DomainError('AWD-409', 'ابتدا باید Award ظرفیت توسط شرکت Y پذیرفته شود.', 409);
    const [drafts] = await pool.execute(`SELECT id, version_no, state FROM platform_documents WHERE case_id = ? AND tenant_id = ? AND doc_type = 'CMR_DRAFT' AND state = 'APPROVED' ORDER BY version_no DESC LIMIT 1`, [trip.case_id, request.actor.tenantId]);
    if (!drafts[0]) throw new DomainError('DOC-423', 'CMR Draft تأییدشده پیدا نشد.', 423);
    if (request.body?.sourceDraftId && String(request.body.sourceDraftId) !== String(drafts[0].id)) throw new DomainError('DOC-423', 'Final CMR باید از آخرین Draft تأییدشده ایجاد شود.', 423);
    if (request.body?.sourceDraftVersion && Number(request.body.sourceDraftVersion) !== Number(drafts[0].version_no)) throw new DomainError('DOC-423', 'نسخه Draft مرجع با نسخه تأییدشده منطبق نیست.', 423);
    const fileHash = String(request.body?.fileHash || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new DomainError('DOC-400', 'hash نسخه نهایی CMR الزامی است.', 400);
    const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM platform_documents WHERE tenant_id = ? AND trip_id = ? AND doc_type = 'CMR_FINAL'`, [request.actor.tenantId, tripId]);
    const versionNo = Number(versions[0]?.max_version || 0) + 1;
    const [result] = await pool.execute(
      `INSERT INTO platform_documents
        (tenant_id, case_id, trip_id, doc_type, owner_org_id, uploader_user_id, version_no, state, sensitivity, file_ref, file_hash, metadata_json)
       VALUES (?, ?, ?, 'CMR_FINAL', ?, ?, ?, 'APPROVED', 'P2', ?, ?, ?)`,
      [request.actor.tenantId, trip.case_id, tripId, request.actor.organizationId, request.actor.userId, versionNo, String(request.body?.fileRef || `cmr-final/${trip.case_number}/${versionNo}`), fileHash, JSON.stringify({ sourceDraftId: drafts[0].id, sourceDraftVersion: drafts[0].version_no, issuerOrgId: request.actor.organizationId, issuedByRole: normalizeRole(request.actor.role) })]
    );
    await pool.execute(`UPDATE platform_documents SET locked_at = NOW(), approver_user_id = ? WHERE id = ? AND tenant_id = ?`, [request.actor.userId, result.insertId, request.actor.tenantId]);
    await event(request, { eventName: 'CMRIssued', entityType: 'document', entityId: result.insertId, payload: { tripId, sourceDraftId: drafts[0].id, versionNo }, recipientOrgId: trip.x_org_id });
    return jsonResponse({ message: 'CMR نهایی برای سفر صادر شد.', documentId: result.insertId, versionNo, state: 'APPROVED' }, 201);
  }, { requireKey: true });
});

router.post('/driver/trips/:tripId/delivery/otp/request', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    if (!['AT_DESTINATION', 'READY_FOR_DELIVERY'].includes(trip.state)) throw new DomainError('POD-409', 'OTP فقط در مرحله تحویل مقصد قابل درخواست است.', 409);
    if (!trip.authorized_agent_org_id) throw new DomainError('POD-424', 'گیرنده مجاز برای این سفر هنوز تعیین نشده است.', 424);
    const challenge = randomBytes(24).toString('base64url');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = addMinutes(new Date(), 10);
    await pool.execute(`UPDATE driver_delivery_otps SET state = 'EXPIRED' WHERE tenant_id = ? AND trip_id = ? AND driver_id = ? AND state = 'SENT'`, [request.actor.tenantId, tripId, request.actor.externalId]);
    const [result] = await pool.execute(`INSERT INTO driver_delivery_otps (tenant_id, trip_id, driver_id, challenge_hash, code_hash, state, expires_at) VALUES (?, ?, ?, ?, ?, 'SENT', ?)`, [request.actor.tenantId, tripId, request.actor.externalId, hashValue(challenge), hashValue(`${challenge}:${code}`), expiresAt]);
    await event(request, { eventName: 'DeliveryOtpRequested', entityType: 'driver_delivery_otp', entityId: result.insertId, payload: { tripId, caseId: trip.case_id, recipientOrgId: trip.authorized_agent_org_id, expiresAt }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'کد یک‌بارمصرف برای گیرنده مجاز صادر شد.', challengeId: challenge, expiresAt, deliveryMethod: 'configured-provider', ...(process.env.NODE_ENV === 'production' ? {} : { devCode: code }) }, 201);
  }, { requireKey: true });
});

router.post('/driver/trips/:tripId/delivery/otp/verify', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverTripAccepted(request, tripId);
    await assertDriverDevice(request);
    if (!['AT_DESTINATION', 'READY_FOR_DELIVERY'].includes(trip.state)) throw new DomainError('POD-409', 'OTP فقط در مرحله تحویل مقصد قابل تأیید است.', 409);
    const challengeId = String(request.body?.challengeId || '').trim();
    const code = String(request.body?.code || '').trim();
    if (!challengeId || !/^\d{6}$/.test(code)) throw new DomainError('OTP-400', 'چالش و کد یک‌بارمصرف معتبر لازم است.', 400);
    const [rows] = await pool.execute(`SELECT * FROM driver_delivery_otps WHERE tenant_id = ? AND trip_id = ? AND driver_id = ? AND challenge_hash = ? LIMIT 1`, [request.actor.tenantId, tripId, request.actor.externalId, hashValue(challengeId)]);
    const otp = rows[0];
    if (!otp) throw new DomainError('OTP-404', 'چالش یک‌بارمصرف پیدا نشد.', 404);
    if (otp.state !== 'SENT' || new Date(otp.expires_at) <= new Date()) {
      await pool.execute(`UPDATE driver_delivery_otps SET state = 'EXPIRED' WHERE id = ? AND tenant_id = ?`, [otp.id, request.actor.tenantId]);
      throw new DomainError(ERROR_CODES.OTP_EXPIRED, 'کد یک‌بارمصرف منقضی شده است.', 424);
    }
    if (Number(otp.attempts) >= 5) throw new DomainError('OTP-429', 'تعداد تلاش‌های کد یک‌بارمصرف به سقف رسیده است.', 429);
    if (hashValue(`${challengeId}:${code}`) !== otp.code_hash) {
      await pool.execute(`UPDATE driver_delivery_otps SET attempts = attempts + 1 WHERE id = ? AND tenant_id = ?`, [otp.id, request.actor.tenantId]);
      throw new DomainError('OTP-424', 'کد یک‌بارمصرف نادرست است.', 424);
    }
    await pool.execute(`UPDATE driver_delivery_otps SET state = 'VERIFIED', verified_at = NOW() WHERE id = ? AND tenant_id = ? AND state = 'SENT'`, [otp.id, request.actor.tenantId]);
    await event(request, { eventName: 'DeliveryOtpVerified', entityType: 'driver_delivery_otp', entityId: otp.id, payload: { tripId, caseId: trip.case_id, recipientOrgId: trip.authorized_agent_org_id }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'کد گیرنده تأیید شد.', challengeId, state: 'VERIFIED', verifiedAt: new Date().toISOString() });
  }, { requireKey: true });
});

router.get('/driver/trips/:tripId/delivery', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    const [agentRows] = trip.authorized_agent_org_id ? await pool.execute(`SELECT id, display_name, organization_type, status FROM platform_organizations WHERE id = ? AND tenant_id = ? LIMIT 1`, [trip.authorized_agent_org_id, request.actor.tenantId]) : [[]];
    const [podRows] = await pool.execute(`SELECT id, state, otp_verified, evidence_version_no, recipient_org_id, authority_ref, reviewed_at FROM pod_cases WHERE tenant_id = ? AND trip_id = ? LIMIT 1`, [request.actor.tenantId, tripId]);
    const [otpRows] = await pool.execute(`SELECT id, state, expires_at, verified_at, attempts FROM driver_delivery_otps WHERE tenant_id = ? AND trip_id = ? AND driver_id = ? ORDER BY created_at DESC LIMIT 1`, [request.actor.tenantId, tripId, request.actor.externalId]);
    return response.json({ authorizedAgent: agentRows[0] ? { organizationId: agentRows[0].id, name: agentRows[0].display_name, type: agentRows[0].organization_type, status: agentRows[0].status } : null, pod: podRows[0] ? { id: podRows[0].id, state: podRows[0].state, otpVerified: Boolean(podRows[0].otp_verified), evidenceVersion: podRows[0].evidence_version_no, recipientOrgId: podRows[0].recipient_org_id, authorityRef: podRows[0].authority_ref, reviewedAt: podRows[0].reviewed_at } : null, otp: otpRows[0] ? { state: otpRows[0].state, expiresAt: otpRows[0].expires_at, verifiedAt: otpRows[0].verified_at, attempts: otpRows[0].attempts } : null });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/trips/:tripId/pod', platformAuth({ roles: [ROLES.DRIVER, ROLES.AGENT_Z, ROLES.CONSIGNEE], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    const driverActor = normalizeRole(request.actor.role) === ROLES.DRIVER;
    const agentActor = isAgentActor(request.actor);
    let agentAssignment = null;
    if (driverActor) {
      assertDriverTrip(request.actor, trip);
      await assertDriverTripAccepted(request, tripId);
      await assertDriverDevice(request);
    }
    if (agentActor) agentAssignment = await assertAgentTrip(request, trip, 'submit_pod', { device: true });
    if (!['AT_DESTINATION', 'READY_FOR_DELIVERY', 'DELIVERED'].includes(trip.state) && trip.delivery_state !== 'DELIVERED') throw new DomainError('POD-409', 'سفر هنوز در مرحله تحویل نیست.', 409);
    const evidence = { ...(request.body?.evidence || request.body || {}) };
    const casePayload = parseJson(trip.case_payload_json, {});
    const otpRequired = driverActor
      ? Boolean(request.body?.otpRequired ?? casePayload.delivery?.otpRequired ?? true)
      : agentActor
        ? Boolean(casePayload.delivery?.otpRequired ?? true) || request.body?.otpRequired === true
        : Boolean(request.body?.otpRequired);
    if ((driverActor || agentActor) && otpRequired) {
      const challengeId = String(request.body?.otpChallengeId || evidence.otpChallengeId || '').trim();
      if (!challengeId) throw new DomainError('OTP-424', 'برای تحویل این سفر تأیید گیرنده لازم است.', 424);
      const otpTable = agentActor ? 'agent_delivery_otps' : 'driver_delivery_otps';
      const otpWhere = agentActor ? `assignment_id = ?` : `driver_id = ?`;
      const otpSubject = agentActor ? agentAssignment.id : request.actor.externalId;
      const [otpRows] = await pool.execute(`SELECT id FROM ${otpTable} WHERE tenant_id = ? AND trip_id = ? AND ${otpWhere} AND challenge_hash = ? AND state = 'VERIFIED' AND expires_at >= NOW() LIMIT 1`, [request.actor.tenantId, tripId, otpSubject, hashValue(challengeId)]);
      if (!otpRows[0]) throw new DomainError('OTP-424', 'تأیید یک‌بارمصرف گیرنده معتبر نیست.', 424);
      evidence.otpVerified = true;
      evidence.otpChallengeId = challengeId;
    }
    if (agentActor) {
      const [verificationRows] = await pool.execute(`SELECT outcome, verification_json FROM agent_delivery_verifications WHERE tenant_id = ? AND trip_id = ? ORDER BY version_no DESC LIMIT 1`, [request.actor.tenantId, tripId]);
      if (verificationRows[0]?.outcome !== 'VERIFIED') throw new DomainError(ERROR_CODES.INCOMPLETE_POD, 'ابتدا احراز تحویل مقصد باید با نتیجه Verified ثبت شود.', 424);
      if (String(evidence.recipientOrgId || '') !== String(request.actor.organizationId) || String(evidence.authorityRef || '') !== String(agentAssignment.authority_ref)) throw new DomainError(ERROR_CODES.RECIPIENT_MISMATCH, 'گیرنده و مرجع اختیار POD با Assignment منطبق نیست.', 422);
      if (!evidence.signatureRef || !evidence.signedCmrRef) throw new DomainError(ERROR_CODES.INCOMPLETE_POD, 'امضای گیرنده و CMR رسیدشده برای ارسال POD الزامی است.', 424);
      evidence.recipientOrgId = request.actor.organizationId;
      evidence.authorityRef = agentAssignment.authority_ref;
    }
    validatePodEvidence(evidence, { authorizedAgentOrgId: trip.authorized_agent_org_id, otpRequired });
    const [existing] = await pool.execute(`SELECT id, state, evidence_version_no FROM pod_cases WHERE trip_id = ? AND tenant_id = ? LIMIT 1`, [tripId, request.actor.tenantId]);
    let podId;
    let evidenceVersion = 1;
    if (existing[0] && existing[0].state !== 'RETURNED') throw new DomainError('POD-409', 'برای این سفر POD قبلاً ارسال شده است.', 409);
    if (existing[0]) {
      const [versions] = await pool.execute(`SELECT COALESCE(MAX(version_no), 0) AS max_version FROM pod_evidence_versions WHERE tenant_id = ? AND pod_id = ?`, [request.actor.tenantId, existing[0].id]);
      evidenceVersion = Number(versions[0]?.max_version || existing[0].evidence_version_no || 0) + 1;
      await pool.execute(`INSERT INTO pod_evidence_versions (tenant_id, pod_id, version_no, evidence_json, submitted_by_user_id) VALUES (?, ?, ?, ?, ?)`, [request.actor.tenantId, existing[0].id, evidenceVersion, JSON.stringify(evidence), request.actor.userId]);
      await pool.execute(`UPDATE pod_cases SET state = 'SUBMITTED', submitted_by_user_id = ?, recipient_org_id = ?, authority_ref = ?, otp_verified = ?, evidence_version_no = ?, reviewed_by_user_id = NULL, reviewed_at = NULL WHERE id = ? AND tenant_id = ? AND state = 'RETURNED'`, [request.actor.userId, evidence.recipientOrgId, evidence.authorityRef, evidence.otpVerified ? 1 : 0, evidenceVersion, existing[0].id, request.actor.tenantId]);
      podId = existing[0].id;
    } else {
      const [result] = await pool.execute(
        `INSERT INTO pod_cases
          (tenant_id, trip_id, state, submitted_by_user_id, recipient_org_id, authority_ref, otp_verified, evidence_json, evidence_version_no)
         VALUES (?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, 1)`,
        [request.actor.tenantId, tripId, request.actor.userId, evidence.recipientOrgId, evidence.authorityRef, evidence.otpVerified ? 1 : 0, JSON.stringify(evidence)]
      );
      podId = result.insertId;
      await pool.execute(`INSERT INTO pod_evidence_versions (tenant_id, pod_id, version_no, evidence_json, submitted_by_user_id) VALUES (?, ?, 1, ?, ?)`, [request.actor.tenantId, podId, JSON.stringify(evidence), request.actor.userId]);
    }
    await pool.execute(`UPDATE shipment_cases SET delivery_state = 'POD_SUBMITTED', state = 'POD_SUBMITTED' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    if (trip.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I12_DOMESTIC_DELIVERY' WHERE id = ? AND tenant_id = ?`, [trip.case_id, request.actor.tenantId]);
    await event(request, { eventName: 'PODSubmitted', entityType: 'pod', entityId: podId, payload: { tripId, recipientOrgId: evidence.recipientOrgId, evidenceCount: (evidence.photos || []).length, evidenceVersion }, recipientOrgId: trip.x_org_id });
    return jsonResponse({ message: 'POD برای بررسی شرکت X ارسال شد.', podId, evidenceVersion, state: 'POD_SUBMITTED' }, 201);
  }, { requireKey: true });
});

router.post('/pods/:podId/accept', platformAuth({ roles: [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_X_DOCUMENT_EXPERT], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const podId = parsePositiveId(request.params.podId, 'شناسه POD');
    const [rows] = await pool.execute(
      `SELECT p.*, v.evidence_json AS current_evidence_json, t.case_id, t.x_org_id, t.y_org_id, t.authorized_agent_org_id, c.direction, c.delivery_state
         FROM pod_cases p LEFT JOIN pod_evidence_versions v ON v.pod_id = p.id AND v.tenant_id = p.tenant_id AND v.version_no = p.evidence_version_no
         JOIN trip_cases t ON t.id = p.trip_id AND t.tenant_id = p.tenant_id
         JOIN shipment_cases c ON c.id = t.case_id AND c.tenant_id = t.tenant_id
        WHERE p.id = ? AND p.tenant_id = ? LIMIT 1`,
      [podId, request.actor.tenantId]
    );
    const pod = rows[0];
    if (!pod) throw new DomainError('POD-404', 'POD پیدا نشد.', 404);
    const trip = await loadTrip(pod.trip_id, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, pod.x_org_id);
    if (pod.state !== 'SUBMITTED') throw new DomainError('POD-409', 'POD در وضعیت بررسی نیست.', 409);
    validatePodEvidence(parseJson(pod.current_evidence_json || pod.evidence_json, {}), { authorizedAgentOrgId: pod.authorized_agent_org_id, otpRequired: Boolean(pod.otp_verified) });
    await pool.execute(`UPDATE pod_cases SET state = 'ACCEPTED', reviewed_by_user_id = ?, reviewed_at = NOW() WHERE id = ? AND tenant_id = ? AND state = 'SUBMITTED'`, [request.actor.userId, podId, request.actor.tenantId]);
    await pool.execute(`UPDATE shipment_cases SET delivery_state = 'POD_ACCEPTED', financial_state = 'SETTLEMENT_PENDING', state = 'POD_ACCEPTED' WHERE id = ? AND tenant_id = ?`, [pod.case_id, request.actor.tenantId]);
    await pool.execute(`UPDATE trip_cases SET tracking_state = 'INACTIVE', state = 'READY_FOR_DELIVERY' WHERE id = ? AND tenant_id = ?`, [pod.trip_id, request.actor.tenantId]);
    await pool.execute(`UPDATE drivers d JOIN trip_cases t ON t.driver_id = d.id AND t.tenant_id = d.tenant_id SET d.availability_state = 'available' WHERE t.id = ? AND t.tenant_id = ?`, [pod.trip_id, request.actor.tenantId]);
    await pool.execute(`UPDATE vehicles v JOIN trip_cases t ON t.vehicle_id = v.id AND t.tenant_id = v.tenant_id SET v.availability_state = 'available' WHERE t.id = ? AND t.tenant_id = ?`, [pod.trip_id, request.actor.tenantId]);
    if (pod.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I13_SETTLEMENT' WHERE id = ? AND tenant_id = ?`, [pod.case_id, request.actor.tenantId]);
    await event(request, { eventName: 'PODAccepted', entityType: 'pod', entityId: podId, payload: { tripId: pod.trip_id, caseId: pod.case_id, settlementState: 'SETTLEMENT_PENDING' }, recipientOrgId: pod.y_org_id });
    return jsonResponse({ message: 'POD کافی تشخیص داده شد و شرط تسویه به‌روزرسانی شد.', podId, state: 'POD_ACCEPTED', financialState: 'SETTLEMENT_PENDING' });
  }, { requireKey: true });
});

router.post('/pods/:podId/return', platformAuth({ roles: COMPANY_X_POD_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const podId = parsePositiveId(request.params.podId, 'شناسه POD');
    const [rows] = await pool.execute(`SELECT p.*, t.case_id, t.x_org_id, t.y_org_id FROM pod_cases p JOIN trip_cases t ON t.id = p.trip_id AND t.tenant_id = p.tenant_id WHERE p.id = ? AND p.tenant_id = ? LIMIT 1`, [podId, request.actor.tenantId]);
    const pod = rows[0];
    if (!pod) throw new DomainError('POD-404', 'POD پیدا نشد.', 404);
    const trip = await loadTrip(pod.trip_id, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, pod.x_org_id);
    if (pod.state !== 'SUBMITTED') throw new DomainError('POD-409', 'فقط POD ارسالی قابل برگشت است.', 409);
    const reason = String(request.body?.reason || '').trim();
    if (reason.length < 8) throw new DomainError(ERROR_CODES.INCOMPLETE_POD, 'دلیل بازگشت POD الزامی است.', 424);
    await pool.execute(`UPDATE pod_cases SET state = 'RETURNED', reviewed_by_user_id = ?, reviewed_at = NOW() WHERE id = ? AND tenant_id = ? AND state = 'SUBMITTED'`, [request.actor.userId, podId, request.actor.tenantId]);
    await pool.execute(`UPDATE shipment_cases SET delivery_state = 'POD_SUBMITTED', state = 'POD_SUBMITTED' WHERE id = ? AND tenant_id = ?`, [pod.case_id, request.actor.tenantId]);
    await event(request, { eventName: 'PODReturned', entityType: 'pod', entityId: podId, payload: { tripId: pod.trip_id, caseId: pod.case_id, reason }, recipientOrgId: pod.y_org_id });
    return jsonResponse({ message: 'POD برای تکمیل شواهد برگشت داده شد.', podId, state: 'RETURNED', reason });
  }, { requireKey: true });
});

router.post('/pods/:podId/risk-flag', platformAuth({ roles: COMPANY_X_POD_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const podId = parsePositiveId(request.params.podId, 'شناسه POD');
    const [rows] = await pool.execute(`SELECT p.*, t.case_id, t.x_org_id, t.y_org_id FROM pod_cases p JOIN trip_cases t ON t.id = p.trip_id AND t.tenant_id = p.tenant_id WHERE p.id = ? AND p.tenant_id = ? LIMIT 1`, [podId, request.actor.tenantId]);
    const pod = rows[0];
    if (!pod) throw new DomainError('POD-404', 'POD پیدا نشد.', 404);
    const trip = await loadTrip(pod.trip_id, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, pod.x_org_id);
    const reason = String(request.body?.reason || '').trim();
    if (reason.length < 8) throw new DomainError('RISK-400', 'دلیل پرچم ریسک الزامی است.', 400);
    const flag = { type: String(request.body?.flagType || 'RISK').toUpperCase(), reason, actorUserId: request.actor.userId, createdAt: new Date().toISOString() };
    const flags = parseJson(pod.risk_flags_json, []);
    flags.push(flag);
    await pool.execute(`UPDATE pod_cases SET risk_flags_json = ? WHERE id = ? AND tenant_id = ?`, [JSON.stringify(flags), podId, request.actor.tenantId]);
    await event(request, { eventName: flag.type === 'FRAUD' ? 'FraudFlagged' : 'RiskFlagged', entityType: 'pod', entityId: podId, payload: { tripId: pod.trip_id, caseId: pod.case_id, flag }, recipientOrgId: pod.y_org_id });
    return jsonResponse({ message: 'پرچم ریسک ثبت و Audit شد.', podId, riskFlags: flags });
  }, { requireKey: true });
});

router.get('/trips/:tripId/pod', platformAuth({ permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    if (isAgentActor(request.actor)) await assertAgentAssignment(request, trip, 'read_case');
    const [rows] = await pool.execute(`SELECT p.*, v.evidence_json AS current_evidence_json FROM pod_cases p LEFT JOIN pod_evidence_versions v ON v.pod_id = p.id AND v.tenant_id = p.tenant_id AND v.version_no = p.evidence_version_no WHERE p.id = (SELECT id FROM pod_cases WHERE trip_id = ? AND tenant_id = ? LIMIT 1) AND p.tenant_id = ? LIMIT 1`, [tripId, request.actor.tenantId, request.actor.tenantId]);
    const pod = rows[0];
    if (!pod) return response.json({ pod: null });
    const evidence = parseJson(pod.current_evidence_json || pod.evidence_json, {});
    const customerView = isShipperActor(request.actor);
    const agentView = isAgentActor(request.actor);
    const safeEvidence = customerView
      ? { ...evidence, location: undefined, locationScope: evidence.locationScope || evidence.location?.city || evidence.location?.scope || null }
      : agentView ? publicAgentPodEvidence(evidence) : evidence;
    const podRiskFlags = parseJson(pod.risk_flags_json, []);
    if (agentView) await audit(request, { eventType: 'PODViewed', subjectType: 'pod', subjectId: pod.id, payload: { tripId, evidenceVersion: pod.evidence_version_no || 1, surface: 'agent_z' } });
    return response.json({
      pod: {
        id: pod.id,
        tripId: pod.trip_id,
        state: pod.state,
        evidenceVersion: pod.evidence_version_no || 1,
        recipientOrgId: pod.recipient_org_id,
        authorityRef: pod.authority_ref,
        otpVerified: Boolean(pod.otp_verified),
        evidence: safeEvidence,
        riskFlagged: agentView ? Array.isArray(podRiskFlags) && podRiskFlags.length > 0 : undefined,
        riskFlags: agentView ? undefined : podRiskFlags,
        reviewedAt: pod.reviewed_at,
        createdAt: pod.created_at
      }
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/cases/:caseId/exceptions', platformAuth({ roles: [...COMPANY_X_ROLES, ...COMPANY_Y_ROLES], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, isCompanyYActor(request.actor) ? item.y_org_id : item.x_org_id);
    const [rows] = await pool.execute(`SELECT e.* FROM platform_exceptions e JOIN shipment_cases c ON c.id = e.case_id AND c.tenant_id = e.tenant_id WHERE e.tenant_id = ? AND e.case_id = ? AND (? = c.x_org_id OR ? = c.y_org_id OR ? = e.opened_by_org_id) ORDER BY e.created_at DESC`, [request.actor.tenantId, caseId, request.actor.organizationId, request.actor.organizationId, request.actor.organizationId]);
    return response.json({ exceptions: rows.map(publicException) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/trips/:tripId/exceptions', platformAuth({ roles: [...COMPANY_X_OPERATION_ROLES, ...COMPANY_Y_OWNER_ROLES], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertTripAccess(request.actor, trip);
    assertOrganizationScope(request.actor, isCompanyYActor(request.actor) ? trip.y_org_id : trip.x_org_id);
    const exceptionType = String(request.body?.exceptionType || '').trim().toUpperCase();
    const severity = String(request.body?.severity || 'medium').trim().toLowerCase();
    const reason = String(request.body?.reason || '').trim();
    if (!EXCEPTION_TYPES.has(exceptionType)) throw new DomainError('EXC-400', 'نوع Exception معتبر نیست.', 400);
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) throw new DomainError('EXC-400', 'شدت Exception معتبر نیست.', 400);
    if (reason.length < 8) throw new DomainError('EXC-400', 'دلیل Exception الزامی است.', 400);
    const [result] = await pool.execute(`INSERT INTO platform_exceptions (tenant_id, case_id, trip_id, exception_type, severity, status, reason, evidence_json, opened_by_user_id, opened_by_org_id) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`, [request.actor.tenantId, trip.case_id, tripId, exceptionType, severity, reason, JSON.stringify(request.body?.evidence || {}), request.actor.userId, request.actor.organizationId]);
    await event(request, { eventName: 'ExceptionOpened', entityType: 'platform_exception', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, exceptionType, severity }, recipientOrgId: isCompanyYActor(request.actor) ? trip.x_org_id : trip.y_org_id });
    return jsonResponse({ message: 'Exception عملیاتی ثبت شد.', exceptionId: result.insertId, state: 'OPEN' }, 201);
  }, { requireKey: true });
});

router.patch('/exceptions/:exceptionId', platformAuth({ roles: [...COMPANY_X_OPERATION_ROLES, ...COMPANY_Y_OWNER_ROLES], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const exceptionId = parsePositiveId(request.params.exceptionId, 'شناسه Exception');
    const [rows] = await pool.execute(`SELECT e.*, c.x_org_id, c.y_org_id FROM platform_exceptions e JOIN shipment_cases c ON c.id = e.case_id AND c.tenant_id = e.tenant_id WHERE e.id = ? AND e.tenant_id = ? LIMIT 1`, [exceptionId, request.actor.tenantId]);
    const exception = rows[0];
    if (!exception) throw new DomainError('EXC-404', 'Exception پیدا نشد.', 404);
    const item = await loadCase(exception.case_id, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, isCompanyYActor(request.actor) ? exception.y_org_id : exception.x_org_id);
    const status = request.body?.status ? String(request.body.status).toUpperCase() : exception.status;
    if (!['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED'].includes(status)) throw new DomainError('EXC-400', 'وضعیت Exception معتبر نیست.', 400);
    const reason = request.body?.reason === undefined ? exception.reason : String(request.body.reason).trim();
    if (reason.length < 8) throw new DomainError('EXC-400', 'دلیل Exception معتبر نیست.', 400);
    await pool.execute(`UPDATE platform_exceptions SET status = ?, reason = ? WHERE id = ? AND tenant_id = ?`, [status, reason, exceptionId, request.actor.tenantId]);
    await event(request, { eventName: 'ExceptionUpdated', entityType: 'platform_exception', entityId: exceptionId, payload: { caseId: exception.case_id, tripId: exception.trip_id, status }, recipientOrgId: exception.opened_by_org_id });
    return jsonResponse({ message: 'Exception به‌روزرسانی شد.', exceptionId, status });
  }, { requireKey: true });
});

router.get('/driver/settlements', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const driverId = driverIdFromActor(request.actor);
    const driverOrgId = `driver:${driverId}`;
    const [rows] = await pool.execute(
      `SELECT l.id, l.case_id, l.trip_id, l.relationship_type, l.payer_org_id, l.payee_org_id, l.amount, l.currency, l.state, l.evidence_json, l.created_at, l.updated_at, c.case_number, c.direction, t.y_org_id
         FROM relationship_ledgers l
         JOIN shipment_cases c ON c.id = l.case_id AND c.tenant_id = l.tenant_id
         LEFT JOIN trip_cases t ON t.id = l.trip_id AND t.tenant_id = l.tenant_id
        WHERE l.tenant_id = ? AND l.relationship_type = 'y_driver' AND (l.payer_org_id = ? OR l.payee_org_id = ?) AND (t.driver_id = ? OR (l.trip_id IS NULL AND l.case_id IN (SELECT case_id FROM trip_cases WHERE tenant_id = ? AND driver_id = ?)))
        ORDER BY l.updated_at DESC`,
      [request.actor.tenantId, driverOrgId, driverOrgId, driverId, request.actor.tenantId, driverId]
    );
    return response.json({ relationship: RELATIONSHIPS.Y_DRIVER, settlements: rows.map((row) => ({ id: row.id, caseId: row.case_id, tripId: row.trip_id, caseNumber: row.case_number, relationshipType: row.relationship_type, amount: row.amount, currency: row.currency, state: row.state, evidence: publicSettlementEvidence(row.evidence_json), counterpartyOrgId: row.payer_org_id === driverOrgId ? row.payee_org_id : row.payer_org_id, createdAt: row.created_at, updatedAt: row.updated_at })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/driver/settlements/:settlementId/dispute', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const driverId = driverIdFromActor(request.actor);
    await assertDriverDevice(request);
    const settlementId = parsePositiveId(request.params.settlementId, 'شناسه تسویه');
    const reason = String(request.body?.reason || '').trim();
    if (reason.length < 8) throw new DomainError('DSP-400', 'شرح اعتراض به تسویه الزامی است.', 400);
    const [rows] = await pool.execute(`SELECT l.*, t.driver_id, t.y_org_id FROM relationship_ledgers l JOIN trip_cases t ON t.id = l.trip_id AND t.tenant_id = l.tenant_id WHERE l.id = ? AND l.tenant_id = ? AND l.relationship_type = 'y_driver' LIMIT 1`, [settlementId, request.actor.tenantId]);
    const ledger = rows[0];
    if (!ledger || String(ledger.driver_id) !== String(driverId)) throw new DomainError('FIN-403', 'این تسویه به راننده فعلی مربوط نیست.', 403);
    const [claim] = await pool.execute(`INSERT INTO platform_claims (tenant_id, case_id, trip_id, case_type, status, reason, evidence_json, opened_by_user_id, opened_by_org_id) VALUES (?, ?, ?, 'DISPUTE', 'OPEN', ?, ?, ?, ?)`, [request.actor.tenantId, ledger.case_id, ledger.trip_id, reason, JSON.stringify(request.body?.evidence || {}), request.actor.userId, request.actor.organizationId]);
    await event(request, { eventName: 'DisputeOpened', entityType: 'case_issue', entityId: claim.insertId, payload: { caseId: ledger.case_id, tripId: ledger.trip_id, settlementId, caseType: 'DISPUTE' }, recipientOrgIds: [ledger.y_org_id] });
    return jsonResponse({ message: 'اعتراض به تسویه ثبت شد.', issueId: claim.insertId, settlementId, state: 'OPEN' }, 201);
  }, { requireKey: true });
});

router.post('/driver/trips/:tripId/claims', platformAuth({ roles: [ROLES.DRIVER], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const tripId = parsePositiveId(request.params.tripId, 'شناسه سفر');
    const trip = await loadTrip(tripId, request.actor.tenantId);
    assertDriverTrip(request.actor, trip);
    await assertDriverDevice(request);
    const reason = String(request.body?.reason || '').trim();
    if (reason.length < 8) throw new DomainError('CLM-400', 'شرح اعتراض یا خسارت الزامی است.', 400);
    const [result] = await pool.execute(`INSERT INTO platform_claims (tenant_id, case_id, trip_id, case_type, status, reason, evidence_json, opened_by_user_id, opened_by_org_id) VALUES (?, ?, ?, 'CLAIM', 'OPEN', ?, ?, ?, ?)`, [request.actor.tenantId, trip.case_id, tripId, reason, JSON.stringify(request.body?.evidence || {}), request.actor.userId, request.actor.organizationId]);
    await event(request, { eventName: 'ClaimOpened', entityType: 'case_issue', entityId: result.insertId, payload: { caseId: trip.case_id, tripId, caseType: 'CLAIM' }, recipientOrgIds: [trip.x_org_id, trip.y_org_id] });
    return jsonResponse({ message: 'اعتراض راننده ثبت شد.', issueId: result.insertId, tripId, state: 'OPEN' }, 201);
  }, { requireKey: true });
});

router.post('/settlements', platformAuth({ permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const caseId = parsePositiveId(request.body?.caseId, 'شناسه پرونده');
    const tripId = request.body?.tripId ? parsePositiveId(request.body.tripId, 'شناسه سفر') : null;
    const relationshipType = String(request.body?.relationshipType || '').trim();
    const payerOrgId = String(request.body?.payerOrgId || '').trim();
    const payeeOrgId = String(request.body?.payeeOrgId || '').trim();
    const amount = Number(request.body?.amount);
    if (!Object.values(RELATIONSHIPS).includes(relationshipType) || !payerOrgId || !payeeOrgId || !Number.isFinite(amount) || amount <= 0) throw new DomainError('FIN-400', 'رابطه مالی و مبلغ معتبر الزامی است.', 400);
    if (isCompanyYDocumentIssuer(request.actor)) throw new DomainError('FIN-403', 'متخصص اسناد شرکت Y به دفتر مالی دسترسی ندارد.', 403);
    if (isCompanyYOwner(request.actor) && ![RELATIONSHIPS.X_Y, RELATIONSHIPS.Y_DRIVER].includes(relationshipType)) throw new DomainError('FIN-403', 'شرکت Y فقط روابط X-Y و Y-Driver را ثبت می‌کند.', 403);
    assertRelationshipAccess(request.actor, { payerOrgId, payeeOrgId, relationshipType });
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    const trip = tripId ? await loadTrip(tripId, request.actor.tenantId) : null;
    if (trip) assertTripAccess(request.actor, trip);
    assertRelationshipCaseBoundary(item, trip, { relationshipType, payerOrgId, payeeOrgId });
    if (!['POD_ACCEPTED', 'SETTLEMENT_PENDING'].includes(item.delivery_state) && item.financial_state !== 'SETTLEMENT_PENDING') throw new DomainError(ERROR_CODES.SETTLEMENT_CONDITION_MISSING, 'شرط POD_ACCEPTED برای ثبت تسویه کامل نیست.', 424);
    await assertImportSettlementReady(item);
    const [result] = await pool.execute(`INSERT INTO relationship_ledgers (tenant_id, case_id, trip_id, relationship_type, payer_org_id, payee_org_id, amount, currency, state, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SETTLEMENT_PENDING', ?)`, [request.actor.tenantId, caseId, tripId, relationshipType, payerOrgId, payeeOrgId, amount, String(request.body?.currency || 'EUR').toUpperCase().slice(0, 3), JSON.stringify(request.body?.evidence || {})]);
    await event(request, { eventName: 'SettlementRequested', entityType: 'relationship_ledger', entityId: result.insertId, payload: { caseId, tripId, relationshipType, payerOrgId, payeeOrgId }, recipientOrgId: request.actor.organizationId === payerOrgId ? payeeOrgId : payerOrgId });
    return jsonResponse({ message: 'درخواست تسویه در دفتر رابطه ثبت شد.', settlementId: result.insertId, state: 'SETTLEMENT_PENDING' }, 201);
  }, { requireKey: true });
});

router.get('/cases/:caseId/settlements', platformAuth({ permission: PERMISSIONS.SEE_SETTLEMENT }), async (request, response) => {
  try {
    if (isCustomerCommercialActor(request.actor)) assertShipperOrganization(request.actor);
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    if (isAgentActor(request.actor)) {
      const assignedTrip = await loadTrip((await pool.execute(`SELECT id FROM trip_cases WHERE case_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1`, [caseId, request.actor.tenantId]))[0][0]?.id, request.actor.tenantId);
      await assertAgentAssignment(request, assignedTrip, 'read_settlement');
    }
    const [rows] = await pool.execute(`SELECT id, relationship_type, payer_org_id, payee_org_id, amount, currency, state, created_at, updated_at FROM relationship_ledgers WHERE tenant_id = ? AND case_id = ? ORDER BY created_at`, [request.actor.tenantId, caseId]);
    const customerView = isShipperActor(request.actor);
    const settlements = rows
      .filter((row) => [row.payer_org_id, row.payee_org_id].includes(request.actor.organizationId))
      .filter((row) => !isAgentActor(request.actor) || row.relationship_type === RELATIONSHIPS.X_AGENT)
      .filter((row) => !customerView || (row.relationship_type === RELATIONSHIPS.CUSTOMER_X && [item.owner_org_id, item.x_org_id].includes(request.actor.organizationId)))
      .map((row) => ({ ...row, amount: row.amount }));
    return response.json({ settlements });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/cases/:caseId/finance', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_FINANCE_USER, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.SEE_SETTLEMENT }), async (request, response) => {
  try {
    assertShipperOrganization(request.actor);
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    assertOrganizationScope(request.actor, item.owner_org_id);
    const [rows] = await pool.execute(`SELECT id, relationship_type, payer_org_id, payee_org_id, amount, currency, state, evidence_json, created_at, updated_at FROM relationship_ledgers WHERE tenant_id = ? AND case_id = ? AND relationship_type = 'customer_x' AND (payer_org_id = ? OR payee_org_id = ?) ORDER BY created_at`, [request.actor.tenantId, caseId, item.owner_org_id, item.owner_org_id]);
    return response.json({ relationship: RELATIONSHIPS.CUSTOMER_X, settlements: rows.map((row) => ({ ...row, evidence: publicSettlementEvidence(row.evidence_json) })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/settlements/:settlementId/confirm', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER, ROLES.SHIPPER_FINANCE_USER, ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_Y_OWNER, ROLES.FINANCE_ADMIN], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    if (isCustomerCommercialActor(request.actor)) assertShipperOrganization(request.actor);
    const settlementId = parsePositiveId(request.params.settlementId, 'شناسه تسویه');
    const [rows] = await pool.execute(`SELECT l.*, c.direction, c.owner_org_id, c.x_org_id, c.y_org_id, c.tir_state, c.delivery_state, c.financial_state FROM relationship_ledgers l JOIN shipment_cases c ON c.id = l.case_id AND c.tenant_id = l.tenant_id WHERE l.id = ? AND l.tenant_id = ? LIMIT 1`, [settlementId, request.actor.tenantId]);
    const ledger = rows[0];
    if (!ledger) throw new DomainError('FIN-404', 'رکورد تسویه پیدا نشد.', 404);
    const actorRole = normalizeRole(request.actor.role);
    const xActor = [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER].includes(actorRole);
    const yActor = actorRole === ROLES.COMPANY_Y_OWNER;
    if (xActor) {
      if (![RELATIONSHIPS.CUSTOMER_X, RELATIONSHIPS.X_Y, RELATIONSHIPS.X_AGENT].includes(ledger.relationship_type)) throw new DomainError('FIN-403', 'این رابطه مالی خارج از دامنه شرکت X است.', 403);
      if (![ledger.owner_org_id, ledger.x_org_id].includes(request.actor.organizationId)) throw new DomainError('FIN-403', 'تأییدکننده طرف این رابطه نیست.', 403);
    } else if (yActor) {
      if (![RELATIONSHIPS.X_Y, RELATIONSHIPS.Y_DRIVER].includes(ledger.relationship_type)) throw new DomainError('FIN-403', 'این رابطه مالی خارج از دامنه شرکت Y است.', 403);
      if (ledger.y_org_id !== request.actor.organizationId) throw new DomainError('FIN-403', 'تأییدکننده طرف شرکت Y این رابطه نیست.', 403);
    } else {
      if (ledger.relationship_type !== RELATIONSHIPS.CUSTOMER_X) throw new DomainError('FIN-403', 'این پنل فقط رابطه مالی Customer-X را تأیید می‌کند.', 403);
      if (![ledger.owner_org_id, ledger.x_org_id].includes(request.actor.organizationId)) throw new DomainError('FIN-403', 'تأییدکننده طرف این رابطه نیست.', 403);
    }
    assertDelegated(request.actor, 'confirmPayment');
    if (request.body?.accountChange === true || request.body?.highRisk === true || parseJson(ledger.evidence_json, {}).riskLevel === 'high' || parseJson(ledger.evidence_json, {}).accountChange === true) throw new DomainError(ERROR_CODES.STEP_UP_REQUIRED, 'برای تغییر حساب یا پرداخت پرریسک احراز هویت مرحله دوم لازم است.', 428);
    if (ledger.state !== 'SETTLEMENT_PENDING') throw new DomainError('FIN-409', 'این تسویه در وضعیت قابل تأیید نیست.', 409);
    if (ledger.delivery_state !== 'POD_ACCEPTED' && ledger.financial_state !== 'SETTLEMENT_PENDING') throw new DomainError(ERROR_CODES.SETTLEMENT_CONDITION_MISSING, 'POD_ACCEPTED شرط تأیید تسویه است.', 424);
    const item = await loadCase(ledger.case_id, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    await assertImportSettlementReady(item);
    await pool.execute(`UPDATE relationship_ledgers SET state = 'FINANCIALLY_SETTLED', evidence_json = JSON_SET(COALESCE(evidence_json, JSON_OBJECT()), '$.confirmedBy', ?, '$.confirmedAt', ?) WHERE id = ? AND tenant_id = ? AND state = 'SETTLEMENT_PENDING'`, [request.actor.userId, new Date().toISOString(), settlementId, request.actor.tenantId]);
    if (ledger.relationship_type === RELATIONSHIPS.CUSTOMER_X) {
      await pool.execute(`UPDATE shipment_cases SET financial_state = 'FINANCIALLY_SETTLED' WHERE id = ? AND tenant_id = ?`, [ledger.case_id, request.actor.tenantId]);
      if (item.direction === 'IMPORT') await pool.execute(`UPDATE shipment_cases SET import_state = 'I14_CLOSE_DISPUTE' WHERE id = ? AND tenant_id = ?`, [ledger.case_id, request.actor.tenantId]);
    }
    await event(request, { eventName: 'SettlementConfirmed', entityType: 'relationship_ledger', entityId: settlementId, payload: { caseId: ledger.case_id, relationshipType: ledger.relationship_type, payerOrgId: ledger.payer_org_id, payeeOrgId: ledger.payee_org_id }, recipientOrgId: request.actor.organizationId === ledger.payer_org_id ? ledger.payee_org_id : ledger.payer_org_id });
    return jsonResponse({ message: `تسویه رابطه ${ledger.relationship_type} تأیید شد.`, settlementId, relationshipType: ledger.relationship_type, state: 'FINANCIALLY_SETTLED', financialState: ledger.relationship_type === RELATIONSHIPS.CUSTOMER_X ? 'FINANCIALLY_SETTLED' : item.financial_state });
  }, { requireKey: true });
});

router.post('/contact-reveals', platformAuth({ permission: PERMISSIONS.CONTACT_REVEAL }), async (request, response) => {
  return runWrite(request, response, async () => {
    const caseId = parsePositiveId(request.body?.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    const expiresAt = request.body?.expiresAt || addMinutes(new Date(), 15);
    assertContactReveal({ actor: request.actor, reason: request.body?.reason, expiresAt });
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM platform_contact_reveals WHERE tenant_id = ? AND actor_user_id = ? AND created_at >= CURRENT_DATE`, [request.actor.tenantId, request.actor.userId]);
    if (Number(countRows[0]?.total || 0) >= 3) throw new DomainError(ERROR_CODES.CONTACT_REVEAL_CAP, 'سقف افشای تماس روزانه تکمیل شده است.', 429);
    const [result] = await pool.execute(`INSERT INTO platform_contact_reveals (tenant_id, case_id, actor_user_id, organization_id, reason, expires_at) VALUES (?, ?, ?, ?, ?, ?)`, [request.actor.tenantId, caseId, request.actor.userId, request.actor.organizationId, String(request.body.reason).trim(), new Date(expiresAt)]);
    await event(request, { eventName: 'ContactRevealed', entityType: 'contact_reveal', entityId: result.insertId, payload: { caseId, expiresAt, reason: String(request.body.reason).trim() } });
    return jsonResponse({ message: 'مجوز مشاهده تماس صادر شد.', revealId: result.insertId, expiresAt }, 201);
  }, { requireKey: true });
});

router.get('/cases/:caseId/contacts', platformAuth({ permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    const payload = parseJson(item.payload_json, {});
    const contacts = payload.contacts || {};
    const [grants] = await pool.execute(`SELECT id, expires_at FROM platform_contact_reveals WHERE tenant_id = ? AND case_id = ? AND actor_user_id = ? AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1`, [request.actor.tenantId, caseId, request.actor.userId || 0]);
    const revealed = Boolean(grants[0]);
    return response.json({
      revealed,
      revealExpiresAt: grants[0]?.expires_at || null,
      shipper: { phone: revealed ? contacts.shipperPhone || null : maskPhone(contacts.shipperPhone), email: revealed ? contacts.shipperEmail || null : maskEmail(contacts.shipperEmail) },
      consignee: { phone: revealed ? contacts.consigneePhone || null : maskPhone(contacts.consigneePhone), email: revealed ? contacts.consigneeEmail || null : maskEmail(contacts.consigneeEmail) }
    });
  } catch (error) {
    return problem(response, error, request);
  }
});

async function createCaseIssue(request, caseId, caseType) {
  const item = await loadCase(caseId, request.actor.tenantId);
  assertCaseAccess(request.actor, item);
  const tripId = request.body?.tripId ? parsePositiveId(request.body.tripId, 'شناسه سفر') : null;
  const trip = tripId ? await loadTrip(tripId, request.actor.tenantId) : null;
  if (trip) assertTripAccess(request.actor, trip);
  if (isAgentActor(request.actor)) {
    if (!trip) throw new DomainError(ERROR_CODES.AGENT_ASSIGNMENT_MISSING, 'Agent باید Claim یا Dispute را به سفر تخصیص‌یافته متصل کند.', 403);
    await assertAgentAssignment(request, trip, 'open_claim');
  }
  const reason = String(request.body?.reason || '').trim();
  if (reason.length < 8) throw new DomainError('CASE-400', 'شرح پرونده خسارت یا اختلاف الزامی است.', 400);
  const timingWarning = item.delivery_state === 'POD_ACCEPTED' && Boolean(request.body?.outsideClaimWindow);
  const [result] = await pool.execute(
    `INSERT INTO platform_claims (tenant_id, case_id, trip_id, case_type, status, reason, evidence_json, opened_by_user_id, opened_by_org_id, timing_warning)
     VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
    [request.actor.tenantId, caseId, tripId, caseType, reason, JSON.stringify(request.body?.evidence || {}), request.actor.userId, request.actor.organizationId, timingWarning ? 1 : 0]
  );
  const recipientOrgId = isAgentActor(request.actor)
    ? item.x_org_id
    : request.actor.organizationId === item.owner_org_id
    ? item.x_org_id
    : request.actor.organizationId === item.y_org_id
      ? item.x_org_id
      : item.owner_org_id;
  await event(request, { eventName: caseType === 'CLAIM' ? 'ClaimOpened' : 'DisputeOpened', entityType: 'case_issue', entityId: result.insertId, payload: { caseId, tripId, caseType, timingWarning }, recipientOrgId });
  return { id: result.insertId, caseId, tripId, caseType, state: 'OPEN', timingWarning, warningCode: timingWarning ? ERROR_CODES.CLAIM_TIMING_WARNING : null };
}

router.post('/cases/:caseId/claims', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER, ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_Y_OWNER, ROLES.AGENT_Z, ROLES.CONSIGNEE], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => jsonResponse({ message: 'پرونده خسارت ایجاد شد.', issue: await createCaseIssue(request, parsePositiveId(request.params.caseId, 'شناسه پرونده'), 'CLAIM') }, 201), { requireKey: true });
});

router.post('/cases/:caseId/disputes', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER, ROLES.SHIPPER_FINANCE_USER, ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_Y_OWNER, ROLES.AGENT_Z, ROLES.FINANCE_ADMIN], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => jsonResponse({ message: 'پرونده اختلاف ایجاد شد.', issue: await createCaseIssue(request, parsePositiveId(request.params.caseId, 'شناسه پرونده'), 'DISPUTE') }, 201), { requireKey: true });
});

router.get('/cases/:caseId/issues', platformAuth({ permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const caseId = parsePositiveId(request.params.caseId, 'شناسه پرونده');
    const item = await loadCase(caseId, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    if (isAgentActor(request.actor)) {
      const [tripRows] = await pool.execute(`SELECT id FROM trip_cases WHERE tenant_id = ? AND case_id = ? AND authorized_agent_org_id = ? ORDER BY id DESC LIMIT 1`, [request.actor.tenantId, caseId, request.actor.organizationId]);
      if (!tripRows[0]) throw new DomainError(ERROR_CODES.AGENT_ASSIGNMENT_MISSING, 'پرونده در دامنه Agent فعلی نیست.', 403);
      await assertAgentTrip(request, await loadTrip(tripRows[0].id, request.actor.tenantId), 'read_case');
    }
    const driverActor = normalizeRole(request.actor.role) === ROLES.DRIVER;
    const agentActor = isAgentActor(request.actor);
    const scopeFilter = isCompanyYActor(request.actor)
      ? ' AND opened_by_org_id IN (?, ?)'
      : driverActor
        ? ' AND (opened_by_org_id = ? OR trip_id IN (SELECT id FROM trip_cases WHERE tenant_id = ? AND driver_id = ?))'
        : agentActor
          ? ' AND (opened_by_org_id = ? OR trip_id IN (SELECT id FROM trip_cases WHERE tenant_id = ? AND authorized_agent_org_id = ?))'
          : '';
    const params = isCompanyYActor(request.actor)
      ? [request.actor.tenantId, caseId, item.y_org_id, item.x_org_id]
      : driverActor
        ? [request.actor.tenantId, caseId, request.actor.organizationId, request.actor.tenantId, request.actor.externalId]
        : agentActor
          ? [request.actor.tenantId, caseId, request.actor.organizationId, request.actor.tenantId, request.actor.organizationId]
          : [request.actor.tenantId, caseId];
    const [rows] = await pool.execute(`SELECT id, case_id, trip_id, case_type, status, reason, evidence_json, opened_by_org_id, timing_warning, created_at, updated_at FROM platform_claims WHERE tenant_id = ? AND case_id = ?${scopeFilter} ORDER BY created_at DESC`, params);
    return response.json({ issues: rows.map((row) => agentActor ? publicAgentIssue(row) : ({ ...row, evidence: parseJson(row.evidence_json, {}), timingWarning: Boolean(row.timing_warning) })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.patch('/claims/:claimId', platformAuth({ roles: [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_Y_OWNER, ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.UPDATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const claimId = parsePositiveId(request.params.claimId, 'شناسه Claim');
    const [rows] = await pool.execute(`SELECT * FROM platform_claims WHERE id = ? AND tenant_id = ? LIMIT 1`, [claimId, request.actor.tenantId]);
    const claim = rows[0];
    if (!claim) throw new DomainError('CLM-404', 'Claim یا Dispute پیدا نشد.', 404);
    const item = await loadCase(claim.case_id, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    if (isCompanyYActor(request.actor) && (request.actor.organizationId !== item.y_org_id || ![item.x_org_id, item.y_org_id].includes(claim.opened_by_org_id))) throw new DomainError('AUTH-403', 'Claim خارج از رابطه شرکت Y است.', 403);
    if (request.actor.organizationId !== item.owner_org_id && request.actor.organizationId !== item.x_org_id && request.actor.organizationId !== item.y_org_id) throw new DomainError('AUTH-403', 'Claim خارج از رابطه قراردادی شماست.', 403);
    const status = request.body?.status ? String(request.body.status).toUpperCase() : claim.status;
    if (!['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED'].includes(status)) throw new DomainError('CLM-400', 'وضعیت Claim معتبر نیست.', 400);
    const reason = request.body?.reason === undefined ? claim.reason : String(request.body.reason).trim();
    if (reason.length < 8) throw new DomainError('CLM-400', 'شرح پاسخ Claim الزامی است.', 400);
    await pool.execute(`UPDATE platform_claims SET status = ?, reason = ? WHERE id = ? AND tenant_id = ?`, [status, reason, claimId, request.actor.tenantId]);
    await event(request, { eventName: claim.case_type === 'DISPUTE' ? 'DisputeUpdated' : 'ClaimUpdated', entityType: 'case_issue', entityId: claimId, payload: { caseId: claim.case_id, tripId: claim.trip_id, status, caseType: claim.case_type }, recipientOrgId: request.actor.organizationId === item.x_org_id ? item.y_org_id : item.x_org_id });
    return jsonResponse({ message: 'وضعیت Claim/Dispute به‌روزرسانی شد.', claimId, status });
  }, { requireKey: true });
});

router.post('/claims/:claimId/evidence', platformAuth({ roles: [ROLES.COMPANY_X_OWNER, ROLES.COMPANY_X_OPERATIONS_MANAGER, ROLES.COMPANY_Y_OWNER, ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER, ROLES.AGENT_Z], permission: PERMISSIONS.CREATE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const claimId = parsePositiveId(request.params.claimId, 'شناسه Claim');
    const [rows] = await pool.execute(`SELECT * FROM platform_claims WHERE id = ? AND tenant_id = ? LIMIT 1`, [claimId, request.actor.tenantId]);
    const claim = rows[0];
    if (!claim) throw new DomainError('CLM-404', 'Claim یا Dispute پیدا نشد.', 404);
    const item = await loadCase(claim.case_id, request.actor.tenantId);
    assertCaseAccess(request.actor, item);
    if (isAgentActor(request.actor)) {
      if (!claim.trip_id) throw new DomainError(ERROR_CODES.AGENT_ASSIGNMENT_MISSING, 'شاهد Agent باید به سفر تخصیص‌یافته متصل باشد.', 403);
      await assertAgentTrip(request, await loadTrip(claim.trip_id, request.actor.tenantId), 'open_claim', { device: true });
    } else if (![item.owner_org_id, item.x_org_id, item.y_org_id].includes(request.actor.organizationId) || (isCompanyYActor(request.actor) && ![item.x_org_id, item.y_org_id].includes(claim.opened_by_org_id))) throw new DomainError('AUTH-403', 'افزودن شاهد خارج از رابطه شماست.', 403);
    const evidence = request.body?.evidence && typeof request.body.evidence === 'object' ? request.body.evidence : request.body || {};
    if (evidence.fileHash && !/^[a-f0-9]{64}$/i.test(String(evidence.fileHash))) throw new DomainError('DOC-400', 'hash شاهد Claim معتبر نیست.', 400);
    if (!evidence.fileRef && String(evidence.note || '').trim().length < 8) throw new DomainError('CLM-400', 'مرجع فایل یا توضیح شاهد الزامی است.', 400);
    const current = parseJson(claim.evidence_json, {});
    const evidenceItems = Array.isArray(current) ? current : (Object.keys(current).length ? [{ ...current, legacy: true }] : []);
    evidenceItems.push({ ...evidence, addedByOrgId: request.actor.organizationId, addedByUserId: request.actor.userId, addedAt: new Date().toISOString() });
    await pool.execute(`UPDATE platform_claims SET evidence_json = ? WHERE id = ? AND tenant_id = ?`, [JSON.stringify(evidenceItems), claimId, request.actor.tenantId]);
    await event(request, { eventName: 'ClaimEvidenceAdded', entityType: 'case_issue', entityId: claimId, payload: { caseId: claim.case_id, tripId: claim.trip_id, evidenceCount: evidenceItems.length }, recipientOrgId: request.actor.organizationId === item.y_org_id ? item.x_org_id : item.y_org_id });
    return jsonResponse({ message: 'شاهد Claim به‌صورت append-only افزوده شد.', claimId, evidenceCount: evidenceItems.length }, 201);
  }, { requireKey: true });
});

router.get('/notifications', platformAuth({ permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit || 50), 1), 200);
    const [rows] = await pool.execute(`SELECT id, event_id, recipient_org_id, recipient_user_id, channel, state, payload_json, created_at, sent_at FROM platform_notifications WHERE tenant_id = ? AND (recipient_org_id = ? OR recipient_user_id = ?) ORDER BY created_at DESC LIMIT ${limit}`, [request.actor.tenantId, request.actor.organizationId, request.actor.userId || 0]);
    return response.json({ notifications: rows.map((row) => isAgentActor(request.actor) ? publicAgentNotification(row) : ({ ...row, payload: parseJson(row.payload_json, {}) })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.get('/organization/members', platformAuth({ roles: COMPANY_Y_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const [rows] = await pool.execute(
      `SELECT m.id, m.user_id, m.role, m.transaction_role, m.qualification_state, m.kyc_level, m.status,
              u.display_name, u.status AS user_status
         FROM organization_memberships m
         JOIN platform_users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND m.organization_id = ? AND m.status = 'active'
        ORDER BY m.role, u.display_name`,
      [request.actor.tenantId, request.actor.organizationId]
    );
    return response.json({ members: rows.map((row) => ({ id: row.id, userId: row.user_id, displayName: row.display_name, role: row.role, transactionRole: row.transaction_role, qualificationState: row.qualification_state, kycLevel: row.kyc_level, status: row.status, userStatus: row.user_status })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

router.post('/exports', platformAuth({ permission: PERMISSIONS.EXPORT_REQUEST }), async (request, response) => {
  return runWrite(request, response, async () => {
    const scope = request.body?.scope;
    const purpose = String(request.body?.purpose || '').trim();
    const crmScope = String(request.body?.crmScope || '').toUpperCase();
    if (!scope || !purpose || purpose.length < 8 || !['L1', 'L2'].includes(crmScope)) throw new DomainError(ERROR_CODES.CRM_SCOPE, 'محدوده CRM و هدف صادرات داده الزامی است.', 403);
    if (scope.all === true || (!Array.isArray(scope.accountIds) && !Array.isArray(scope.caseIds) && !scope.bookOfBusinessId)) throw new DomainError(ERROR_CODES.CRM_SCOPE, 'خروجی کلی مجاز نیست؛ محدوده مشخص لازم است.', 403);
    const [result] = await pool.execute(`INSERT INTO platform_export_requests (tenant_id, requested_by_user_id, organization_id, crm_scope, purpose, scope_json, state) VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED')`, [request.actor.tenantId, request.actor.userId, request.actor.organizationId, crmScope, purpose, JSON.stringify(scope)]);
    await event(request, { eventName: 'ExportRequested', entityType: 'export_request', entityId: result.insertId, payload: { crmScope, purpose, scope } });
    return jsonResponse({ message: 'درخواست خروجی برای تأیید دومرحله‌ای ثبت شد.', exportRequestId: result.insertId, state: 'REQUESTED' }, 201);
  }, { requireKey: true });
});

router.post('/exports/:exportId/approve', platformAuth({ roles: [ROLES.CRM_ADMIN, ROLES.DATA_GOVERNANCE_OFFICER, ROLES.SALES_MANAGER, ROLES.SUPPORT_LEAD], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  return runWrite(request, response, async () => {
    const exportId = parsePositiveId(request.params.exportId, 'شناسه درخواست خروجی');
    const [rows] = await pool.execute(`SELECT * FROM platform_export_requests WHERE id = ? AND tenant_id = ? LIMIT 1`, [exportId, request.actor.tenantId]);
    const exportRequest = rows[0];
    if (!exportRequest) throw new DomainError('EXP-404', 'درخواست خروجی پیدا نشد.', 404);
    if (exportRequest.organization_id !== request.actor.organizationId) throw new DomainError(ERROR_CODES.CRM_SCOPE, 'درخواست خارج از دفتر سازمانی شماست.', 403);
    assertExportApproval({ request: exportRequest, actor: request.actor });
    await pool.execute(`UPDATE platform_export_requests SET state = 'APPROVED', approved_by_user_id = ?, approved_at = NOW() WHERE id = ? AND state = 'REQUESTED'`, [request.actor.userId, exportId]);
    await event(request, { eventName: 'ExportApproved', entityType: 'export_request', entityId: exportId, payload: { approvedBy: request.actor.userId } });
    return jsonResponse({ message: 'درخواست خروجی با تأیید شخص دوم مجاز شد.', exportRequestId: exportId, state: 'APPROVED' });
  }, { requireKey: true });
});

router.post('/exports/:exportId/execute', platformAuth({ permission: PERMISSIONS.EXPORT_REQUEST }), async (request, response) => {
  return runWrite(request, response, async () => {
    const exportId = parsePositiveId(request.params.exportId, 'شناسه درخواست خروجی');
    const [rows] = await pool.execute(`SELECT * FROM platform_export_requests WHERE id = ? AND tenant_id = ? LIMIT 1`, [exportId, request.actor.tenantId]);
    const exportRequest = rows[0];
    if (!exportRequest) throw new DomainError('EXP-404', 'درخواست خروجی پیدا نشد.', 404);
    if (exportRequest.state !== 'APPROVED') throw new DomainError('EXP-409', 'درخواست خروجی هنوز تأیید نشده است.', 409);
    if (String(exportRequest.requested_by_user_id) === String(request.actor.userId)) throw new DomainError('EXP-403', 'اجراکننده خروجی باید با درخواست‌کننده متفاوت باشد.', 403);
    await pool.execute(`UPDATE platform_export_requests SET state = 'EXECUTED', executed_by_user_id = ?, executed_at = NOW() WHERE id = ? AND state = 'APPROVED'`, [request.actor.userId, exportId]);
    await event(request, { eventName: 'ExportExecuted', entityType: 'export_request', entityId: exportId, payload: { executedBy: request.actor.userId, crmScope: exportRequest.crm_scope } });
    return jsonResponse({ message: 'خروجی محدوده‌دار اجرا شد و رویداد آن ثبت شد.', exportRequestId: exportId, state: 'EXECUTED', scope: parseJson(exportRequest.scope_json, {}) });
  }, { requireKey: true });
});

router.get('/audit', platformAuth({ permission: PERMISSIONS.SEE_AUDIT }), async (request, response) => {
  try {
    if (['super_admin', 'marketplace_admin'].includes(normalizeRole(request.actor.role)) && String(request.actor.purpose || '').trim().length < 8) throw new DomainError('AUTH-428', 'مشاهده حسابرسی مدیریتی نیازمند محدوده هدف و ثبت دلیل است.', 428);
    const limit = Math.min(Math.max(Number(request.query.limit || 50), 1), 200);
    const caseId = request.query.caseId ? parsePositiveId(request.query.caseId, 'شناسه پرونده') : null;
    if (caseId) {
      const item = await loadCase(caseId, request.actor.tenantId);
      assertCaseAccess(request.actor, item);
    }
    const [rows] = await pool.execute(
      `SELECT id, actor_id, organization_id, event_type, subject_type, subject_id, payload_json, correlation_id, event_version, created_at
         FROM audit_events
        WHERE tenant_id = ? AND (? IS NULL OR subject_id = ? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.caseId')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.case_id')) = ?)
        ORDER BY created_at DESC LIMIT ${limit}`,
      [request.actor.tenantId, caseId, caseId, caseId ? String(caseId) : null, caseId ? String(caseId) : null]
    );
    return response.json({ items: rows.map((row) => ({ ...row, payload: parseJson(row.payload_json, {}) })) });
  } catch (error) {
    return problem(response, error, request);
  }
});

export default router;
