import { ROLES, normalizeRole } from '../../../shared/contract.js';

export const PLATFORM_PANEL_ROLE_MAP = Object.freeze({
  shipper: Object.freeze([
    ROLES.SHIPPER_ADMIN,
    ROLES.SHIPPER_LOGISTICS_USER,
    ROLES.SHIPPER_FINANCE_USER,
    ROLES.CONSIGNEE
  ]),
  forwarder: Object.freeze([
    ROLES.COMPANY_X_OWNER,
    ROLES.COMPANY_X_OPERATIONS_MANAGER,
    ROLES.COMPANY_X_PRICING_EXPERT,
    ROLES.COMPANY_X_DISPATCHER,
    ROLES.COMPANY_X_DOCUMENT_EXPERT
  ]),
  agent: Object.freeze([ROLES.AGENT_Z])
});

export const PLATFORM_ROLE_LABELS = Object.freeze({
  [ROLES.SHIPPER_ADMIN]: 'مدیر صاحب کالا',
  [ROLES.SHIPPER_LOGISTICS_USER]: 'کاربر لجستیک صاحب کالا',
  [ROLES.SHIPPER_FINANCE_USER]: 'کاربر مالی صاحب کالا',
  [ROLES.CONSIGNEE]: 'گیرنده / کاربر مقصد',
  [ROLES.COMPANY_X_OWNER]: 'مالک شرکت X',
  [ROLES.COMPANY_X_OPERATIONS_MANAGER]: 'مدیر عملیات شرکت X',
  [ROLES.COMPANY_X_PRICING_EXPERT]: 'متخصص قیمت‌گذاری شرکت X',
  [ROLES.COMPANY_X_DISPATCHER]: 'دیسپچر شرکت X',
  [ROLES.COMPANY_X_DOCUMENT_EXPERT]: 'متخصص اسناد شرکت X',
  [ROLES.AGENT_Z]: 'نماینده مقصد Z'
});

const phonePattern = /^09\d{9}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeDigits(value = '') {
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));
}

export function normalizePlatformLoginIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 180) return '';
  const compactPhone = normalizeDigits(raw).replace(/[\s()-]/g, '');
  if (phonePattern.test(compactPhone)) return compactPhone;
  return raw.toLowerCase().replace(/\s+/g, ' ');
}

export function isValidPlatformLoginIdentifier(value) {
  const normalized = normalizePlatformLoginIdentifier(value);
  return Boolean(normalized && (phonePattern.test(normalized) || emailPattern.test(normalized)));
}

export function validatePlatformLoginInput(body = {}) {
  const panel = String(body.panel || '').trim().toLowerCase();
  const allowedRoles = PLATFORM_PANEL_ROLE_MAP[panel];
  if (!allowedRoles) {
    const error = new Error('سطح ورود معتبر نیست.');
    error.code = 'AUTH-400';
    error.status = 400;
    throw error;
  }

  const identifier = normalizePlatformLoginIdentifier(body.identifier);
  const password = String(body.password || '');
  const requestedRole = body.role ? normalizeRole(body.role) : '';
  if (!identifier || (!phonePattern.test(identifier) && !emailPattern.test(identifier))) {
    const error = new Error('ایمیل کاری یا شماره موبایل معتبر نیست.');
    error.code = 'AUTH-400';
    error.status = 400;
    throw error;
  }
  if (password.length < 12 || password.length > 256) {
    const error = new Error('رمز عبور باید بین ۱۲ تا ۲۵۶ نویسه باشد.');
    error.code = 'AUTH-400';
    error.status = 400;
    throw error;
  }
  if (requestedRole && !allowedRoles.includes(requestedRole)) {
    const error = new Error('نقش انتخاب‌شده به این پنل تعلق ندارد.');
    error.code = 'AUTH-400';
    error.status = 400;
    throw error;
  }
  return { panel, identifier, password, requestedRole, allowedRoles };
}

export function selectPlatformMembership(rows, { allowedRoles, requestedRole = '' } = {}) {
  const candidates = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const role = normalizeRole(row.role);
    if (!allowedRoles?.includes(role) || (requestedRole && requestedRole !== role)) continue;
    const membershipId = Number(row.membership_id);
    if (!Number.isSafeInteger(membershipId) || membershipId < 1 || seen.has(membershipId)) continue;
    seen.add(membershipId);
    candidates.push({ ...row, role });
  }

  if (!candidates.length) return { kind: 'not-found' };
  if (candidates.length > 1) {
    return {
      kind: 'ambiguous',
      roles: [...new Map(candidates.map((row) => [row.role, { role: row.role, label: PLATFORM_ROLE_LABELS[row.role] || row.role }])).values()]
    };
  }
  return { kind: 'selected', membership: candidates[0] };
}

export function publicPlatformUser(row) {
  return {
    id: Number(row.user_id),
    userId: Number(row.user_id),
    displayName: row.display_name,
    role: normalizeRole(row.role),
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    organizationType: row.organization_type,
    membershipId: Number(row.membership_id),
    status: 'active'
  };
}
