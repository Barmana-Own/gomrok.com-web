import {
  ERROR_CODES,
  OPERATING_CONTEXT_TYPES,
  ORGANIZATION_ROLE_GRANT_TYPES,
  PERMISSIONS,
  RFQ_LEVELS,
  ROLES,
  hasPermission,
  normalizeRole
} from '../../../shared/contract.js';

export const RFQ_READ_MODES = Object.freeze({
  PUBLISHER: 'publisher',
  BIDDER: 'bidder'
});

const forwarderRoles = new Set([
  ROLES.COMPANY_X_OWNER,
  ROLES.COMPANY_X_OPERATIONS_MANAGER,
  ROLES.COMPANY_X_PRICING_EXPERT,
  ROLES.COMPANY_X_DISPATCHER,
  ROLES.COMPANY_X_DOCUMENT_EXPERT
]);

const carrierRoles = new Set([
  ROLES.COMPANY_Y_OWNER,
  ROLES.COMPANY_Y_DOCUMENT_ISSUER
]);

const internalPricingRoles = new Set([
  ROLES.COMPANY_X_OWNER,
  ROLES.COMPANY_X_PRICING_EXPERT
]);

export class RfqContextAccessError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = 'RfqContextAccessError';
    this.code = code;
    this.status = status;
  }
}

function crossContextError() {
  return new RfqContextAccessError(
    ERROR_CODES.CONTEXT_CROSS_SCOPE,
    'این منبع خارج از زمینه عملیاتی فعال است.'
  );
}

function confidentialRateError() {
  return new RfqContextAccessError(
    ERROR_CODES.CONTEXT_CONFIDENTIAL_RATE,
    'دسترسی به نرخ محرمانه در زمینه عملیاتی فعال مجاز نیست.'
  );
}

function legacyAuthorizationError() {
  return new RfqContextAccessError('AUTH-403', 'این دفتر پیشنهاد خارج از بازار و عضویت شماست.');
}

function field(object, snakeCase, camelCase) {
  return object?.[snakeCase] ?? object?.[camelCase] ?? null;
}

function sameIdentifier(first, second) {
  return first !== null && first !== undefined
    && second !== null && second !== undefined
    && String(first) === String(second);
}

export function isContextBoundRfqActor(actor) {
  return Boolean(actor?.contextId || actor?.contextType || actor?.contextRoleGrantType);
}

function assertContextIdentity(actor) {
  const role = normalizeRole(actor?.role);
  if (!actor?.contextId || !actor?.contextType || !actor?.contextRoleGrantType || !actor?.organizationId) {
    throw crossContextError();
  }

  if (actor.contextType === OPERATING_CONTEXT_TYPES.FORWARDER) {
    if (!forwarderRoles.has(role) || actor.contextRoleGrantType !== ORGANIZATION_ROLE_GRANT_TYPES.FORWARDER) {
      throw crossContextError();
    }
    return OPERATING_CONTEXT_TYPES.FORWARDER;
  }

  if (actor.contextType === OPERATING_CONTEXT_TYPES.CARRIER) {
    if (!carrierRoles.has(role) || actor.contextRoleGrantType !== ORGANIZATION_ROLE_GRANT_TYPES.CARRIER) {
      throw crossContextError();
    }
    return OPERATING_CONTEXT_TYPES.CARRIER;
  }

  throw crossContextError();
}

export function assertCarrierRfqListAccess(actor) {
  if (!isContextBoundRfqActor(actor)) return false;
  if (assertContextIdentity(actor) !== OPERATING_CONTEXT_TYPES.CARRIER) throw crossContextError();
  return true;
}

export function resolveRfqReadAccess({ actor, rfq, legacyOrganization = null }) {
  if (!actor || !rfq || !sameIdentifier(actor.tenantId, field(rfq, 'tenant_id', 'tenantId'))) {
    if (isContextBoundRfqActor(actor)) throw crossContextError();
    throw legacyAuthorizationError();
  }

  const level = field(rfq, 'level', 'level');
  const publisherOrganizationId = field(rfq, 'publisher_org_id', 'publisherOrgId');

  if (![RFQ_LEVELS.MARKET_A, RFQ_LEVELS.MARKET_B].includes(level)) {
    if (isContextBoundRfqActor(actor)) throw crossContextError();
    throw legacyAuthorizationError();
  }

  if (isContextBoundRfqActor(actor)) {
    const contextType = assertContextIdentity(actor);
    if (contextType === OPERATING_CONTEXT_TYPES.CARRIER) {
      if (level !== RFQ_LEVELS.MARKET_B || sameIdentifier(actor.organizationId, publisherOrganizationId)) {
        throw crossContextError();
      }
      return Object.freeze({ mode: RFQ_READ_MODES.BIDDER, contextBound: true });
    }

    if (level === RFQ_LEVELS.MARKET_A) {
      if (sameIdentifier(actor.organizationId, publisherOrganizationId)) throw crossContextError();
      return Object.freeze({ mode: RFQ_READ_MODES.BIDDER, contextBound: true });
    }
    if (level === RFQ_LEVELS.MARKET_B && sameIdentifier(actor.organizationId, publisherOrganizationId)) {
      return Object.freeze({ mode: RFQ_READ_MODES.PUBLISHER, contextBound: true });
    }
    throw crossContextError();
  }

  if (sameIdentifier(actor.organizationId, publisherOrganizationId)) {
    return Object.freeze({ mode: RFQ_READ_MODES.PUBLISHER, contextBound: false });
  }

  const expectedOrganizationType = level === RFQ_LEVELS.MARKET_A ? 'company_x' : 'company_y';
  if (
    legacyOrganization?.status === 'active'
    && legacyOrganization?.qualification_state === 'qualified'
    && legacyOrganization?.organization_type === expectedOrganizationType
  ) {
    return Object.freeze({ mode: RFQ_READ_MODES.BIDDER, contextBound: false });
  }
  throw legacyAuthorizationError();
}

export function assertConfidentialRateAccess(actor) {
  const role = normalizeRole(actor?.role);
  if (isContextBoundRfqActor(actor)) {
    const contextType = assertContextIdentity(actor);
    if (contextType === OPERATING_CONTEXT_TYPES.CARRIER) throw confidentialRateError();
    if (contextType !== OPERATING_CONTEXT_TYPES.FORWARDER) throw crossContextError();
  }

  if (!internalPricingRoles.has(role) || !hasPermission(role, PERMISSIONS.SEE_PRICE)) {
    throw legacyAuthorizationError();
  }
  return true;
}

export function mayLoadAllRfqQuotes({ access, rfq, now = new Date() }) {
  if (access?.mode !== RFQ_READ_MODES.PUBLISHER) return false;
  const state = field(rfq, 'state', 'state');
  if (state === 'AWARDED') return true;
  const deadline = new Date(field(rfq, 'deadline_at', 'deadlineAt'));
  return !Number.isNaN(deadline.getTime()) && deadline.getTime() <= now.getTime();
}
