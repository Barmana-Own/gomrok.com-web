import { useEffect, useMemo, useState } from 'react';
import { usePlatformRealtime } from '../hooks/usePlatformRealtime.js';
import {
  ApprovalDialog,
  AuditDrawer,
  DocCard,
  EvidenceGallery,
  MoneyBreakdown,
  RiskBadge,
  StatusTimeline
} from './PlatformPrimitives.jsx';
import { NavigationIcon, ProductLogo } from './ProductIcon.jsx';
import { PanelMenuButton, PanelSidebar, usePanelNavigation } from './ResponsivePanelNav.jsx';

const stateLabels = {
  DRAFT: 'پیش‌نویس',
  RFQ_OPEN: 'RFQ1 باز',
  OFFERS_RECEIVED: 'پیشنهاد دریافت شد',
  PROVIDER_AWARDED: 'Award مشتری',
  CUSTOMER_CONTRACTED: 'قرارداد Customer-X',
  CAPACITY_RFQ: 'RFQ2 ظرفیت باز',
  ELIGIBLE: 'ظرفیت واجد شرایط',
  CARRIER_AWARDED: 'شرکت Y انتخاب شد',
  TRUCK_NOMINATED: 'راننده/خودرو معرفی شد',
  CHECKED_IN: 'ورود به بارگیری',
  DISPATCHED: 'اعزام',
  AT_BORDER: 'در مرز',
  EXITED_IRAN: 'خروج از ایران',
  IN_TRANSIT: 'در مسیر',
  AT_DESTINATION: 'ورود به مقصد',
  READY_FOR_DELIVERY: 'آماده تحویل',
  DELIVERED: 'تحویل شد',
  POD_SUBMITTED: 'POD در بررسی',
  RETURNED: 'برگشت برای تکمیل',
  ACCEPTED: 'پذیرفته شد',
  SETTLEMENT_PENDING: 'در انتظار تسویه',
  FINANCIALLY_SETTLED: 'تسویه شد',
  CLOSED: 'بسته شد'
};

const roleLabels = {
  company_x_owner: 'مالک شرکت X',
  company_x_operations_manager: 'مدیر عملیات X',
  company_x_pricing_expert: 'متخصص قیمت‌گذاری X',
  company_x_dispatcher: 'دیسپچر X',
  company_x_document_expert: 'متخصص اسناد X'
};

const menu = [
  ['dashboard', 'داشبورد عملیات'],
  ['rfq1', 'RFQهای سطح ۱ دریافتی'],
  ['pricing', 'نرخ‌دهی مشتری / Quote1'],
  ['contracts', 'قراردادهای Customer-X'],
  ['rfq2', 'اعلام بار / RFQ2'],
  ['dispatch', 'دیسپچ'],
  ['network', 'شبکه Carrier / Y'],
  ['nomination', 'معرفی Driver / Vehicle'],
  ['loading', 'عملیات بارگیری'],
  ['documents', 'اسناد'],
  ['cmr', 'CMR / TIR / Customs'],
  ['tracking', 'Control Tower / Tracking'],
  ['pod', 'POD Review'],
  ['finance', 'مالی و تسویه'],
  ['claims', 'Claims / Disputes'],
  ['exceptions', 'Exceptions'],
  ['reports', 'KPI / Reports'],
  ['organization', 'سازمان و سطح دسترسی'],
  ['notifications', 'اعلان‌ها']
];

const evidenceTypes = ['ARRIVAL', 'PRELOAD_CHECKLIST', 'LOADING_LIST', 'SCALE_TICKET', 'SEAL', 'LOADING_PHOTO'];

function stateLabel(value) {
  return stateLabels[value] || value || 'ثبت نشده';
}

function requestJson(apiUrl, path, token, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Correlation-Id': options.correlationId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    ...(options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
    ...(options.headers || {})
  };
  return fetch(`${apiUrl}${path}`, { ...options, headers }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.detail || body.message || 'عملیات انجام نشد.');
      error.code = body.code;
      error.details = body.details;
      throw error;
    }
    return body;
  });
}

