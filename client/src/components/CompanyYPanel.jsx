import { useEffect, useState } from 'react';
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
  CAPACITY_RFQ: 'RFQ2 ظرفیت باز',
  ELIGIBLE: 'واجد شرایط',
  CARRIER_AWARDED: 'Award شرکت Y',
  TRUCK_NOMINATED: 'راننده/خودرو معرفی شد',
  CHECKED_IN: 'ورود به بارگیری',
  DISPATCHED: 'اعزام',
  AT_BORDER: 'مرز',
  EXITED_IRAN: 'خروج از ایران',
  IN_TRANSIT: 'در مسیر',
  AT_DESTINATION: 'ورود به مقصد',
  READY_FOR_DELIVERY: 'آماده تحویل',
  DELIVERED: 'تحویل شد',
  POD_SUBMITTED: 'POD در بررسی',
  POD_ACCEPTED: 'POD پذیرفته شد',
  SETTLEMENT_PENDING: 'در انتظار تسویه',
  FINANCIALLY_SETTLED: 'تسویه شد',
  CARNET_ISSUED: 'Carnet صادر شد',
  OPENED: 'TIR باز شد',
  CHECKPOINTS: 'در Checkpoint',
  DISCHARGED: 'TIR تخلیه شد',
  COMMERCIAL_DOCS_READY: 'مدارک تجاری آماده',
  LOADED: 'بارگیری شد',
  WEIGHT_CONFIRMED: 'وزن تأیید شد'
};

const roleLabels = {
  company_y_owner: 'مالک شرکت Y',
  company_y_document_issuer: 'صادرکننده اسناد Y'
};

const menu = [
  ['dashboard', 'داشبورد Carrier'],
  ['rfq2', 'درخواست‌های پوشش / RFQ2'],
  ['bids', 'پیشنهادهای من'],
  ['trips', 'سفرهای برنده'],
  ['drivers', 'رانندگان تحت پوشش'],
  ['vehicles', 'وسایل نقلیه / تریلرها'],
  ['coverage', 'DriverCarrierCoverage'],
  ['nomination', 'Nomination'],
  ['cmr', 'CMR / TIR / Transit Permits'],
  ['documents', 'اسناد'],
  ['tracking', 'سفرهای فعال / Tracking'],
  ['pod', 'POD / Delivery Status'],
  ['finance', 'تسویه‌ها'],
  ['claims', 'Claims / Disputes'],
  ['notifications', 'اعلان‌ها'],
  ['organization', 'سازمان و کاربران']
];

const documentTypes = ['TIR_CARNET', 'ROUTE_PERMIT', 'TRANSIT_PERMIT', 'DRIVER_HANDOFF', 'VEHICLE_DOCUMENT', 'INCIDENT_DOCUMENT'];
const tirStates = [['CARNET_ISSUED', 'CARNET_ISSUED'], ['OPENED', 'OPENED'], ['CHECKPOINTS', 'CHECKPOINTS'], ['DISCHARGED', 'DISCHARGED']];

function stateLabel(value) {
  return stateLabels[value] || value || 'ثبت نشده';
}

function requestJson(apiUrl, path, token, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Correlation-Id': globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
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
  return <label className="company-y-field"><span>{label}</span><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}

function selectField(label, value, onChange, options) {
  return <label className="company-y-field"><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>{options.map(([option, title]) => <option value={option} key={option}>{title}</option>)}</select></label>;
}

function Notice({ notice }) {
  if (!notice) return null;
  return <div className="platform-notice"><strong>{notice.code ? `${notice.code} · ` : ''}</strong>{notice.message}</div>;
}

function Card({ title, eyebrow, children, actions }) {
  return <section className="company-y-card"><div className="company-y-card__heading"><div><span className="platform-eyebrow">{eyebrow}</span><h2>{title}</h2></div>{actions}</div>{children}</section>;
}

function YHeader({ role, onLogout, menuOpen, onMenuToggle, menuId }) {
  return <header className="platform-header"><div className="platform-header__primary"><PanelMenuButton open={menuOpen} onClick={onMenuToggle} controls={menuId} inverse /><div className="platform-brand"><ProductLogo subtitle="عملیات ناوگان شرکت Y" /></div></div><div className="platform-header__user"><span>{roleLabels[role] || 'پنل شرکت Y'}</span><button type="button" onClick={onLogout}>خروج</button></div></header>;
}

function caseTimeline(item) {
  const values = [
    ['RFQ2 / Capacity', item.capacityState],
    ['Carrier Award', item.capacityState === 'CARRIER_AWARDED' ? item.capacityState : null],
    ['Nomination', item.capacityState === 'TRUCK_NOMINATED' ? item.capacityState : null],
    ['Loading', item.loadingState],
    ['CMR / TIR', item.tirState],
    ['Trip / Border', item.tripState],
    ['Delivery / POD', item.deliveryState],
    ['Settlement', item.financialState]
  ];
  const current = item.deliveryState || item.tripState || item.loadingState || item.capacityState;
  return values.map(([label, value]) => ({ label, state: stateLabel(value), done: Boolean(value && value !== current), current: value === current }));
}

