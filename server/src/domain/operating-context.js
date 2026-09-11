import {
  OPERATING_CONTEXT_TYPES,
  ORGANIZATION_ROLE_GRANT_TYPES,
  operatingContextTypeForRoleGrant
} from '../../../shared/contract.js';

export const ROLE_GRANT_EVIDENCE_LEVELS = Object.freeze(['E0', 'E1', 'E2', 'E3']);
export const ROLE_GRANT_STATUSES = Object.freeze(['pending', 'active', 'suspended', 'expired', 'revoked']);
export const OPERATING_CONTEXT_STATUSES = Object.freeze(['pending', 'active', 'suspended', 'archived']);

const roleGrantTypes = new Set(Object.values(ORGANIZATION_ROLE_GRANT_TYPES));
const contextTypes = new Set(Object.values(OPERATING_CONTEXT_TYPES));
const evidenceLevels = new Set(ROLE_GRANT_EVIDENCE_LEVELS);
const roleGrantStatuses = new Set(ROLE_GRANT_STATUSES);
const contextStatuses = new Set(OPERATING_CONTEXT_STATUSES);

export class OperatingContextModelError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'OperatingContextModelError';
    this.code = 'CONTEXT_MODEL_INVALID';
    this.field = field;
  }
}

function invalid(field, message) {
  throw new OperatingContextModelError(message, field);
}

