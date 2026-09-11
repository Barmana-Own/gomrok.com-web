import {
  CONTEXT_SESSION_MODES,
  ERROR_CODES,
  OPERATING_CONTEXT_TYPES,
  operatingContextTypeForRoleGrant,
  ROLES,
  normalizeRole
} from '../../../shared/contract.js';

export const CONTEXT_ID_MAX_LENGTH = 128;
export const CONTEXT_SESSION_ID_MAX_LENGTH = 64;
export const CONTEXT_REFRESH_TOKEN_MIN_LENGTH = 32;
export const CONTEXT_REFRESH_TOKEN_MAX_LENGTH = 512;

const contextIdPattern = /^[\x21-\x2b\x2d-\x7e]+$/;
const sessionIdPattern = /^[A-Za-z0-9_-]{32,64}$/;
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

export class ContextSessionError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ContextSessionError';
    this.code = code;
    this.status = status;
  }
}

export function contextBindingError(message = 'زمینه عملیاتی نشست با درخواست تطابق ندارد.') {
  return new ContextSessionError(ERROR_CODES.CONTEXT_BINDING, message, 400);
}

export function contextSessionConflict(message = 'نسخه نشست تغییر کرده است؛ نشست جدید را استفاده کنید.') {
  return new ContextSessionError(ERROR_CODES.CONTEXT_SESSION_CONFLICT, message, 409);
}

export function authenticationError(message = 'نشست کاربر منقضی یا نامعتبر است.') {
  return new ContextSessionError('AUTH-401', message, 401);
}

export function authorizationError(message = 'زمینه عملیاتی برای این کاربر در دسترس نیست.') {
  return new ContextSessionError('AUTH-403', message, 403);
}

export function normalizeContextId(value, { field = 'contextId' } = {}) {
  if (typeof value !== 'string') throw contextBindingError(`${field} معتبر نیست.`);
  if (
    !value ||
    value.length > CONTEXT_ID_MAX_LENGTH ||
    value !== value.trim() ||
    value.includes(',') ||
    !contextIdPattern.test(value)
  ) {
    throw contextBindingError(`${field} معتبر نیست.`);
  }
  return value;
}

export function normalizeRefreshToken(value) {
  if (
    typeof value !== 'string' ||
    value.length < CONTEXT_REFRESH_TOKEN_MIN_LENGTH ||
    value.length > CONTEXT_REFRESH_TOKEN_MAX_LENGTH ||
    value !== value.trim() ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw authenticationError('توکن نوسازی نامعتبر یا منقضی است.');
  }
  return value;
}

export function assertContextRoleCompatibility(access) {
  if (!access?.contextId) return access;
  const role = normalizeRole(access.role);
  const membershipRoleValid = access.contextType === OPERATING_CONTEXT_TYPES.FORWARDER
    ? forwarderRoles.has(role)
    : access.contextType === OPERATING_CONTEXT_TYPES.CARRIER && carrierRoles.has(role);
  const grantRoleValid = operatingContextTypeForRoleGrant(access.roleGrantType) === access.contextType;
  if (!membershipRoleValid || !grantRoleValid) {
    throw authorizationError('نگاشت نقش کاربر به زمینه عملیاتی معتبر نیست.');
  }
  return access;
}

export function parseContextSessionClaims(claims) {
  const fields = ['sessionId', 'sessionMode', 'sessionGeneration', 'contextId'];
  const hasAnyField = fields.some((field) => claims?.[field] !== undefined && claims?.[field] !== null);
  if (!hasAnyField) return null;

  const sessionId = typeof claims.sessionId === 'string' ? claims.sessionId : '';
  const sessionMode = claims.sessionMode;
  const sessionGeneration = claims.sessionGeneration;
  if (!sessionIdPattern.test(sessionId)) throw authenticationError();
  if (!Object.values(CONTEXT_SESSION_MODES).includes(sessionMode)) throw authenticationError();
  if (!Number.isSafeInteger(sessionGeneration) || sessionGeneration < 0) throw authenticationError();

  let contextId = null;
  if (sessionMode === CONTEXT_SESSION_MODES.CONTEXT) {
    if (sessionGeneration < 1) throw authenticationError();
    contextId = normalizeContextId(claims.contextId);
  } else if (claims.contextId !== null && claims.contextId !== undefined) {
    throw authenticationError();
  }

  return Object.freeze({ sessionId, sessionMode, sessionGeneration, contextId });
}

export function assertCurrentSession(session, claims, at = new Date()) {
  if (!session) throw authenticationError();
  const expiresAt = new Date(session.expiresAt);
  if (session.status !== 'active' || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= at.getTime()) {
    throw authenticationError();
  }
  if (
    session.mode !== claims.sessionMode ||
    session.generation !== claims.sessionGeneration ||
    (session.activeContextId || null) !== (claims.contextId || null)
  ) {
    throw contextSessionConflict();
  }
  return session;
}
