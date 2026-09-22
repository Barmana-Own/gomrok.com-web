import { Router } from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { JWT_SECRET, PLATFORM_TENANT_ID } from '../config.js';
import { pool } from '../db.js';
import { platformAuth } from '../security/platform-auth.js';
import { DomainError } from '../domain/workflow.js';
import {
  assertInquiryValid,
  assertOfferSelectable,
  driverProjection,
  normalizeInquiryPayload,
  publicationDecision,
  validateInquiry,
  validateOffer
} from '../domain/cargo-inquiry.js';
import { PERMISSIONS, ROLES } from '../../../shared/contract.js';

const router = Router();
const SHIPPER_ROLES = [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER, ROLES.CONSIGNEE];
const SUPPORT_ROLES = [ROLES.CUSTOMER_SUPPORT, ROLES.SUPPORT_AGENT, ROLES.SUPPORT_LEAD, ROLES.SUPER_ADMIN, ROLES.MARKETPLACE_ADMIN];
const DRIVER_ROLES = [ROLES.DRIVER];
const GUEST_DRAFT_TTL_HOURS = 72;
const MEMBER_DRAFT_TTL_DAYS = 7;
const MAX_PAYLOAD_BYTES = 60_000;
const SENSITIVE_KEY = createHash('sha256').update(JWT_SECRET).digest();