function requiredText(value, field, maxLength) {
  if (typeof value !== 'string') invalid(field, `${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) invalid(field, `${field} is required and must not exceed ${maxLength} characters.`);
  return normalized;
}

function optionalText(value, field, maxLength) {
  if (value === null || value === undefined || value === '') return null;
  return requiredText(value, field, maxLength);
}

function positiveId(value, field) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) {
    invalid(field, `${field} must be a positive integer.`);
  }
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) invalid(field, `${field} must be a positive integer.`);
  return normalized;
}

function instant(value, field, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (!(value instanceof Date) && typeof value !== 'string') invalid(field, `${field} must be a valid timestamp.`);
  const normalized = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(normalized.getTime())) invalid(field, `${field} must be a valid timestamp.`);
  return normalized;
}

function assertJsonScopeValue(value, field, location, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(field, `${field} must contain only finite JSON values.`);
    return;
  }
  if (typeof value !== 'object') invalid(field, `${field} must contain only JSON values.`);
  if (seen.has(value)) invalid(field, `${field} must not contain circular references.`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    invalid(field, `${field} must contain only plain JSON objects and arrays.`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonScopeValue(item, field, `${location}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertJsonScopeValue(item, field, `${location}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function jsonScope(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') invalid(field, `${field} must be a JSON object, array, or null.`);
  assertJsonScopeValue(value, field, field, new Set());
  return JSON.parse(JSON.stringify(value));
}

export function validateOrganizationRoleGrant(input = {}) {
  const role = requiredText(input.role, 'role', 32).toUpperCase();
  const evidenceLevel = requiredText(input.evidenceLevel, 'evidenceLevel', 2).toUpperCase();
  const status = requiredText(input.status ?? 'pending', 'status', 24).toLowerCase();
  if (!roleGrantTypes.has(role)) invalid('role', 'role must be FORWARDER or CARRIER.');
  if (!evidenceLevels.has(evidenceLevel)) invalid('evidenceLevel', 'evidenceLevel must be E0, E1, E2, or E3.');
  if (!roleGrantStatuses.has(status)) invalid('status', 'role-grant status is invalid.');
  const permitNo = optionalText(input.permitNo, 'permitNo', 120);
  const permitType = optionalText(input.permitType, 'permitType', 80);
  const issuingAuthority = optionalText(input.issuingAuthority, 'issuingAuthority', 180);
  const validFrom = instant(input.validFrom, 'validFrom', { optional: true });
  const validTo = instant(input.validTo, 'validTo', { optional: true });
  if (validTo && !validFrom) invalid('validFrom', 'validFrom is required when validTo is provided.');
  if (validTo && validTo.getTime() <= validFrom.getTime()) invalid('validTo', 'validTo must be later than validFrom.');
  if (status === 'active') {
    if (!permitNo) invalid('permitNo', 'An active role grant requires permitNo.');
    if (!permitType) invalid('permitType', 'An active role grant requires permitType.');
    if (!issuingAuthority) invalid('issuingAuthority', 'An active role grant requires issuingAuthority.');
    if (!validFrom) invalid('validFrom', 'An active role grant requires validFrom.');
  }

  return {
    id: input.id === null || input.id === undefined ? null : positiveId(input.id, 'id'),
    tenantId: requiredText(input.tenantId, 'tenantId', 64),
    organizationId: requiredText(input.organizationId, 'organizationId', 128),
    role,
    permitNo,
    permitType,
    issuingAuthority,
    validFrom,
    validTo,
    evidenceLevel,
    routeScope: jsonScope(input.routeScope, 'routeScope'),
    cargoScope: jsonScope(input.cargoScope, 'cargoScope'),
    status
  };
}

export function isRoleGrantEffectiveAt(grantInput, at = new Date()) {
  const grant = validateOrganizationRoleGrant(grantInput);
  const effectiveAt = instant(at, 'at');
  return grant.status === 'active'
    && Boolean(grant.validFrom)
    && effectiveAt.getTime() >= grant.validFrom.getTime()
    && (!grant.validTo || effectiveAt.getTime() < grant.validTo.getTime());
}

export function validateOperatingContext(input = {}, { roleGrant, at = new Date() } = {}) {
  if (!roleGrant) invalid('roleGrant', 'A server-loaded role grant is required.');
  const grant = validateOrganizationRoleGrant(roleGrant);
  if (grant.id === null) invalid('roleGrant.id', 'The role grant must have a persisted identifier.');
  const contextType = requiredText(input.contextType, 'contextType', 8).toUpperCase();
  const status = requiredText(input.status ?? 'active', 'status', 24).toLowerCase();
  if (!contextTypes.has(contextType)) invalid('contextType', 'contextType must be FWD or CAR.');
  if (!contextStatuses.has(status)) invalid('status', 'operating-context status is invalid.');
  const expectedType = operatingContextTypeForRoleGrant(grant.role);
  if (contextType !== expectedType) invalid('contextType', 'Operating context type does not match the role grant.');

  const tenantId = requiredText(input.tenantId, 'tenantId', 64);
  const organizationId = requiredText(input.organizationId, 'organizationId', 128);
  const roleGrantId = positiveId(input.roleGrantId, 'roleGrantId');
  if (tenantId !== grant.tenantId) invalid('tenantId', 'Operating context tenant does not match the role grant.');
  if (organizationId !== grant.organizationId) invalid('organizationId', 'Operating context organization does not match the role grant.');
  if (roleGrantId !== grant.id) invalid('roleGrantId', 'Operating context does not reference the supplied role grant.');
  if (status === 'active' && !isRoleGrantEffectiveAt(grant, at)) {
    invalid('status', 'An active operating context requires an active and effective role grant.');
  }

  const displayColor = optionalText(input.displayColor, 'displayColor', 16);
  if (displayColor && !/^#[0-9a-f]{6}$/i.test(displayColor)) invalid('displayColor', 'displayColor must be a six-digit hexadecimal color.');

  const ledgerId = optionalText(input.ledgerId, 'ledgerId', 128);
  if (status === 'active' && !ledgerId) invalid('ledgerId', 'An active operating context requires ledgerId.');

  return {
    contextId: requiredText(input.contextId, 'contextId', 128),
    tenantId,
    organizationId,
    roleGrantId,
    contextType,
    dataPartitionKey: requiredText(input.dataPartitionKey, 'dataPartitionKey', 160),
    ledgerId,
    displayColor,
    status
  };
}
