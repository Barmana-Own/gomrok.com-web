import { useEffect, useMemo, useState } from 'react';
import { usePlatformRealtime } from '../hooks/usePlatformRealtime.js';
import { RiskBadge } from './PlatformPrimitives.jsx';

const roleLabels = {
  super_admin: 'Super Admin',
  marketplace_admin: 'Marketplace Admin',
  conflict_officer: 'Conflict of Interest Officer',
  security_admin: 'Security Admin',
  compliance_officer: 'Compliance Officer',
  risk_manager: 'Risk Manager',
  customer_support: 'Customer Support',
  finance_admin: 'Finance Admin',
  government_observer: 'Government Observer',
  data_governance_officer: 'Data Governance Officer',
  crm_admin: 'CRM Admin',
  support_lead: 'Support Lead'
};

const menu = [
  ['dashboard', 'داشبورد حاکمیت'],
  ['users', 'Users / Memberships'],
  ['organizations', 'سازمان‌ها و Tenantها'],
  ['qualification', 'KYC / صلاحیت'],
  ['marketplace', 'حاکمیت RFQ / بازار'],
  ['trips', 'حاکمیت سفرها'],
  ['cases', 'ریسک / انطباق / تعارض'],
  ['audit', 'حسابرسی append-only'],
  ['breakglass', 'Break-Glass کنترل‌شده'],
  ['rulepacks', 'RulePack / Rule Engine'],
  ['pricing', 'Pricing Governance'],
  ['finance', 'حاکمیت مالی'],
  ['claims', 'Claims / Disputes'],
  ['exports', 'درخواست‌های خروجی'],
  ['security', 'امنیت / اعلان / Reveal'],
  ['crm', 'CRM Governance'],
  ['bi', 'BI / KPI تجمیعی'],
  ['ai', 'پایش AI'],
  ['health', 'سلامت / Backup / DR']
];

const roleMenu = {
  qualification: ['super_admin', 'marketplace_admin', 'compliance_officer'],
  marketplace: ['super_admin', 'marketplace_admin', 'conflict_officer', 'risk_manager', 'security_admin'],
  trips: ['super_admin', 'marketplace_admin', 'security_admin', 'compliance_officer', 'risk_manager'],
  breakglass: ['super_admin', 'security_admin', 'conflict_officer'],
  rulepacks: ['super_admin', 'marketplace_admin', 'compliance_officer', 'risk_manager'],
  pricing: ['super_admin', 'marketplace_admin', 'finance_admin'],
  finance: ['finance_admin'],
  claims: ['super_admin', 'marketplace_admin', 'compliance_officer', 'risk_manager', 'customer_support', 'finance_admin'],
  exports: ['super_admin', 'marketplace_admin', 'security_admin', 'data_governance_officer', 'crm_admin', 'support_lead'],
  security: ['super_admin', 'marketplace_admin', 'security_admin', 'conflict_officer', 'data_governance_officer'],
  crm: ['super_admin', 'marketplace_admin', 'data_governance_officer', 'crm_admin', 'support_lead'],
  bi: ['super_admin', 'marketplace_admin', 'compliance_officer', 'risk_manager', 'finance_admin', 'security_admin', 'data_governance_officer'],
  ai: ['super_admin', 'marketplace_admin', 'security_admin', 'compliance_officer', 'risk_manager'],
  health: ['super_admin', 'security_admin']
};

const caseTypes = [
  ['COMPLIANCE', 'انطباق'],
  ['RISK', 'ریسک'],
  ['CONFLICT', 'تعارض منافع'],
  ['SECURITY', 'امنیت'],
  ['INCIDENT', 'حادثه'],
  ['SUPPORT', 'پشتیبانی'],
  ['DISPUTE', 'اختلاف']
];