function hashSecret(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function encryptSensitive(value) {
  if (value === null || value === undefined || value === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SENSITIVE_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptSensitive(value) {
  if (typeof value !== 'string' || !value.startsWith('enc:v1:')) return value;
  try {
    const [, , ivText, tagText, ciphertextText] = value.split(':');
    const decipher = createDecipheriv('aes-256-gcm', SENSITIVE_KEY, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  } catch (_error) {
    return '[اطلاعات محافظت‌شده]';
  }
}

function protectPayload(payload) {
  const copy = JSON.parse(JSON.stringify(payload || {}));
  copy.requester = { ...(copy.requester || {}) };
  for (const key of ['mobile', 'email', 'alternatePhone', 'nationalIdentifier']) copy.requester[key] = encryptSensitive(copy.requester[key]);
  copy.stops = Array.isArray(copy.stops) ? copy.stops.map((stop) => ({
    ...stop,
    address: encryptSensitive(stop.address),
    postalCode: encryptSensitive(stop.postalCode),
    contactName: encryptSensitive(stop.contactName),
    contactPhone: encryptSensitive(stop.contactPhone)
  })) : [];
  copy.value = { ...(copy.value || {}) };
  if (copy.value.amount !== null && copy.value.amount !== undefined) copy.value.amount = encryptSensitive(copy.value.amount);
  if (copy.value.amountMinor !== null && copy.value.amountMinor !== undefined) copy.value.amountMinor = encryptSensitive(copy.value.amountMinor);
  if (copy.value.budgetAmount !== null && copy.value.budgetAmount !== undefined) copy.value.budgetAmount = encryptSensitive(copy.value.budgetAmount);
  if (copy.cargo?.specialRequirements && typeof copy.cargo.specialRequirements === 'object') copy.cargo.specialRequirements = encryptSensitive(JSON.stringify(copy.cargo.specialRequirements));
  return copy;
}

function revealPayload(payload) {
  const copy = JSON.parse(JSON.stringify(payload || {}));
  copy.requester = { ...(copy.requester || {}) };
  for (const key of ['mobile', 'email', 'alternatePhone', 'nationalIdentifier']) copy.requester[key] = decryptSensitive(copy.requester[key]);
  copy.stops = Array.isArray(copy.stops) ? copy.stops.map((stop) => ({
    ...stop,
    address: decryptSensitive(stop.address),
    postalCode: decryptSensitive(stop.postalCode),
    contactName: decryptSensitive(stop.contactName),
    contactPhone: decryptSensitive(stop.contactPhone)
  })) : [];
  copy.value = { ...(copy.value || {}) };
  for (const key of ['amount', 'amountMinor', 'budgetAmount']) copy.value[key] = decryptSensitive(copy.value[key]);
  if (typeof copy.cargo?.specialRequirements === 'string') {
    try { copy.cargo.specialRequirements = JSON.parse(decryptSensitive(copy.cargo.specialRequirements)); } catch (_error) { copy.cargo.specialRequirements = {}; }
  }
  return copy;
}

function scopeIdempotency(scope, value) {
  return value ? `${scope}:${hashSecret(value)}` : null;
}

function issueSecret() {
  return randomBytes(32).toString('base64url');
}

function maskContact(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.length <= 4 ? '***' : `***${normalized.slice(-4)}`;
}

function trackingCode() {
  return 'GQ-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + randomBytes(3).toString('hex').toUpperCase();
}

function publicReference() {
  return 'BQ-' + randomBytes(4).toString('hex').toUpperCase();
}

function statusForState(state) {
  const map = {
    DRAFT: 'DRAFT',
    SUPPORT_QUEUE: 'SUPPORT_QUEUE',
    SUPPORT_RESPONDED: 'QUOTES_RECEIVED',
    PUBLISHED: 'OPEN_FOR_QUOTES',
    PUBLISHED_NO_AUDIENCE: 'OPEN_FOR_QUOTES',
    OFFERS_RECEIVED: 'QUOTES_RECEIVED',
    OFFER_SELECTED: 'QUOTE_SELECTED',
    PENDING_SPECIALIST: 'AWAITING_RISK_APPROVAL',
    PENDING_REVIEW: 'AWAITING_REVIEW',
    NEEDS_COMPLETION: 'AWAITING_CUSTOMER_INFO',
    SUPPORT_WAITING_CUSTOMER: 'AWAITING_CUSTOMER_INFO',
    READY_FOR_DRIVER_MATCHING: 'READY_FOR_DRIVER_MATCHING',
    CANCELLED: 'CANCELLED_BY_SHIPPER',
    EXPIRED: 'EXPIRED'
  };
  return map[state] || state || 'DRAFT';
}

function cleanBody(body) {
  const serialized = JSON.stringify(body || {});
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) throw new DomainError('CARGO-413', 'حجم اطلاعات استعلام بیش از حد مجاز است.', 413);
  return body || {};
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function publicInquiry(row, { includePrivate = false } = {}) {
  const payload = revealPayload(parseJson(row.payload_json));
  const result = {
    id: row.public_id,
    publicId: row.public_id,
    requestId: row.public_id,
    publicReference: row.public_reference || row.tracking_code,
    trackingCode: row.tracking_code,
    mode: row.mode,
    state: row.state,
    status: row.status || statusForState(row.state),
    versionNo: Number(row.active_version_no || 1),
    requester: includePrivate ? payload.requester : { name: payload.requester?.name || '', companyName: payload.requester?.companyName || '' },
    route: includePrivate ? payload.route : undefined,
    stops: includePrivate ? payload.stops : undefined,
    cargo: includePrivate ? payload.cargo : driverProjection({ public_id: row.public_id, version_no: row.active_version_no, payload_json: row.payload_json }).cargo,
    schedule: includePrivate ? payload.schedule : undefined,
    review: parseJson(row.validation_json),
    publicationDecision: row.publication_decision || parseJson(row.validation_json).decisionCode || null,
    publicationReasonCode: row.publication_reason_code || parseJson(row.validation_json).decisionCode || null,
    policyVersion: row.policy_version || parseJson(row.validation_json).policyVersion || null,
    riskLevel: row.risk_level || 'standard',
    currency: row.currency || payload.value?.currency || 'IRR',
    submittedAt: row.submitted_at || null,
    support: row.support_response_json ? parseJson(row.support_response_json, null) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at
  };
  if (includePrivate) result.handlingUnits = payload.handlingUnits;
  return result;
}

function responseError(response, request, error) {
  const missingTable = error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR';
  const status = missingTable ? 503 : Number(error?.status || error?.statusCode || 500);
  const code = missingTable ? 'CARGO-503' : (error?.code || 'CARGO-500');
  const message = missingTable ? 'ماژول استعلام در این محیط هنوز در پایگاه‌داده راه‌اندازی نشده است.' : (error?.message || 'عملیات استعلام انجام نشد.');
  return response.status(status).type('application/problem+json').json({ type: 'https://gomrok.org/problems/' + code, title: code, status, detail: message, code, details: error?.details, correlationId: request.correlationId });
}

async function appendEvent({ request, inquiryId, eventName, payload = {}, connection = pool }) {
  await connection.execute(
    `INSERT INTO cargo_inquiry_events
      (tenant_id, inquiry_id, event_name, actor_user_id, actor_role, correlation_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [request?.actor?.tenantId || PLATFORM_TENANT_ID, inquiryId, eventName, request?.actor?.userId || null, request?.actor?.role || 'guest', request?.correlationId || null, JSON.stringify(payload)]
  );
  await connection.execute(
    `INSERT INTO audit_events
      (actor_id, tenant_id, organization_id, event_type, subject_type, subject_id, payload_json, correlation_id, event_version)
     VALUES (?, ?, ?, ?, 'cargo_inquiry', ?, ?, ?, 1)`,
    [request?.actor?.userId || null, request?.actor?.tenantId || PLATFORM_TENANT_ID, request?.actor?.organizationId || null, eventName, inquiryId, JSON.stringify(payload), request?.correlationId || null]
  );
}

async function loadInquiry(publicId, { tenantId = null, connection = pool, forUpdate = false } = {}) {
  const filters = ['public_id = ?'];
  const values = [String(publicId || '').trim()];
  if (tenantId) { filters.push('tenant_id = ?'); values.push(tenantId); }
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await connection.execute('SELECT * FROM cargo_inquiries WHERE ' + filters.join(' AND ') + ' LIMIT 1' + suffix, values);
  if (!rows[0]) throw new DomainError('CARGO-404', 'استعلام پیدا نشد.', 404);
  return rows[0];
}

function assertShipperOwner(actor, inquiry) {
  if (!actor?.organizationId || String(actor.organizationId) !== String(inquiry.owner_org_id)) throw new DomainError('AUTH-403', 'این استعلام خارج از محدوده سازمان شماست.', 403);
}

function assertContinuation(request, inquiry) {
  const token = String(request.headers['x-continuation-token'] || '').trim();
  if (!token || !inquiry.guest_token_hash || hashSecret(token) !== inquiry.guest_token_hash || inquiry.guest_access_revoked) throw new DomainError('AUTH-403', 'ادامه مهمان معتبر نیست یا قبلاً مصرف شده است.', 403);
}

function assertGuestAccess(request, inquiry) {
  const token = String(request.headers['x-guest-access-token'] || request.headers['x-continuation-token'] || '').trim();
  if (!token || !inquiry.guest_token_hash || hashSecret(token) !== inquiry.guest_token_hash || inquiry.guest_access_revoked) throw new DomainError('AUTH-403', 'مجوز مهمان معتبر نیست یا قبلاً مصرف شده است.', 403);
}

async function latestVersion(inquiryId, connection = pool) {
  const [rows] = await connection.execute('SELECT * FROM cargo_inquiry_versions WHERE inquiry_id = ? ORDER BY version_no DESC LIMIT 1', [inquiryId]);
  if (!rows[0]) throw new DomainError('CARGO-404', 'نسخه استعلام پیدا نشد.', 404);
  return rows[0];
}

function riskLevel(review) {
  if (review?.prohibited) return 'prohibited';
  if (review?.dangerous) return 'high';
  if (review?.requiresSpecialist || review?.highValueOverThreshold) return 'elevated';
  return review?.warnings?.length ? 'review' : 'standard';
}

async function persistStructuredSnapshot({ connection, inquiryId, tenantId, versionNo, payload, actorUserId = null }) {
  const stops = [...(payload.stops || []), ...(payload.route?.extraStops || [])].map((stop, index) => ({ ...stop, sequence: index + 1 }));
  for (const stop of stops) {
    await connection.execute(
      `INSERT INTO cargo_inquiry_stops
        (tenant_id, inquiry_id, version_no, sequence_no, stop_type, province, city, district, location_type,
         address_encrypted, postal_code, latitude, longitude, contact_name_encrypted, contact_phone_encrypted,
         loading_window_start, loading_window_end, appointment_required, dock_available, forklift_available,
         crane_available, access_restrictions, estimated_operation_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, inquiryId, versionNo, stop.sequence, stop.operation, stop.province, stop.city || '', stop.district, stop.locationType || stop.placeType,
        encryptSensitive(stop.address), stop.postalCode || null, stop.latitude, stop.longitude,
        encryptSensitive(stop.contactName), encryptSensitive(stop.contactPhone), safeDate(payload.schedule?.pickupFrom), safeDate(payload.schedule?.pickupTo),
        stop.appointment === 'required' ? 1 : 0, stop.availableEquipment.includes('dock') ? 1 : 0, stop.availableEquipment.includes('forklift') ? 1 : 0,
        stop.availableEquipment.includes('crane') ? 1 : 0, stop.accessRestrictions, stop.operationMinutes]
    );
  }
  for (const item of payload.handlingUnits || []) {
    await connection.execute(
      `INSERT INTO cargo_inquiry_items
        (tenant_id, inquiry_id, version_no, cargo_type, description_public, description_private_encrypted,
         condition_code, quantity, unit_type, packaging_type, weight_gross_kg, weight_net_kg, is_weight_estimated,
         length_cm, width_cm, height_cm, stackable, rotatable, fragility_level, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, inquiryId, versionNo, payload.cargo?.cargoType || payload.cargo?.category, payload.cargo?.descriptionPublic || payload.cargo?.title,
        encryptSensitive(payload.cargo?.descriptionPrivate || payload.cargo?.description), payload.cargo?.condition, item.quantity, payload.cargo?.unitType,
        item.packagingType, item.grossWeight, item.netWeight, payload.cargo?.isWeightEstimated ? 1 : 0,
        item.dimensionUnit === 'cm' ? item.length : item.length === null ? null : item.length * 100,
        item.dimensionUnit === 'cm' ? item.width : item.width === null ? null : item.width * 100,
        item.dimensionUnit === 'cm' ? item.height : item.height === null ? null : item.height * 100,
        item.stackability === 'stackable' ? 1 : item.stackability === 'not_stackable' ? 0 : null,
        item.rotatable ? 1 : 0, payload.cargo?.specialFlags?.includes('fragile') ? 'declared' : null, item.description]
    );
  }
  const requirements = payload.cargo?.specialRequirements || {};
  for (const flag of payload.cargo?.specialFlags || []) {
    const requirement = requirements[flag] || {};
    await connection.execute(
      `INSERT INTO cargo_inquiry_special_requirements
        (tenant_id, inquiry_id, version_no, requirement_type, is_selected, risk_level, data_json_encrypted, requires_review)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [tenantId, inquiryId, versionNo, flag, riskLevel({ dangerous: ['dangerous', 'hazardous', 'chemical'].includes(flag), requiresSpecialist: ['dangerous', 'hazardous', 'chemical', 'oversized', 'liquid', 'live_animal', 'unknown'].includes(flag) }), JSON.stringify(encryptSensitive(JSON.stringify(requirement))), ['dangerous', 'hazardous', 'chemical', 'oversized', 'liquid', 'live_animal', 'unknown'].includes(flag) ? 1 : 0]
    );
  }
  for (const [consentType, accepted] of Object.entries(payload.consent || {})) {
    if (consentType === 'acceptedAt') continue;
    await connection.execute(
      `INSERT INTO cargo_inquiry_consents
        (tenant_id, inquiry_id, version_no, consent_type, accepted, accepted_by_user_id, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE accepted = VALUES(accepted), accepted_by_user_id = VALUES(accepted_by_user_id), accepted_at = VALUES(accepted_at)`,
      [tenantId, inquiryId, versionNo, consentType, accepted ? 1 : 0, actorUserId, accepted ? new Date() : null]
    );
  }
}

async function saveVersion({ connection, inquiry, payload, actor = null, validation, idempotencyKey = null }) {
  const versionNo = Number(inquiry.active_version_no || 0) + 1;
  const storedPayload = protectPayload(payload);
  await connection.execute(
    `INSERT INTO cargo_inquiry_versions
      (tenant_id, inquiry_id, version_no, payload_json, calculation_json, validation_json, changed_by_user_id, idempotency_key, effective_change)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [inquiry.tenant_id, inquiry.id, versionNo, JSON.stringify(storedPayload), JSON.stringify(validation.calculation), JSON.stringify(validation), actor?.userId || null, idempotencyKey]
  );
  await connection.execute('UPDATE cargo_inquiries SET active_version_no = ?, payload_json = ?, validation_json = ?, declared_total_weight_kg = ?, estimated_total_volume_m3 = ?, risk_level = ?, publication_decision = ?, publication_reason_code = ?, policy_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?', [versionNo, JSON.stringify(storedPayload), JSON.stringify(validation), validation.calculation.totalGrossWeightKg, validation.calculation.totalVolumeM3, riskLevel(validation), validation.decisionCode, publicationDecision(validation).reason, validation.policyVersion, inquiry.id, inquiry.tenant_id]);
  await connection.execute("UPDATE cargo_inquiry_offers SET state = 'REVIEW_REQUIRED', updated_at = CURRENT_TIMESTAMP WHERE inquiry_id = ? AND state IN ('ACTIVE', 'SELECTED')", [inquiry.id]);
  await connection.execute("UPDATE cargo_inquiry_publications SET state = 'CLOSED_BY_VERSION_CHANGE', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE inquiry_id = ? AND state IN ('PUBLISHED', 'PUBLISHED_NO_AUDIENCE')", [inquiry.id]);
  await persistStructuredSnapshot({ connection, inquiryId: inquiry.id, tenantId: inquiry.tenant_id, versionNo, payload, actorUserId: actor?.userId || null });
  return versionNo;
}

async function createInquiry({ payload, mode, owner = null, token, idempotencyKey = null, connection = pool }) {
  const normalized = normalizeInquiryPayload(payload);
  const validation = validateInquiry(normalized, { mode, strict: false });
  const publicId = randomUUID();
  const reference = publicReference();
  const expiresAt = new Date(Date.now() + (owner ? MEMBER_DRAFT_TTL_DAYS * 24 : GUEST_DRAFT_TTL_HOURS) * 60 * 60 * 1000);
  const storedPayload = protectPayload(normalized);
  const decision = publicationDecision(validation);
  const calculation = validation.calculation;
  const [result] = await connection.execute(
    `INSERT INTO cargo_inquiries
      (public_id, tenant_id, owner_user_id, owner_org_id, guest_token_hash, guest_token_encrypted, idempotency_key,
       requester_kind, requester_name, requester_mobile, requester_email, contact_channel,
       tracking_code, public_reference, mode, state, status, route_type, risk_level, publication_decision,
       publication_reason_code, policy_version, currency, declared_total_weight_kg, estimated_total_volume_m3,
       mobile_verified, active_version_no, payload_json, validation_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [publicId, owner?.tenantId || PLATFORM_TENANT_ID, owner?.userId || null, owner?.organizationId || null, token ? hashSecret(token) : null, token ? encryptSensitive(token) : null, idempotencyKey,
      normalized.requester.kind, normalized.requester.name, maskContact(normalized.requester.mobile), maskContact(normalized.requester.email), normalized.contact.channel,
      trackingCode(), reference, mode === 'support' ? 'SUPPORT_QUEUE' : 'DRAFT', mode === 'support' ? 'SUPPORT_QUEUE' : 'DRAFT', mode === 'support' ? 'SUPPORT_QUEUE' : 'DRAFT', normalized.route.routeType,
      riskLevel(validation), decision.code, decision.reason, validation.policyVersion || null, normalized.value.currency || 'IRR', calculation.totalGrossWeightKg,
      calculation.totalVolumeM3, normalized.contact.mobileVerified ? 1 : 0, JSON.stringify(storedPayload), JSON.stringify(validation), expiresAt]
  );
  await connection.execute(
    `INSERT INTO cargo_inquiry_versions
      (tenant_id, inquiry_id, version_no, payload_json, calculation_json, validation_json, changed_by_user_id)
     VALUES (?, ?, 1, ?, ?, ?, ?)`,
    [owner?.tenantId || PLATFORM_TENANT_ID, result.insertId, JSON.stringify(storedPayload), JSON.stringify(validation.calculation), JSON.stringify(validation), owner?.userId || null]
  );
  await persistStructuredSnapshot({ connection, inquiryId: result.insertId, tenantId: owner?.tenantId || PLATFORM_TENANT_ID, versionNo: 1, payload: normalized, actorUserId: owner?.userId || null });
  const [rows] = await connection.execute('SELECT tracking_code FROM cargo_inquiries WHERE id = ? LIMIT 1', [result.insertId]);
  return { id: result.insertId, publicId, trackingCode: rows[0]?.tracking_code || null, publicReference: reference, validation, expiresAt };
}

async function findEligibleDrivers(tenantId, connection = pool, limit = 100) {
  const [rows] = await connection.execute(
    `SELECT id, province, city FROM drivers
      WHERE tenant_id = ? AND status = 'active'
        AND kyc_state IN ('approved', 'verified')
        AND license_state IN ('approved', 'verified')
        AND driver_card_state IN ('approved', 'verified')
        AND availability_state = 'available'
      ORDER BY updated_at DESC
      LIMIT ${Math.min(Math.max(Number(limit) || 100, 1), 100)}`,
    [tenantId]
  );
  return rows;
}

async function publishAutomatic({ request, inquiry, payload, connection }) {
  const validation = assertInquiryValid(payload, { mode: 'automatic' });
  const decision = publicationDecision(validation);
  if (decision.state !== 'PUBLISHED') {
    await connection.execute('UPDATE cargo_inquiries SET state = ?, status = ?, risk_level = ?, publication_decision = ?, publication_reason_code = ?, policy_version = ?, validation_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [decision.state, statusForState(decision.state), riskLevel(validation), decision.code, decision.reason, validation.policyVersion, JSON.stringify(validation), inquiry.id]);
    return { state: decision.state, decision, validation, candidateCount: 0 };
  }
  const drivers = await findEligibleDrivers(inquiry.tenant_id, connection);
  const candidateCount = drivers.length;
  const state = candidateCount > 0 ? 'PUBLISHED' : 'PUBLISHED_NO_AUDIENCE';
  const deadline = safeDate(payload.schedule.quoteDeadline) || new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [publication] = await connection.execute(
    `INSERT INTO cargo_inquiry_publications
      (tenant_id, inquiry_id, version_no, state, stage_no, deadline_at, candidate_count, driver_limit, eligibility_snapshot_json, created_by_user_id)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE state = VALUES(state), deadline_at = VALUES(deadline_at), candidate_count = VALUES(candidate_count), driver_limit = VALUES(driver_limit), eligibility_snapshot_json = VALUES(eligibility_snapshot_json), closed_at = NULL`,
    [inquiry.tenant_id, inquiry.id, inquiry.active_version_no, state, deadline, candidateCount, Math.min(candidateCount, 100), JSON.stringify({ candidateCount, policy: validation.policyVersion }), request.actor?.userId || null]
  );
  const [publicationRows] = await connection.execute('SELECT id FROM cargo_inquiry_publications WHERE inquiry_id = ? AND version_no = ? LIMIT 1', [inquiry.id, inquiry.active_version_no]);
  const publicationId = publicationRows[0]?.id || publication.insertId || null;
  for (const driver of drivers) {
    const [broadcast] = await connection.execute(
      `INSERT INTO cargo_inquiry_broadcasts
        (tenant_id, inquiry_id, version_no, driver_id, match_score, eligibility_snapshot_json, sent_at, expires_at, state)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'SENT')
       ON DUPLICATE KEY UPDATE state = 'SENT', expires_at = VALUES(expires_at)`,
      [inquiry.tenant_id, inquiry.id, inquiry.active_version_no, driver.id, 1, JSON.stringify({ province: driver.province, city: driver.city, policy: validation.policyVersion }), deadline]
    );
    const [broadcastRows] = await connection.execute('SELECT id FROM cargo_inquiry_broadcasts WHERE inquiry_id = ? AND version_no = ? AND driver_id = ? LIMIT 1', [inquiry.id, inquiry.active_version_no, driver.id]);
    await connection.execute(
      `INSERT INTO cargo_inquiry_notification_deliveries
        (tenant_id, inquiry_id, broadcast_id, channel, event_name, payload_json, state)
       VALUES (?, ?, ?, 'in_app', 'CargoInquiryBroadcast', ?, 'PENDING')`,
      [inquiry.tenant_id, inquiry.id, broadcastRows[0]?.id || broadcast.insertId || null, JSON.stringify({ publicId: inquiry.public_id, publicReference: inquiry.public_reference, originCity: payload.stops?.[0]?.city || null, destinationCity: payload.stops?.[1]?.city || null, cargoType: payload.cargo?.cargoType || null, weightKg: validation.calculation.totalGrossWeightKg, pickupFrom: payload.schedule?.pickupFrom || null })]
    );
  }
  await connection.execute('UPDATE cargo_inquiries SET state = ?, status = ?, submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP), risk_level = ?, publication_decision = ?, publication_reason_code = ?, policy_version = ?, validation_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [state, statusForState(state), riskLevel(validation), decision.code, decision.reason, validation.policyVersion, JSON.stringify(validation), inquiry.id]);
  return { state, decision, validation, candidateCount, publicationId, deadlineAt: deadline.toISOString() };
}

router.post('/drafts', async (request, response) => {
  try {
    const body = cleanBody(request.body);
    const requestIdempotencyKey = String(request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || '').trim().slice(0, 180) || null;
    const idempotencyKey = scopeIdempotency('automatic', requestIdempotencyKey);
    if (idempotencyKey) {
      const [existing] = await pool.execute('SELECT * FROM cargo_inquiries WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1', [PLATFORM_TENANT_ID, idempotencyKey]);
      if (existing[0]) return response.json({ inquiry: publicInquiry(existing[0], { includePrivate: true }), continuationRequired: true, continuationToken: decryptSensitive(existing[0].guest_token_encrypted) || null, idempotentReplay: true });
    }
    const token = issueSecret();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const created = await createInquiry({ payload: body, mode: 'automatic', token, idempotencyKey, connection });
      const inquiry = await loadInquiry(created.publicId, { connection });
      await appendEvent({ request, inquiryId: created.id, eventName: 'CargoInquiryDraftCreated', payload: { mode: 'automatic', versionNo: 1 }, connection });
      await connection.commit();
      return response.status(201).json({ inquiry: publicInquiry(inquiry, { includePrivate: true }), continuationRequired: true, continuationToken: token, review: created.validation });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.patch('/:publicId/draft', async (request, response) => {
  try {
    const body = cleanBody(request.body);
    const inquiry = await loadInquiry(request.params.publicId);
    assertContinuation(request, inquiry);
    if (inquiry.state !== 'DRAFT') throw new DomainError('CARGO-409', 'فقط پیش‌نویس مهمان قابل ویرایش است.', 409);
    const requestIdempotencyKey = String(request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || '').trim().slice(0, 180) || null;
    const idempotencyKey = scopeIdempotency('guest-draft', requestIdempotencyKey);
    const payload = normalizeInquiryPayload(body);
    const validation = validateInquiry(payload, { mode: 'automatic', strict: false });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const locked = await loadInquiry(request.params.publicId, { connection, forUpdate: true });
      assertContinuation(request, locked);
      if (idempotencyKey) {
        const [existingVersions] = await connection.execute('SELECT version_no, validation_json FROM cargo_inquiry_versions WHERE inquiry_id = ? AND idempotency_key = ? LIMIT 1', [locked.id, idempotencyKey]);
        if (existingVersions[0]) {
          await connection.commit();
          const updated = await loadInquiry(request.params.publicId);
          return response.json({ inquiry: publicInquiry(updated, { includePrivate: true }), review: parseJson(existingVersions[0].validation_json, validation), versionNo: existingVersions[0].version_no, idempotentReplay: true });
        }
      }
      const versionNo = await saveVersion({ connection, inquiry: locked, payload, validation, idempotencyKey });
      await appendEvent({ request, inquiryId: locked.id, eventName: 'CargoInquiryDraftUpdated', payload: { versionNo }, connection });
      await connection.commit();
      const updated = await loadInquiry(request.params.publicId);
      return response.json({ inquiry: publicInquiry(updated, { includePrivate: true }), review: validation });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/support', async (request, response) => {
  try {
    const body = cleanBody(request.body);
    assertInquiryValid(body, { mode: 'support' });
    const requestIdempotencyKey = String(request.headers['idempotency-key'] || request.headers['x-idempotency-key'] || '').trim().slice(0, 180) || null;
    const idempotencyKey = scopeIdempotency('support', requestIdempotencyKey);
    if (idempotencyKey) {
      const [existing] = await pool.execute('SELECT * FROM cargo_inquiries WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1', [PLATFORM_TENANT_ID, idempotencyKey]);
      if (existing[0]) return response.json({ inquiry: publicInquiry(existing[0]), trackingCode: existing[0].tracking_code, state: existing[0].state, guestAccessToken: decryptSensitive(existing[0].guest_token_encrypted) || null, idempotentReplay: true });
    }
    const accessToken = issueSecret();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const created = await createInquiry({ payload: body, mode: 'support', token: accessToken, idempotencyKey, connection });
      await connection.execute("INSERT INTO cargo_support_cases (tenant_id, inquiry_id, state, contact_verified) VALUES (?, ?, 'QUEUED', 0)", [PLATFORM_TENANT_ID, created.id]);
      await appendEvent({ request, inquiryId: created.id, eventName: 'CargoInquirySubmittedToSupport', payload: { mode: 'support' }, connection });
      await connection.commit();
      const inquiry = await loadInquiry(created.publicId);
      return response.status(201).json({ inquiry: publicInquiry(inquiry), trackingCode: inquiry.tracking_code, guestAccessToken: accessToken, state: 'SUPPORT_QUEUE' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.get('/support/queue', platformAuth({ roles: SUPPORT_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit || 50), 1), 100);
    const [rows] = await pool.execute(
      `SELECT i.public_id, i.tracking_code, i.state, i.requester_name, i.requester_mobile, i.contact_channel, i.created_at,
              s.state AS support_state, s.assigned_user_id
         FROM cargo_inquiries i JOIN cargo_support_cases s ON s.inquiry_id = i.id AND s.tenant_id = i.tenant_id
        WHERE i.tenant_id = ? AND s.state IN ('QUEUED', 'ASSIGNED', 'WAITING_CUSTOMER', 'RESPONDED')
        ORDER BY i.created_at ASC LIMIT ${limit}`,
      [request.actor.tenantId || PLATFORM_TENANT_ID]
    );
    return response.json({ items: rows.map((row) => ({ publicId: row.public_id, trackingCode: row.tracking_code, state: row.state, requester: { name: row.requester_name, mobile: row.requester_mobile, channel: row.contact_channel }, supportState: row.support_state, assignedUserId: row.assigned_user_id, createdAt: row.created_at })) });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.get('/support/:publicId', async (request, response) => {
  try {
    const inquiry = await loadInquiry(request.params.publicId);
    const token = String(request.headers['x-guest-access-token'] || '').trim();
    if (!token || !inquiry.guest_token_hash || hashSecret(token) !== inquiry.guest_token_hash) throw new DomainError('AUTH-403', 'مجوز پیگیری مهمان معتبر نیست.', 403);
    return response.json({ inquiry: publicInquiry(inquiry, { includePrivate: true }), trackingCode: inquiry.tracking_code });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.get('/support/:publicId/quotes', platformAuth({ roles: SUPPORT_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId });
    const [rows] = await pool.execute('SELECT id, version_no, base_amount_minor, surcharges_json, discount_minor, tax_minor, total_amount_minor, currency, included_services_json, excluded_services_json, valid_until, customer_message, internal_note, state, created_at FROM cargo_support_quotes WHERE inquiry_id = ? AND tenant_id = ? ORDER BY version_no DESC', [inquiry.id, request.actor.tenantId]);
    return response.json({ publicId: inquiry.public_id, items: rows.map((row) => ({ id: row.id, versionNo: row.version_no, baseAmountMinor: row.base_amount_minor, components: parseJson(row.surcharges_json), discountMinor: row.discount_minor, taxMinor: row.tax_minor, totalAmountMinor: row.total_amount_minor, currency: row.currency, includedServices: parseJson(row.included_services_json, []), excludedServices: parseJson(row.excluded_services_json, []), validUntil: row.valid_until, customerMessage: row.customer_message, internalNote: row.internal_note, state: row.state, createdAt: row.created_at })) });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/support/:publicId/request-info', platformAuth({ roles: SUPPORT_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  try {
    const message = String(request.body?.message || request.body?.body || '').trim().slice(0, 2000);
    if (!message) throw new DomainError('SUPPORT-422', 'متن درخواست اطلاعات لازم است.', 422);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId, connection, forUpdate: true });
      await connection.execute("INSERT INTO cargo_inquiry_messages (tenant_id, inquiry_id, sender_user_id, sender_role, body_encrypted, visibility_scope) VALUES (?, ?, ?, ?, ?, 'OWNER_SUPPORT')", [request.actor.tenantId, inquiry.id, request.actor.userId, request.actor.role, encryptSensitive(message)]);
      await connection.execute("UPDATE cargo_support_cases SET state = 'WAITING_CUSTOMER', next_action_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR), last_contact_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE inquiry_id = ? AND tenant_id = ?", [inquiry.id, request.actor.tenantId]);
      await connection.execute("UPDATE cargo_inquiries SET state = 'SUPPORT_WAITING_CUSTOMER', status = 'AWAITING_CUSTOMER_INFO', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?", [inquiry.id, request.actor.tenantId]);
      await appendEvent({ request, inquiryId: inquiry.id, eventName: 'CargoSupportInformationRequested', payload: { messageLength: message.length }, connection });
      await connection.commit();
      return response.json({ publicId: inquiry.public_id, state: 'SUPPORT_WAITING_CUSTOMER', status: 'AWAITING_CUSTOMER_INFO' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/support/:publicId/approve-risk', platformAuth({ roles: SUPPORT_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  try {
    const approved = request.body?.approved === true || request.body?.approved === 1;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId, connection, forUpdate: true });
      await connection.execute("INSERT INTO cargo_inquiry_risk_reviews (tenant_id, inquiry_id, version_no, review_type, state, reason_code, decision_note, reviewed_by, reviewed_at) VALUES (?, ?, ?, 'support', ?, ?, ?, ?, CURRENT_TIMESTAMP)", [request.actor.tenantId, inquiry.id, inquiry.active_version_no, approved ? 'APPROVED' : 'REJECTED', approved ? 'support_approved' : 'support_rejected', String(request.body?.note || '').slice(0, 1000), request.actor.userId]);
      await connection.execute("UPDATE cargo_inquiries SET state = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?", [approved ? 'READY_FOR_DRIVER_MATCHING' : 'PENDING_SPECIALIST', approved ? 'READY_FOR_DRIVER_MATCHING' : 'AWAITING_RISK_APPROVAL', inquiry.id, request.actor.tenantId]);
      await appendEvent({ request, inquiryId: inquiry.id, eventName: approved ? 'CargoRiskApproved' : 'CargoRiskRejected', payload: {}, connection });
      await connection.commit();
      return response.json({ publicId: inquiry.public_id, state: approved ? 'READY_FOR_DRIVER_MATCHING' : 'PENDING_SPECIALIST', status: approved ? 'READY_FOR_DRIVER_MATCHING' : 'AWAITING_RISK_APPROVAL' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/support/:publicId/send-to-customer', platformAuth({ roles: SUPPORT_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId, connection, forUpdate: true });
      await appendEvent({ request, inquiryId: inquiry.id, eventName: 'CargoSupportQuoteSentToCustomer', payload: { delivery: 'configured_notification_pipeline' }, connection });
      await connection.commit();
      return response.json({ publicId: inquiry.public_id, state: inquiry.state, delivery: 'PENDING_NOTIFICATION' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/support/:publicId/assign', platformAuth({ roles: SUPPORT_ROLES, permission: PERMISSIONS.UPDATE }), async (request, response) => {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId, connection, forUpdate: true });
      const [result] = await connection.execute(
        `UPDATE cargo_support_cases SET assigned_user_id = ?, state = 'ASSIGNED', updated_at = CURRENT_TIMESTAMP
          WHERE inquiry_id = ? AND tenant_id = ? AND (assigned_user_id IS NULL OR assigned_user_id = ?)`,
        [request.actor.userId, inquiry.id, request.actor.tenantId, request.actor.userId]
      );
      if (!result.affectedRows) throw new DomainError('SUPPORT-409', 'پرونده هم‌زمان به کارشناس دیگری تخصیص یافته است.', 409);
      await appendEvent({ request, inquiryId: inquiry.id, eventName: 'CargoSupportAssigned', payload: { assignedUserId: request.actor.userId }, connection });
      await connection.commit();
      return response.json({ publicId: inquiry.public_id, state: 'ASSIGNED', assignedUserId: request.actor.userId });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

async function respondSupportCase(request, response) {
  try {
    const prices = Array.isArray(request.body?.prices)
      ? request.body.prices.slice(0, 20)
      : (request.body?.amountMinor || request.body?.amount ? [request.body] : []);
    if (!prices.length) throw new DomainError('SUPPORT-422', 'حداقل یک قیمت یا نتیجه بررسی لازم است.', 422);
    const normalizedPrices = prices.map((price) => ({
      source: String(price.source || 'external').slice(0, 120),
      amount: Number(price.amount),
      amountMinor: Number(price.amountMinor ?? price.totalAmountMinor ?? price.amount),
      currency: String(price.currency || '').slice(0, 3).toUpperCase(),
      scope: String(price.scope || '').slice(0, 300),
      validUntil: safeDate(price.validUntil)?.toISOString() || null,
      conditions: String(price.conditions || '').slice(0, 500),
      components: price.components && typeof price.components === 'object' ? price.components : {},
      includedServices: Array.isArray(price.includedServices) ? price.includedServices.slice(0, 40) : [],
      excludedServices: Array.isArray(price.excludedServices) ? price.excludedServices.slice(0, 40) : [],
      customerMessage: String(price.customerMessage || '').slice(0, 800),
      internalNote: String(price.internalNote || '').slice(0, 800)
    }));
    if (normalizedPrices.some((price) => !Number.isFinite(price.amountMinor) || price.amountMinor <= 0 || !/^[A-Z]{3}$/.test(price.currency) || !price.validUntil)) throw new DomainError('SUPPORT-422', 'قیمت پشتیبانی باید منبع، مبلغ، ارز و اعتبار داشته باشد.', 422);
    const responsePayload = { prices: normalizedPrices, respondedAt: new Date().toISOString(), responderUserId: request.actor.userId };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const locked = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId, connection, forUpdate: true });
      const [caseRows] = await connection.execute('SELECT id FROM cargo_support_cases WHERE inquiry_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE', [locked.id, request.actor.tenantId]);
      const supportCase = caseRows[0];
      if (!supportCase) throw new DomainError('SUPPORT-404', 'پرونده پشتیبانی پیدا نشد.', 404);
      const [versionRows] = await connection.execute('SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version FROM cargo_support_quotes WHERE support_case_id = ?', [supportCase.id]);
      const quoteVersion = Number(versionRows[0]?.next_version || 1);
      for (const [priceIndex, price] of normalizedPrices.entries()) {
        await connection.execute(
          `INSERT INTO cargo_support_quotes
            (tenant_id, inquiry_id, support_case_id, version_no, base_amount_minor, surcharges_json, discount_minor, tax_minor,
             total_amount_minor, currency, included_services_json, excluded_services_json, valid_until, customer_message, internal_note, created_by, approved_by, state)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SENT')`,
          [request.actor.tenantId, locked.id, supportCase.id, quoteVersion + priceIndex, price.amountMinor, JSON.stringify(price.components), price.amountMinor, price.currency, JSON.stringify(price.includedServices), JSON.stringify(price.excludedServices), price.validUntil, price.customerMessage, price.internalNote, request.actor.userId, request.actor.userId]
        );
      }
      await connection.execute("UPDATE cargo_support_cases SET state = 'RESPONDED', response_json = ?, last_contact_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE inquiry_id = ? AND tenant_id = ?", [JSON.stringify(responsePayload), locked.id, request.actor.tenantId]);
      await connection.execute("UPDATE cargo_inquiries SET state = 'SUPPORT_RESPONDED', status = 'QUOTES_RECEIVED', support_response_json = ?, submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?", [JSON.stringify(responsePayload), locked.id, request.actor.tenantId]);
      await appendEvent({ request, inquiryId: locked.id, eventName: 'CargoSupportResponseRecorded', payload: { priceCount: normalizedPrices.length }, connection });
      await connection.commit();
      return response.json({ publicId: locked.public_id, state: 'SUPPORT_RESPONDED', quoteVersion, response: responsePayload });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
}

router.post('/support/:publicId/respond', platformAuth({ roles: SUPPORT_ROLES, permission: PERMISSIONS.UPDATE }), respondSupportCase);
router.post('/support/:publicId/quote', platformAuth({ roles: SUPPORT_ROLES, permission: PERMISSIONS.UPDATE }), respondSupportCase);

router.get('/:publicId/status', async (request, response) => {
  try {
    const inquiry = await loadInquiry(request.params.publicId);
    assertGuestAccess(request, inquiry);
    return response.json({ inquiry: publicInquiry(inquiry), trackingCode: inquiry.tracking_code, status: inquiry.status || statusForState(inquiry.state), state: inquiry.state });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.get('/:publicId/validate', async (request, response) => {
  try {
    const inquiry = await loadInquiry(request.params.publicId);
    assertGuestAccess(request, inquiry);
    const version = await latestVersion(inquiry.id);
    const review = validateInquiry(revealPayload(parseJson(version.payload_json)), { mode: inquiry.mode === 'automatic' ? 'automatic' : 'support', strict: false });
    return response.json({ publicId: inquiry.public_id, versionNo: version.version_no, review, decision: publicationDecision(review) });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/:publicId/auth-handoff', async (request, response) => {
  try {
    const inquiry = await loadInquiry(request.params.publicId);
    assertGuestAccess(request, inquiry);
    if (inquiry.mode !== 'automatic' || inquiry.state !== 'DRAFT') throw new DomainError('CARGO-409', 'این استعلام در وضعیت اتصال به حساب نیست.', 409);
    return response.json({ publicId: inquiry.public_id, continuationRequired: true, next: '/app/shipper', oneTime: true });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/:publicId/documents/init', async (request, response) => {
  return responseError(response, request, new DomainError('FILE_STORAGE_NOT_CONFIGURED', 'ذخیره‌سازی و اسکن فایل برای این محیط پیکربندی نشده است.', 503));
});

router.post('/:publicId/documents/:documentId/complete', async (request, response) => {
  return responseError(response, request, new DomainError('FILE_STORAGE_NOT_CONFIGURED', 'ذخیره‌سازی و اسکن فایل برای این محیط پیکربندی نشده است.', 503));
});

router.delete('/:publicId/documents/:documentId', async (request, response) => {
  return responseError(response, request, new DomainError('FILE_STORAGE_NOT_CONFIGURED', 'ذخیره‌سازی و اسکن فایل برای این محیط پیکربندی نشده است.', 503));
});

router.get('/:publicId/documents/:documentId', async (request, response) => {
  return responseError(response, request, new DomainError('FILE_STORAGE_NOT_CONFIGURED', 'ذخیره‌سازی و اسکن فایل برای این محیط پیکربندی نشده است.', 503));
});

router.post('/:publicId/continue', platformAuth({ roles: SHIPPER_ROLES, permission: PERMISSIONS.CREATE }), async (request, response) => {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const inquiry = await loadInquiry(request.params.publicId, { connection, forUpdate: true });
      assertContinuation(request, inquiry);
      if (inquiry.mode !== 'automatic' || inquiry.state !== 'DRAFT') throw new DomainError('CARGO-409', 'فقط پیش‌نویس خودکار قابل اتصال به حساب صاحب بار است.', 409);
      if (inquiry.owner_org_id && inquiry.owner_org_id !== request.actor.organizationId) throw new DomainError('AUTH-409', 'این پیش‌نویس به سازمان دیگری متصل است.', 409);
      await connection.execute('UPDATE cargo_inquiries SET tenant_id = ?, owner_user_id = ?, owner_org_id = ?, guest_token_hash = NULL, guest_token_encrypted = NULL, guest_access_revoked = 1, expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [request.actor.tenantId || PLATFORM_TENANT_ID, request.actor.userId, request.actor.organizationId, inquiry.id]);
      await appendEvent({ request, inquiryId: inquiry.id, eventName: 'CargoInquiryOwnershipBound', payload: { organizationId: request.actor.organizationId }, connection });
      await connection.commit();
      return response.json({ publicId: inquiry.public_id, state: inquiry.state, ownerOrganizationId: request.actor.organizationId });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

async function submitAutomatic(request, response) {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId, connection, forUpdate: true });
      assertShipperOwner(request.actor, inquiry);
      const version = await latestVersion(inquiry.id, connection);
      const result = await publishAutomatic({ request, inquiry, payload: revealPayload(parseJson(version.payload_json)), connection });
      const eventName = result.state === 'PUBLISHED' || result.state === 'PUBLISHED_NO_AUDIENCE' ? 'CargoInquiryPublished' : 'CargoInquiryReviewRequired';
      await appendEvent({ request, inquiryId: inquiry.id, eventName, payload: { state: result.state, versionNo: inquiry.active_version_no, candidateCount: result.candidateCount, reason: result.decision.reason }, connection });
      await connection.commit();
      return response.status(result.state === 'PUBLISHED' ? 201 : 200).json({ publicId: inquiry.public_id, state: result.state, candidateCount: result.candidateCount, deadlineAt: result.deadlineAt || null, review: result.validation, reason: result.decision.reason });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
}

const submitAutomaticAuth = platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.CREATE });
router.post('/:publicId/submit-automatic', submitAutomaticAuth, submitAutomatic);
router.post('/:publicId/submit', submitAutomaticAuth, submitAutomatic);

router.get('/', platformAuth({ roles: SHIPPER_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM cargo_inquiries WHERE tenant_id = ? AND owner_org_id = ? ORDER BY updated_at DESC LIMIT 100', [request.actor.tenantId, request.actor.organizationId]);
    return response.json({ items: rows.map((row) => publicInquiry(row, { includePrivate: true })) });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.get('/driver/opportunities', platformAuth({ roles: DRIVER_ROLES, permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const driverId = Number(request.actor.externalId);
    if (!Number.isSafeInteger(driverId) || driverId < 1) throw new DomainError('AUTH-403', 'حساب راننده معتبر نیست.', 403);
    const [driverRows] = await pool.execute("SELECT id FROM drivers WHERE id = ? AND tenant_id = ? AND status = 'active' AND kyc_state IN ('approved', 'verified') AND license_state IN ('approved', 'verified') AND driver_card_state IN ('approved', 'verified') AND availability_state = 'available' LIMIT 1", [driverId, request.actor.tenantId]);
    if (!driverRows[0]) throw new DomainError('AUTH-403', 'راننده برای دریافت فرصت‌های حمل واجد شرایط نیست.', 403);
    await pool.execute("UPDATE cargo_inquiry_broadcasts SET state = 'VIEWED', viewed_at = COALESCE(viewed_at, CURRENT_TIMESTAMP) WHERE tenant_id = ? AND driver_id = ? AND state = 'SENT' AND expires_at > CURRENT_TIMESTAMP", [request.actor.tenantId, driverId]);
    const [rows] = await pool.execute(
      `SELECT i.public_id, i.state, i.active_version_no, i.payload_json, p.deadline_at,
              p.state AS publication_state, o.id AS own_offer_id, o.amount AS own_offer_amount,
              o.currency AS own_offer_currency, o.state AS own_offer_state
         FROM cargo_inquiries i
         JOIN cargo_inquiry_publications p ON p.inquiry_id = i.id AND p.tenant_id = i.tenant_id AND p.version_no = i.active_version_no
         JOIN cargo_inquiry_broadcasts b ON b.inquiry_id = i.id AND b.tenant_id = i.tenant_id AND b.version_no = i.active_version_no AND b.driver_id = ? AND b.state IN ('SENT', 'VIEWED', 'RESPONDED')
         LEFT JOIN cargo_inquiry_offers o ON o.inquiry_id = i.id AND o.version_no = i.active_version_no AND o.driver_id = ? AND o.state IN ('ACTIVE', 'SELECTED')
        WHERE i.tenant_id = ? AND p.state IN ('PUBLISHED', 'PUBLISHED_NO_AUDIENCE') AND p.deadline_at > CURRENT_TIMESTAMP AND b.expires_at > CURRENT_TIMESTAMP
        ORDER BY p.deadline_at ASC LIMIT 100`,
      [driverId, driverId, request.actor.tenantId]
    );
    return response.json({ items: rows.map((row) => ({ ...driverProjection({ public_id: row.public_id, version_no: row.active_version_no, payload_json: row.payload_json }), state: row.state, deadlineAt: row.deadline_at, ownOffer: row.own_offer_id ? { id: row.own_offer_id, amount: row.own_offer_amount, currency: row.own_offer_currency, state: row.own_offer_state } : null })) });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/:publicId/offers', platformAuth({ roles: DRIVER_ROLES, permission: PERMISSIONS.CREATE }), async (request, response) => {
  try {
    const driverId = Number(request.actor.externalId);
    if (!Number.isSafeInteger(driverId) || driverId < 1) throw new DomainError('AUTH-403', 'حساب راننده معتبر نیست.', 403);
    const offer = validateOffer(request.body || {});
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId, connection, forUpdate: true });
      const [driverRows] = await connection.execute("SELECT id FROM drivers WHERE id = ? AND tenant_id = ? AND status = 'active' AND kyc_state IN ('approved', 'verified') AND license_state IN ('approved', 'verified') AND driver_card_state IN ('approved', 'verified') AND availability_state = 'available' LIMIT 1", [driverId, request.actor.tenantId]);
      if (!driverRows[0]) throw new DomainError('AUTH-403', 'راننده برای اعلام پیشنهاد واجد شرایط نیست.', 403);
      const [publicationRows] = await connection.execute('SELECT * FROM cargo_inquiry_publications WHERE inquiry_id = ? AND version_no = ? AND tenant_id = ? LIMIT 1 FOR UPDATE', [inquiry.id, inquiry.active_version_no, request.actor.tenantId]);
      const publication = publicationRows[0];
      if (!publication || !['PUBLISHED', 'PUBLISHED_NO_AUDIENCE'].includes(publication.state)) throw new DomainError('CARGO-409', 'این استعلام در بازار رانندگان فعال نیست.', 409);
      if (new Date(publication.deadline_at).getTime() <= Date.now()) throw new DomainError('OFFER-409', 'مهلت پیشنهاد پایان یافته است.', 409);
      const [broadcastRows] = await connection.execute("SELECT * FROM cargo_inquiry_broadcasts WHERE inquiry_id = ? AND version_no = ? AND driver_id = ? AND tenant_id = ? AND state IN ('SENT', 'VIEWED', 'RESPONDED') AND expires_at > CURRENT_TIMESTAMP LIMIT 1 FOR UPDATE", [inquiry.id, inquiry.active_version_no, driverId, request.actor.tenantId]);
      const broadcast = broadcastRows[0];
      if (!broadcast) throw new DomainError('OFFER-403', 'این استعلام برای این راننده اختصاص داده نشده است.', 403);
      const [existing] = await connection.execute("SELECT * FROM cargo_inquiry_offers WHERE inquiry_id = ? AND version_no = ? AND driver_id = ? LIMIT 1 FOR UPDATE", [inquiry.id, inquiry.active_version_no, driverId]);
      if (existing[0]?.state === 'SELECTED') throw new DomainError('OFFER-409', 'پیشنهاد انتخاب‌شده قابل ویرایش نیست.', 409);
      let offerId;
      const quoteVersion = existing[0] ? Number(existing[0].quote_version || 1) + 1 : 1;
      const offerPayload = { amountMinor: offer.amountMinor, currency: offer.currency, basis: offer.basis, components: offer.components, includedServices: offer.includedServices, excludedServices: offer.excludedServices, estimatedArrivalMinutes: offer.estimatedArrivalMinutes, vehicleId: offer.vehicleId, loadingIncluded: offer.loadingIncluded, unloadingIncluded: offer.unloadingIncluded, conditions: offer.conditions, note: offer.note, validUntil: offer.validUntil };
      if (existing[0]) {
        offerId = existing[0].id;
        await connection.execute(`UPDATE cargo_inquiry_offers SET amount = ?, amount_minor = ?, currency = ?, basis = ?, included_json = ?, excluded_json = ?, components_json = ?, included_services_json = ?, excluded_services_json = ?, conditions = ?, driver_note = ?, vehicle_id = ?, estimated_arrival_minutes = ?, loading_included = ?, unloading_included = ?, quote_version = ?, valid_until = ?, state = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [offer.amount, offer.amountMinor, offer.currency, offer.basis, JSON.stringify({ text: offer.included }), JSON.stringify({ text: offer.excluded }), JSON.stringify(offer.components), JSON.stringify(offer.includedServices), JSON.stringify(offer.excludedServices), offer.conditions, offer.note, offer.vehicleId, offer.estimatedArrivalMinutes, offer.loadingIncluded, offer.unloadingIncluded, quoteVersion, offer.validUntil, offerId]);
      } else {
        const [result] = await connection.execute(
          `INSERT INTO cargo_inquiry_offers
            (tenant_id, inquiry_id, version_no, driver_id, driver_org_id, amount, amount_minor, currency, basis,
             included_json, excluded_json, components_json, included_services_json, excluded_services_json, conditions,
             driver_note, vehicle_id, estimated_arrival_minutes, loading_included, unloading_included, quote_version,
             valid_until, state, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
          [request.actor.tenantId, inquiry.id, inquiry.active_version_no, driverId, request.actor.organizationId || null, offer.amount, offer.amountMinor, offer.currency, offer.basis, JSON.stringify({ text: offer.included }), JSON.stringify({ text: offer.excluded }), JSON.stringify(offer.components), JSON.stringify(offer.includedServices), JSON.stringify(offer.excludedServices), offer.conditions, offer.note, offer.vehicleId, offer.estimatedArrivalMinutes, offer.loadingIncluded, offer.unloadingIncluded, quoteVersion, offer.validUntil, request.actor.userId]
        );
        offerId = result.insertId;
      }
      await connection.execute(`INSERT INTO cargo_inquiry_offer_revisions (tenant_id, inquiry_id, offer_id, driver_id, quote_version, payload_json, changed_by_user_id, change_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [request.actor.tenantId, inquiry.id, offerId, driverId, quoteVersion, JSON.stringify(offerPayload), request.actor.userId, existing[0] ? 'driver_offer_updated' : 'driver_offer_created']);
      await connection.execute("UPDATE cargo_inquiry_broadcasts SET state = 'RESPONDED', responded_at = CURRENT_TIMESTAMP WHERE id = ?", [broadcast.id]);
      await connection.execute("UPDATE cargo_inquiries SET state = 'OFFERS_RECEIVED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state IN ('PUBLISHED', 'PUBLISHED_NO_AUDIENCE')", [inquiry.id]);
      await appendEvent({ request, inquiryId: inquiry.id, eventName: 'CargoInquiryOfferSubmitted', payload: { offerId, versionNo: inquiry.active_version_no, driverId }, connection });
      await connection.commit();
      return response.status(existing[0] ? 200 : 201).json({ offerId, publicId: inquiry.public_id, versionNo: inquiry.active_version_no, quoteVersion, state: 'ACTIVE', amount: offer.amount, amountMinor: offer.amountMinor, currency: offer.currency, validUntil: offer.validUntil });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.get('/:publicId/offers', platformAuth({ roles: SHIPPER_ROLES, permission: PERMISSIONS.SEE_PRICE }), async (request, response) => {
  try {
    const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId });
    assertShipperOwner(request.actor, inquiry);
    const [rows] = await pool.execute("SELECT id, version_no, driver_org_id, amount, amount_minor, currency, basis, included_json, excluded_json, components_json, included_services_json, excluded_services_json, conditions, driver_note, vehicle_id, estimated_arrival_minutes, loading_included, unloading_included, quote_version, valid_until, state, created_at, updated_at FROM cargo_inquiry_offers WHERE inquiry_id = ? AND version_no = ? AND state IN ('ACTIVE', 'SELECTED') ORDER BY amount_minor ASC, amount ASC", [inquiry.id, inquiry.active_version_no]);
    return response.json({ publicId: inquiry.public_id, versionNo: inquiry.active_version_no, items: rows.map((row) => ({ id: row.id, amount: row.amount, amountMinor: row.amount_minor, currency: row.currency, basis: row.basis, included: parseJson(row.included_json), excluded: parseJson(row.excluded_json), components: parseJson(row.components_json), includedServices: parseJson(row.included_services_json, []), excludedServices: parseJson(row.excluded_services_json, []), conditions: row.conditions, note: row.driver_note, vehicleId: row.vehicle_id, estimatedArrivalMinutes: row.estimated_arrival_minutes, loadingIncluded: row.loading_included, unloadingIncluded: row.unloading_included, quoteVersion: row.quote_version, validUntil: row.valid_until, state: row.state, provider: 'راننده واجد شرایط', createdAt: row.created_at, updatedAt: row.updated_at })) });
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.post('/:publicId/select-offer', platformAuth({ roles: [ROLES.SHIPPER_ADMIN, ROLES.SHIPPER_LOGISTICS_USER], permission: PERMISSIONS.APPROVE }), async (request, response) => {
  try {
    const offerId = Number(request.body?.offerId);
    if (!Number.isSafeInteger(offerId) || offerId < 1) throw new DomainError('OFFER-422', 'شناسه پیشنهاد معتبر نیست.', 422);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId, connection, forUpdate: true });
      assertShipperOwner(request.actor, inquiry);
      const [offerRows] = await connection.execute('SELECT * FROM cargo_inquiry_offers WHERE id = ? AND inquiry_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE', [offerId, inquiry.id, request.actor.tenantId]);
      const offer = offerRows[0];
      const [publicationRows] = await connection.execute('SELECT state, deadline_at FROM cargo_inquiry_publications WHERE inquiry_id = ? AND version_no = ? AND tenant_id = ? LIMIT 1 FOR UPDATE', [inquiry.id, inquiry.active_version_no, request.actor.tenantId]);
      const publication = publicationRows[0];
      if (!publication || !['PUBLISHED', 'PUBLISHED_NO_AUDIENCE'].includes(publication.state) || new Date(publication.deadline_at).getTime() <= Date.now()) throw new DomainError('CARGO-409', 'مهلت انتخاب پیشنهاد این استعلام پایان یافته است.', 409);
      assertOfferSelectable({ offer, inquiry, versionNo: inquiry.active_version_no });
      await connection.execute("UPDATE cargo_inquiry_offers SET state = IF(id = ?, 'SELECTED', 'EXPIRED'), updated_at = CURRENT_TIMESTAMP WHERE inquiry_id = ? AND version_no = ? AND state = 'ACTIVE'", [offerId, inquiry.id, inquiry.active_version_no]);
      await connection.execute("UPDATE cargo_inquiries SET state = 'OFFER_SELECTED', status = 'QUOTE_SELECTED', selected_offer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [offerId, inquiry.id]);
      await connection.execute("UPDATE cargo_inquiry_publications SET state = 'CLOSED_BY_SELECTION', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE inquiry_id = ? AND version_no = ?", [inquiry.id, inquiry.active_version_no]);
      await connection.execute("UPDATE cargo_inquiry_broadcasts SET state = 'CLOSED' WHERE inquiry_id = ? AND version_no = ? AND state IN ('SENT', 'VIEWED', 'RESPONDED')", [inquiry.id, inquiry.active_version_no]);
      await appendEvent({ request, inquiryId: inquiry.id, eventName: 'CargoInquiryOfferSelected', payload: { offerId, versionNo: inquiry.active_version_no }, connection });
      await connection.commit();
      return response.json({ publicId: inquiry.public_id, state: 'OFFER_SELECTED', selectedOfferId: offerId, versionNo: inquiry.active_version_no });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return responseError(response, request, error);
  }
});

router.get('/:publicId', platformAuth({ roles: [...SHIPPER_ROLES, ...SUPPORT_ROLES], permission: PERMISSIONS.READ }), async (request, response) => {
  try {
    const inquiry = await loadInquiry(request.params.publicId, { tenantId: request.actor.tenantId });
    const supportRole = SUPPORT_ROLES.includes(request.actor.role);
    if (!supportRole) assertShipperOwner(request.actor, inquiry);
    return response.json({ inquiry: publicInquiry(inquiry, { includePrivate: true }) });
  } catch (error) {
    return responseError(response, request, error);
  }
});

export default router;