function idempotency(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function field(label, value, onChange, props = {}) {
  return <label className="company-x-field"><span>{label}</span><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}

function selectField(label, value, onChange, options) {
  return <label className="company-x-field"><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>{options.map(([option, title]) => <option value={option} key={option}>{title}</option>)}</select></label>;
}

function Notice({ notice }) {
  if (!notice) return null;
  return <div className="platform-notice"><strong>{notice.code ? `${notice.code} · ` : ''}</strong>{notice.message}</div>;
}

function XHeader({ role, onLogout, menuOpen, onMenuToggle, menuId }) {
  return <header className="platform-header"><div className="platform-header__primary"><PanelMenuButton open={menuOpen} onClick={onMenuToggle} controls={menuId} inverse /><div className="platform-brand"><ProductLogo subtitle="کنترل‌تاور عملیات شرکت X" /></div></div><div className="platform-header__user"><span>{roleLabels[role] || 'پنل شرکت X'}</span><button type="button" onClick={onLogout}>خروج</button></div></header>;
}

function caseTimeline(item) {
  const values = [
    ['RFQ1 / Customer', item.commercialState],
    ['Customer-X contract', item.commercialState === 'CUSTOMER_CONTRACTED' ? item.commercialState : null],
    ['RFQ2 / Capacity', item.capacityState],
    ['Loading', item.loadingState],
    ['Customs / TIR', item.customsState || item.tirState],
    ['Trip / Border', item.tripState],
    ['POD / Delivery', item.deliveryState],
    ['Settlement', item.financialState]
  ];
  const current = item.deliveryState || item.tripState || item.loadingState || item.capacityState || item.commercialState;
  return values.map(([label, value]) => ({ label, state: stateLabel(value), done: Boolean(value && value !== current), current: value === current }));
}

function Card({ title, eyebrow, children, actions }) {
  return <section className="company-x-card"><div className="company-x-card__heading"><div><span className="platform-eyebrow">{eyebrow}</span><h2>{title}</h2></div>{actions}</div>{children}</section>;
}

export default function CompanyXPanel({ user, token, apiUrl, onLogout }) {
  const role = user?.role || 'company_x_operations_manager';
  const { menuId, menuOpen, closeMenu, toggleMenu } = usePanelNavigation('company-x-menu');
  const canPrice = [ 'company_x_owner', 'company_x_pricing_expert' ].includes(role);
  const canAward = [ 'company_x_owner', 'company_x_operations_manager' ].includes(role);
  const canContract = canAward;
  const canDispatch = [ 'company_x_owner', 'company_x_operations_manager', 'company_x_dispatcher' ].includes(role);
  const canDocuments = canDispatch || role === 'company_x_document_expert';
  const canPod = [ 'company_x_owner', 'company_x_operations_manager', 'company_x_document_expert' ].includes(role);
  const canFinance = canAward;
  const canException = canDispatch;

  const [section, setSection] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [context, setContext] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [rfqRead, setRfqRead] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [nomination, setNomination] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [loadingEvidence, setLoadingEvidence] = useState([]);
  const [tracking, setTracking] = useState(null);
  const [pod, setPod] = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [issues, setIssues] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [auditItems, setAuditItems] = useState([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [awardOpen, setAwardOpen] = useState(false);
  const [awardReason, setAwardReason] = useState('');
  const [awardWinner, setAwardWinner] = useState('');
  const [activeRfq, setActiveRfq] = useState(null);
  const [quote, setQuote] = useState({ amount: '', currency: 'EUR', validUntil: '', transitTime: '', services: '', costComponents: '', estimatedRate: '', suggestedRate: '', firmRate: '', xMargin: '', platformFee: '', priceRisk: '', outlier: false, outlierReason: '' });
  const [rfq2Form, setRfq2Form] = useState({ deadlineAt: '', requiredVehicle: '', loadingWindow: '', permitRules: '', operationalInstructions: '', settlementConditions: '' });
  const [scheduleForm, setScheduleForm] = useState({ checkInAt: '', loadingWindow: '', location: '', notes: '' });
  const [evidenceForm, setEvidenceForm] = useState({ evidenceType: 'ARRIVAL', fileRef: '', fileHash: '', deviceRef: '', mismatch: false, mismatchReason: '' });
  const [readiness, setReadiness] = useState({ customsReady: false, routePermitReady: false, documentsReady: false, vehicleReady: false, driverReady: false, preloadState: 'PRELOAD_ACCEPTED', loadingState: 'PRELOAD_ACCEPTED' });
  const [documentForm, setDocumentForm] = useState({ docType: 'COMMERCIAL_DOC', fileRef: '', fileHash: '', sensitivity: 'P1', deadlineAt: '' });
  const [cmrForm, setCmrForm] = useState({ fileRef: '', fileHash: '' });
  const [tirForm, setTirForm] = useState({ state: 'CARNET_ISSUED', holderOrgId: '', holderAuthorizationRef: '' });
  const [issueReason, setIssueReason] = useState('');
  const [exceptionForm, setExceptionForm] = useState({ exceptionType: 'DOCUMENT_MISMATCH', severity: 'medium', reason: '' });
  const [podReason, setPodReason] = useState('');

  const cases = dashboard?.cases || [];
  const trips = dashboard?.trips || [];
  const metrics = dashboard?.metrics || { cases: 0, activeTrips: 0, pendingEvidence: 0 };
  const currentRfq1 = selectedCase?.rfqs?.find((item) => item.level === 'RFQ1');
  const currentRfq2 = selectedCase?.rfqs?.find((item) => item.level === 'RFQ2');
  const currentContract = selectedCase?.contracts?.[0];
  const documents = selectedCase?.documents || [];

  const notify = (error) => setNotice(error?.message ? { code: error.code, message: error.message } : { message: String(error) });

  const loadDashboard = async () => {
    setBusy(true);
    try {
      const [nextDashboard, nextContext, nextNotifications] = await Promise.all([
        requestJson(apiUrl, '/api/platform/dashboard', token),
        requestJson(apiUrl, '/api/platform/context', token).catch(() => null),
        requestJson(apiUrl, '/api/platform/notifications?limit=40', token).catch(() => ({ notifications: [] }))
      ]);
      setDashboard(nextDashboard);
      setContext(nextContext);
      setNotifications(nextNotifications.notifications || []);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  usePlatformRealtime({ apiUrl, token, onEvent: loadDashboard });

  useEffect(() => { loadDashboard(); }, [token]);

  const loadCase = async (item, nextSection = 'dispatch') => {
    setBusy(true);
    try {
      const [details, ledger, issueList, exceptionList] = await Promise.all([
        requestJson(apiUrl, `/api/platform/cases/${item.id}`, token),
        requestJson(apiUrl, `/api/platform/cases/${item.id}/settlements`, token).catch(() => ({ settlements: [] })),
        requestJson(apiUrl, `/api/platform/cases/${item.id}/issues`, token).catch(() => ({ issues: [] })),
        requestJson(apiUrl, `/api/platform/cases/${item.id}/exceptions`, token).catch(() => ({ exceptions: [] }))
      ]);
      const nextCase = { ...details.case, documents: details.documents || [], trips: details.trips || [], rfqs: details.rfqs || [], contracts: details.contracts || [], timeline: details.timeline || [] };
      setSelectedCase(nextCase);
      setSettlements(ledger.settlements || []);
      setIssues(issueList.issues || []);
      setExceptions(exceptionList.exceptions || []);
      setSection(nextSection);
      const trip = nextCase.trips?.[0] || trips.find((candidate) => candidate.caseId === nextCase.id);
      if (trip) await loadTrip(trip);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const loadTrip = async (trip) => {
    setSelectedTrip(trip);
    const [nextNomination, nextSchedule, nextEvidence, nextTracking, nextPod] = await Promise.all([
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/nomination`, token).catch(() => null),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/loading-schedule`, token).catch(() => ({ schedules: [] })),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/loading-evidence`, token).catch(() => ({ evidence: [] })),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/tracking`, token).catch(() => null),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/pod`, token).catch(() => ({ pod: null }))
    ]);
    setNomination(nextNomination);
    setSchedule(nextSchedule);
    setLoadingEvidence(nextEvidence?.evidence || []);
    setTracking(nextTracking);
    setPod(nextPod?.pod || null);
    setReadiness(trip.readiness || { customsReady: false, routePermitReady: false, documentsReady: false, vehicleReady: false, driverReady: false, preloadState: 'PRELOAD_ACCEPTED', loadingState: 'PRELOAD_ACCEPTED' });
  };

  const selectedRfq = activeRfq || currentRfq1 || currentRfq2;
  const openRfq = async (rfq) => {
    setBusy(true);
    try {
      const result = await requestJson(apiUrl, `/api/platform/rfqs/${rfq.id}`, token);
      setActiveRfq(result);
      setAwardWinner(result.quotes?.[0]?.bidderOrgId || '');
      setSection(rfq.level === 'RFQ1' ? 'pricing' : 'rfq2');
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const submitQuote = async (rfq = activeRfq) => {
    if (!rfq || !quote.amount) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/rfqs/${rfq.id}/quotes`, token, {
        method: 'POST',
        idempotencyKey: idempotency('quote'),
        body: JSON.stringify({
          amount: Number(quote.amount),
          currency: quote.currency,
          terms: { validUntil: quote.validUntil, transitTime: quote.transitTime, services: quote.services },
          pricing: { estimatedRate: quote.estimatedRate, suggestedRate: quote.suggestedRate, firmRate: quote.firmRate, costComponents: quote.costComponents.split(',').map((item) => item.trim()).filter(Boolean), xMargin: quote.xMargin, platformFee: quote.platformFee, priceRisk: quote.priceRisk, outlier: quote.outlier, outlierReason: quote.outlierReason },
          isAiAssisted: false
        })
      });
      setNotice({ message: 'Quote1 مهر و موم‌شده ثبت شد؛ مشاهده رقبا ممکن نیست.' });
      await openRfq({ id: rfq.id, level: rfq.level });
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const loadPricing = async () => {
    if (!currentRfq1) return;
    try {
      setPricing(await requestJson(apiUrl, `/api/platform/rfqs/${currentRfq1.id}/pricing`, token));
    } catch (error) {
      notify(error);
    }
  };

  const award = async () => {
    if (!activeRfq || !awardWinner || awardReason.trim().length < 8) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/rfqs/${activeRfq.id}/award`, token, { method: 'POST', idempotencyKey: idempotency('human-award'), body: JSON.stringify({ winnerOrgId: awardWinner, reason: awardReason.trim(), aiActor: false }) });
      setAwardOpen(false);
      setAwardReason('');
      setNotice({ message: 'اعطای انسانی با دلیل ثبت شد.' });
      await loadDashboard();
      if (selectedCase) await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const acceptContract = async () => {
    if (!currentContract) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/contracts/${currentContract.id}/accept-x`, token, { method: 'POST', idempotencyKey: idempotency('contract-x'), body: JSON.stringify({}) });
      setNotice({ message: 'Customer-X توسط شرکت X پذیرفته و role lock حفظ شد.' });
      if (selectedCase) await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const acceptAward = async () => {
    if (!selectedCase) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/cases/${selectedCase.id}/accept-award`, token, { method: 'POST', idempotencyKey: idempotency('award-acceptance'), body: JSON.stringify({}) });
      setNotice({ message: 'Award مشتری پذیرفته شد؛ قرارداد Customer-X گام بعدی است.' });
      await loadCase(selectedCase, 'contracts');
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const publishRfq2 = async () => {
    if (!selectedCase) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/cases/${selectedCase.id}/capacity-rfq`, token, { method: 'POST', idempotencyKey: idempotency('rfq2'), body: JSON.stringify({ deadlineAt: rfq2Form.deadlineAt || undefined, requiredVehicle: rfq2Form.requiredVehicle, loadingWindow: rfq2Form.loadingWindow, permitRules: rfq2Form.permitRules, operationalInstructions: rfq2Form.operationalInstructions, settlementConditions: rfq2Form.settlementConditions }) });
      setNotice({ message: 'RFQ2 فقط برای شبکه Y واجد شرایط منتشر شد.' });
      await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const createTrip = async () => {
    if (!selectedCase) return;
    setBusy(true);
    try {
      const result = await requestJson(apiUrl, '/api/platform/trips', token, { method: 'POST', idempotencyKey: idempotency('trip'), body: JSON.stringify({ caseId: selectedCase.id }) });
      setNotice({ message: 'سفر عملیاتی ایجاد شد.' });
      await loadDashboard();
      await loadCase({ id: selectedCase.id });
      if (result.tripId) await loadTrip({ id: result.tripId, caseId: selectedCase.id, readiness: {} });
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = async () => {
    if (!selectedTrip) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/loading-schedule`, token, { method: 'POST', idempotencyKey: idempotency('schedule'), body: JSON.stringify({ schedule: scheduleForm }) });
      setNotice({ message: 'برنامه بارگیری به‌صورت نسخه جدید ثبت شد.' });
      await loadTrip(selectedTrip);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const submitLoadingEvidence = async () => {
    if (!selectedTrip) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/loading-evidence`, token, { method: 'POST', idempotencyKey: idempotency('loading-evidence'), body: JSON.stringify(evidenceForm) });
      setNotice({ message: 'شاهد بارگیری immutable ثبت شد.' });
      await loadTrip(selectedTrip);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const saveReadiness = async () => {
    if (!selectedTrip) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/readiness`, token, { method: 'POST', idempotencyKey: idempotency('readiness'), body: JSON.stringify({ readiness }) });
      setNotice({ message: 'گیت‌های آمادگی از سرور به‌روزرسانی شد.' });
      await loadTrip(selectedTrip);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const uploadDocument = async () => {
    if (!selectedCase || !documentForm.fileRef || !/^[a-f0-9]{64}$/i.test(documentForm.fileHash)) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, '/api/platform/documents', token, { method: 'POST', idempotencyKey: idempotency('document'), body: JSON.stringify({ caseId: selectedCase.id, ...documentForm }) });
      setNotice({ message: 'نسخه سند ثبت شد؛ overwrite وجود ندارد.' });
      await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const createCmr = async () => {
    if (!selectedCase || !/^[a-f0-9]{64}$/i.test(cmrForm.fileHash)) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/cases/${selectedCase.id}/cmr-draft`, token, { method: 'POST', idempotencyKey: idempotency('cmr-draft'), body: JSON.stringify(cmrForm) });
      setNotice({ message: 'CMR Draft نسخه‌دار برای بررسی مشتری ارسال شد.' });
      await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const changeTir = async () => {
    if (!selectedTrip) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/tir`, token, { method: 'POST', idempotencyKey: idempotency('tir'), body: JSON.stringify(tirForm) });
      setNotice({ message: 'وضعیت مستقل TIR ثبت شد.' });
      await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const reviewPod = async (action) => {
    if (!pod) return;
    setBusy(true);
    try {
      const path = action === 'accept' ? `/api/platform/pods/${pod.id}/accept` : action === 'return' ? `/api/platform/pods/${pod.id}/return` : `/api/platform/pods/${pod.id}/risk-flag`;
      const body = action === 'accept' ? {} : { reason: podReason.trim(), flagType: action === 'risk' ? 'RISK' : undefined };
      await requestJson(apiUrl, path, token, { method: 'POST', idempotencyKey: idempotency(`pod-${action}`), body: JSON.stringify(body) });
      setPod((current) => current ? { ...current, state: action === 'accept' ? 'ACCEPTED' : action === 'return' ? 'RETURNED' : current.state } : current);
      setPodReason('');
      setNotice({ message: action === 'accept' ? 'POD پذیرفته شد و شرط تسویه به‌روزرسانی شد.' : 'اقدام POD ثبت و Audit شد.' });
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const confirmSettlement = async (settlementId) => {
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/settlements/${settlementId}/confirm`, token, { method: 'POST', idempotencyKey: idempotency('settlement'), body: JSON.stringify({}) });
      setNotice({ message: 'تسویه رابطه مجاز تأیید شد.' });
      if (selectedCase) await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const openIssue = async (type) => {
    if (!selectedCase || issueReason.trim().length < 8) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/cases/${selectedCase.id}/${type}`, token, { method: 'POST', idempotencyKey: idempotency(type), body: JSON.stringify({ reason: issueReason.trim(), tripId: selectedTrip?.id }) });
      setIssueReason('');
      setNotice({ message: `${type === 'claims' ? 'Claim' : 'Dispute'} ثبت شد.` });
      await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const createException = async () => {
    if (!selectedTrip || exceptionForm.reason.trim().length < 8) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/exceptions`, token, { method: 'POST', idempotencyKey: idempotency('exception'), body: JSON.stringify(exceptionForm) });
      setExceptionForm((current) => ({ ...current, reason: '' }));
      setNotice({ message: 'Exception ثبت شد.' });
      await loadCase(selectedCase);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const downloadDocument = async (document) => {
    try {
      const result = await requestJson(apiUrl, `/api/platform/documents/${document.id}/download`, token);
      setNotice({ message: `لینک کوتاه‌عمر نسخه ${document.versionNo} صادر شد؛ Download در Audit ثبت شده است.` });
      if (result.fileRef) window.open(`${apiUrl}${result.fileRef}`, '_blank', 'noopener,noreferrer');
    } catch (error) {
      notify(error);
    }
  };

  const openAudit = async () => {
    try {
      const result = await requestJson(apiUrl, `/api/platform/audit${selectedCase ? `?caseId=${selectedCase.id}` : ''}`, token);
      setAuditItems(result.items || []);
      setAuditOpen(true);
    } catch (error) {
      notify(error);
    }
  };

  const operationCases = useMemo(() => cases.filter((item) => item.commercialState !== 'DRAFT'), [cases]);
  const selectedRfqQuotes = activeRfq?.quotes || [];

  const renderDashboard = () => <>
    <section className="company-x-metrics"><article><span>پرونده‌های عملیاتی</span><strong>{Number(metrics.cases).toLocaleString('fa-IR')}</strong><small>tenant / org scoped</small></article><article><span>سفر فعال</span><strong>{Number(metrics.activeTrips).toLocaleString('fa-IR')}</strong><small>GPS least privilege</small></article><article><span>شاهد در انتظار</span><strong>{Number(metrics.pendingEvidence).toLocaleString('fa-IR')}</strong><small>نیازمند اقدام</small></article><article><span>نقش قراردادی</span><strong>Company X</strong><small>ROLE_LOCKED پس از قرارداد</small></article></section>
    <Card title="صف عملیات شرکت X" eyebrow="Market A + Market B + Control Tower" actions={<button className="platform-button" type="button" onClick={loadDashboard}>بروزرسانی</button>}>
      {cases.length ? <div className="company-x-case-grid">{cases.map((item) => <button className="company-x-case" type="button" key={item.id} onClick={() => loadCase(item)}><div><span>#{item.caseNumber}</span><RiskBadge flags={item.riskFlags} /></div><strong>{item.cargo?.type || 'محموله'}</strong><small>{item.origin?.location || 'مبدأ'} ← {item.destination?.location || 'مقصد'}</small><b>{stateLabel(item.deliveryState || item.tripState || item.capacityState || item.commercialState)}</b></button>)}</div> : <div className="platform-empty"><strong>پرونده‌ای به شرکت X متصل نیست</strong><span>RFQ1های واجد صلاحیت یا پرونده‌های Awardشده اینجا ظاهر می‌شوند.</span></div>}
    </Card>
  </>;

  const renderRfq1 = () => <Card title="RFQهای سطح ۱ دریافتی" eyebrow="Market A · sealed quote book">
    <p className="company-x-hint">شرکت X فقط Quote خودش را می‌بیند. Quote رقبا و Market B از این read model عبور نمی‌کند.</p>
    <div className="company-x-list">{operationCases.filter((item) => ['RFQ_OPEN', 'OFFERS_RECEIVED', 'PROVIDER_AWARDED'].includes(item.commercialState)).map((item) => <button type="button" key={item.id} onClick={() => loadCase(item, 'pricing')}><span>#{item.caseNumber}</span><strong>{item.cargo?.type || 'محموله'}</strong><small>{stateLabel(item.commercialState)}</small><b>باز کردن RFQ1</b></button>)}</div>
  </Card>;

  const renderPricing = () => <>
    <Card title="نرخ‌دهی مشتری / Quote1" eyebrow="P$ · own quote only" actions={currentRfq1 && canPrice && <button type="button" className="platform-button" onClick={loadPricing}>بارگذاری قیمت داخلی</button>}>
    {selectedCase ? <><div className="company-x-facts"><span>پرونده <b>#{selectedCase.caseNumber}</b></span><span>مسیر <b>{selectedCase.origin?.location} ← {selectedCase.destination?.location}</b></span><span>کالا <b>{selectedCase.cargo?.type} / {selectedCase.cargo?.weight || '—'}</b></span><span>RFQ <b>{currentRfq1?.id || '—'}</b></span></div><div className="company-x-form-grid">{field('مبلغ Quote1', quote.amount, (value) => setQuote((current) => ({ ...current, amount: value })), { type: 'number', min: '0' })}{field('Currency', quote.currency, (value) => setQuote((current) => ({ ...current, currency: value.toUpperCase().slice(0, 3) })))}{field('Valid Until', quote.validUntil, (value) => setQuote((current) => ({ ...current, validUntil: value })), { type: 'datetime-local' })}{field('Transit time / ETA', quote.transitTime, (value) => setQuote((current) => ({ ...current, transitTime: value })))}{field('Cost components', quote.costComponents, (value) => setQuote((current) => ({ ...current, costComponents: value })), { placeholder: 'fuel, toll, border ...' })}{field('Estimated rate', quote.estimatedRate, (value) => setQuote((current) => ({ ...current, estimatedRate: value })), { type: 'number' })}{field('Suggested rate', quote.suggestedRate, (value) => setQuote((current) => ({ ...current, suggestedRate: value })), { type: 'number' })}{field('Firm rate', quote.firmRate, (value) => setQuote((current) => ({ ...current, firmRate: value })), { type: 'number' })}{field('X Margin · فقط P$', quote.xMargin, (value) => setQuote((current) => ({ ...current, xMargin: value })), { type: 'number' })}{field('Platform fee', quote.platformFee, (value) => setQuote((current) => ({ ...current, platformFee: value })), { type: 'number' })}{field('Price risk', quote.priceRisk, (value) => setQuote((current) => ({ ...current, priceRisk: value })))}{field('Included services', quote.services, (value) => setQuote((current) => ({ ...current, services: value })))}<label className="company-x-check"><input type="checkbox" checked={quote.outlier} onChange={(event) => setQuote((current) => ({ ...current, outlier: event.target.checked }))} /><span>Outlier / نیازمند Justification</span></label>{quote.outlier && field('دلیل Outlier', quote.outlierReason, (value) => setQuote((current) => ({ ...current, outlierReason: value })), { placeholder: 'حداقل ۸ حرف' })}</div><button className="platform-button platform-button--primary" type="button" disabled={!canPrice || busy || !currentRfq1 || !quote.amount} onClick={() => { setActiveRfq(currentRfq1); submitQuote(currentRfq1); }}>ثبت Quote1 مهر و موم‌شده</button></> : <div className="platform-empty"><strong>پرونده RFQ1 را انتخاب کن</strong><span>قیمت داخلی فقط از endpoint مجاز P$ خوانده می‌شود.</span></div>}
    </Card>
    {pricing && <Card title="Price Book داخلی" eyebrow="X-only · audited read"><MoneyBreakdown items={[{ label: 'Estimated', amount: pricing.pricing?.estimatedRate, currency: pricing.currency }, { label: 'Suggested', amount: pricing.pricing?.suggestedRate, currency: pricing.currency }, { label: 'X Margin', amount: pricing.pricing?.xMargin, currency: pricing.currency }, { label: 'Platform Fee', amount: pricing.pricing?.platformFee, currency: pricing.currency }]} /><span className="company-x-private">این بخش برای Customer، Y و Driver قابل مشاهده نیست.</span></Card>}
  </>;

  const renderContracts = () => <Card title="قراردادهای Customer-X" eyebrow="ROLE_LOCKED · versioned">
    {selectedCase ? <>{selectedCase.commercialState === 'PROVIDER_AWARDED' && !selectedCase.xAwardAcceptedAt && canContract && <button className="platform-button" type="button" disabled={busy} onClick={acceptAward}>پذیرش Award مشتری</button>}{selectedCase.contracts?.map((contract) => <article className="company-x-contract" key={contract.id}><div><strong>نسخه {contract.versionNo}</strong><span>{contract.state} · role lock: {contract.roleLock}</span></div><small>امضای مشتری: {contract.signedAt || '—'} · امضای X: {contract.xSignedAt || 'در انتظار'}</small><p>مبلغ Customer-X: {contract.snapshot?.customerFreightPrice ?? '—'} {contract.snapshot?.currency || ''} · محرمانگی: فعال</p></article>)}{currentContract && canContract && !currentContract.xSignedAt && <button className="platform-button platform-button--primary" type="button" disabled={busy} onClick={acceptContract}>پذیرش و امضای شرکت X</button>}{!selectedCase.contracts?.length && <div className="platform-empty-inline">قرارداد پس از Award مشتری در صف شرکت X قرار می‌گیرد.</div>}</> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>نسخه‌های قرارداد فقط برای طرف Customer-X نمایش داده می‌شوند.</span></div>}
  </Card>;

  const renderRfq2 = () => <>
    <Card title="اعلام بار / RFQ2" eyebrow="Market B · Company X → qualified Y">
      {selectedCase ? <><div className="company-x-facts"><span>پرونده <b>#{selectedCase.caseNumber}</b></span><span>وضعیت <b>{stateLabel(selectedCase.capacityState)}</b></span><span>شرکت Y <b>{selectedCase.yOrgId || 'پس از Award'}</b></span></div><div className="company-x-form-grid">{field('Deadline', rfq2Form.deadlineAt, (value) => setRfq2Form((current) => ({ ...current, deadlineAt: value })), { type: 'datetime-local' })}{field('Required vehicle', rfq2Form.requiredVehicle, (value) => setRfq2Form((current) => ({ ...current, requiredVehicle: value })))}{field('Loading window', rfq2Form.loadingWindow, (value) => setRfq2Form((current) => ({ ...current, loadingWindow: value })))}{field('Permit / qualification rules', rfq2Form.permitRules, (value) => setRfq2Form((current) => ({ ...current, permitRules: value })))}{field('Operational instructions', rfq2Form.operationalInstructions, (value) => setRfq2Form((current) => ({ ...current, operationalInstructions: value })))}{field('Settlement conditions', rfq2Form.settlementConditions, (value) => setRfq2Form((current) => ({ ...current, settlementConditions: value })))}</div><button className="platform-button platform-button--primary" type="button" disabled={!canDispatch || busy || selectedCase.commercialState !== 'CUSTOMER_CONTRACTED' || selectedCase.capacityState} onClick={publishRfq2}>انتشار RFQ2 برای شبکه Y</button>{currentRfq2 && <button className="platform-button" type="button" onClick={() => openRfq(currentRfq2)}>مشاهده Bidهای مجاز Y</button>}</> : <div className="platform-empty"><strong>پرونده Customer-Contracted را انتخاب کن</strong><span>RFQ2 هرگز از مسیر RFQ1 یا به Driver منتشر نمی‌شود.</span></div>}
    </Card>
    {activeRfq?.level === 'RFQ2' && <Card title={`Bidهای RFQ2 · ${stateLabel(activeRfq.state)}`} eyebrow="Human award · X → Y" actions={<button className="platform-button platform-button--primary" type="button" disabled={!canAward || !selectedRfqQuotes.length} onClick={() => setAwardOpen(true)}>Award شرکت Y</button>}><div className="company-x-list">{selectedRfqQuotes.length ? selectedRfqQuotes.map((item) => <article key={item.id}><span>{item.companyName || item.bidderOrgId}</span><strong>{item.amount ?? 'محرمانه' } {item.currency || ''}</strong><small>{item.qualificationState} · {item.terms?.transitTime || 'زمان حمل ثبت نشده'}</small></article>) : <div className="platform-empty-inline">Bidها تا پایان پنجره مهر و موم هستند.</div>}</div></Card>}
  </>;

  const renderDispatch = () => <Card title="دیسپچ و عملیات سفر" eyebrow="Capacity award → trip → check-in" actions={selectedCase && <button className="platform-button" type="button" onClick={() => loadCase(selectedCase)}>بروزرسانی</button>}>
    {selectedCase ? <><div className="company-x-facts"><span>پرونده <b>#{selectedCase.caseNumber}</b></span><span>Capacity <b>{stateLabel(selectedCase.capacityState)}</b></span><span>Trip <b>{selectedTrip ? stateLabel(selectedTrip.state) : 'ایجاد نشده'}</b></span><span>Y <b>{selectedCase.yOrgId || '—'}</b></span></div>{selectedTrip ? <button className="platform-button platform-button--primary" type="button" onClick={() => loadTrip(selectedTrip)}>باز کردن Control Tower سفر #{selectedTrip.id}</button> : <button className="platform-button platform-button--primary" type="button" disabled={!canDispatch || busy || selectedCase.capacityState !== 'CARRIER_AWARDED'} onClick={createTrip}>ایجاد سفر پس از Award شرکت Y</button>}</> : <div className="platform-empty"><strong>یک پرونده را انتخاب کن</strong><span>Trip فقط پس از Award شرکت Y ساخته می‌شود.</span></div>}
  </Card>;

  const renderNetwork = () => <Card title="شبکه Carrier / Y" eyebrow="Qualified capacity only"><p className="company-x-hint">مخزن کامل Driverهای Y در این پنل منتشر نمی‌شود؛ فقط Bidهای RFQ2 و nomination مرتبط با سفر خوانده می‌شود.</p>{selectedCase?.rfqs?.filter((item) => item.level === 'RFQ2').map((item) => <article className="company-x-contract" key={item.id}><div><strong>RFQ2 #{item.id}</strong><span>{stateLabel(item.state)}</span></div><small>Deadline: {item.deadline_at} · برنده: {item.awarded_org_id || '—'}</small></article>)}{!selectedCase && <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>شبکه بر اساس qualification و پرونده جاری محدود می‌شود.</span></div>}</Card>;

  const renderNomination = () => <Card title="معرفی Driver / Vehicle" eyebrow="Y coverage validation"><>{selectedTrip ? <>{nomination ? <div className="company-x-nomination"><article><span>Driver</span><strong>{nomination.driver?.name || 'ثبت نشده'}</strong><small>{nomination.driver?.status || '—'} · coverage: {nomination.driver?.coverageState || '—'} · qualification: {nomination.driver?.qualificationState || '—'}</small></article><article><span>Vehicle</span><strong>{nomination.vehicle?.plateNumber || 'ثبت نشده'}</strong><small>{nomination.vehicle?.status || '—'} · cargo scope: {Array.isArray(nomination.vehicle?.cargoScope) ? nomination.vehicle.cargoScope.join(', ') || '—' : 'ثبت‌شده'}</small></article></div> : <div className="platform-empty-inline">Nomination هنوز از شرکت Y دریافت نشده است.</div>}<button className="platform-button" type="button" onClick={() => loadTrip(selectedTrip)}>بررسی مجدد Nomination</button></> : <div className="platform-empty"><strong>Trip را انتخاب کن</strong><span>X فقط nomination معتبر از Y را review می‌کند و مستقیماً Driver را award نمی‌کند.</span></div>}</></Card>;

  const renderLoading = () => <Card title="عملیات بارگیری" eyebrow="Immutable loading evidence" actions={selectedTrip && <button className="platform-button" type="button" onClick={() => loadTrip(selectedTrip)}>بروزرسانی</button>}>
    {selectedTrip ? <><div className="company-x-form-grid">{field('Check-in target', scheduleForm.checkInAt, (value) => setScheduleForm((current) => ({ ...current, checkInAt: value })), { type: 'datetime-local' })}{field('Loading window', scheduleForm.loadingWindow, (value) => setScheduleForm((current) => ({ ...current, loadingWindow: value })))}{field('Loading location', scheduleForm.location, (value) => setScheduleForm((current) => ({ ...current, location: value })))}{field('Notes', scheduleForm.notes, (value) => setScheduleForm((current) => ({ ...current, notes: value })) )}</div><button className="platform-button" type="button" disabled={!canDispatch || busy} onClick={saveSchedule}>ثبت نسخه جدید برنامه بارگیری</button><div className="company-x-divider" /><div className="company-x-form-grid">{selectField('Evidence type', evidenceForm.evidenceType, (value) => setEvidenceForm((current) => ({ ...current, evidenceType: value })), evidenceTypes.map((value) => [value, value]))}{field('File reference', evidenceForm.fileRef, (value) => setEvidenceForm((current) => ({ ...current, fileRef: value })))}{field('SHA-256 hash', evidenceForm.fileHash, (value) => setEvidenceForm((current) => ({ ...current, fileHash: value })))}{field('Device', evidenceForm.deviceRef, (value) => setEvidenceForm((current) => ({ ...current, deviceRef: value })))}<label className="company-x-check"><input type="checkbox" checked={evidenceForm.mismatch} onChange={(event) => setEvidenceForm((current) => ({ ...current, mismatch: event.target.checked }))} /><span>Mismatch → باز کردن Exception</span></label>{evidenceForm.mismatch && field('Mismatch reason', evidenceForm.mismatchReason, (value) => setEvidenceForm((current) => ({ ...current, mismatchReason: value })))}</div><button className="platform-button platform-button--primary" type="button" disabled={!canDocuments || busy} onClick={submitLoadingEvidence}>ثبت شاهد immutable</button><div className="company-x-divider" /><div className="company-x-readiness"><strong>Server readiness gates</strong>{['customsReady', 'routePermitReady', 'documentsReady', 'vehicleReady', 'driverReady'].map((key) => <label key={key}><input type="checkbox" checked={Boolean(readiness[key])} onChange={(event) => setReadiness((current) => ({ ...current, [key]: event.target.checked }))} /><span>{key}</span></label>)}{selectField('Preload state', readiness.preloadState, (value) => setReadiness((current) => ({ ...current, preloadState: value })), [['PRELOAD_ACCEPTED', 'PRELOAD_ACCEPTED'], ['CHECKED_IN', 'CHECKED_IN']])}{selectField('Loading state', readiness.loadingState || 'PRELOAD_ACCEPTED', (value) => setReadiness((current) => ({ ...current, loadingState: value })), [['PRELOAD_ACCEPTED', 'PRELOAD_ACCEPTED'], ['LOADED', 'LOADED'], ['WEIGHT_CONFIRMED', 'WEIGHT_CONFIRMED'], ['COMMERCIAL_DOCS_READY', 'COMMERCIAL_DOCS_READY']])}<button className="platform-button" type="button" disabled={!canDispatch || busy} onClick={saveReadiness}>به‌روزرسانی گیت‌ها</button></div><EvidenceGallery evidence={loadingEvidence.map((item) => ({ type: item.evidenceType, label: `${item.createdAt || ''}${item.mismatch ? ' · mismatch' : ''}` }))} /></> : <div className="platform-empty"><strong>Trip را انتخاب کن</strong><span>Evidence اصلی قابل حذف یا overwrite نیست.</span></div>}
  </Card>;

  const renderDocuments = () => <Card title="اسناد نسخه‌دار" eyebrow="DMS · no overwrite">
    {selectedCase ? <><div className="company-x-doc-list">{documents.length ? documents.map((document) => <DocCard key={document.id} document={document} onOpen={downloadDocument} />) : <div className="platform-empty-inline">سندی در پرونده نیست.</div>}</div>{canDocuments && <div className="company-x-form-grid company-x-upload"><select value={documentForm.docType} onChange={(event) => setDocumentForm((current) => ({ ...current, docType: event.target.value }))}><option>COMMERCIAL_DOC</option><option>CUSTOMS_PERMIT</option><option>ROUTE_PERMIT</option><option>INVOICE</option><option>PACKING_LIST</option><option>EXPORT_PERMIT</option><option>IMPORT_PERMIT</option></select>{field('File reference', documentForm.fileRef, (value) => setDocumentForm((current) => ({ ...current, fileRef: value })))}{field('SHA-256 hash', documentForm.fileHash, (value) => setDocumentForm((current) => ({ ...current, fileHash: value })))}{field('Deadline', documentForm.deadlineAt, (value) => setDocumentForm((current) => ({ ...current, deadlineAt: value })), { type: 'datetime-local' })}<button className="platform-button platform-button--primary" type="button" disabled={busy} onClick={uploadDocument}>ثبت نسخه سند</button></div>}</> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>فایل صادرشده توسط Y یا گمرک از این پنل overwrite نمی‌شود.</span></div>}
  </Card>;

  const renderCmr = () => <Card title="CMR / TIR / Customs" eyebrow="Independent document domains">
    {selectedCase ? <><div className="company-x-doc-list">{documents.filter((document) => ['CMR_DRAFT', 'CMR_FINAL', 'TIR_CARNET', 'CUSTOMS_PERMIT', 'ROUTE_PERMIT'].includes(document.docType)).map((document) => <DocCard key={document.id} document={document} onOpen={downloadDocument} />)}</div>{canDocuments && <div className="company-x-form-grid company-x-upload">{field('CMR Draft file reference', cmrForm.fileRef, (value) => setCmrForm((current) => ({ ...current, fileRef: value })))}{field('CMR Draft SHA-256', cmrForm.fileHash, (value) => setCmrForm((current) => ({ ...current, fileHash: value })))}<button className="platform-button platform-button--primary" type="button" disabled={busy} onClick={createCmr}>ایجاد CMR Draft برای مشتری</button></div>}{selectedTrip && <div className="company-x-form-grid company-x-upload">{selectField('TIR state', tirForm.state, (value) => setTirForm((current) => ({ ...current, state: value })), [['CARNET_ISSUED', 'CARNET_ISSUED'], ['OPENED', 'OPENED'], ['CHECKPOINTS', 'CHECKPOINTS'], ['DISCHARGED', 'DISCHARGED'], ['NOT_APPLICABLE', 'NOT_APPLICABLE']])}{field('Holder organization', tirForm.holderOrgId, (value) => setTirForm((current) => ({ ...current, holderOrgId: value })))}{field('Holder authorization ref', tirForm.holderAuthorizationRef, (value) => setTirForm((current) => ({ ...current, holderAuthorizationRef: value })))}<button className="platform-button" type="button" disabled={!canDocuments || busy} onClick={changeTir}>ثبت State مستقل TIR</button></div>}<p className="company-x-hint">CMR Draft را X ایجاد می‌کند، مشتری approve/lock می‌کند و صدور نهایی CMR طبق قرارداد پایه با Y است. TIR بدون Holder معتبر عبور نمی‌کند.</p></> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>گیت Customs و Route Permit توسط سرور کنترل می‌شود.</span></div>}
  </Card>;

  const renderTracking = () => <Card title="Control Tower / Tracking" eyebrow="Least-privilege active trip" actions={selectedTrip && <button className="platform-button" type="button" onClick={() => loadTrip(selectedTrip)}>بروزرسانی</button>}>
    {tracking ? <><div className="company-x-facts"><span>State <b>{stateLabel(tracking.state || selectedTrip?.state)}</b></span><span>ETA <b>{tracking.eta || tracking.etaAt || '—'}</b></span><span>Milestone <b>{tracking.lastMilestone || '—'}</b></span><RiskBadge flags={tracking.delayFlags || []} /></div><StatusTimeline items={(tracking.timeline || []).map((item, index) => ({ label: stateLabel(item.eventType), detail: item.createdAt, current: index === 0, done: index > 0 }))} /><p className="company-x-hint">GPS خام فقط در scope سفر فعال و برای طرف مجاز دیده می‌شود؛ سفرهای دیگر راننده در این view وجود ندارد.</p></> : <div className="platform-empty"><strong>Trip فعال را انتخاب کن</strong><span>موقعیت و border event از read model کنترل‌شده خوانده می‌شود.</span></div>}
  </Card>;

  const renderPod = () => <Card title="POD Review" eyebrow="Submitted ≠ Accepted">
    {pod ? <><div className="company-x-facts"><span>State <b>{stateLabel(pod.state)}</b></span><span>Recipient <b>{pod.recipientOrgId}</b></span><span>Authority <b>{pod.authorityRef}</b></span><span>OTP <b>{pod.otpVerified ? 'تأیید' : 'طبق RulePack'}</b></span></div><EvidenceGallery evidence={Object.entries(pod.evidence || {}).filter(([key]) => key !== 'location').map(([key, value]) => ({ type: key, label: Array.isArray(value) ? `${value.length} مورد` : String(value || 'ثبت‌شده') }))} /><div className="company-x-form-grid"><label className="company-x-field"><span>دلیل Return / Risk</span><input value={podReason} onChange={(event) => setPodReason(event.target.value)} placeholder="حداقل ۸ حرف" /></label><div className="company-x-actions"><button className="platform-button platform-button--primary" type="button" disabled={!canPod || busy || pod.state !== 'SUBMITTED'} onClick={() => reviewPod('accept')}>Accept POD</button><button className="platform-button" type="button" disabled={!canPod || busy || podReason.length < 8 || pod.state !== 'SUBMITTED'} onClick={() => reviewPod('return')}>Return for completion</button><button className="platform-button" type="button" disabled={!canPod || busy || podReason.length < 8} onClick={() => reviewPod('risk')}>Risk flag</button></div></div>{pod.riskFlags?.length > 0 && <RiskBadge flags={pod.riskFlags} />}<p className="company-x-hint">فقط POD_ACCEPTED می‌تواند شرط Settlement را طبق Contract Rule فعال کند.</p></> : <div className="platform-empty"><strong>POD برای این Trip ارسال نشده است</strong><span>پس از Destination arrival، Agent/Z یا Consignee شواهد را ثبت می‌کند.</span></div>}
  </Card>;

  const renderFinance = () => <Card title="مالی و تسویه" eyebrow="Relationship-scoped ledgers">
    {selectedCase ? <><MoneyBreakdown items={settlements.map((item) => ({ ...item, label: `${item.relationship_type} · ${item.state}` }))} />{settlements.map((item) => <div className="company-x-finance-row" key={item.id}><span>{item.relationship_type} · {item.payer_org_id} ↔ {item.payee_org_id}</span><strong>{item.amount} {item.currency}</strong>{canFinance && item.state === 'SETTLEMENT_PENDING' && <button className="platform-button" type="button" disabled={busy} onClick={() => confirmSettlement(item.id)}>Confirm</button>}</div>)}<p className="company-x-hint">رابطه Customer-X، X-Y و X-Agent جدا هستند؛ Y-Driver و margin فقط با policy مربوط قابل مشاهده‌اند.</p></> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>دفترهای مالی بدون cross-relationship inference نمایش داده می‌شوند.</span></div>}
  </Card>;

  const renderIssues = () => <Card title="Claims / Disputes" eyebrow="Parallel case domains">
    {selectedCase ? <><label className="company-x-field company-x-wide"><span>شرح موضوع و evidence reference</span><textarea value={issueReason} onChange={(event) => setIssueReason(event.target.value)} rows="4" /></label><div className="company-x-actions"><button className="platform-button" type="button" disabled={!canAward || busy || issueReason.length < 8} onClick={() => openIssue('claims')}>Open Claim</button><button className="platform-button platform-button--primary" type="button" disabled={!canAward || busy || issueReason.length < 8} onClick={() => openIssue('disputes')}>Open Dispute</button></div><div className="company-x-list">{issues.map((item) => <article key={item.id}><span>{item.case_type} · {item.status}</span><strong>{item.reason}</strong><small>{item.timingWarning ? 'CLM-408 · timing warning' : 'evidence retained'}</small></article>)}</div></> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>Claim و Dispute با رابطه قراردادی همین پرونده ثبت می‌شوند.</span></div>}
  </Card>;

  const renderExceptions = () => <Card title="Exceptions" eyebrow="Human review queue">
    {selectedTrip && <div className="company-x-form-grid">{selectField('Type', exceptionForm.exceptionType, (value) => setExceptionForm((current) => ({ ...current, exceptionType: value })), [['DOCUMENT_MISMATCH', 'Document mismatch'], ['WEIGHT_MISMATCH', 'Weight mismatch'], ['DRIVER_SUBSTITUTION', 'Driver substitution'], ['VEHICLE_SUBSTITUTION', 'Vehicle substitution'], ['SEAL_ISSUE', 'Seal issue'], ['GPS_ISSUE', 'GPS issue'], ['ROUTE_DEVIATION', 'Route deviation'], ['BORDER_DELAY', 'Border delay'], ['WRONG_RECIPIENT', 'Wrong recipient'], ['PAYMENT_INSTRUCTION_CHANGE', 'Payment instruction change'], ['OTHER', 'Other']])}{selectField('Severity', exceptionForm.severity, (value) => setExceptionForm((current) => ({ ...current, severity: value })), [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']])}{field('Reason', exceptionForm.reason, (value) => setExceptionForm((current) => ({ ...current, reason: value })))}<button className="platform-button platform-button--primary" type="button" disabled={!canException || busy || exceptionForm.reason.length < 8} onClick={createException}>ثبت Exception</button></div>}{exceptions.length ? <div className="company-x-list">{exceptions.map((item) => <article key={item.id}><span>{item.exceptionType} · {item.severity}</span><strong>{item.reason}</strong><small>{item.status} · {item.createdAt}</small></article>)}</div> : <div className="platform-empty"><strong>Exception باز وجود ندارد</strong><span>Mismatch شواهد، route deviation و payment instruction change اینجا human-review می‌شوند.</span></div>}
  </Card>;

  const renderSimple = (title, description, action) => <Card title={title} eyebrow="Governed read model"><p className="company-x-hint">{description}</p>{action && <button className="platform-button" type="button" onClick={action.onClick}>{action.label}</button>}{title === 'اعلان‌ها' && <div className="company-x-list">{notifications.length ? notifications.map((item) => <article key={item.id}><span>{item.payload?.eventName || 'Domain event'}</span><strong>{item.payload?.payload?.caseId ? `پرونده ${item.payload.payload.caseId}` : 'رویداد ثبت‌شده'}</strong><small>{item.created_at}</small></article>) : <div className="platform-empty-inline">اعلانی وجود ندارد.</div>}</div>}</Card>;

  let content = renderDashboard();
  if (section === 'rfq1') content = renderRfq1();
  if (section === 'pricing') content = renderPricing();
  if (section === 'contracts') content = renderContracts();
  if (section === 'rfq2') content = renderRfq2();
  if (section === 'dispatch') content = renderDispatch();
  if (section === 'network') content = renderNetwork();
  if (section === 'nomination') content = renderNomination();
  if (section === 'loading') content = renderLoading();
  if (section === 'documents') content = renderDocuments();
  if (section === 'cmr') content = renderCmr();
  if (section === 'tracking') content = renderTracking();
  if (section === 'pod') content = renderPod();
  if (section === 'finance') content = renderFinance();
  if (section === 'claims') content = renderIssues();
  if (section === 'exceptions') content = renderExceptions();
  if (section === 'reports') content = renderSimple('KPI / Reports', 'KPI فقط از read model سازمانی ساخته می‌شود. Export-all یا دسترسی به margin خارج از policy وجود ندارد.', { label: 'باز کردن Audit', onClick: openAudit });
  if (section === 'organization') content = renderSimple('سازمان و سطح دسترسی', `نقش جاری: ${roleLabels[role] || role} · Delegation و route/country/cargo scope از سرور خوانده می‌شود.`, { label: 'باز کردن context', onClick: () => setNotice({ message: JSON.stringify(context?.delegation || {}) }) });
  if (section === 'notifications') content = renderSimple('اعلان‌ها', 'Notification از Domain Event ساخته شده و فقط برای سازمان جاری نمایش داده می‌شود.');

  const selectMenuSection = (key) => {
    closeMenu();
    setSection(key);
  };

  return <div className="company-x-shell" dir="rtl">
    <XHeader role={role} onLogout={onLogout} menuOpen={menuOpen} onMenuToggle={toggleMenu} menuId={menuId} />
    <div className="company-x-layout">
      <PanelSidebar open={menuOpen} onClose={closeMenu} id={menuId} className="company-x-sidebar" title="منوی عملیات شرکت X" subtitle={roleLabels[role] || role}>
        <div className="company-x-sidebar__intro"><span className="platform-eyebrow">{roleLabels[role] || role}</span><strong>پنل شرکت X</strong><small>Market A ↔ Market B ↔ Control Tower</small></div>
        <nav>{menu.map(([key, label]) => <button type="button" key={key} className={section === key ? 'is-active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => selectMenuSection(key)}><NavigationIcon section={key} /><span>{label}</span></button>)}</nav>
        <div className="company-x-sidebar__guard">RFQ1 و RFQ2 جدا هستند. انتخاب مستقیم راننده و نرخ رابطه Y–Driver در این پنل نمایش داده نمی‌شود.</div>
      </PanelSidebar>
      <main className="company-x-content">
        <section className="platform-hero"><div><span className="platform-eyebrow">منبع حقیقت: سرور · {roleLabels[role] || role}</span><h1>{menu.find(([key]) => key === section)?.[1] || 'داشبورد عملیات'}</h1><p>هر اقدام از نقش، دامنه دسترسی، صلاحیت، آمادگی پرونده و حسابرسی عبور می‌کند.</p></div><div className="platform-hero__status"><i /> دسترسی سازمانی<br /><small>مرز Market A / Market B فعال</small></div></section>
        <Notice notice={notice} />
        {busy && <div className="platform-loading">در حال دریافت یا ثبت اطلاعات…</div>}
        {!busy && content}
      </main>
    </div>
    <ApprovalDialog open={awardOpen} title="Award انسانی" description="AI فقط رتبه‌بندی/توضیح است. شرکت برنده و دلیل انسانی باید صریحاً ثبت شود؛ Award مستقیم به Driver مجاز نیست." busy={busy} onCancel={() => setAwardOpen(false)} onConfirm={award}><div className="company-x-dialog-fields"><label>برنده<select value={awardWinner} onChange={(event) => setAwardWinner(event.target.value)}>{selectedRfqQuotes.map((item) => <option key={item.bidderOrgId} value={item.bidderOrgId}>{item.companyName || item.bidderOrgId}</option>)}</select></label><label>دلیل اجباری<textarea value={awardReason} onChange={(event) => setAwardReason(event.target.value)} rows="3" /></label></div></ApprovalDialog>
    <AuditDrawer open={auditOpen} items={auditItems} onClose={() => setAuditOpen(false)} />
  </div>;
}
