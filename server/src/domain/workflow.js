import { DOMAIN_STATES, ERROR_CODES, RFQ_LEVELS, STATE_GRAPH, hasPermission, normalizeRole } from '../../../shared/contract.js';

export class DomainError extends Error {
  constructor(code, message, status = 422, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assertKnownState(domain, state) {
  if (!DOMAIN_STATES[domain]?.includes(state)) {
    throw new DomainError('STATE-422', `وضعیت ${state || 'نامشخص'} برای دامنه ${domain} معتبر نیست.`);
  }
}

export function assertTransition(domain, from, to) {
  assertKnownState(domain, from);
  assertKnownState(domain, to);
  if (from === to) return true;
  if (!STATE_GRAPH[domain]?.[from]?.includes(to)) {
    throw new DomainError('STATE-409', `انتقال ${domain} از ${from} به ${to} مجاز نیست.`, 409, { domain, from, to });
  }
  return true;
}

export function assertTenantScope(actor, tenantId) {
  if (!actor?.tenantId || actor.tenantId !== tenantId) {
    throw new DomainError('AUTH-403', 'این شیء خارج از محدوده سازمانی شماست.', 403);
  }
}

export function assertOrganizationScope(actor, organizationId) {
  if (!actor?.organizationId || actor.organizationId !== organizationId) {
    throw new DomainError('AUTH-403', 'این عملیات برای سازمان شما مجاز نیست.', 403);
  }
}

export function assertPermission(actor, permission) {
  if (!hasPermission(actor?.role, permission)) {
    throw new DomainError('AUTH-403', 'مجوز لازم برای این عملیات را ندارید.', 403, { permission });
  }
}

export function hasDelegation(actor, action) {
  const scope = actor?.delegationScope;
  if (!scope) return false;
  if (Array.isArray(scope)) return scope.map((item) => String(item).trim()).includes(action);
  if (typeof scope === 'object') {
    if (scope[action] === true) return true;
    if (Array.isArray(scope.actions)) return scope.actions.map((item) => String(item).trim()).includes(action);
  }
  return false;
}

export function assertDelegated(actor, action) {
  if (normalizeRole(actor?.role) !== 'shipper_logistics_user') return true;
  if (!hasDelegation(actor, action)) {
    throw new DomainError('AUTH-403', `Delegation برای اقدام ${action} ثبت نشده است.`, 403, { action, delegationRequired: true });
  }
  return true;
}

export function assertHumanAward({ actor, level, winnerOrganizationType, isAiActor = false }) {
  if (isAiActor || actor?.isAi === true) {
    throw new DomainError('AWD-403', 'هوش مصنوعی اجازه ثبت یا اتصال برنده را ندارد.', 403);
  }
  const role = normalizeRole(actor?.role);
  const allowed = level === RFQ_LEVELS.MARKET_A
    ? ['shipper_admin', 'shipper_logistics_user']
    : ['company_x_owner', 'company_x_operations_manager'];
  if (!allowed.includes(role)) {
    throw new DomainError('AWD-403', 'اعطای برنده فقط توسط نقش انسانی مجاز انجام می‌شود.', 403);
  }
  if (level === RFQ_LEVELS.MARKET_A && role === 'shipper_logistics_user') assertDelegated(actor, 'award');
  if (level === RFQ_LEVELS.MARKET_B && winnerOrganizationType !== 'company_y') {
    throw new DomainError(ERROR_CODES.FORBIDDEN_DIRECT_DRIVER_AWARD, 'در بازار B فقط شرکت کرییر می‌تواند برنده ظرفیت باشد؛ اعطای مستقیم به راننده ممنوع است.', 403);
  }
  if (level === RFQ_LEVELS.MARKET_A && winnerOrganizationType !== 'company_x') {
    throw new DomainError('AWD-403', 'برنده RFQ1 باید شرکت حمل واجد شرایط باشد.', 403);
  }
  return true;
}

export function canReadQuote({ actor, rfq, quote, now = new Date() }) {
  if (!actor || !rfq || !quote) return false;
  if (actor.tenantId !== rfq.tenantId) return false;
  if (actor.organizationId === quote.bidderOrgId) return true;
  if (actor.organizationId !== rfq.publisherOrgId) return false;
  const deadlinePassed = rfq.deadlineAt && new Date(rfq.deadlineAt).getTime() <= now.getTime();
  return Boolean(deadlinePassed || rfq.state === 'AWARDED');
}

export function assertRelationshipAccess(actor, { payerOrgId, payeeOrgId, relationshipType }) {
  if (!actor?.organizationId || ![payerOrgId, payeeOrgId].includes(actor.organizationId)) {
    throw new DomainError('FIN-403', `دسترسی به رابطه مالی ${relationshipType || 'نامشخص'} مجاز نیست.`, 403);
  }
}

export function maskPhone(value = '') {
  const normalized = String(value);
  if (normalized.length < 7) return '••••••';
  return `${normalized.slice(0, 4)}••••${normalized.slice(-3)}`;
}

export function maskEmail(value = '') {
  const [local, domain] = String(value).split('@');
  if (!domain) return '••••';
  return `${(local || '').slice(0, 1)}•••@${domain}`;
}

export function assertContactReveal({ actor, reason, expiresAt, maxMinutes = 15 }) {
  if (!hasPermission(actor?.role, 'RV$')) {
    throw new DomainError('CRM-403', 'افشای تماس برای این نقش مجاز نیست.', 403);
  }
  if (String(reason || '').trim().length < 8) {
    throw new DomainError('CRM-403', 'دلیل افشای تماس باید ثبت شود.', 422);
  }
  const expiry = new Date(expiresAt);
  const upperBound = Date.now() + maxMinutes * 60 * 1000;
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now() || expiry.getTime() > upperBound) {
    throw new DomainError('CRM-429', `مدت افشای تماس حداکثر ${maxMinutes} دقیقه است.`, 429);
  }
}

export function assertTripStartReady(trip) {
  const readiness = typeof trip?.readiness === 'string' ? JSON.parse(trip.readiness || '{}') : (trip?.readiness || {});
  const missing = ['customsReady', 'routePermitReady', 'documentsReady', 'vehicleReady', 'driverReady']
    .filter((key) => readiness[key] !== true);
  if (readiness.preloadState !== 'CHECKED_IN') missing.push('preloadState');
  if (missing.length) {
    throw new DomainError(ERROR_CODES.COMPLIANCE_BLOCK, 'شروع سفر تا تکمیل گیت‌های گمرکی، مجوز مسیر و آمادگی عملیاتی مجاز نیست.', 451, { missing });
  }
  return true;
}

export function validatePodEvidence(evidence = {}, { authorizedAgentOrgId = null, otpRequired = false } = {}) {
  const missing = [];
  if (!evidence.recipientOrgId) missing.push('recipientOrgId');
  if (!evidence.authorityRef) missing.push('authorityRef');
  if (!evidence.receivedAt) missing.push('receivedAt');
  if (!evidence.location || !Number.isFinite(Number(evidence.location.lat)) || !Number.isFinite(Number(evidence.location.lng))) missing.push('location');
  if (!Array.isArray(evidence.photos) || evidence.photos.length === 0) missing.push('photos');
  if (!evidence.signedCmrRef) missing.push('signedCmrRef');
  if (authorizedAgentOrgId && evidence.recipientOrgId !== authorizedAgentOrgId) missing.push('authorizedRecipient');
  if (otpRequired && !evidence.otpVerified) missing.push('otpVerified');
  if (missing.length) {
    throw new DomainError(ERROR_CODES.INCOMPLETE_POD, 'شواهد تحویل برای پذیرش POD کافی نیست.', 424, { missing });
  }
  return true;
}

export function assertExportApproval({ request, actor }) {
  if (!request || request.state !== 'REQUESTED') {
    throw new DomainError('EXP-409', 'درخواست خروجی در وضعیت قابل تأیید نیست.', 409);
  }
  if (String(request.requestedByUserId) === String(actor?.userId)) {
    throw new DomainError('EXP-403', 'تأییدکننده خروجی باید شخص دوم باشد.', 403);
  }
}

export function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || ''); } catch (_error) { return fallback; }
}
