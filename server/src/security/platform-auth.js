import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { pool } from '../db.js';
import { JWT_SECRET, OPERATING_CONTEXT_SESSIONS_ENABLED } from '../config.js';
import {
  ADMIN_ROLES,
  CONTEXT_SESSION_MODES,
  ERROR_CODES,
  hasPermission,
  isCanonicalRole,
  normalizeRole,
  ROLES
} from '../../../shared/contract.js';
import {
  assertContextRoleCompatibility,
  assertCurrentSession,
  authenticationError,
  authorizationError,
  contextBindingError,
  contextSessionConflict,
  normalizeContextId,
  parseContextSessionClaims
} from '../domain/operating-context-session.js';
import { createOperatingContextSessionRepository } from '../repositories/operating-context-session.repository.js';

const jwtSecret = JWT_SECRET;
const maxTokenTtlSeconds = 4 * 60 * 60 + 60;
const runtimeEnvironment = String(process.env.NODE_ENV || 'development').toLowerCase();
const legacyAdminTokenAllowed = runtimeEnvironment !== 'production' && process.env.ALLOW_LEGACY_ADMIN_TOKEN === 'true';
const expectedAuthCodes = new Set([
  'AUTH-401',
  'AUTH-403',
  'AUTH-428',
  ERROR_CODES.CONTEXT_BINDING,
  ERROR_CODES.CONTEXT_SESSION_CONFLICT
]);
const sessionRouteModes = new Set(['business', 'bootstrap', 'context', 'selection']);

function authProblem(response, request, status, code, detail) {
  return response.status(status).type('application/problem+json').json({
    type: `https://gomrok.org/problems/${code}`,
    title: code,
    status,
    detail,
    code,
    correlationId: request.correlationId
  });
}

function parseScope(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || ''); } catch (_error) { return null; }
}

function tokenFromRequest(request) {
  const authorization = String(request.headers.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1] || '';
  return token.length <= 4096 ? token : '';
}

function purposeFromRequest(request) {
  return String(request.headers['x-purpose-scope'] || '').trim().slice(0, 256);
}

function validateClaims(claims) {
  const now = Math.floor(Date.now() / 1000);
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('invalid claims');
  if (typeof claims.sub !== 'string' || !claims.sub.trim() || typeof claims.role !== 'string' || !claims.role.trim()) throw new Error('invalid subject or role');
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) throw new Error('missing token lifetime');
  if (claims.iat > now + 60 || claims.exp <= claims.iat || claims.exp - claims.iat > maxTokenTtlSeconds) throw new Error('invalid token lifetime');
  return claims;
}

export function verifyPlatformToken(request) {
  const token = tokenFromRequest(request);
  if (!token) {
    const error = new Error('ورود به سامانه لازم است.');
    error.status = 401;
    error.code = 'AUTH-401';
    throw error;
  }
  try {
    return validateClaims(jwt.verify(token, jwtSecret, { algorithms: ['HS256'], clockTolerance: 5 }));
  } catch (_error) {
    const error = new Error('نشست کاربر منقضی یا نامعتبر است.');
    error.status = 401;
    error.code = 'AUTH-401';
    throw error;
  }
}

function allowedRole(role, roles) {
  if (!roles?.length) return true;
  const normalized = normalizeRole(role);
  return roles.map(normalizeRole).includes(normalized);
}

function actorFromContextAccess(access, purpose) {
  return {
    userId: access.userId,
    membershipId: access.membershipId,
    tenantId: access.tenantId,
    organizationId: access.organizationId,
    organizationType: access.organizationType,
    role: normalizeRole(access.role),
    transactionRole: access.transactionRole,
    routeScope: access.routeScope,
    countryScope: access.countryScope,
    cargoScope: access.cargoScope,
    qualificationState: access.qualificationState,
    kycLevel: access.kycLevel,
    contractState: access.contractState,
    delegationScope: access.delegationScope,
    externalType: access.externalType,
    externalId: access.externalId,
    contextId: access.contextId,
    contextType: access.contextType,
    contextRoleGrantId: access.roleGrantId,
    contextRoleGrantType: access.roleGrantType,
    contextEvidenceLevel: access.evidenceLevel,
    isAi: false,
    purpose: purpose || null
  };
}

