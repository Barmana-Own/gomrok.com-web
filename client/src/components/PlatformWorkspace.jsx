import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  ApprovalDialog,
  AuditDrawer,
  ContactMasked,
  ContactRevealDialog,
  DocCard,
  EvidenceGallery,
  MoneyBreakdown,
  RiskBadge,
  StatusTimeline
} from './PlatformPrimitives.jsx';
import { ProductLogo } from './ProductIcon.jsx';
const ShipperPanel = lazy(() => import('./ShipperPanel.jsx'));
const CompanyXPanel = lazy(() => import('./CompanyXPanel.jsx'));
const CompanyYPanel = lazy(() => import('./CompanyYPanel.jsx'));
const DriverMobilePanel = lazy(() => import('./DriverMobilePanel.jsx'));
const AgentPanel = lazy(() => import('./AgentPanel.jsx'));
const AdminGovernancePanel = lazy(() => import('./AdminGovernancePanel.jsx'));

function deferredPanel(element) {
  return <Suspense fallback={<div className="platform-loading" dir="rtl">در حال آماده‌سازی پنل…</div>}>{element}</Suspense>;
}

const stateLabels = {
  DRAFT: 'پیش‌نویس',
  RFQ_OPEN: 'RFQ باز',
  OFFERS_RECEIVED: 'پیشنهاد دریافت شد',
  PROVIDER_AWARDED: 'شرکت X انتخاب شد',
  CUSTOMER_CONTRACTED: 'قرارداد مشتری',
  CAPACITY_RFQ: 'خرید ظرفیت',
  CARRIER_AWARDED: 'شرکت Y انتخاب شد',
  TRUCK_NOMINATED: 'معرفی راننده',
  CHECKED_IN: 'ورود به بارگیری',
  DISPATCHED: 'اعزام شده',
  AT_BORDER: 'مرز',
  IN_TRANSIT: 'در مسیر',
  AT_DESTINATION: 'مقصد',
  POD_SUBMITTED: 'POD در بررسی',
  POD_ACCEPTED: 'POD پذیرفته شد',
  SETTLEMENT_PENDING: 'در انتظار تسویه'
};

const roleLabels = {
  driver: 'راننده',
  carrier: 'شرکت Y',
  company_y_owner: 'شرکت Y',
  company_x_owner: 'شرکت X',
  shipper_admin: 'شیپر',
  shipper_logistics_user: 'کاربر لجستیک شیپر'
};

function stateLabel(value) {
  return stateLabels[value] || value || 'ثبت نشده';
}

function requestJson(apiUrl, path, token, options = {}) {
  return fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || body.message || 'دریافت اطلاعات انجام نشد.');
    return body;
  });
}

function timelineForCase(item) {
  if (item.timeline?.length) return item.timeline.map((entry) => ({ label: entry.eventName || entry.event_name, detail: entry.occurred_at || 'رویداد ثبت‌شده', done: true }));
  const states = [
    ['درخواست بار', item.commercialState],
    ['بازار A', item.commercialState === 'DRAFT' ? null : item.commercialState],
    ['قرارداد مشتری', item.commercialState === 'CUSTOMER_CONTRACTED' ? item.commercialState : null],
    ['خرید ظرفیت', item.capacityState],
    ['عملیات سفر', item.tripState],
    ['تحویل و POD', item.deliveryState],
    ['تسویه', item.financialState]
  ];
  const current = item.deliveryState || item.tripState || item.capacityState || item.commercialState;
  return states.map(([label, state]) => ({ label, state: stateLabel(state), done: Boolean(state && state !== current), current: state === current }));
}