function randomKey(prefix = 'admin') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function requestJson(apiUrl, path, token, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Purpose-Scope': options.purpose || '',
    'X-Correlation-Id': randomKey('corr'),
    ...(options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
    ...(options.stepUpToken ? { 'X-Step-Up-Token': options.stepUpToken } : {}),
    ...(options.headers || {})
  };
  return fetch(`${apiUrl}${path}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.detail || body.message || 'عملیات مدیریتی انجام نشد.');
      error.code = body.code;
      throw error;
    }
    return body;
  });
}

function formatDate(value) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); } catch (_error) { return String(value); }
}

function stateLabel(value) {
  const labels = {
    OPEN: 'باز',
    IN_REVIEW: 'در بررسی',
    ESCALATED: 'ارجاع‌شده',
    RESTRICTED: 'محدودشده',
    RESOLVED: 'مختومه',
    REQUESTED: 'درخواست‌شده',
    APPROVED: 'تأییدشده',
    REJECTED: 'ردشده',
    ACTIVE: 'فعال',
    DRAFT: 'پیش‌نویس',
    REVIEW: 'در بازبینی',
    SCHEDULED: 'زمان‌بندی‌شده',
    SUPERSEDED: 'منسوخ‌شده',
    ARCHIVED: 'بایگانی‌شده'
  };
  return labels[value] || value || 'ثبت نشده';
}

function StatCard({ label, value, hint }) {
  return <article className="admin-governance-stat"><span>{label}</span><strong>{Number(value || 0).toLocaleString('fa-IR')}</strong><small>{hint}</small></article>;
}

function EmptyState({ children = 'داده‌ای در این محدوده وجود ندارد.' }) {
  return <div className="admin-governance-empty">{children}</div>;
}

function Table({ headers, children }) {
  return <div className="admin-governance-table-wrap"><table className="admin-governance-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function AdminGovernancePanel({ user, token, apiUrl, onLogout }) {
  const role = user?.role || 'super_admin';
  const [activeTab, setActiveTab] = useState('dashboard');
  const [purpose, setPurpose] = useState('بازبینی حاکمیت بازار و کنترل دسترسی');
  const [stepUpToken, setStepUpToken] = useState(() => sessionStorage.getItem('gomrok-admin-step-up-token') || '');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState('');
  const [caseForm, setCaseForm] = useState({ caseType: 'RISK', signal: '', subjectOrgId: '', reason: '', severity: 'medium' });
  const [breakGlassForm, setBreakGlassForm] = useState({ targetType: 'quote_access_audit', targetId: '', reason: '', incidentRef: '', durationMinutes: 15 });
  const [rulePackForm, setRulePackForm] = useState({ ruleKey: '', level: 'B', sourceType: 'B', sourceRef: '', rules: '{\n  "reviewRequired": true\n}' });

  const allowedMenu = useMemo(() => menu.filter(([key]) => !roleMenu[key] || roleMenu[key].includes(role)), [role]);

  const load = async (tab = activeTab) => {
    setLoading(true);
    setNotice('');
    const paths = {
      dashboard: '/api/platform/admin/dashboard',
      users: '/api/platform/admin/users?limit=100',
      organizations: '/api/platform/admin/organizations?limit=100',
      qualification: '/api/platform/admin/qualification?limit=100',
      marketplace: '/api/platform/admin/marketplace?limit=100',
      trips: '/api/platform/admin/trips?limit=100',
      cases: '/api/platform/admin/cases?limit=100',
      audit: '/api/platform/admin/audit?limit=100',
      breakglass: '/api/platform/admin/break-glass?limit=100',
      rulepacks: '/api/platform/admin/rulepacks?limit=100',
      pricing: '/api/platform/admin/pricing?limit=100',
      finance: '/api/platform/admin/finance',
      claims: '/api/platform/admin/claims?limit=100',
      exports: '/api/platform/admin/exports?limit=100',
      security: '/api/platform/admin/notification-policies',
      crm: '/api/platform/admin/crm-governance',
      bi: '/api/platform/admin/bi',
      ai: '/api/platform/admin/ai-monitor?limit=100',
      health: '/api/platform/admin/health'
    };
    try {
      const result = tab === 'security'
        ? { ...(await requestJson(apiUrl, paths.security, token, { purpose })), ...(await requestJson(apiUrl, '/api/platform/admin/contact-reveals?limit=100', token, { purpose })) }
        : await requestJson(apiUrl, paths[tab] || paths.dashboard, token, { purpose });
      setData((current) => ({ ...current, [tab]: result }));
    } catch (error) {
      setNoticeTone('error');
      setNotice(error.code ? `${error.code}: ${error.message}` : error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(activeTab); }, [activeTab]);

  usePlatformRealtime({ apiUrl, token, onEvent: () => load(activeTab) });

  const perform = async (path, method, body = {}, options = {}) => {
    setLoading(true);
    setNotice('');
    try {
      const result = await requestJson(apiUrl, path, token, { method, body, purpose, stepUpToken, idempotencyKey: randomKey('write'), ...options });
      setNoticeTone('success');
      setNotice(result.message || 'عملیات ثبت شد.');
      await load(activeTab);
      return result;
    } catch (error) {
      setNoticeTone('error');
      setNotice(error.code ? `${error.code}: ${error.message}` : error.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const saveStepUp = (value) => {
    setStepUpToken(value);
    sessionStorage.setItem('gomrok-admin-step-up-token', value);
  };

  const dashboard = data.dashboard || {};
  const metrics = dashboard.metrics || {};
  const cases = data.cases?.cases || [];
  const roleTitle = roleLabels[role] || role;

  const renderDashboard = () => <>
    <section className="admin-governance-hero"><div><span className="admin-governance-eyebrow">MARKETPLACE GOVERNANCE · SERVER ENFORCED</span><h1>کنترل‌تاور بی‌طرفی و امنیت</h1><p>داده تجاری حساس در این read model برنمی‌گردد؛ هر اقدام به نقش، هدف، Tenant و حسابرسی متصل است.</p></div><div className="admin-governance-guard"><strong>{roleTitle}</strong><span>Tenant: {user?.tenantId || 'platform'}</span><small>AI binding actions: disabled</small></div></section>
    <section className="admin-governance-stats"><StatCard label="سازمان‌ها" value={metrics.organizations} hint="در محدوده Tenant" /><StatCard label="پرونده‌های باز" value={metrics.openGovernanceCases} hint="ریسک، انطباق، تعارض" /><StatCard label="Break-Glass در انتظار" value={metrics.pendingBreakGlass} hint="نیازمند کنترل دومرحله‌ای" /><StatCard label="RulePack فعال" value={metrics.activeRulePacks} hint="نسخه‌گذاری‌شده" /><StatCard label="خروجی‌های در انتظار" value={metrics.pendingExports} hint="بدون export-all" /><StatCard label="Audit در ۲۴ ساعت" value={metrics.auditEvents24h} hint="append-only" /></section>
    <section className="admin-governance-grid"><article className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">ACCESS BOUNDARY</span><h2>مرزهای این نشست</h2></div></div><div className="admin-governance-boundaries"><span><b>Quote body</b><strong>مخفی</strong></span><span><b>Market A / B</b><strong>تفکیک‌شده</strong></span><span><b>Audit delete</b><strong>غیرفعال</strong></span><span><b>AI award</b><strong>ممنوع</strong></span></div></article><article className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">RFQ SEAL MONITOR</span><h2>وضعیت بازارها</h2></div></div>{dashboard.rfqs?.length ? <div className="admin-governance-mini-list">{dashboard.rfqs.map((item) => <div key={`${item.level}-${item.state}`}><span>{item.level}</span><strong>{stateLabel(item.state)}</strong><small>{Number(item.total || 0).toLocaleString('fa-IR')} دفتر</small></div>)}</div> : <EmptyState>دفتری برای نمایش نیست.</EmptyState>}</article></section>
  </>;

  const renderOrganizations = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">TENANT ISOLATION</span><h2>سازمان‌ها و عضویت‌ها</h2></div><button className="platform-button" type="button" onClick={() => load('organizations')}>بروزرسانی</button></div>{data.organizations?.organizations?.length ? <Table headers={['سازمان', 'نوع', 'وضعیت', 'صلاحیت', 'آخرین تغییر']}>{data.organizations.organizations.map((item) => <tr key={item.id}><td><strong>{item.displayName}</strong><small>{item.id}</small></td><td>{item.organizationType}</td><td><span className={`admin-governance-state admin-governance-state--${item.status}`}>{stateLabel(item.status)}</span></td><td>{stateLabel(item.qualificationState)}</td><td>{formatDate(item.updatedAt)}</td></tr>)}</Table> : <EmptyState />}</section>;

  const renderUsers = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">IAM / MEMBERSHIP SCOPE</span><h2>کاربران و عضویت‌ها</h2></div></div>{data.users?.users?.length ? <Table headers={['کاربر', 'سازمان', 'نقش', 'KYC', 'وضعیت', 'اقدام']}>{data.users.users.map((item) => <tr key={item.membershipId}><td><strong>{item.displayName}</strong><small>user #{item.userId}</small></td><td>{item.organizationId}</td><td>{item.role}</td><td>{item.kycLevel}</td><td>{stateLabel(item.status)}</td><td className="admin-governance-actions">{['super_admin', 'security_admin'].includes(role) && <button type="button" onClick={() => perform(`/api/platform/admin/users/${item.userId}/sessions/revoke`, 'POST')}>لغو نشست‌ها</button>}</td></tr>)}</Table> : <EmptyState />}</section>;

  const renderQualification = () => <><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">HUMAN REVIEW OWNER</span><h2>صف سازمان‌ها</h2></div></div>{data.qualification?.organizations?.length ? <Table headers={['سازمان', 'نوع', 'وضعیت', 'اقدام']}>{data.qualification.organizations.map((item) => <tr key={item.id}><td><strong>{item.displayName}</strong><small>{item.id}</small></td><td>{item.organizationType}</td><td>{stateLabel(item.qualificationState)}</td><td className="admin-governance-actions"><button type="button" onClick={() => perform(`/api/platform/admin/qualification/organization/${encodeURIComponent(item.id)}/decision`, 'POST', { decision: 'APPROVE', reason: 'بررسی انسانی مدارک و احراز سازمان انجام شد.' })}>تأیید</button><button type="button" onClick={() => perform(`/api/platform/admin/qualification/organization/${encodeURIComponent(item.id)}/decision`, 'POST', { decision: 'REQUEST_INFO', reason: 'مدرک یا اطلاعات تکمیلی برای ادامه بررسی لازم است.' })}>اطلاعات بیشتر</button></td></tr>)}</Table> : <EmptyState />}</section><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">MEMBERSHIP KYC</span><h2>صف عضویت‌ها</h2></div></div>{data.qualification?.memberships?.length ? <Table headers={['کاربر', 'نقش', 'KYC', 'صلاحیت', 'اقدام']}>{data.qualification.memberships.map((item) => <tr key={item.membershipId}><td>{item.displayName}<small>{item.organizationId}</small></td><td>{item.role}</td><td>{item.kycLevel}</td><td>{stateLabel(item.qualificationState)}</td><td className="admin-governance-actions"><button type="button" onClick={() => perform(`/api/platform/admin/qualification/membership/${item.membershipId}/decision`, 'POST', { decision: 'APPROVE', reason: 'بررسی انسانی عضویت و مدارک انجام شد.' })}>تأیید</button><button type="button" onClick={() => perform(`/api/platform/admin/qualification/membership/${item.membershipId}/decision`, 'POST', { decision: 'SUSPEND', reason: 'تعلیق کنترل‌شده تا بررسی تکمیلی.' })}>تعلیق</button></td></tr>)}</Table> : <EmptyState />}</section></>;

  const renderMarketplace = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">SEALED QUOTE BOOK</span><h2>نظارت RFQ بدون مشاهده Quote body</h2></div></div>{data.marketplace?.rfqs?.length ? <Table headers={['دفتر', 'سطح', 'وضعیت Seal', 'مهلت', 'تعداد پیشنهاد', 'Award']}>{data.marketplace.rfqs.map((item) => <tr key={item.id}><td><strong>{item.caseNumber}</strong><small>{item.route.originCountry} ← {item.route.destinationCountry}</small></td><td>{item.level}</td><td><span className="admin-governance-sealed">sealed / audited</span></td><td>{formatDate(item.deadlineAt)}</td><td>{Number(item.quoteCount || 0).toLocaleString('fa-IR')}</td><td>{item.awardedOrgId || '—'}</td></tr>)}</Table> : <EmptyState />}</section>;

  const renderTrips = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">OPERATIONAL GOVERNANCE</span><h2>read model حداقلی سفرها</h2></div></div>{data.trips?.trips?.length ? <Table headers={['پرونده', 'X / Y', 'State', 'GPS', 'Customs / TIR', 'POD']}>{data.trips.trips.map((item) => <tr key={item.id}><td><strong>{item.caseNumber}</strong><small>{item.direction}</small></td><td>{item.xOrgId}<small>{item.yOrgId}</small></td><td>{stateLabel(item.state)}</td><td>{stateLabel(item.trackingState)}<small>{formatDate(item.lastLocationAt)}</small></td><td>{item.customsState || '—'} / {item.tirState || '—'}</td><td>{stateLabel(item.deliveryState)}</td></tr>)}</Table> : <EmptyState />}</section>;

  const renderCases = () => <><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">HUMAN REVIEW QUEUE</span><h2>پرونده‌های ریسک، انطباق و تعارض</h2></div></div>{cases.length ? <div className="admin-governance-case-list">{cases.map((item) => <article key={item.id}><div><span className="admin-governance-case-type">{item.caseType}</span><RiskBadge flags={item.severity === 'critical' || item.severity === 'high' ? ['risk'] : []} /></div><strong>{item.signal}</strong><p>{item.reason}</p><small>{stateLabel(item.state)} · {formatDate(item.createdAt)} · {item.subjectOrgId || 'بدون سازمان موضوع'}</small><div className="admin-governance-actions"><button type="button" onClick={() => perform(`/api/platform/admin/cases/${item.id}`, 'PATCH', { state: 'IN_REVIEW' })}>در بررسی</button><button type="button" onClick={() => perform(`/api/platform/admin/cases/${item.id}`, 'PATCH', { state: 'RESOLVED', outcome: 'بررسی انسانی انجام و نتیجه در پرونده ثبت شد.' })}>مختومه</button></div></article>)}</div> : <EmptyState />}</section><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">NEW CASE</span><h2>ثبت سیگنال حاکمیتی</h2></div></div><form className="admin-governance-form" onSubmit={(event) => { event.preventDefault(); perform('/api/platform/admin/cases', 'POST', { ...caseForm, subjectOrgId: caseForm.subjectOrgId || undefined }); setCaseForm({ caseType: 'RISK', signal: '', subjectOrgId: '', reason: '', severity: 'medium' }); }}><label><span>نوع</span><select value={caseForm.caseType} onChange={(event) => setCaseForm({ ...caseForm, caseType: event.target.value })}>{caseTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>شدت</span><select value={caseForm.severity} onChange={(event) => setCaseForm({ ...caseForm, severity: event.target.value })}><option value="low">کم</option><option value="medium">متوسط</option><option value="high">زیاد</option><option value="critical">بحرانی</option></select></label><label><span>Signal</span><input value={caseForm.signal} onChange={(event) => setCaseForm({ ...caseForm, signal: event.target.value })} placeholder="مثلاً GPS_SPOOF" /></label><label><span>سازمان موضوع</span><input value={caseForm.subjectOrgId} onChange={(event) => setCaseForm({ ...caseForm, subjectOrgId: event.target.value })} placeholder="اختیاری" /></label><label className="admin-governance-form__wide"><span>دلیل</span><textarea required minLength="8" value={caseForm.reason} onChange={(event) => setCaseForm({ ...caseForm, reason: event.target.value })} /></label><button className="platform-button platform-button--primary" type="submit" disabled={loading}>ثبت و حسابرسی</button></form></section></>;

  const renderAudit = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">IMMUTABLE AUDIT</span><h2>جست‌وجوی حسابرسی</h2></div><span className="admin-governance-append-only">Delete capability: false</span></div>{data.audit?.items?.length ? <Table headers={['زمان', 'Actor', 'Event', 'Subject', 'Correlation', 'Payload']}>{data.audit.items.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td>{item.actorId || 'system'}</td><td>{item.eventType}</td><td>{item.subjectType} / {item.subjectId || '—'}</td><td className="admin-governance-ltr">{item.correlationId || '—'}</td><td><code>{JSON.stringify(item.payload).slice(0, 120)}</code></td></tr>)}</Table> : <EmptyState />}</section>;

  const renderBreakGlass = () => <><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">DUAL CONTROL</span><h2>درخواست‌های Break-Glass</h2></div></div>{data.breakglass?.requests?.length ? <Table headers={['هدف', 'درخواست‌کننده', 'مدت', 'وضعیت', 'انقضا', 'اقدام']}>{data.breakglass.requests.map((item) => <tr key={item.id}><td>{item.targetType}<small>{item.targetId || '—'}</small></td><td>{item.requesterUserId}</td><td>{item.durationMinutes} دقیقه</td><td>{stateLabel(item.state)}</td><td>{formatDate(item.expiresAt)}</td><td className="admin-governance-actions">{item.state === 'REQUESTED' && <button type="button" onClick={() => perform(`/api/platform/admin/break-glass/${item.id}/approve`, 'POST')}>تأیید دوم</button>}{item.state === 'APPROVED' && <button type="button" onClick={() => perform(`/api/platform/admin/break-glass/${item.id}/revoke`, 'POST')}>لغو</button>}</td></tr>)}</Table> : <EmptyState />}</section><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">REQUEST</span><h2>درخواست دسترسی اضطراری</h2></div></div><form className="admin-governance-form" onSubmit={(event) => { event.preventDefault(); perform('/api/platform/admin/break-glass', 'POST', breakGlassForm); }}><label><span>نوع هدف</span><input required value={breakGlassForm.targetType} onChange={(event) => setBreakGlassForm({ ...breakGlassForm, targetType: event.target.value })} /></label><label><span>شناسه هدف</span><input value={breakGlassForm.targetId} onChange={(event) => setBreakGlassForm({ ...breakGlassForm, targetId: event.target.value })} /></label><label><span>مرجع حادثه</span><input required value={breakGlassForm.incidentRef} onChange={(event) => setBreakGlassForm({ ...breakGlassForm, incidentRef: event.target.value })} /></label><label><span>مدت (دقیقه)</span><input type="number" min="5" max="60" value={breakGlassForm.durationMinutes} onChange={(event) => setBreakGlassForm({ ...breakGlassForm, durationMinutes: Number(event.target.value) })} /></label><label className="admin-governance-form__wide"><span>دلیل</span><textarea required minLength="12" value={breakGlassForm.reason} onChange={(event) => setBreakGlassForm({ ...breakGlassForm, reason: event.target.value })} /></label><button className="platform-button platform-button--primary" type="submit" disabled={loading}>ارسال برای تأیید دوم</button></form></section></>;

  const renderRulePacks = () => <><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">VERSIONED RULE ENGINE</span><h2>RulePackهای فعال و نسخه‌ها</h2></div></div>{data.rulepacks?.rulePacks?.length ? <Table headers={['کلید / نسخه', 'Level', 'Source', 'وضعیت', 'Hard Gate', 'اقدام']}>{data.rulepacks.rulePacks.map((item) => <tr key={item.id}><td><strong>{item.ruleKey}</strong><small>v{item.versionNo}</small></td><td>{item.level}</td><td>{item.sourceType} · {item.sourceRef}</td><td>{stateLabel(item.state)}</td><td>{item.hardGate ? 'فعال' : 'خاموش'}</td><td className="admin-governance-actions">{item.state === 'DRAFT' && <button type="button" onClick={() => perform(`/api/platform/admin/rulepacks/${item.id}/transition`, 'POST', { state: 'REVIEW' })}>بازبینی</button>}{item.state === 'REVIEW' && <button type="button" onClick={() => perform(`/api/platform/admin/rulepacks/${item.id}/transition`, 'POST', { state: 'APPROVED' })}>تأیید</button>}{item.state === 'APPROVED' && <button type="button" onClick={() => perform(`/api/platform/admin/rulepacks/${item.id}/transition`, 'POST', { state: 'SCHEDULED' })}>زمان‌بندی</button>}{item.state === 'SCHEDULED' && <button type="button" onClick={() => perform(`/api/platform/admin/rulepacks/${item.id}/transition`, 'POST', { state: 'ACTIVE' })}>فعال‌سازی</button>}</td></tr>)}</Table> : <EmptyState />}</section><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">NEW VERSION</span><h2>ساخت نسخه Draft</h2></div></div><form className="admin-governance-form" onSubmit={(event) => { event.preventDefault(); let rules = {}; try { rules = JSON.parse(rulePackForm.rules); } catch (_error) { setNoticeTone('error'); setNotice('RULE-422: JSON قواعد معتبر نیست.'); return; } perform('/api/platform/admin/rulepacks', 'POST', { ...rulePackForm, rules }); }}><label><span>کلید</span><input required value={rulePackForm.ruleKey} onChange={(event) => setRulePackForm({ ...rulePackForm, ruleKey: event.target.value })} placeholder="route.permit" /></label><label><span>Level</span><select value={rulePackForm.level} onChange={(event) => setRulePackForm({ ...rulePackForm, level: event.target.value })}><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></label><label><span>Source Type</span><select value={rulePackForm.sourceType} onChange={(event) => setRulePackForm({ ...rulePackForm, sourceType: event.target.value })}><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></label><label><span>Source Reference</span><input required value={rulePackForm.sourceRef} onChange={(event) => setRulePackForm({ ...rulePackForm, sourceRef: event.target.value })} /></label><label className="admin-governance-form__wide"><span>Rules JSON</span><textarea required value={rulePackForm.rules} onChange={(event) => setRulePackForm({ ...rulePackForm, rules: event.target.value })} /></label><button className="platform-button platform-button--primary" type="submit" disabled={loading}>ثبت نسخه Draft</button></form></section></>;

  const renderFinance = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">RELATIONSHIP LEDGERS</span><h2>حاکمیت مالی رابطه‌ای</h2></div></div>{data.finance?.relationships?.length ? <Table headers={['Relationship', 'Currency', 'State', 'Ledger count', 'Total']}>{data.finance.relationships.map((item) => <tr key={`${item.relationshipType}-${item.currency}-${item.state}`}><td>{item.relationshipType}</td><td>{item.currency}</td><td>{stateLabel(item.state)}</td><td>{item.ledgerCount.toLocaleString('fa-IR')}</td><td className="admin-governance-ltr">{item.amountTotal || '0'}</td></tr>)}</Table> : <EmptyState />}</section>;

  const renderExports = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">GOVERNED DATA EXPORT</span><h2>درخواست‌های خروجی</h2></div></div>{data.exports?.exports?.length ? <Table headers={['سازمان', 'CRM scope', 'هدف', 'محدوده', 'وضعیت', 'تأییدکننده']}>{data.exports.exports.map((item) => <tr key={item.id}><td>{item.organizationId}</td><td>{item.crmScope}</td><td>{item.purpose}</td><td>{item.scopeSummary.accountIds} account · {item.scopeSummary.caseIds} case</td><td>{stateLabel(item.state)}</td><td>{item.approvedByUserId || 'تأیید دوم لازم است'}</td></tr>)}</Table> : <EmptyState />}</section>;

  const renderPricing = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">PRICE POLICY, NOT QUOTE DATA</span><h2>سیاست‌های قیمت‌گذاری</h2></div></div>{data.pricing?.policies?.length ? <Table headers={['Policy / version', 'وضعیت', 'اجزای مجاز', 'FX source', 'Outlier', 'فعال‌شده']}>{data.pricing.policies.map((item) => <tr key={item.id}><td><strong>{item.policyKey}</strong><small>v{item.versionNo}</small></td><td>{stateLabel(item.state)}</td><td>{item.allowedComponents.join(' · ')}</td><td>{item.fxSource.source || item.fxSource.provider || '—'}</td><td>{item.outlierPolicy.enabled ? 'فعال' : 'طبق RulePack'}</td><td>{formatDate(item.activatedAt)}</td></tr>)}</Table> : <EmptyState>Policy ثبت نشده است؛ Quote body در این بخش هرگز نمایش داده نمی‌شود.</EmptyState>}</section>;

  const renderClaims = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">EVIDENCE / HOLD</span><h2>Claims و Disputes</h2></div></div>{data.claims?.claims?.length ? <Table headers={['پرونده', 'نوع', 'وضعیت', 'Opened by', 'POD / Finance', 'Timing']}>{data.claims.claims.map((item) => <tr key={item.id}><td><strong>{item.caseNumber}</strong><small>#{item.id}</small></td><td>{item.caseType}</td><td>{stateLabel(item.status)}</td><td>{item.openedByOrgId}</td><td>{stateLabel(item.deliveryState)} / {stateLabel(item.financialState)}</td><td>{item.timingWarning ? 'هشدار زمانی' : '—'}</td></tr>)}</Table> : <EmptyState />}</section>;

  const renderCrm = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">L1 / L2 ISOLATION</span><h2>حاکمیت CRM</h2></div></div><div className="admin-governance-boundaries"><span><b>Scope rows</b><strong>{(data.crm?.scopes || []).length.toLocaleString('fa-IR')}</strong></span><span><b>Reveal active</b><strong>{Number(data.crm?.contactReveal?.active || 0).toLocaleString('fa-IR')}</strong></span><span><b>Raw contacts</b><strong>مخفی</strong></span><span><b>Campaign send</b><strong>Consent required</strong></span></div><p className="admin-governance-hint">اتصال L1/L2، Contact Reveal و خروجی داده توسط scope، reason، cap، expiry و تأیید دوم کنترل می‌شود.</p></section>;

  const renderBi = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">AGGREGATED / ANONYMIZED</span><h2>BI و KPI</h2></div></div><div className="admin-governance-mini-list">{[['پرونده‌ها', data.bi?.cases], ['سفرها', data.bi?.trips], ['RFQها', data.bi?.rfqs]].map(([label, rows]) => <div key={label}><span>{label}</span><strong>{Array.isArray(rows) ? rows.reduce((sum, row) => sum + Number(row.total || 0), 0).toLocaleString('fa-IR') : '—'}</strong><small>تجمیعی · بدون raw business rows</small></div>)}</div></section>;

  const renderSecurity = () => <><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">CRITICAL NOTIFICATIONS</span><h2>سیاست‌های اعلان</h2></div></div>{data.security?.policies?.length ? <Table headers={['Policy', 'Severity', 'Critical', 'وضعیت', 'کانال‌ها']}>{data.security.policies.map((item) => <tr key={item.id}><td>{item.label}<small>{item.policyKey}</small></td><td>{item.severity}</td><td>{item.critical ? 'غیرقابل خاموش‌کردن' : 'قابل تنظیم'}</td><td>{item.enabled ? 'فعال' : 'خاموش'}</td><td>{item.channels.join(' · ')}</td></tr>)}</Table> : <EmptyState />}</section><section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">CONTACT REVEAL</span><h2>حسابرسی افشای موقت تماس</h2></div></div>{data.security?.reveals?.length ? <Table headers={['Case', 'Actor', 'سازمان', 'دلیل', 'انقضا', 'وضعیت']}>{data.security.reveals.map((item) => <tr key={item.id}><td>#{item.caseId}</td><td>{item.actorUserId}</td><td>{item.organizationId}</td><td>{item.reason}</td><td>{formatDate(item.expiresAt)}</td><td>{item.active ? 'فعال' : 'منقضی'}</td></tr>)}</Table> : <p className="admin-governance-hint">Full contact در این console نمایش داده نمی‌شود؛ فقط دلیل، دامنه، زمان انقضا و Actor قابل بررسی است.</p>}</section></>;

  const renderAi = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">ASSISTIVE ONLY</span><h2>پایش AI / OCR</h2></div></div>{data.ai?.runs?.length ? <Table headers={['Use case', 'Model', 'Latency', 'Quality', 'Source', 'Override', 'Binding']}>{data.ai.runs.map((item) => <tr key={item.id}><td>{item.useCase}</td><td>{item.modelVersion}<small>{item.promptVersion || '—'}</small></td><td>{item.latencyMs || '—'} ms</td><td>{item.qualityScore || '—'}</td><td>{item.sourceStatus || '—'}</td><td>{item.humanOverride ? 'بله' : 'خیر'}</td><td><span className="admin-governance-denied">ممنوع</span></td></tr>)}</Table> : <EmptyState>برای این Tenant run ثبت نشده است.</EmptyState>}</section>;

  const renderHealth = () => <section className="admin-governance-panel"><div className="admin-governance-panel__heading"><div><span className="admin-governance-kicker">TECHNICAL READ MODEL</span><h2>سلامت سیستم و Backup/DR</h2></div></div>{data.health?.components ? <div className="admin-governance-health-grid">{Object.entries(data.health.components).map(([name, item]) => <article key={name}><span>{name}</span><strong className={item.state === 'ok' || item.state === 'configured' ? 'is-ok' : 'is-muted'}>{item.state}</strong>{item.rpo && <small>RPO {item.rpo} · RTO {item.rto || '—'}</small>}</article>)}</div> : <EmptyState />}</section>;

  const rendered = { dashboard: renderDashboard, users: renderUsers, organizations: renderOrganizations, qualification: renderQualification, marketplace: renderMarketplace, trips: renderTrips, cases: renderCases, audit: renderAudit, breakglass: renderBreakGlass, rulepacks: renderRulePacks, pricing: renderPricing, finance: renderFinance, claims: renderClaims, exports: renderExports, security: renderSecurity, crm: renderCrm, bi: renderBi, ai: renderAi, health: renderHealth }[activeTab]?.() || renderDashboard();

  return <div className="admin-governance-shell" dir="rtl"><header className="admin-governance-header"><div className="admin-governance-brand"><span>G</span><div><strong>GOMROK</strong><small>Marketplace Governance</small></div></div><div className="admin-governance-header__scope"><label><span>Purpose scope</span><input value={purpose} onChange={(event) => setPurpose(event.target.value)} aria-label="Purpose scope" /></label><label><span>Step-up token</span><input value={stepUpToken} onChange={(event) => saveStepUp(event.target.value)} placeholder="از IAM" aria-label="Step-up token" /></label><button type="button" onClick={onLogout}>خروج</button></div></header><div className="admin-governance-layout"><aside className="admin-governance-sidebar"><div className="admin-governance-sidebar__role"><span>STAFF CONSOLE</span><strong>{roleTitle}</strong><small>Server authorization active</small></div><nav>{allowedMenu.map(([key, label]) => <button key={key} type="button" className={activeTab === key ? 'is-active' : ''} onClick={() => setActiveTab(key)}><span>{key === 'dashboard' ? '⌂' : key === 'audit' ? '◈' : key === 'security' ? '◉' : '▦'}</span>{label}</button>)}</nav><div className="admin-governance-sidebar__note">Role ≠ permission<br />ABAC + purpose + audit</div></aside><main className="admin-governance-main"><div className="admin-governance-main__heading"><div><span className="admin-governance-kicker">{roleTitle}</span><h1>{menu.find(([key]) => key === activeTab)?.[1] || 'داشبورد'}</h1></div><button className="platform-button" type="button" onClick={() => load(activeTab)} disabled={loading}>{loading ? 'در حال دریافت…' : 'بروزرسانی'}</button></div>{notice && <div className={`admin-governance-notice ${noticeTone ? `admin-governance-notice--${noticeTone}` : ''}`}>{notice}</div>}{rendered}</main></div><footer className="admin-governance-footer"><span>GOMROK · no blanket Super Admin business access</span><span>Quote body / raw location / raw contact masked by default</span></footer></div>;
}

export default AdminGovernancePanel;