async function authenticateContextSession(request, claims, routeMode) {
  const parsed = parseContextSessionClaims(claims);
  if (!parsed) return null;
  const userId = Number(claims.userId);
  const membershipId = Number(claims.membershipId);
  const tenantId = typeof claims.tenantId === 'string' ? claims.tenantId.trim() : '';
  const organizationId = typeof claims.organizationId === 'string' ? claims.organizationId.trim() : '';
  if (
    !Number.isSafeInteger(userId) || userId < 1 ||
    !Number.isSafeInteger(membershipId) || membershipId < 1 ||
    !tenantId || !organizationId
  ) {
    throw authenticationError('نشست فاقد عضویت سازمانی معتبر است.');
  }

  const repository = createOperatingContextSessionRepository(pool);
  const session = await repository.findSession({ sessionId: parsed.sessionId, tenantId, userId });
  assertCurrentSession(session, parsed);

  const access = parsed.sessionMode === CONTEXT_SESSION_MODES.CONTEXT
    ? await repository.findContextAccess({
      tenantId,
      userId,
      membershipId: session.activeMembershipId,
      organizationId: session.activeOrganizationId,
      contextId: session.activeContextId
    })
    : await repository.findOriginMembership({
      tenantId,
      userId,
      membershipId: session.originMembershipId
    });
  if (!access) throw authorizationError();
  assertContextRoleCompatibility(access);

  const role = normalizeRole(claims.role);
  if (
    access.membershipId !== membershipId ||
    access.organizationId !== organizationId ||
    normalizeRole(access.role) !== role
  ) {
    throw contextSessionConflict();
  }

  if (routeMode === 'business' && parsed.sessionMode !== CONTEXT_SESSION_MODES.CONTEXT) {
    throw contextBindingError('برای دسترسی عملیاتی ابتدا یک زمینه فعال انتخاب کنید.');
  }
  if (routeMode === 'bootstrap' && parsed.sessionMode !== CONTEXT_SESSION_MODES.BOOTSTRAP) {
    throw contextSessionConflict('نشست انتخاب زمینه قبلاً مصرف شده است.');
  }
  if (routeMode === 'context' && parsed.sessionMode !== CONTEXT_SESSION_MODES.CONTEXT) {
    throw contextBindingError('نشست فاقد زمینه عملیاتی فعال است.');
  }

  if (parsed.sessionMode === CONTEXT_SESSION_MODES.CONTEXT) {
    const requestedContextId = resolveOperatingContextHeader(request);
    if (requestedContextId !== access.contextId) throw contextBindingError();
  }

  return {
    actor: actorFromContextAccess(access, purposeFromRequest(request)),
    session: Object.freeze({ ...parsed, tenantId, userId })
  };
}