export default function PlatformWorkspace({ user, token, apiUrl, onLogout }) {
  if (['super_admin', 'marketplace_admin', 'conflict_officer', 'security_admin', 'compliance_officer', 'risk_manager', 'customer_support', 'finance_admin', 'government_observer', 'data_governance_officer', 'crm_admin', 'support_lead'].includes(user?.role)) {
    return deferredPanel(<AdminGovernancePanel user={user} token={token} apiUrl={apiUrl} onLogout={onLogout} />);
  }
  if (['shipper_admin', 'shipper_logistics_user', 'shipper_finance_user', 'consignee'].includes(user?.role)) {
    return deferredPanel(<ShipperPanel user={user} token={token} apiUrl={apiUrl} onLogout={onLogout} />);
  }
  if (['company_x_owner', 'company_x_operations_manager', 'company_x_pricing_expert', 'company_x_dispatcher', 'company_x_document_expert'].includes(user?.role)) {
    return deferredPanel(<CompanyXPanel user={user} token={token} apiUrl={apiUrl} onLogout={onLogout} />);
  }
  if (['carrier', 'company_y_owner', 'company_y_document_issuer'].includes(user?.role)) {
    return deferredPanel(<CompanyYPanel user={user} token={token} apiUrl={apiUrl} onLogout={onLogout} />);
  }
  if (user?.role === 'driver') {
    return deferredPanel(<DriverMobilePanel user={user} token={token} apiUrl={apiUrl} onLogout={onLogout} />);
  }
  if (user?.role === 'agent_z') {
    return deferredPanel(<AgentPanel user={user} token={token} apiUrl={apiUrl} onLogout={onLogout} />);
  }
  const [dashboard, setDashboard] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditItems, setAuditItems] = useState([]);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [revealBusy, setRevealBusy] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);

  const role = user?.role === 'carrier' ? 'company_y_owner' : user?.role;
  const label = roleLabels[role] || roleLabels[user?.role] || 'کاربر';
  const cases = dashboard?.cases || [];
  const trips = dashboard?.trips || [];
  const selectedContacts = selectedCase?.contacts || null;

  const metrics = useMemo(() => dashboard?.metrics || { cases: 0, activeTrips: 0, pendingEvidence: 0 }, [dashboard]);

  const refresh = () => {
    setLoading(true);
    requestJson(apiUrl, '/api/platform/dashboard', token)
      .then(setDashboard)
      .catch((error) => setNotice(error.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, [token]);

  const openCase = async (item) => {
    setNotice('');
    try {
      const [details, ledger] = await Promise.all([
        requestJson(apiUrl, `/api/platform/cases/${item.id}`, token),
        requestJson(apiUrl, `/api/platform/cases/${item.id}/settlements`, token).catch(() => ({ settlements: [] }))
      ]);
      const contacts = await requestJson(apiUrl, `/api/platform/cases/${item.id}/contacts`, token).catch(() => null);
      setSelectedCase({ ...details.case, documents: details.documents || [], trips: details.trips || [], rfqs: details.rfqs || [], timeline: details.timeline || [], contacts });
      setSettlements(ledger.settlements || []);
      setActiveTab('case');
    } catch (error) {
      setNotice(error.message);
    }
  };

  const requestReveal = async () => {
    if (!selectedCase || revealReason.trim().length < 8) return;
    setRevealBusy(true);
    try {
      const result = await requestJson(apiUrl, '/api/platform/contact-reveals', token, {
        method: 'POST',
        headers: { 'X-Idempotency-Key': `contact-${selectedCase.id}-${Date.now()}` },
        body: JSON.stringify({ caseId: selectedCase.id, reason: revealReason.trim() })
      });
      const contacts = await requestJson(apiUrl, `/api/platform/cases/${selectedCase.id}/contacts`, token);
      setReveal(result);
      setSelectedCase((current) => ({ ...current, contacts }));
      setRevealOpen(false);
      setRevealReason('');
      setNotice('مجوز تماس ثبت شد و در حسابرسی قابل مشاهده است.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setRevealBusy(false);
    }
  };

  const openAudit = async () => {
    try {
      const result = await requestJson(apiUrl, `/api/platform/audit${selectedCase ? `?caseId=${selectedCase.id}` : ''}`, token);
      setAuditItems(result.items || []);
      setAuditOpen(true);
    } catch (error) {
      setNotice(error.message);
    }
  };

  return (
    <div className="platform-shell" dir="rtl">
      <header className="platform-header">
        <div className="platform-brand"><ProductLogo subtitle="فضای عملیات لجستیک" /></div>
        <div className="platform-header__user"><span>{label}</span><button type="button" onClick={onLogout}>خروج</button></div>
      </header>
      <main className="platform-main">
        <section className="platform-hero">
          <div><span className="platform-eyebrow">سرور منبع حقیقت · {roleLabels[role] || 'پنل عملیاتی'}</span><h1>مرکز عملیات و شواهد</h1><p>وضعیت پرونده‌ها، گیت‌های آمادگی و مدارک را در یک نمای کنترل‌شده دنبال کن.</p></div>
          <div className="platform-hero__status"><i /> tenant-scoped<br /><small>داده فقط در محدوده عضویت شما</small></div>
        </section>

        <nav className="platform-tabs" aria-label="بخش‌های پنل"><button type="button" className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => setActiveTab('overview')}>نمای کلی</button><button type="button" className={activeTab === 'cases' ? 'is-active' : ''} onClick={() => setActiveTab('cases')}>پرونده‌ها</button><button type="button" className={activeTab === 'tracking' ? 'is-active' : ''} onClick={() => setActiveTab('tracking')}>ردیابی فعال</button><button type="button" className={activeTab === 'case' ? 'is-active' : ''} disabled={!selectedCase}>جزئیات</button></nav>

        {notice && <div className="platform-notice">{notice}</div>}
        {loading && <div className="platform-loading">در حال دریافت read model از سرور…</div>}

        {!loading && activeTab !== 'case' && (
          <>
            <section className="platform-metrics"><article><span>پرونده‌های مجاز</span><strong>{Number(metrics.cases).toLocaleString('fa-IR')}</strong><small>در محدوده سازمان</small></article><article><span>سفر فعال</span><strong>{Number(metrics.activeTrips).toLocaleString('fa-IR')}</strong><small>با موقعیت کنترل‌شده</small></article><article><span>شاهد در انتظار</span><strong>{Number(metrics.pendingEvidence).toLocaleString('fa-IR')}</strong><small>نیازمند اقدام بعدی</small></article></section>
            {(activeTab === 'overview' || activeTab === 'cases') && <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Shared Case Read Model</span><h2>پرونده‌های اخیر</h2></div><button className="platform-button" type="button" onClick={refresh}>بروزرسانی</button></div>{cases.length ? <div className="platform-case-grid">{cases.map((item) => <button className="platform-case-card" type="button" key={item.id} onClick={() => openCase(item)}><div className="platform-case-card__top"><span>#{item.caseNumber}</span><RiskBadge flags={item.riskFlags} /></div><strong>{item.cargo?.type || 'محموله ثبت‌شده'}</strong><small>{item.origin?.location || 'مبدأ نامشخص'} ← {item.destination?.location || 'مقصد نامشخص'}</small><div className="platform-case-card__state">{stateLabel(item.deliveryState || item.tripState || item.capacityState || item.commercialState)}</div></button>)}</div> : <div className="platform-empty"><strong>پرونده‌ای در این محدوده وجود ندارد</strong><span>وقتی یک پرونده به سازمان شما واگذار شود، اینجا نمایش داده می‌شود.</span></div>}</section>}
            {activeTab === 'tracking' && <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Least privilege location</span><h2>سفرهای فعال</h2></div></div>{trips.length ? <div className="platform-trip-list">{trips.map((trip) => <button className="platform-trip-card" type="button" key={trip.id} onClick={() => { const item = cases.find((caseItem) => caseItem.id === trip.caseId); if (item) openCase(item); }}><span className="platform-trip-card__signal">{trip.trackingState === 'ACTIVE' ? '● زنده' : '○ آماده‌سازی'}</span><strong>{trip.caseNumber}</strong><small>{stateLabel(trip.state)} · {trip.lastLocationAt ? `آخرین موقعیت ${trip.lastLocationAt}` : 'موقعیت هنوز ثبت نشده'}</small></button>)}</div> : <div className="platform-empty"><strong>سفر فعالی در محدوده شما نیست</strong><span>موقعیت خام فقط برای طرف‌های مجاز سفر نمایش داده می‌شود.</span></div>}</section>}
          </>
        )}

        {!loading && activeTab === 'case' && selectedCase && <section className="platform-case-detail"><div className="platform-section__heading"><div><span className="platform-eyebrow">Case #{selectedCase.caseNumber}</span><h2>{selectedCase.cargo?.type || 'جزئیات پرونده'}</h2><p>{selectedCase.origin?.location} ← {selectedCase.destination?.location}</p></div><div className="platform-heading-actions"><RiskBadge flags={selectedCase.riskFlags} /><button className="platform-button" type="button" onClick={openAudit}>حساب‌رسی</button></div></div><div className="platform-detail-grid"><article className="platform-panel"><h3>وضعیت و گام بعد</h3><StatusTimeline items={timelineForCase(selectedCase)} /><div className="platform-next-action"><span>مسئول اقدام بعدی</span><strong>{selectedCase.deliveryState === 'POD_SUBMITTED' ? 'شرکت X · بررسی POD' : label}</strong></div></article><article className="platform-panel"><h3>مدارک نسخه‌دار</h3><div className="platform-doc-list">{selectedCase.documents?.length ? selectedCase.documents.map((document) => <DocCard key={document.id} document={document} />) : <div className="platform-empty-inline">سندی در این پرونده ثبت نشده است.</div>}</div><h3 className="platform-subheading">شاهد تحویل</h3><EvidenceGallery evidence={[]} /></article><article className="platform-panel"><h3>تماس و اختیار</h3><ContactMasked contact={selectedContacts?.shipper} revealed={Boolean(selectedContacts?.revealed)} expiresAt={selectedContacts?.revealExpiresAt} onReveal={selectedContacts?.revealed ? null : () => setRevealOpen(true)} /><p className="platform-panel__hint">تماس پیش‌فرض ماسک است؛ نمایش کامل فقط با مجوز موقت و دلیل عملیاتی انجام می‌شود.</p><h3 className="platform-subheading">دفتر مالی رابطه‌ای</h3><MoneyBreakdown items={settlements} /></article></div></section>}
      </main>
      <footer className="platform-footer"><span>GOMROK · policy-driven workspace</span><button type="button" onClick={() => setApprovalOpen(true)}>راهنمای کنترل عملیات</button></footer>
      <ApprovalDialog open={approvalOpen} title="کنترل‌های این پنل" description="هر اقدام حساس باید از API، عضویت سازمانی، محدوده رابطه و ثبت حسابرسی عبور کند. Award خودکار و export-all در این پنل وجود ندارد." onCancel={() => setApprovalOpen(false)} onConfirm={() => setApprovalOpen(false)} />
      <ContactRevealDialog open={revealOpen} reason={revealReason} setReason={setRevealReason} busy={revealBusy} onCancel={() => setRevealOpen(false)} onConfirm={requestReveal} />
      <AuditDrawer open={auditOpen} items={auditItems} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
