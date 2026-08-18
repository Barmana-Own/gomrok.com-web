import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config.js';
import { ADMIN_ROLES, hasPermission, isCanonicalRole, normalizeRole, ROLES } from '../../../shared/contract.js';

const jwtSecret = JWT_SECRET;
const maxTokenTtlSeconds = 4 * 60 * 60 + 60;
const runtimeEnvironment = String(process.env.NODE_ENV || 'development').toLowerCase();
const legacyAdminTokenAllowed = runtimeEnvironment !== 'production' && process.env.ALLOW_LEGACY_ADMIN_TOKEN === 'true';
const expectedAuthCodes = new Set(['AUTH-401', 'AUTH-403', 'AUTH-428']);

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

export function platformAuth({ roles = [], permission = null } = {}) {
  return async (request, response, next) => {
    try {
      const claims = verifyPlatformToken(request);
      const role = normalizeRole(claims.role);
      if (!isCanonicalRole(role)) return authProblem(response, request, 401, 'AUTH-401', 'نقش نشست در قرارداد پلتفرم معتبر نیست.');
      if (!allowedRole(role, roles)) {
        return authProblem(response, request, 403, 'AUTH-403', 'نقش کاربر برای این عملیات مجاز نیست.');
      }

      if (role === ROLES.SUPER_ADMIN && claims.sub === 'super-admin') {
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
        if (role === ROLES.AGENT_Z && !['agent_z', 'consignee'].includes(membership.organization_type)) {
          return authProblem(response, request, 403, 'AUTH-403', 'نقش Agent باید به سازمان Agent/Z یا Consignee متصل باشد.');
        }
        if (role === ROLES.CONSIGNEE && !['consignee', 'agent_z'].includes(membership.organization_type)) {
          return authProblem(response, request, 403, 'AUTH-403', 'نقش گیرنده باید به سازمان گیرنده یا Agent/Z متصل باشد.');
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

      if (ADMIN_ROLES.includes(role) && String(request.actor.purpose || '').length < 8) {
        return authProblem(response, request, 428, 'AUTH-428', 'نشست ستادی نیازمند محدوده هدف و دلیل عملیاتی است.');
      }
      if (permission && !hasPermission(request.actor.role, permission)) {
        return authProblem(response, request, 403, 'AUTH-403', 'مجوز لازم برای این عملیات را ندارید.');
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

export function idempotencyKey(request) {
  return String(request.headers['x-idempotency-key'] || '').trim().slice(0, 128);
}