export function platformAuth({ roles = [], permission = null, sessionMode = 'business' } = {}) {
  if (!sessionRouteModes.has(sessionMode)) throw new TypeError('platformAuth sessionMode is invalid.');
  return async (request, response, next) => {
    try {
      const claims = verifyPlatformToken(request);
      const role = normalizeRole(claims.role);
      if (!isCanonicalRole(role)) return authProblem(response, request, 401, 'AUTH-401', 'نقش نشست در قرارداد پلتفرم معتبر نیست.');

      if (role === ROLES.SUPER_ADMIN && claims.sub === 'super-admin') {
        if (sessionMode !== 'business') throw authenticationError();
        if (!legacyAdminTokenAllowed) {
          return authProblem(response, request, 403, 'AUTH-403', 'نشست Legacy Admin غیرفعال است؛ از نشست سازمانی قابل انتساب استفاده کنید.');
        }
        request.actor = {
          userId: null,
          membershipId: null,
          tenantId: typeof claims.tenantId === 'string' && claims.tenantId.trim() ? claims.tenantId.trim() : 'platform',
          organizationId: typeof claims.organizationId === 'string' && claims.organizationId.trim() ? claims.organizationId.trim() : 'platform',
          organizationType: 'platform',
          role,
          isAi: false,
          purpose: purposeFromRequest(request) || null
        };
      } else {
        const contextAuthentication = await authenticateContextSession(request, claims, sessionMode);
        if (contextAuthentication) {
          request.actor = contextAuthentication.actor;
          request.contextSession = contextAuthentication.session;
        } else {
          if (sessionMode !== 'business') throw authenticationError();
          const userId = Number(claims.userId);
          const membershipId = Number(claims.membershipId);
          if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(membershipId) || membershipId < 1 || typeof claims.tenantId !== 'string' || !claims.tenantId.trim() || typeof claims.organizationId !== 'string' || !claims.organizationId.trim()) {
            return authProblem(response, request, 401, 'AUTH-401', 'نشست فاقد عضویت سازمانی معتبر است.');
          }
          const [rows] = await pool.execute(
            `SELECT m.id AS membership_id, m.tenant_id, m.organization_id, m.role, m.transaction_role,
                    m.route_scope, m.country_scope, m.cargo_scope, m.qualification_state, m.kyc_level, m.contract_state,
                    m.delegation_json, o.organization_type, o.status AS organization_status,
                    u.external_type, u.external_id
               FROM organization_memberships m
               JOIN platform_users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
               JOIN platform_organizations o ON o.id = m.organization_id AND o.tenant_id = m.tenant_id
              WHERE m.id = ? AND m.user_id = ? AND m.tenant_id = ?
                AND m.organization_id = ? AND m.status = 'active' AND u.status = 'active' AND o.status = 'active'
              LIMIT 1`,
            [membershipId, userId, claims.tenantId, claims.organizationId]
          );
          const membership = rows[0];
          if (!membership || normalizeRole(membership.role) !== role) {
            return authProblem(response, request, 401, 'AUTH-401', 'عضویت سازمانی فعال پیدا نشد.');
          }
          if (OPERATING_CONTEXT_SESSIONS_ENABLED) {
            const hasContextMapping = await createOperatingContextSessionRepository(pool).hasContextMapping({
              tenantId: membership.tenant_id,
              userId
            });
            if (hasContextMapping) {
              throw contextBindingError('نشست قدیمی این کاربر فاقد اتصال زمینه است؛ دوباره وارد شوید.');
            }
          }
          request.actor = {
            userId,
            membershipId,
            tenantId: membership.tenant_id,
            organizationId: membership.organization_id,
            organizationType: membership.organization_type,
            role,
            transactionRole: membership.transaction_role,
            routeScope: parseScope(membership.route_scope),
            countryScope: parseScope(membership.country_scope),
            cargoScope: parseScope(membership.cargo_scope),
            qualificationState: membership.qualification_state,
            kycLevel: membership.kyc_level,
            contractState: membership.contract_state,
            delegationScope: parseScope(membership.delegation_json),
            externalType: membership.external_type,
            externalId: Number(membership.external_id),
            isAi: false,
            purpose: purposeFromRequest(request) || null
          };
        }
      }

      if (!allowedRole(role, roles)) {
        return authProblem(response, request, 403, 'AUTH-403', 'نقش کاربر برای این عملیات مجاز نیست.');
      }
      if (permission && !hasPermission(request.actor.role, permission)) {
        return authProblem(response, request, 403, 'AUTH-403', 'مجوز لازم برای این عملیات را ندارید.');
      }
      if (role === ROLES.AGENT_Z && !['agent_z', 'consignee'].includes(request.actor.organizationType)) {
        return authProblem(response, request, 403, 'AUTH-403', 'نقش Agent باید به سازمان Agent/Z یا Consignee متصل باشد.');
      }
      if (role === ROLES.CONSIGNEE && !['consignee', 'agent_z'].includes(request.actor.organizationType)) {
        return authProblem(response, request, 403, 'AUTH-403', 'نقش گیرنده باید به سازمان گیرنده یا Agent/Z متصل باشد.');
      }
      if (sessionMode === 'business' && ADMIN_ROLES.includes(role) && String(request.actor.purpose || '').length < 8) {
        return authProblem(response, request, 428, 'AUTH-428', 'نشست ستادی نیازمند محدوده هدف و دلیل عملیاتی است.');
      }
      return next();
    } catch (error) {
      if (expectedAuthCodes.has(error.code)) {
        return authProblem(response, request, error.status || 401, error.code, error.message || 'احراز هویت انجام نشد.');
      }
      return authProblem(response, request, 503, 'AUTH-503', 'سرویس احراز هویت موقتاً در دسترس نیست.');
    }
  };
}