export default function CompanyYPanel({ user, token, apiUrl, onLogout }) {
  const role = user?.role === 'carrier' ? 'company_y_owner' : user?.role || 'company_y_owner';
  const { menuId, menuOpen, closeMenu, toggleMenu } = usePanelNavigation('company-y-menu');
  const isOwner = role === 'company_y_owner';
  const isDocumentIssuer = role === 'company_y_document_issuer';
  const visibleMenu = menu.filter(([key]) => !isDocumentIssuer || !['rfq2', 'bids', 'drivers', 'vehicles', 'coverage', 'tracking', 'finance'].includes(key));
  const [section, setSection] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [context, setContext] = useState(null);
  const [rfqs, setRfqs] = useState([]);
  const [network, setNetwork] = useState({ drivers: [], vehicles: [] });
  const [members, setMembers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [selectedRfq, setSelectedRfq] = useState(null);
  const [rfqDetail, setRfqDetail] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [tripData, setTripData] = useState({ nomination: null, schedules: [], evidence: [], tracking: null, pod: null, tir: null });
  const [settlements, setSettlements] = useState([]);
  const [issues, setIssues] = useState([]);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditItems, setAuditItems] = useState([]);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [bidForm, setBidForm] = useState({ amount: '', currency: 'EUR', transitTime: '', paymentTerms: '', includedServices: '', excludedServices: '' });
  const [coverageForm, setCoverageForm] = useState({ driverId: '', vehicleId: '', validFrom: '', validTo: '', routeScope: '', supportingDocs: '' });
  const [vehicleForm, setVehicleForm] = useState({ plateNumber: '', vehicleType: '', capacity: '', cargoScope: '', reeferCapable: false, specialCapability: '', ownerRelation: '', routePermitsValid: false });
  const [nominationForm, setNominationForm] = useState({ driverId: '', vehicleId: '' });
  const [cmrForm, setCmrForm] = useState({ fileRef: '', fileHash: '', sourceDraftId: '', sourceDraftVersion: '' });
  const [tirForm, setTirForm] = useState({ state: 'CARNET_ISSUED', carnetNo: '', holderAuthorizationRef: '', route: '', manifestRef: '' });
  const [documentForm, setDocumentForm] = useState({ docType: 'TIR_CARNET', fileRef: '', fileHash: '', sensitivity: 'P2', deadlineAt: '' });
  const [issueForm, setIssueForm] = useState({ kind: 'claims', reason: '', evidenceRef: '', note: '' });

  const cases = dashboard?.cases || [];
  const trips = dashboard?.trips || [];
  const metrics = dashboard?.metrics || { cases: 0, activeTrips: 0, pendingEvidence: 0 };

  const notify = (error) => setNotice(error?.message ? { code: error.code, message: error.message } : { message: String(error) });

  const loadDashboard = async () => {
    setBusy(true);
    try {
      const [nextDashboard, nextContext, nextRfqs, nextNetwork, nextNotifications] = await Promise.all([
        requestJson(apiUrl, '/api/platform/dashboard', token),
        requestJson(apiUrl, '/api/platform/context', token).catch(() => null),
        requestJson(apiUrl, '/api/platform/rfqs?level=RFQ2', token).catch(() => ({ rfqs: [] })),
        requestJson(apiUrl, '/api/platform/carrier/network', token).catch(() => ({ drivers: [], vehicles: [] })),
        requestJson(apiUrl, '/api/platform/notifications?limit=40', token).catch(() => ({ notifications: [] }))
      ]);
      setDashboard(nextDashboard);
      setContext(nextContext);
      setRfqs(nextRfqs.rfqs || []);
      setNetwork({ drivers: nextNetwork.drivers || [], vehicles: nextNetwork.vehicles || [] });
      setNotifications(nextNotifications.notifications || []);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  usePlatformRealtime({ apiUrl, token, onEvent: loadDashboard });

  useEffect(() => { loadDashboard(); }, [token]);

  const loadMembers = async () => {
    try {
      const result = await requestJson(apiUrl, '/api/platform/organization/members', token);
      setMembers(result.members || []);
    } catch (error) {
      notify(error);
    }
  };

  const loadCase = async (item, nextSection = 'trips') => {
    setBusy(true);
    try {
      const [details, ledger, issueList] = await Promise.all([
        requestJson(apiUrl, `/api/platform/cases/${item.id}`, token),
        requestJson(apiUrl, `/api/platform/cases/${item.id}/settlements`, token).catch(() => ({ settlements: [] })),
        requestJson(apiUrl, `/api/platform/cases/${item.id}/issues`, token).catch(() => ({ issues: [] }))
      ]);
      const nextCase = { ...details.case, documents: details.documents || [], trips: details.trips || [], rfqs: details.rfqs || [], timeline: details.timeline || [] };
      setSelectedCase(nextCase);
      setSettlements(ledger.settlements || []);
      setIssues(issueList.issues || []);
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
    const [nomination, schedules, evidence, tracking, pod, tir] = await Promise.all([
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/nomination`, token).catch(() => null),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/loading-schedule`, token).catch(() => ({ schedules: [] })),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/loading-evidence`, token).catch(() => ({ evidence: [] })),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/tracking`, token).catch(() => null),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/pod`, token).catch(() => ({ pod: null })),
      requestJson(apiUrl, `/api/platform/trips/${trip.id}/tir`, token).catch(() => null)
    ]);
    setTripData({ nomination, schedules: schedules.schedules || [], evidence: evidence.evidence || [], tracking, pod: pod.pod || null, tir });
    if (nomination?.driver?.id) setNominationForm((current) => ({ ...current, driverId: String(nomination.driver.id) }));
    if (nomination?.vehicle?.id) setNominationForm((current) => ({ ...current, vehicleId: String(nomination.vehicle.id) }));
  };

  const openRfq = async (rfq) => {
    setSelectedRfq(rfq);
    setSection('rfq2');
    try {
      const detail = await requestJson(apiUrl, `/api/platform/rfqs/${rfq.id}`, token);
      setRfqDetail(detail);
      setBidForm((current) => ({ ...current, amount: detail.quotes?.find((quote) => quote.bidderOrgId === context?.organizationId)?.amount || rfq.ownQuote?.amount || current.amount }));
    } catch (error) {
      notify(error);
    }
  };

  const submitBid = async (draft = false) => {
    if (!selectedRfq || !isOwner || !Number(bidForm.amount) || Number(bidForm.amount) <= 0) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/rfqs/${selectedRfq.id}/quotes`, token, {
        method: 'POST',
        idempotencyKey: idempotency('y-bid'),
        body: JSON.stringify({ amount: Number(bidForm.amount), currency: bidForm.currency, state: draft ? 'DRAFT' : 'SUBMITTED', terms: { transitTime: bidForm.transitTime, paymentTerms: bidForm.paymentTerms, includedServices: bidForm.includedServices, excludedServices: bidForm.excludedServices } })
      });
      setNotice({ message: draft ? 'پیش‌نویس Bid شرکت Y ذخیره شد.' : 'Bid شرکت Y به‌صورت مهر و موم‌شده ثبت شد.' });
      await loadDashboard();
      await openRfq(selectedRfq);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const acceptAward = async () => {
    if (!selectedTrip || !isOwner) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/accept-award`, token, { method: 'POST', idempotencyKey: idempotency('y-award-accept'), body: JSON.stringify({}) });
      setAcceptOpen(false);
      setNotice({ message: 'Award ظرفیت توسط شرکت Y پذیرفته شد.' });
      await loadDashboard();
      await loadTrip(selectedTrip);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const saveCoverage = async () => {
    if (!isOwner || !coverageForm.driverId || !coverageForm.validFrom || !coverageForm.validTo) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, '/api/platform/driver-assignments', token, {
        method: 'POST',
        idempotencyKey: idempotency('coverage'),
        body: JSON.stringify({ driverId: Number(coverageForm.driverId), vehicleId: coverageForm.vehicleId ? Number(coverageForm.vehicleId) : undefined, validFrom: coverageForm.validFrom, validTo: coverageForm.validTo, routeScope: coverageForm.routeScope.split(',').map((value) => value.trim()).filter(Boolean), supportingDocs: coverageForm.supportingDocs.split(',').map((value) => value.trim()).filter(Boolean) })
      });
      setNotice({ message: 'DriverCarrierCoverage ثبت شد؛ KYC و Qualification همچنان تحت حاکمیت پلتفرم است.' });
      const nextNetwork = await requestJson(apiUrl, '/api/platform/carrier/network', token);
      setNetwork({ drivers: nextNetwork.drivers || [], vehicles: nextNetwork.vehicles || [] });
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const saveVehicle = async () => {
    if (!isOwner || !vehicleForm.plateNumber.trim()) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, '/api/platform/vehicles', token, { method: 'POST', idempotencyKey: idempotency('vehicle'), body: JSON.stringify({ plateNumber: vehicleForm.plateNumber.trim(), vehicleType: vehicleForm.vehicleType, capacity: vehicleForm.capacity || undefined, cargoScope: vehicleForm.cargoScope, reeferCapable: vehicleForm.reeferCapable, specialCapability: vehicleForm.specialCapability, ownerRelation: vehicleForm.ownerRelation, routePermits: { valid: vehicleForm.routePermitsValid } }) });
      setVehicleForm({ plateNumber: '', vehicleType: '', capacity: '', cargoScope: '', reeferCapable: false, specialCapability: '', ownerRelation: '', routePermitsValid: false });
      const nextNetwork = await requestJson(apiUrl, '/api/platform/carrier/network', token);
      setNetwork({ drivers: nextNetwork.drivers || [], vehicles: nextNetwork.vehicles || [] });
      setNotice({ message: 'وسیله نقلیه در رجیستری شرکت Y ثبت شد.' });
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const nominate = async () => {
    if (!selectedTrip || !isOwner || !nominationForm.driverId || !nominationForm.vehicleId) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/nominate`, token, { method: 'POST', idempotencyKey: idempotency('nomination'), body: JSON.stringify({ driverId: Number(nominationForm.driverId), vehicleId: Number(nominationForm.vehicleId) }) });
      setNotice({ message: 'Nomination پس از کنترل Coverage، اسناد و سازگاری وسیله ارسال شد.' });
      await loadDashboard();
      await loadTrip(selectedTrip);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const issueFinalCmr = async () => {
    if (!selectedTrip || !isDocumentIssuer || !/^[a-f0-9]{64}$/i.test(cmrForm.fileHash)) return;
    setBusy(true);
    try {
      const approvedDraft = selectedCase?.documents?.find((document) => document.docType === 'CMR_DRAFT' && document.state === 'APPROVED');
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/final-cmr`, token, { method: 'POST', idempotencyKey: idempotency('final-cmr'), body: JSON.stringify({ ...cmrForm, sourceDraftId: cmrForm.sourceDraftId || approvedDraft?.id, sourceDraftVersion: cmrForm.sourceDraftVersion || approvedDraft?.versionNo }) });
      setNotice({ message: 'Final CMR توسط Document Issuer شرکت Y صادر و قفل شد.' });
      await loadCase(selectedCase, 'cmr');
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const changeTir = async () => {
    if (!selectedTrip || !isDocumentIssuer || !tirForm.holderAuthorizationRef.trim()) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/tir`, token, { method: 'POST', idempotencyKey: idempotency('tir'), body: JSON.stringify({ ...tirForm, holderOrgId: context?.organizationId }) });
      setNotice({ message: 'چرخه مستقل TIR با Holder معتبر ثبت شد.' });
      await loadTrip(selectedTrip);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const uploadDocument = async () => {
    if (!selectedCase || !isDocumentIssuer || !/^[a-f0-9]{64}$/i.test(documentForm.fileHash)) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, '/api/platform/documents', token, { method: 'POST', idempotencyKey: idempotency('y-document'), body: JSON.stringify({ caseId: selectedCase.id, ...documentForm }) });
      setNotice({ message: 'سند Y به‌صورت نسخه جدید ثبت شد؛ overwrite وجود ندارد.' });
      await loadCase(selectedCase, 'documents');
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const confirmSettlement = async (settlementId) => {
    if (!isOwner) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/settlements/${settlementId}/confirm`, token, { method: 'POST', idempotencyKey: idempotency('y-settlement'), body: JSON.stringify({}) });
      setNotice({ message: 'تسویه رابطه‌ای شرکت Y تأیید شد.' });
      if (selectedCase) await loadCase(selectedCase, 'finance');
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const openIssue = async () => {
    if (!selectedCase || issueForm.reason.trim().length < 8) return;
    setBusy(true);
    try {
      const evidence = issueForm.evidenceRef || issueForm.note ? { fileRef: issueForm.evidenceRef || undefined, note: issueForm.note || undefined } : {};
      await requestJson(apiUrl, `/api/platform/cases/${selectedCase.id}/${issueForm.kind}`, token, { method: 'POST', idempotencyKey: idempotency(issueForm.kind), body: JSON.stringify({ reason: issueForm.reason.trim(), tripId: selectedTrip?.id, evidence }) });
      setIssueForm((current) => ({ ...current, reason: '', evidenceRef: '', note: '' }));
      setNotice({ message: `${issueForm.kind === 'claims' ? 'Claim' : 'Dispute'} ثبت شد و شواهد حذف‌پذیر نیست.` });
      await loadCase(selectedCase, 'claims');
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const updateIssue = async (issue, status) => {
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/claims/${issue.id}`, token, { method: 'PATCH', idempotencyKey: idempotency('claim-update'), body: JSON.stringify({ status, reason: issue.reason }) });
      setNotice({ message: 'وضعیت Claim/Dispute به‌روزرسانی شد.' });
      if (selectedCase) await loadCase(selectedCase, 'claims');
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  const downloadDocument = async (document) => {
    try {
      const result = await requestJson(apiUrl, `/api/platform/documents/${document.id}/download`, token);
      setNotice({ message: `لینک کوتاه‌عمر نسخه ${document.versionNo} صادر شد و در Audit ثبت شد.` });
      if (result.fileRef) window.open(result.fileRef, '_blank', 'noopener,noreferrer');
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

  const renderDashboard = () => <>
    <section className="platform-metrics company-y-metrics"><article><span>پرونده‌های مجاز</span><strong>{Number(metrics.cases).toLocaleString('fa-IR')}</strong><small>فقط پرونده‌های پوشش‌شده</small></article><article><span>سفر فعال</span><strong>{Number(metrics.activeTrips).toLocaleString('fa-IR')}</strong><small>GPS در دامنه Y</small></article><article><span>شاهد/تحویل در انتظار</span><strong>{Number(metrics.pendingEvidence).toLocaleString('fa-IR')}</strong><small>نیازمند اقدام عملیاتی</small></article></section>
    <div className="company-y-grid"><Card title="RFQ2های دعوت‌شده" eyebrow="Market B · sealed capacity book"><div className="company-y-list">{rfqs.slice(0, 6).map((rfq) => <button type="button" className="company-y-list-item" key={rfq.id} onClick={() => openRfq(rfq)}><span>RFQ2 #{rfq.id}</span><strong>{rfq.origin?.location || 'مبدأ'} ← {rfq.destination?.location || 'مقصد'}</strong><small>{rfq.cargo?.type || 'کالا'} · {rfq.deadlineAt || 'بدون deadline'} · {rfq.ownQuote ? `Bid ${rfq.ownQuote.state}` : 'Bid ثبت نشده'}</small></button>)}{!rfqs.length && <div className="platform-empty-inline">دعوت RFQ2 واجد شرایطی در صف نیست.</div>}</div></Card><Card title="سفرهای برنده من" eyebrow="Own awarded trips"><div className="company-y-list">{trips.slice(0, 6).map((trip) => <button type="button" className="company-y-list-item" key={trip.id} onClick={() => loadCase({ id: trip.caseId }, 'trips')}><span>{trip.caseNumber}</span><strong>{stateLabel(trip.state)}</strong><small>{trip.trackingState === 'ACTIVE' ? '● GPS فعال' : '○ آماده‌سازی'} · {trip.lastMilestone || 'Milestone ثبت نشده'}</small></button>)}{!trips.length && <div className="platform-empty-inline">هنوز سفر برنده‌ای برای شرکت Y ثبت نشده است.</div>}</div></Card></div>
  </>;

  const renderRfq = () => <div className="company-y-grid"><Card title="درخواست‌های پوشش / RFQ2" eyebrow="X → qualified Y"><div className="company-y-list">{rfqs.map((rfq) => <button type="button" className={`company-y-list-item${selectedRfq?.id === rfq.id ? ' is-selected' : ''}`} key={rfq.id} onClick={() => openRfq(rfq)}><span>RFQ2 #{rfq.id} · {rfq.state}</span><strong>{rfq.origin?.location || 'مبدأ'} ← {rfq.destination?.location || 'مقصد'}</strong><small>{rfq.cargo?.type || 'کالا'} · {rfq.cargo?.weight || '—'} {rfq.cargo?.unit || ''} · Deadline {rfq.deadlineAt || '—'}</small></button>)}{!rfqs.length && <div className="platform-empty"><strong>RFQ2 در دسترس نیست</strong><span>فقط ظرفیت‌هایی که به شرکت Y واجد شرایط دعوت شده‌اند نمایش داده می‌شوند.</span></div>}</div></Card>{selectedRfq && <Card title={`جزئیات RFQ2 #${selectedRfq.id}`} eyebrow="Competitor bids hidden"><div className="company-y-facts"><span>مبدأ <b>{selectedRfq.origin?.location || '—'}</b></span><span>مقصد <b>{selectedRfq.destination?.location || '—'}</b></span><span>کالا <b>{selectedRfq.cargo?.type || '—'}</b></span><span>وضعیت <b>{stateLabel(selectedRfq.state)}</b></span></div><p className="company-y-hint">هویت مشتری، قیمت Customer-X و Bid شرکت‌های رقیب در این read model وجود ندارد.</p>{rfqDetail?.quotes?.length ? <div className="company-y-own-quote"><strong>Bid خود شرکت Y</strong><span>{rfqDetail.quotes[0].amount || selectedRfq.ownQuote?.amount || 'ثبت‌شده'} {rfqDetail.quotes[0].currency || selectedRfq.ownQuote?.currency || ''}</span></div> : null}{isOwner && selectedRfq.state === 'OPEN' && <div className="company-y-form-grid">{field('مبلغ Bid', bidForm.amount, (value) => setBidForm((current) => ({ ...current, amount: value })), { type: 'number', min: '0' })}{selectField('ارز', bidForm.currency, (value) => setBidForm((current) => ({ ...current, currency: value })), [['EUR', 'EUR'], ['USD', 'USD'], ['IRR', 'IRR']])}{field('Transit time / ETA', bidForm.transitTime, (value) => setBidForm((current) => ({ ...current, transitTime: value })))}{field('Payment terms', bidForm.paymentTerms, (value) => setBidForm((current) => ({ ...current, paymentTerms: value })))}{field('Included services', bidForm.includedServices, (value) => setBidForm((current) => ({ ...current, includedServices: value })))}{field('Excluded services', bidForm.excludedServices, (value) => setBidForm((current) => ({ ...current, excludedServices: value })))}<button className="platform-button" type="button" onClick={() => submitBid(true)} disabled={busy}>Save Draft Bid</button><button className="platform-button platform-button--primary" type="button" onClick={() => submitBid(false)} disabled={busy}>Submit Bid مهروموم‌شده</button></div>}{isDocumentIssuer && <div className="platform-empty-inline">نقش Document Issuer فقط اسناد CMR/TIR را انجام می‌دهد و Bid/Finance/Admin ندارد.</div>}</Card>}</div>;

  const renderTrips = () => <div className="company-y-grid"><Card title="سفرهای برنده" eyebrow="Award acceptance · nomination"><div className="company-y-list">{trips.map((trip) => <button type="button" className={`company-y-list-item${selectedTrip?.id === trip.id ? ' is-selected' : ''}`} key={trip.id} onClick={() => loadCase({ id: trip.caseId }, 'trips')}><span>{trip.caseNumber} · {trip.id}</span><strong>{stateLabel(trip.state)}</strong><small>{trip.driverAssigned ? 'Driver معرفی شده' : 'Nomination در انتظار'} · {trip.vehicleAssigned ? 'Vehicle معرفی شده' : 'Vehicle در انتظار'}</small></button>)}{!trips.length && <div className="platform-empty"><strong>سفر برنده‌ای وجود ندارد</strong><span>پس از Award و ایجاد Trip توسط X، پرونده در اینجا ظاهر می‌شود.</span></div>}</div></Card>{selectedTrip && <Card title={`Trip #${selectedTrip.id}`} eyebrow="Least-data operational scope" actions={isOwner && !selectedTrip.carrierAwardAcceptedAt ? <button className="platform-button platform-button--primary" type="button" onClick={() => setAcceptOpen(true)}>Accept Award</button> : null}><div className="company-y-facts"><span>پرونده <b>{selectedTrip.caseNumber || selectedCase?.caseNumber || '—'}</b></span><span>State <b>{stateLabel(selectedTrip.state)}</b></span><span>Carrier Award <b>{selectedTrip.carrierAwardAcceptedAt ? 'پذیرفته‌شده' : 'در انتظار پذیرش'}</b></span><span>POD <b>{stateLabel(selectedTrip.deliveryState)}</b></span></div><StatusTimeline items={caseTimeline(selectedCase || {})} /><div className="company-y-subgrid"><div><strong>Nomination فعلی</strong><p>{tripData.nomination?.driver?.name || 'راننده معرفی نشده'} · {tripData.nomination?.vehicle?.plateNumber || 'خودرو معرفی نشده'}</p><small>{tripData.nomination?.driver?.coverageState || 'coverage نامشخص'} · {tripData.nomination?.driver?.qualificationState || 'qualification نامشخص'}</small></div><div><strong>گیت سفر</strong><p>{Object.entries(selectedTrip.readiness || {}).filter(([, value]) => value === true).map(([key]) => key).join('، ') || 'گیت‌ها هنوز تکمیل نشده‌اند'}</p><small>Trip Start فقط پس از readiness سرور ممکن است.</small></div></div></Card>}</div>;

  const renderNetwork = () => <div className="company-y-grid"><Card title="رانندگان تحت پوشش" eyebrow="Y-only DriverCarrierCoverage"><div className="company-y-list">{network.drivers.map((coverage) => <article className="company-y-list-item" key={coverage.id}><span>{coverage.driver?.name || `Driver #${coverage.driverId}`}</span><strong>{coverage.driver?.status || '—'} · Coverage {coverage.state}</strong><small>{coverage.validFrom || '—'} تا {coverage.validTo || '—'} · {coverage.routeScope?.join?.('، ') || 'کریدور عمومی'}</small><small>KYC: {coverage.driver?.kycState || '—'} · License: {coverage.driver?.licenseState || '—'} · Availability: {coverage.driver?.availabilityState || '—'}</small></article>)}{!network.drivers.length && <div className="platform-empty-inline">رکورد Coverage برای سازمان Y ثبت نشده است.</div>}</div></Card><Card title="وسایل نقلیه / تریلرها" eyebrow="Vehicle-cargo server validation"><div className="company-y-list">{network.vehicles.map((vehicle) => <article className="company-y-list-item" key={vehicle.id}><span>{vehicle.plateNumber}</span><strong>{vehicle.vehicleType || 'Vehicle'} · {vehicle.status}</strong><small>دامنه کالا: {vehicle.cargoScope?.join?.('، ') || '—'} · ظرفیت: {vehicle.capacity || '—'}</small><small>{vehicle.reeferCapable ? 'Reefer' : 'Standard'} · مجوز مسیر: {vehicle.routePermits?.valid ? 'معتبر' : 'نیازمند بررسی'}</small></article>)}{!network.vehicles.length && <div className="platform-empty-inline">وسیله نقلیه‌ای در دامنه سازمان Y نیست.</div>}</div>{isOwner && <div className="company-y-form-grid company-y-divider-top">{field('Plate / Transit plate', vehicleForm.plateNumber, (value) => setVehicleForm((current) => ({ ...current, plateNumber: value })))}{field('Vehicle type', vehicleForm.vehicleType, (value) => setVehicleForm((current) => ({ ...current, vehicleType: value })))}{field('Capacity', vehicleForm.capacity, (value) => setVehicleForm((current) => ({ ...current, capacity: value })), { type: 'number', min: '0' })}{field('Cargo scope', vehicleForm.cargoScope, (value) => setVehicleForm((current) => ({ ...current, cargoScope: value })))}{field('Special capability', vehicleForm.specialCapability, (value) => setVehicleForm((current) => ({ ...current, specialCapability: value })))}{field('Owner relation', vehicleForm.ownerRelation, (value) => setVehicleForm((current) => ({ ...current, ownerRelation: value })))}<label className="company-y-check"><input type="checkbox" checked={vehicleForm.reeferCapable} onChange={(event) => setVehicleForm((current) => ({ ...current, reeferCapable: event.target.checked }))} /><span>Reefer / special equipment</span></label><label className="company-y-check"><input type="checkbox" checked={vehicleForm.routePermitsValid} onChange={(event) => setVehicleForm((current) => ({ ...current, routePermitsValid: event.target.checked }))} /><span>Route permits ready</span></label><button className="platform-button platform-button--primary" type="button" onClick={saveVehicle} disabled={busy}>ثبت Vehicle</button></div>}</Card></div>;

  const renderNomination = () => <Card title="Nomination راننده / Vehicle" eyebrow="Coverage + qualification + cargo fit"><>{selectedTrip ? <><div className="company-y-facts"><span>Driver <b>{tripData.nomination?.driver?.name || '—'}</b></span><span>Vehicle <b>{tripData.nomination?.vehicle?.plateNumber || '—'}</b></span><span>Coverage <b>{tripData.nomination?.driver?.coverageState || '—'}</b></span><span>Route <b>{tripData.nomination?.routeEligibility ? 'مجاز' : 'خارج از scope'}</b></span></div>{isOwner && <div className="company-y-form-grid">{selectField('راننده', nominationForm.driverId, (value) => setNominationForm((current) => ({ ...current, driverId: value })), [['', 'انتخاب Driver'], ...network.drivers.map((item) => [String(item.driverId), item.driver?.name || `Driver #${item.driverId}`])])}{selectField('Vehicle / Trailer', nominationForm.vehicleId, (value) => setNominationForm((current) => ({ ...current, vehicleId: value })), [['', 'انتخاب Vehicle'], ...network.vehicles.map((item) => [String(item.id), `${item.plateNumber} · ${item.vehicleType || 'Vehicle'}`])])}<button className="platform-button platform-button--primary" type="button" onClick={nominate} disabled={busy || !selectedTrip.carrierAwardAcceptedAt}>ارسال Nomination به X</button></div>}{!isOwner && <div className="platform-empty-inline">Document Issuer فقط وضعیت Nomination و اسناد مرتبط را می‌بیند.</div>}<p className="company-y-hint">Coverage منقضی، KYC/License تأییدنشده، Vehicle نامتناسب یا Permit ناقص توسط سرور با COV-424 / QUA-423 / VEH-422 رد می‌شود.</p></> : <div className="platform-empty"><strong>Trip انتخاب نشده است</strong><span>از سفرهای برنده یک Trip را انتخاب کن.</span></div>}</></Card>;

  const renderCoverage = () => <Card title="ثبت DriverCarrierCoverage" eyebrow="Y-owned relationship · platform qualification remains independent"><>{isOwner ? <div className="company-y-form-grid">{field('Driver reference / id', coverageForm.driverId, (value) => setCoverageForm((current) => ({ ...current, driverId: value })), { type: 'number', min: '1' })}{selectField('Vehicle where applicable', coverageForm.vehicleId, (value) => setCoverageForm((current) => ({ ...current, vehicleId: value })), [['', 'بدون Vehicle'], ...network.vehicles.map((item) => [String(item.id), `${item.plateNumber} · ${item.vehicleType || 'Vehicle'}`])])}{field('Valid From', coverageForm.validFrom, (value) => setCoverageForm((current) => ({ ...current, validFrom: value })), { type: 'datetime-local' })}{field('Valid To', coverageForm.validTo, (value) => setCoverageForm((current) => ({ ...current, validTo: value })), { type: 'datetime-local' })}{field('Route / Country scope', coverageForm.routeScope, (value) => setCoverageForm((current) => ({ ...current, routeScope: value })), { placeholder: 'IR, TR, Tehran, Istanbul' })}{field('Supporting docs refs', coverageForm.supportingDocs, (value) => setCoverageForm((current) => ({ ...current, supportingDocs: value })))}<button className="platform-button platform-button--primary" type="button" onClick={saveCoverage} disabled={busy}>ثبت Coverage</button></div> : <div className="platform-empty"><strong>ثبت Coverage فقط برای Y Owner مجاز است</strong><span>Document Issuer نمی‌تواند KYC یا Qualification پلتفرم را self-approve کند.</span></div>}</></Card>;

  const renderCmr = () => <div className="company-y-grid"><Card title="Final CMR / TIR" eyebrow="Independent document domains"><div className="company-y-doc-list">{(selectedCase?.documents || []).filter((document) => ['CMR_DRAFT', 'CMR_FINAL', 'TIR_CARNET', 'ROUTE_PERMIT', 'TRANSIT_PERMIT'].includes(document.docType)).map((document) => <DocCard key={document.id} document={document} onOpen={downloadDocument} />)}{!selectedCase?.documents?.length && <div className="platform-empty-inline">پرونده و سندی انتخاب نشده است.</div>}</div>{isDocumentIssuer && selectedTrip && <><div className="company-y-divider" /><h3>صدور Final CMR</h3><div className="company-y-form-grid">{field('File reference', cmrForm.fileRef, (value) => setCmrForm((current) => ({ ...current, fileRef: value })))}{field('SHA-256', cmrForm.fileHash, (value) => setCmrForm((current) => ({ ...current, fileHash: value })))}<button className="platform-button platform-button--primary" type="button" onClick={issueFinalCmr} disabled={busy}>Issue و Lock Final CMR</button></div><p className="company-y-hint">Final CMR فقط از آخرین Draft تأییدشده ساخته می‌شود و اختلاف خام با Draft مجاز نیست.</p><div className="company-y-divider" /><h3>چرخه مستقل TIR</h3><div className="company-y-form-grid">{selectField('TIR state', tirForm.state, (value) => setTirForm((current) => ({ ...current, state: value })), tirStates)}{field('Carnet No', tirForm.carnetNo, (value) => setTirForm((current) => ({ ...current, carnetNo: value })))}{field('Holder authorization ref', tirForm.holderAuthorizationRef, (value) => setTirForm((current) => ({ ...current, holderAuthorizationRef: value })))}{field('Route', tirForm.route, (value) => setTirForm((current) => ({ ...current, route: value })))}{field('Manifest / Volet ref', tirForm.manifestRef, (value) => setTirForm((current) => ({ ...current, manifestRef: value })))}<button className="platform-button platform-button--primary" type="button" onClick={changeTir} disabled={busy}>ثبت TIR با Holder معتبر</button></div><p className="company-y-hint">TIR بدون Holder فعال و مرجع اختیار با TIR-424 رد می‌شود؛ DISCHARGED شرط Close باقی می‌ماند.</p></>}</Card><Card title="اسناد عملیاتی Y" eyebrow="Versioned DMS"><div className="company-y-doc-list">{(selectedCase?.documents || []).filter((document) => document.ownerOrgId === context?.organizationId).map((document) => <DocCard key={document.id} document={document} onOpen={downloadDocument} />)}</div>{isDocumentIssuer && selectedCase && <div className="company-y-form-grid">{selectField('Doc type', documentForm.docType, (value) => setDocumentForm((current) => ({ ...current, docType: value })), documentTypes.map((type) => [type, type]))}{field('File reference', documentForm.fileRef, (value) => setDocumentForm((current) => ({ ...current, fileRef: value })))}{field('SHA-256', documentForm.fileHash, (value) => setDocumentForm((current) => ({ ...current, fileHash: value })))}{field('Deadline', documentForm.deadlineAt, (value) => setDocumentForm((current) => ({ ...current, deadlineAt: value })), { type: 'datetime-local' })}<button className="platform-button" type="button" onClick={uploadDocument} disabled={busy}>ثبت نسخه سند</button></div>}</Card></div>;

  const renderOperations = () => <div className="company-y-grid"><Card title="بارگیری و شواهد" eyebrow="Immutable operational evidence"><>{selectedTrip ? <><div className="company-y-facts"><span>Schedule versions <b>{tripData.schedules.length}</b></span><span>Evidence count <b>{tripData.evidence.length}</b></span><span>Loading state <b>{stateLabel(selectedCase?.loadingState)}</b></span></div><EvidenceGallery evidence={tripData.evidence.map((item) => ({ type: item.evidenceType, ref: item.fileRef || item.id, label: item.mismatch ? `${item.evidenceType} · mismatch` : item.evidenceType }))} /><div className="company-y-list">{tripData.schedules.map((item) => <article className="company-y-list-item" key={item.id}><span>Schedule v{item.versionNo}</span><strong>{item.schedule?.checkInAt || item.schedule?.loadingWindow || 'بازه بارگیری'}</strong><small>{item.schedule?.location || 'محل طبق پرونده'} · {item.createdAt}</small></article>)}</div></> : <div className="platform-empty"><strong>Trip انتخاب نشده است</strong><span>شواهد فقط برای سفرهای برنده خود شرکت Y نمایش داده می‌شود.</span></div>}</></Card><Card title="Active Tracking" eyebrow="Own-trip least privilege"><>{tripData.tracking ? <><div className="company-y-facts"><span>State <b>{stateLabel(tripData.tracking.state)}</b></span><span>ETA <b>{tripData.tracking.eta || '—'}</b></span><span>GPS <b>{tripData.tracking.locationAvailable ? 'دریافت شد' : 'قطع/ثبت نشده'}</b></span></div>{tripData.tracking.location && <div className="company-y-location">{tripData.tracking.location.lat}, {tripData.tracking.location.lng}</div>}<StatusTimeline items={(tripData.tracking.timeline || []).map((item) => ({ label: item.eventType, detail: item.createdAt, done: true }))} /></> : <div className="platform-empty-inline">برای مشاهده Tracking یک Trip انتخاب کن.</div>}</></Card></div>;

  const renderPod = () => <Card title="POD / Delivery Status" eyebrow="Read-only evidence for Company Y"><>{selectedTrip ? <>{tripData.pod ? <><div className="company-y-facts"><span>POD State <b>{stateLabel(tripData.pod.state)}</b></span><span>Evidence version <b>{tripData.pod.evidenceVersion}</b></span><span>OTP <b>{tripData.pod.otpVerified ? 'تأیید' : 'طبق Policy'}</b></span></div><EvidenceGallery evidence={(tripData.pod.evidence?.photos || []).map((photo, index) => ({ type: 'PHOTO', ref: photo, label: `Photo ${index + 1}` }))} /><RiskBadge flags={tripData.pod.riskFlags} /></> : <div className="platform-empty-inline">POD برای این Trip هنوز ارسال نشده است.</div>}</> : <div className="platform-empty"><strong>Trip انتخاب نشده است</strong><span>شرکت Y POD را overwrite یا accept نمی‌کند؛ فقط وضعیت و شواهد مجاز را می‌بیند.</span></div>}</></Card>;

  const renderFinance = () => <Card title="X-Y و Y-Driver Settlement" eyebrow="Relationship-scoped ledger"><>{isDocumentIssuer ? <div className="platform-empty"><strong>دسترسی مالی برای Document Issuer فعال نیست</strong><span>جزئیات مالی فقط برای Y Owner و رابطه‌های X-Y / Y-Driver مجاز است.</span></div> : selectedCase ? <><MoneyBreakdown items={settlements.map((item) => ({ ...item, label: `${item.relationship_type} · ${item.state}` }))} /><div className="company-y-list">{settlements.map((item) => <article className="company-y-list-item" key={item.id}><span>{item.relationship_type}</span><strong>{Number(item.amount || 0).toLocaleString('fa-IR')} {item.currency}</strong><small>{item.payer_org_id} → {item.payee_org_id} · {item.state}</small>{isOwner && item.state === 'SETTLEMENT_PENDING' && <button className="platform-button" type="button" onClick={() => confirmSettlement(item.id)}>Confirm settlement</button>}</article>)}</div><p className="company-y-hint">Customer-X sale price، Margin X و Platform Fee در دفتر شرکت Y وجود ندارد.</p></> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>از سفرهای برنده یک پرونده را انتخاب کن.</span></div>}</></Card>;

  const renderClaims = () => <Card title="Claims / Disputes" eyebrow="Own contractual relationships"><>{selectedCase ? <>{isOwner && <div className="company-y-form-grid">{selectField('نوع', issueForm.kind, (value) => setIssueForm((current) => ({ ...current, kind: value })), [['claims', 'Claim'], ['disputes', 'Dispute']])}{field('شرح اجباری', issueForm.reason, (value) => setIssueForm((current) => ({ ...current, reason: value })))}{field('Evidence file ref', issueForm.evidenceRef, (value) => setIssueForm((current) => ({ ...current, evidenceRef: value })))}{field('Evidence note', issueForm.note, (value) => setIssueForm((current) => ({ ...current, note: value })))}<button className="platform-button platform-button--primary" type="button" onClick={openIssue} disabled={busy}>ثبت پرونده</button></div>}{!isOwner && <div className="platform-empty-inline">Document Issuer در این بخش فقط وضعیت و شاهد مجاز را می‌خواند.</div>}<div className="company-y-list">{issues.map((issue) => <article className="company-y-list-item" key={issue.id}><span>{issue.case_type} · {issue.opened_by_org_id}</span><strong>{issue.status}</strong><small>{issue.reason}</small>{isOwner && issue.status !== 'CLOSED' && <div className="company-y-inline-actions"><button className="platform-button" type="button" onClick={() => updateIssue(issue, 'ACKNOWLEDGED')}>Acknowledge</button><button className="platform-button" type="button" onClick={() => updateIssue(issue, 'RESOLVED')}>Resolve</button></div>}</article>)}{!issues.length && <div className="platform-empty-inline">Claim یا Dispute مرتبطی ثبت نشده است.</div>}</div></> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>شواهد Claim فقط در رابطه مجاز X-Y/Y-Driver نمایش داده می‌شود.</span></div>}</></Card>;

  let content = renderDashboard();
  if (section === 'rfq2' || section === 'bids') content = renderRfq();
  if (section === 'trips') content = renderTrips();
  if (section === 'drivers' || section === 'vehicles') content = renderNetwork();
  if (section === 'coverage') content = renderCoverage();
  if (section === 'nomination') content = renderNomination();
  if (section === 'cmr' || section === 'documents') content = renderCmr();
  if (section === 'tracking') content = renderOperations();
  if (section === 'pod') content = renderPod();
  if (section === 'finance') content = renderFinance();
  if (section === 'claims') content = renderClaims();
  if (section === 'notifications') content = <Card title="اعلان‌های عملیاتی" eyebrow="Domain events → notifications"><div className="company-y-list">{notifications.map((item) => <article className="company-y-list-item" key={item.id}><span>{item.created_at}</span><strong>{item.payload?.eventName || 'Notification'}</strong><small>{item.payload?.payload?.message || item.payload?.entityType || 'رویداد ثبت‌شده'}</small></article>)}{!notifications.length && <div className="platform-empty-inline">اعلانی در صف نیست.</div>}</div></Card>;
  if (section === 'organization') content = <Card title="سازمان و کاربران" eyebrow="Tenant / organization scoped"><div className="company-y-facts"><span>Organization <b>{context?.organizationId || '—'}</b></span><span>Role <b>{roleLabels[role]}</b></span><span>Qualification <b>{context?.organizationType === 'company_y' ? 'company_y' : '—'}</b></span></div><div className="company-y-list">{members.map((member) => <article className="company-y-list-item" key={member.id}><span>{member.displayName}</span><strong>{member.role}</strong><small>{member.qualificationState} · KYC {member.kycLevel} · {member.status}</small></article>)}{!members.length && <div className="platform-empty-inline">اعضای فعال سازمان بارگذاری نشده‌اند.</div>}</div></Card>;

  const selectMenuSection = (key) => {
    closeMenu();
    setSection(key);
    if (key === 'organization') loadMembers();
  };

  return <div className="company-y-shell" dir="rtl">
    <YHeader role={role} onLogout={onLogout} menuOpen={menuOpen} onMenuToggle={toggleMenu} menuId={menuId} />
    <div className="company-y-layout">
      <PanelSidebar open={menuOpen} onClose={closeMenu} id={menuId} className="company-y-sidebar" title="منوی ناوگان شرکت Y" subtitle={roleLabels[role] || role}>
        <div className="company-y-sidebar__intro"><span className="platform-eyebrow">{roleLabels[role] || role}</span><strong>پنل شرکت Y</strong><small>RFQ2 · Carrier · CMR/TIR</small></div>
        <nav>{visibleMenu.map(([key, label]) => <button type="button" key={key} className={section === key ? 'is-active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => selectMenuSection(key)}><NavigationIcon section={key} /><span>{label}</span></button>)}</nav>
        <div className="company-y-sidebar__guard">قیمت مشتری، حاشیه شرکت X و پیشنهاد رقبای شرکت Y در این پنل نمایش داده نمی‌شود. Award همیشه X → Y است.</div>
      </PanelSidebar>
      <main className="company-y-content">
        <section className="platform-hero"><div><span className="platform-eyebrow">منبع حقیقت: سرور · {roleLabels[role] || role}</span><h1>{visibleMenu.find(([key]) => key === section)?.[1] || 'داشبورد Carrier'}</h1><p>پوشش، صلاحیت، اسناد و امور مالی فقط در دامنه شرکت Y و سفرهای برنده نمایش داده می‌شود.</p></div><div className="platform-hero__status"><i /> دسترسی سازمانی<br /><small>RFQ2 مهرشده · اطلاعات مشتری محفوظ</small></div></section>
        <Notice notice={notice} />
        {busy && <div className="platform-loading">در حال دریافت یا ثبت اطلاعات…</div>}
        {!busy && content}
      </main>
    </div>
    <ApprovalDialog open={acceptOpen} title="پذیرش Award ظرفیت" description="این پذیرش فقط رابطه X-Y را فعال می‌کند؛ Award مستقیم به Driver وجود ندارد و Nomination بعدی باید از Coverage و مدارک عبور کند." busy={busy} onCancel={() => setAcceptOpen(false)} onConfirm={acceptAward} />
    <AuditDrawer open={auditOpen} items={auditItems} onClose={() => setAuditOpen(false)} />
  </div>;
}