export const IDEMPOTENCY_KEY_HEADERS = Object.freeze({
  canonical: 'Idempotency-Key',
  legacy: 'X-Idempotency-Key'
});

export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const OPERATING_CONTEXT_HEADER = 'X-Operating-Context';

const idempotencyKeyPattern = /^[A-Za-z0-9!#$%&'*+\-.^_`|~:/=]+$/;

function idempotencyHeaderError(detail) {
  const error = new Error(detail);
  error.status = 400;
  error.code = ERROR_CODES.IDEMPOTENCY_HEADER;
  return error;
}

function headerValues(request, headerName) {
  const normalizedName = headerName.toLowerCase();
  if (Array.isArray(request.rawHeaders)) {
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (String(request.rawHeaders[index] || '').toLowerCase() === normalizedName) {
        values.push(request.rawHeaders[index + 1]);
      }
    }
    if (values.length) return values;
  }

  const values = [];
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (name.toLowerCase() !== normalizedName) continue;
    if (Array.isArray(value)) values.push(...value);
    else values.push(value);
  }
  return values;
}

export function resolveOperatingContextHeader(request, { required = true } = {}) {
  const values = headerValues(request, OPERATING_CONTEXT_HEADER);
  if (!values.length) {
    if (!required) return null;
    throw contextBindingError('هدر X-Operating-Context لازم است.');
  }
  if (values.length !== 1 || typeof values[0] !== 'string') {
    throw contextBindingError('هدر X-Operating-Context باید دقیقاً یک مقدار داشته باشد.');
  }
  return normalizeContextId(values[0], { field: OPERATING_CONTEXT_HEADER });
}

function readIdempotencyHeader(request, headerName) {
  const values = headerValues(request, headerName);
  if (!values.length) return { present: false, value: null };
  if (values.length !== 1 || typeof values[0] !== 'string') {
    throw idempotencyHeaderError('هر هدر جلوگیری از تکرار باید دقیقاً یک مقدار داشته باشد.');
  }
  return { present: true, value: values[0].replace(/^[\t ]+|[\t ]+$/g, '') };
}

function validateIdempotencyKey(value) {
  if (!value || value.length > IDEMPOTENCY_KEY_MAX_LENGTH || value.includes(',') || !idempotencyKeyPattern.test(value)) {
    throw idempotencyHeaderError('مقدار هدر جلوگیری از تکرار معتبر نیست.');
  }
  return value;
}

export function resolveIdempotencyKey(request) {
  const canonical = readIdempotencyHeader(request, IDEMPOTENCY_KEY_HEADERS.canonical);
  const legacy = readIdempotencyHeader(request, IDEMPOTENCY_KEY_HEADERS.legacy);

  if (!canonical.present && !legacy.present) return null;
  if (canonical.present && legacy.present && canonical.value !== legacy.value) {
    throw idempotencyHeaderError('دو هدر جلوگیری از تکرار مقدار یکسانی ندارند.');
  }

  return validateIdempotencyKey(canonical.present ? canonical.value : legacy.value);
}
