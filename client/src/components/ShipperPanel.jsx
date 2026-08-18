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

const stateLabels = {
  DRAFT: 'پیش‌نویس',
  RFQ_OPEN: 'RFQ1 باز',
  OFFERS_RECEIVED: 'پیشنهادها دریافت شد',
  PROVIDER_AWARDED: 'شرکت X انتخاب شد',
  CUSTOMER_CONTRACTED: 'قرارداد Customer-X',
  CAPACITY_RFQ: 'خرید ظرفیت در بازار B',
  CARRIER_AWARDED: 'شرکت Y انتخاب شد',
  TRUCK_NOMINATED: 'راننده/خودرو معرفی شد',
  CHECKED_IN: 'ورود به بارگیری',
  DISPATCHED: 'اعزام',
  AT_BORDER: 'رویداد مرز',
  EXITED_IRAN: 'خروج از ایران',
  IN_TRANSIT: 'در مسیر',
  AT_DESTINATION: 'ورود به مقصد',
  READY_FOR_DELIVERY: 'آماده تحویل',
  DELIVERED: 'تحویل شد',
  POD_SUBMITTED: 'POD در بررسی',
  POD_ACCEPTED: 'POD پذیرفته شد',
  SETTLEMENT_PENDING: 'در انتظار تسویه',
  FINANCIALLY_SETTLED: 'تسویه مالی شد',
  I01_IMPORT_REQUEST: 'I01 درخواست واردات',
  I04_RFQ_PUBLISHED: 'I04 انتشار RFQ',
  I09_ENTRY_BORDER_EVENT: 'I09 رویداد ورود مرز',
  I10_DOCUMENT_HOLD: 'I10 نقص سند',
  I11_CUSTOMS_WAREHOUSE_RELEASE: 'I11 گمرک/انبار/ترخیص',
  I12_DOMESTIC_DELIVERY: 'I12 تحویل داخلی',
  I13_SETTLEMENT: 'I13 تسویه واردات'
};

const roles = {
  shipper_admin: 'مدیر صاحب بار',
  shipper_logistics_user: 'کاربر لجستیک',
  shipper_finance_user: 'کاربر مالی',
  consignee: 'گیرنده مجاز'
};

const menu = [
  ['dashboard', 'داشبورد'],
  ['new-request', 'ثبت درخواست حمل'],
  ['active', 'درخواست‌های فعال'],
  ['rfq', 'RFQ سطح ۱ / پیشنهادها'],
  ['contracts', 'قراردادها'],
  ['documents', 'اسناد'],
  ['cmr', 'بررسی Draft CMR'],
  ['tracking', 'رهگیری / Timeline / ETA'],
  ['pod', 'تحویل و POD'],
  ['finance', 'پرداخت‌ها و تسویه'],
  ['claims', 'خسارت / شکایت / اختلاف'],
  ['notifications', 'پیام‌ها و اعلان‌ها'],
  ['reports', 'گزارش‌ها'],
  ['organization', 'سازمان و کاربران'],
  ['security', 'پروفایل و امنیت'],
  ['support', 'پشتیبانی']
];

const wizardTitles = ['نوع عملیات', 'مبدأ و مقصد', 'کالا', 'دامنه تجاری', 'ناوگان مورد نیاز', 'زمان', 'اسناد', 'بازبینی سرور'];
const documentOptions = ['INVOICE', 'PACKING_LIST', 'CERTIFICATE_OF_ORIGIN', 'CUSTOMS_PERMIT', 'IMPORT_PERMIT', 'ROUTE_PERMIT', 'COMMERCIAL_DOC'];

function stateLabel(value) {
  return stateLabels[value] || value || 'ثبت نشده';
}

function requestJson(apiUrl, path, token, options = {}) {
  return fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Correlation-Id': options.correlationId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      ...(options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
      ...(options.headers || {})
    }
  }).then(async (response) => {
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

function initialDraft() {
  return {
    direction: 'EXPORT',
    origin: { country: 'ایران', city: '', location: '', loadingPlace: '', preferredBorder: '', corridor: '', customsOffice: '' },
    destination: { country: '', city: '', location: '', unloadingPlace: '' },
    cargo: { type: '', description: '', hsCode: '', weight: '', unit: 'kg', volume: '', packages: '', packagingType: '', value: '', valueSensitivity: 'P2', condition: 'normal', temperature: '', permits: [] },
    commercial: { incoterm: '', namedPlace: '', loadingParty: '', unloadingParty: '', insuranceRequired: false, customsScope: '', specialInstructions: '' },
    fleet: { tractorType: '', trailerType: '', capacity: '', reefer: false, specialEquipment: '', routePermitRequired: false, routePermitRef: '' },
    schedule: { readyDate: '', loadingWindow: '', deliveryWindow: '', rfqDeadline: '' },
    documents: [],
    importerVerification: false,
    originAbroad: { confirmed: false }
  };
}

function field(label, value, onChange, props = {}) {
  return <label className="shipper-field"><span>{label}</span><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}

function timelineForCase(item) {
  return [
    ['درخواست و دامنه', item.commercialState],
    ['RFQ1 و انتخاب شرکت X', item.commercialState === 'DRAFT' ? null : item.commercialState],
    ['قرارداد Customer-X', item.commercialState === 'CUSTOMER_CONTRACTED' ? item.commercialState : null],
    ['خرید ظرفیت داخلی X', item.capacityState],
    ['سفر و مرز', item.tripState],
    ['تحویل و POD', item.deliveryState],
    ['تسویه رابطه Customer-X', item.financialState]
  ].map(([label, value], index) => ({ label, state: stateLabel(value), current: Boolean(value) && index === 0, done: Boolean(value) }));
}

function Notice({ notice }) {
  if (!notice) return null;
  return <div className="platform-notice"><strong>{notice.code ? `${notice.code} · ` : ''}</strong>{notice.message}</div>;
}

function ShipperHeader({ role, onLogout }) {
  return <header className="platform-header"><div className="platform-brand"><span className="platform-brand__mark">✓</span><span><strong>GOMROK</strong><small>SHIPPER / CUSTOMER CONTROL TOWER</small></span></div><div className="platform-header__user"><span>{roles[role] || 'پنل مشتری'}</span><button type="button" onClick={onLogout}>خروج</button></div></header>;
}

function Wizard({ draft, setDraft, step, setStep, draftCase, review, busy, onSave, onPublish, canPublish }) {
  const update = (section, key, value) => setDraft((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  const toggleDocument = (docType) => setDraft((current) => ({ ...current, documents: current.documents.includes(docType) ? current.documents.filter((item) => item !== docType) : [...current.documents, docType] }));
  return <section className="shipper-wizard">
    <div className="shipper-wizard__steps">{wizardTitles.map((title, index) => <button type="button" key={title} className={index === step ? 'is-active' : index < step ? 'is-done' : ''} onClick={() => setStep(index)}><b>{index + 1}</b><span>{title}</span></button>)}</div>
    <div className="shipper-wizard__body">
      <div className="shipper-section-heading"><div><span className="platform-eyebrow">Server-owned wizard</span><h2>{wizardTitles[step]}</h2></div>{draftCase && <span className="shipper-case-id">#{draftCase.caseNumber}</span>}</div>
      {step === 0 && <div className="shipper-choice-grid"><button type="button" className={draft.direction === 'EXPORT' ? 'is-selected' : ''} onClick={() => setDraft((current) => ({ ...current, direction: 'EXPORT' }))}><strong>Export</strong><small>خروج کالا و RFQ1 به شرکت‌های X</small></button><button type="button" className={draft.direction === 'IMPORT' ? 'is-selected' : ''} onClick={() => setDraft((current) => ({ ...current, direction: 'IMPORT' }))}><strong>Import</strong><small>مبدأ خارج از کشور، ورود مرزی، انبار و تحویل داخلی</small></button></div>}
      {step === 1 && <div className="shipper-form-grid">{field('کشور مبدأ', draft.origin.country, (value) => update('origin', 'country', value))}{field('شهر مبدأ', draft.origin.city, (value) => update('origin', 'city', value))}{field('محل بارگیری', draft.origin.location, (value) => update('origin', 'location', value), { placeholder: 'آدرس یا کد محل' })}{field('جزئیات محل بارگیری', draft.origin.loadingPlace, (value) => update('origin', 'loadingPlace', value))}{field('کشور مقصد', draft.destination.country, (value) => update('destination', 'country', value))}{field('شهر مقصد', draft.destination.city, (value) => update('destination', 'city', value))}{field('محل تخلیه', draft.destination.location, (value) => update('destination', 'location', value))}{field('جزئیات محل تخلیه', draft.destination.unloadingPlace, (value) => update('destination', 'unloadingPlace', value))}{field('مرز ترجیحی', draft.origin.preferredBorder, (value) => update('origin', 'preferredBorder', value))}{field('کریدور / Route Option', draft.origin.corridor, (value) => update('origin', 'corridor', value))}{field('گمرک مرتبط', draft.origin.customsOffice, (value) => update('origin', 'customsOffice', value))}</div>}
      {step === 2 && <div className="shipper-form-grid">{field('نوع کالا', draft.cargo.type, (value) => update('cargo', 'type', value))}{field('شرح کالا', draft.cargo.description, (value) => update('cargo', 'description', value))}{field('HS پیشنهادی / مرجع', draft.cargo.hsCode, (value) => update('cargo', 'hsCode', value))}{field('وزن', draft.cargo.weight, (value) => update('cargo', 'weight', value), { type: 'number', min: '0' })}{field('واحد وزن', draft.cargo.unit, (value) => update('cargo', 'unit', value))}{field('حجم', draft.cargo.volume, (value) => update('cargo', 'volume', value), { type: 'number', min: '0' })}{field('تعداد / نوع بسته', draft.cargo.packages, (value) => update('cargo', 'packages', value))}{field('ارزش کالا', draft.cargo.value, (value) => update('cargo', 'value', value), { type: 'number', min: '0' })}{field('سطح حساسیت ارزش', draft.cargo.valueSensitivity, (value) => update('cargo', 'valueSensitivity', value))}{field('دما', draft.cargo.temperature, (value) => update('cargo', 'temperature', value), { placeholder: 'برای reefer' })}<label className="shipper-field"><span>شرایط حمل</span><select value={draft.cargo.condition} onChange={(event) => update('cargo', 'condition', event.target.value)}><option value="normal">عادی</option><option value="reefer">یخچالی</option><option value="dangerous">خطرناک</option><option value="oversized">فوق‌سنگین</option></select></label>{field('مجوزهای خاص', (draft.cargo.permits || []).join(', '), (value) => update('cargo', 'permits', value.split(',').map((item) => item.trim()).filter(Boolean)), { placeholder: 'کد مجوزها با ویرگول' })}</div>}
      {step === 3 && <div className="shipper-form-grid">{field('Incoterm', draft.commercial.incoterm, (value) => update('commercial', 'incoterm', value), { placeholder: 'مثلاً FCA / DAP' })}{field('Named Place', draft.commercial.namedPlace, (value) => update('commercial', 'namedPlace', value))}{field('مسئول بارگیری', draft.commercial.loadingParty, (value) => update('commercial', 'loadingParty', value))}{field('مسئول تخلیه', draft.commercial.unloadingParty, (value) => update('commercial', 'unloadingParty', value))}{field('دامنه گمرکی', draft.commercial.customsScope, (value) => update('commercial', 'customsScope', value))}<label className="shipper-field"><span>بیمه</span><select value={draft.commercial.insuranceRequired ? 'yes' : 'no'} onChange={(event) => update('commercial', 'insuranceRequired', event.target.value === 'yes')}><option value="no">طبق قرارداد پایه</option><option value="yes">لازم است</option></select></label>{field('دستور ویژه', draft.commercial.specialInstructions, (value) => update('commercial', 'specialInstructions', value), { placeholder: 'حساسیت عملیاتی یا محدودیت' })}</div>}
      {step === 4 && <div className="shipper-form-grid">{field('نوع کشنده', draft.fleet.tractorType, (value) => update('fleet', 'tractorType', value))}{field('نوع تریلر', draft.fleet.trailerType, (value) => update('fleet', 'trailerType', value))}{field('ظرفیت لازم', draft.fleet.capacity, (value) => update('fleet', 'capacity', value))}{field('تجهیزات خاص', draft.fleet.specialEquipment, (value) => update('fleet', 'specialEquipment', value))}{field('مرجع مجوز مسیر', draft.fleet.routePermitRef, (value) => update('fleet', 'routePermitRef', value))}<label className="shipper-field"><span>مجوز مسیر لازم است؟</span><select value={draft.fleet.routePermitRequired ? 'yes' : 'no'} onChange={(event) => update('fleet', 'routePermitRequired', event.target.value === 'yes')}><option value="no">خیر / طبق RulePack</option><option value="yes">بله</option></select></label></div>}
      {step === 5 && <div className="shipper-form-grid">{field('Ready Date', draft.schedule.readyDate, (value) => update('schedule', 'readyDate', value), { type: 'datetime-local' })}{field('بازه بارگیری', draft.schedule.loadingWindow, (value) => update('schedule', 'loadingWindow', value))}{field('بازه تحویل', draft.schedule.deliveryWindow, (value) => update('schedule', 'deliveryWindow', value))}{field('مهلت RFQ1', draft.schedule.rfqDeadline, (value) => update('schedule', 'rfqDeadline', value), { type: 'datetime-local' })}<label className="shipper-check"><input type="checkbox" checked={draft.direction !== 'IMPORT' || draft.importerVerification} onChange={(event) => setDraft((current) => ({ ...current, importerVerification: event.target.checked }))} /><span>تأیید اولیه واردکننده / صاحب اختیار ثبت شده است</span></label>{draft.direction === 'IMPORT' && <label className="shipper-check"><input type="checkbox" checked={draft.originAbroad.confirmed} onChange={(event) => update('originAbroad', 'confirmed', event.target.checked)} /><span>Origin Abroad و scope واردات تأیید شده است</span></label>}</div>}
      {step === 6 && <div className="shipper-doc-picker"><p>وجود سند در این مرحله فقط declaration است؛ فایل واقعی بعداً با API DMS و hash نسخه‌دار آپلود می‌شود.</p>{documentOptions.map((docType) => <label key={docType}><input type="checkbox" checked={draft.documents.includes(docType)} onChange={() => toggleDocument(docType)} /><span>{docType}</span></label>)}</div>}
      {step === 7 && <div className="shipper-review"><div className={`shipper-review-status ${review?.ready ? 'is-ready' : ''}`}><strong>{review?.ready ? 'پرونده برای انتشار آماده است' : 'پرونده هنوز برای انتشار آماده نیست'}</strong><span>RulePack: {review?.rulePackVersion || 'در انتظار پاسخ سرور'}</span></div>{review?.missingFields?.length > 0 && <div className="shipper-review-block"><strong>فیلدهای ناقص</strong><ul>{review.missingFields.map((item) => <li key={item}>{item}</li>)}</ul></div>}{review?.complianceBlocks?.length > 0 && <div className="shipper-review-block shipper-review-block--danger"><strong>Compliance Blocks</strong><ul>{review.complianceBlocks.map((item) => <li key={item.code}>{item.code} · {item.field}</li>)}</ul></div>}{review?.conflicts?.length > 0 && <div className="shipper-review-block"><strong>تعارض اسناد</strong><ul>{review.conflicts.map((item) => <li key={item.code}>{item.code} · {item.field}</li>)}</ul></div>}{!review && <span>برای بازبینی، ابتدا پیش‌نویس را ذخیره کن.</span>}</div>}
      <div className="shipper-wizard__actions"><button type="button" className="platform-button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>قبلی</button><div><button type="button" className="platform-button" onClick={onSave} disabled={busy}>{busy ? 'در حال ذخیره…' : draftCase ? 'ذخیره پیش‌نویس' : 'ذخیره Draft'}</button>{step < wizardTitles.length - 1 && <button type="button" className="platform-button platform-button--primary" onClick={() => setStep((current) => Math.min(wizardTitles.length - 1, current + 1))}>مرحله بعد</button>}{step === wizardTitles.length - 1 && <button type="button" className="platform-button platform-button--primary" onClick={onPublish} disabled={!draftCase || busy || !canPublish}>انتشار RFQ1</button>}</div></div>
    </div>
  </section>;
}

export default function ShipperPanel({ user, token, apiUrl, onLogout }) {
  const role = user?.role || 'consignee';
  const canEdit = [ 'shipper_admin', 'shipper_logistics_user' ].includes(role);
  const canFinance = [ 'shipper_admin', 'shipper_finance_user' ].includes(role);
  const [dashboard, setDashboard] = useState(null);
  const [context, setContext] = useState({ delegation: {} });
  const [section, setSection] = useState('dashboard');
  const [selectedCase, setSelectedCase] = useState(null);
  const [draftCase, setDraftCase] = useState(null);
  const [draft, setDraft] = useState(initialDraft);
  const [review, setReview] = useState(null);
  const [step, setStep] = useState(0);
  const [quotes, setQuotes] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [pod, setPod] = useState(null);
  const [issues, setIssues] = useState([]);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [awardOpen, setAwardOpen] = useState(false);
  const [awardReason, setAwardReason] = useState('');
  const [selectedWinner, setSelectedWinner] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [issueReason, setIssueReason] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditItems, setAuditItems] = useState([]);
  const [documentUpload, setDocumentUpload] = useState({ docType: 'INVOICE', fileRef: '', fileHash: '', sensitivity: 'P1', deadlineAt: '' });
  const delegation = context.delegation || {};
  const delegated = (action) => role !== 'shipper_logistics_user' || (Array.isArray(delegation) ? delegation.includes(action) : delegation[action] === true || delegation.actions?.includes?.(action));
  const canPublish = canEdit && delegated('publishRfq');
  const canAward = canEdit && delegated('award');
  const canApproveCmr = canEdit && delegated('approveCmr');
  const canConfirm = canFinance || (role === 'shipper_logistics_user' && delegated('confirmPayment'));

  const cases = dashboard?.cases || [];
  const activeTrips = dashboard?.trips || [];
  const currentRoleLabel = roles[role] || 'پنل مشتری';
  const currentRfq = selectedCase?.rfqs?.find((rfq) => rfq.level === 'RFQ1');
  const cmrDrafts = selectedCase?.documents?.filter((document) => document.docType === 'CMR_DRAFT') || [];
  const selectedTrip = selectedCase?.trips?.[0];
  const metrics = dashboard?.metrics || { cases: 0, activeTrips: 0, pendingEvidence: 0 };

  const loadDashboard = async () => {
    setBusy(true);
    try {
      const [nextDashboard, nextNotifications, nextContext] = await Promise.all([
        requestJson(apiUrl, '/api/platform/dashboard', token),
        requestJson(apiUrl, '/api/platform/notifications?limit=30', token).catch(() => ({ notifications: [] })),
        requestJson(apiUrl, '/api/platform/context', token).catch(() => ({ delegation: {} }))
      ]);
      setDashboard(nextDashboard);
      setNotifications(nextNotifications.notifications || []);
      setContext(nextContext);
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  usePlatformRealtime({ apiUrl, token, onEvent: loadDashboard });

  useEffect(() => { loadDashboard(); }, [token]);

  const openCase = async (item) => {
    setBusy(true);
    setNotice(null);
    try {
      const [details, ledger, issueResult] = await Promise.all([
        requestJson(apiUrl, `/api/platform/cases/${item.id}`, token),
        requestJson(apiUrl, `/api/platform/cases/${item.id}/finance`, token).catch(() => ({ settlements: [] })),
        requestJson(apiUrl, `/api/platform/cases/${item.id}/issues`, token).catch(() => ({ issues: [] }))
      ]);
      setSelectedCase({ ...details.case, ...details, finance: ledger, issues: issueResult.issues || [] });
      setIssues(issueResult.issues || []);
      setSection('active');
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = draftCase
        ? await requestJson(apiUrl, `/api/platform/cases/${draftCase.id}/draft`, token, { method: 'PATCH', idempotencyKey: `draft-${draftCase.id}-${Date.now()}`, body: JSON.stringify(draft) })
        : await requestJson(apiUrl, '/api/platform/cases', token, { method: 'POST', idempotencyKey: `case-${Date.now()}`, body: JSON.stringify(draft) });
      const nextCase = result.case || draftCase;
      setDraftCase(nextCase);
      setReview(result.review || review);
      setNotice({ message: 'پیش‌نویس در سرور ذخیره شد.' });
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const publishRfq = async () => {
    if (!draftCase) return;
    setBusy(true);
    try {
      const result = await requestJson(apiUrl, `/api/platform/cases/${draftCase.id}/publish-rfq`, token, { method: 'POST', idempotencyKey: `publish-${draftCase.id}-${Date.now()}`, body: JSON.stringify({ deadlineAt: draft.schedule.rfqDeadline || undefined }) });
      setNotice({ message: `RFQ1 منتشر شد · مهلت ${result.deadlineAt || 'ثبت‌شده'}` });
      await loadDashboard();
      setSection('rfq');
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const loadQuotes = async (item = selectedCase) => {
    setBusy(true);
    try {
      let current = item;
      if (current && !current.rfqs) {
        const details = await requestJson(apiUrl, `/api/platform/cases/${current.id}`, token);
        current = { ...current, ...details.case, ...details };
        setSelectedCase(current);
      }
      const rfq = current?.rfqs?.find((entry) => entry.level === 'RFQ1');
      if (!rfq) throw new Error('RFQ1 این پرونده هنوز منتشر نشده است.');
      setQuotes(await requestJson(apiUrl, `/api/platform/rfqs/${rfq.id}`, token));
      setSelectedCase(current);
      setSection('rfq');
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const award = async () => {
    if (!currentRfq || !selectedWinner || awardReason.trim().length < 8) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/rfqs/${currentRfq.id}/award`, token, { method: 'POST', idempotencyKey: `award-${currentRfq.id}-${Date.now()}`, body: JSON.stringify({ winnerOrgId: selectedWinner, reason: awardReason.trim() }) });
      setAwardOpen(false);
      setAwardReason('');
      setNotice({ message: 'اعطای انسانی شرکت X ثبت شد.' });
      await loadDashboard();
      if (selectedCase) await openCase(selectedCase);
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const signContract = async () => {
    if (!selectedCase) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/cases/${selectedCase.id}/customer-contract`, token, { method: 'POST', idempotencyKey: `contract-${selectedCase.id}-${Date.now()}`, body: JSON.stringify({ contract: { parties: { customerOrgId: 'server-owned', xOrgId: selectedCase.case?.xOrgId || null }, scope: selectedCase.draft || {}, confidentiality: true } }) });
      setNotice({ message: 'قرارداد Customer-X نسخه‌دار و قفل شد.' });
      await loadDashboard();
      await openCase(selectedCase);
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const approveCmr = async (documentId) => {
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/documents/${documentId}/approve`, token, { method: 'POST', idempotencyKey: `cmr-approve-${documentId}-${Date.now()}` });
      setNotice({ message: 'Draft CMR بررسی، تأیید و قفل شد.' });
      await openCase(selectedCase);
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const rejectCmr = async () => {
    const document = cmrDrafts.find((item) => item.state === 'SUBMITTED' || item.state === 'DRAFT');
    if (!document || rejectReason.trim().length < 8) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/documents/${document.id}/reject`, token, { method: 'POST', idempotencyKey: `cmr-reject-${document.id}-${Date.now()}`, body: JSON.stringify({ reason: rejectReason.trim() }) });
      setRejectOpen(false);
      setRejectReason('');
      setNotice({ message: 'Draft CMR برای اصلاح برگشت داده شد.' });
      await openCase(selectedCase);
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const loadTracking = async () => {
    if (!selectedTrip) return setNotice({ message: 'برای این پرونده سفر عملیاتی ایجاد نشده است.' });
    setBusy(true);
    try {
      setTracking(await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/tracking`, token));
      setSection('tracking');
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const loadPod = async () => {
    if (!selectedTrip) return setNotice({ message: 'سفر مقصد برای مشاهده POD وجود ندارد.' });
    setBusy(true);
    try {
      setPod(await requestJson(apiUrl, `/api/platform/trips/${selectedTrip.id}/pod`, token));
      setSection('pod');
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const downloadDocument = async (document) => {
    try {
      const result = await requestJson(apiUrl, `/api/platform/documents/${document.id}/download`, token);
      setNotice({ message: `دانلود نسخه ${document.versionNo} مجاز شد؛ توکن تا ${result.expiresAt} اعتبار دارد.` });
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    }
  };

  const uploadDocument = async () => {
    if (!selectedCase || !documentUpload.fileRef.trim() || !/^[a-f0-9]{64}$/i.test(documentUpload.fileHash.trim())) return;
    setBusy(true);
    try {
      await requestJson(apiUrl, '/api/platform/documents', token, {
        method: 'POST',
        idempotencyKey: `document-${selectedCase.id}-${documentUpload.docType}-${Date.now()}`,
        body: JSON.stringify({ ...documentUpload, caseId: selectedCase.id, fileRef: documentUpload.fileRef.trim(), fileHash: documentUpload.fileHash.trim().toLowerCase() })
      });
      setDocumentUpload((current) => ({ ...current, fileRef: '', fileHash: '' }));
      setNotice({ message: 'نسخه جدید سند ثبت شد و نسخه‌های قبلی حفظ شدند.' });
      await openCase(selectedCase);
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const confirmSettlement = async (settlementId) => {
    setBusy(true);
    try {
      await requestJson(apiUrl, `/api/platform/settlements/${settlementId}/confirm`, token, { method: 'POST', idempotencyKey: `settlement-${settlementId}-${Date.now()}`, body: JSON.stringify({}) });
      setNotice({ message: 'تسویه Customer-X تأیید شد و رویداد مالی ثبت گردید.' });
      await openCase(selectedCase);
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const openIssue = async (type) => {
    if (!selectedCase || issueReason.trim().length < 8) return;
    setBusy(true);
    try {
      const result = await requestJson(apiUrl, `/api/platform/cases/${selectedCase.id}/${type}`, token, { method: 'POST', idempotencyKey: `issue-${type}-${selectedCase.id}-${Date.now()}`, body: JSON.stringify({ reason: issueReason.trim() }) });
      setIssues((current) => [result.issue, ...current]);
      setIssueReason('');
      setNotice({ message: type === 'claims' ? 'پرونده خسارت ثبت شد.' : 'پرونده اختلاف ثبت شد.' });
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    } finally {
      setBusy(false);
    }
  };

  const openAudit = async () => {
    try {
      const result = await requestJson(apiUrl, `/api/platform/audit${selectedCase ? `?caseId=${selectedCase.id}` : ''}`, token);
      setAuditItems(result.items || []);
      setAuditOpen(true);
    } catch (error) {
      setNotice({ code: error.code, message: error.message });
    }
  };

  const startNewRequest = () => {
    setDraft(initialDraft());
    setDraftCase(null);
    setReview(null);
    setStep(0);
    setSection('new-request');
  };

  const caseCards = useMemo(() => cases.map((item) => ({ ...item, primaryState: item.deliveryState || item.tripState || item.capacityState || item.commercialState })), [cases]);

  const renderOverview = () => <>
    <section className="platform-metrics"><article><span>پرونده‌های مجاز</span><strong>{Number(metrics.cases).toLocaleString('fa-IR')}</strong><small>tenant / organization scoped</small></article><article><span>سفر فعال</span><strong>{Number(metrics.activeTrips).toLocaleString('fa-IR')}</strong><small>ETA و Timeline کنترل‌شده</small></article><article><span>شاهد یا اقدام معوق</span><strong>{Number(metrics.pendingEvidence).toLocaleString('fa-IR')}</strong><small>next action از read model</small></article></section>
    <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Customer control tower</span><h2>پرونده‌های اخیر</h2></div><button className="platform-button" type="button" onClick={loadDashboard}>بروزرسانی</button></div>{caseCards.length ? <div className="platform-case-grid">{caseCards.map((item) => <button className="platform-case-card" key={item.id} type="button" onClick={() => openCase(item)}><div className="platform-case-card__top"><span>#{item.caseNumber}</span><RiskBadge flags={item.riskFlags} /></div><strong>{item.cargo?.type || 'محموله در Draft'}</strong><small>{item.origin?.location || 'مبدأ نامشخص'} ← {item.destination?.location || 'مقصد نامشخص'}</small><div className="platform-case-card__state">{stateLabel(item.primaryState)}</div></button>)}</div> : <div className="platform-empty"><strong>پرونده‌ای در محدوده سازمان نیست</strong><span>ثبت درخواست جدید از منوی سمت راست شروع می‌شود.</span></div>}</section>
  </>;

  const renderCases = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Tenant-scoped read model</span><h2>درخواست‌های فعال</h2></div><button type="button" className="platform-button platform-button--primary" onClick={startNewRequest} disabled={!canEdit}>ثبت درخواست جدید</button></div><div className="shipper-list">{caseCards.length ? caseCards.map((item) => <button type="button" className="shipper-list-row" key={item.id} onClick={() => openCase(item)}><span>#{item.caseNumber}</span><strong>{item.cargo?.type || 'Draft'}</strong><small>{stateLabel(item.primaryState)}</small><RiskBadge flags={item.riskFlags} /></button>) : <div className="platform-empty"><strong>درخواستی ثبت نشده است</strong><span>Draft و وضعیت‌های جاری فقط از API نمایش داده می‌شوند.</span></div>}</div></section>;

  const renderCaseDetail = () => selectedCase && <section className="platform-case-detail"><div className="platform-section__heading"><div><span className="platform-eyebrow">Case #{selectedCase.caseNumber}</span><h2>{selectedCase.cargo?.type || 'جزئیات پرونده'}</h2><p>{selectedCase.origin?.location} ← {selectedCase.destination?.location}</p></div><div className="platform-heading-actions"><RiskBadge flags={selectedCase.riskFlags} /><button type="button" className="platform-button" onClick={openAudit}>حسابرسی</button></div></div><div className="shipper-detail-facts"><span><b>مهلت</b>{selectedCase.deadlineAt || 'ثبت نشده'}</span><span><b>مسئول بعدی</b>{selectedCase.deliveryState === 'POD_SUBMITTED' ? 'شرکت X · بررسی POD' : selectedCase.commercialState === 'PROVIDER_AWARDED' ? 'صاحب بار · قرارداد Customer-X' : 'طبق وضعیت پرونده'}</span><span><b>مدرک ناقص</b>{selectedCase.review?.missingFields?.length ? selectedCase.review.missingFields.join('، ') : 'موردی از read model گزارش نشده'}</span><span><b>مسدودکننده</b>{selectedCase.review?.complianceBlocks?.length ? selectedCase.review.complianceBlocks.map((item) => item.code).join('، ') : 'بدون block فعال'}</span></div><div className="platform-detail-grid"><article className="platform-panel"><h3>وضعیت، گام بعد و مسئول</h3><StatusTimeline items={timelineForCase(selectedCase)} /><div className="platform-next-action"><span>اقدام‌های مالک پرونده</span><strong>{selectedCase.deliveryState === 'POD_SUBMITTED' ? 'شرکت X در حال بررسی POD است' : stateLabel(selectedCase.commercialState)}</strong></div><div className="shipper-action-row"><button type="button" className="platform-button" onClick={() => loadQuotes(selectedCase)}>مقایسه RFQ1</button><button type="button" className="platform-button" onClick={loadTracking}>رهگیری</button><button type="button" className="platform-button" onClick={loadPod}>POD</button></div></article><article className="platform-panel"><h3>اسناد نسخه‌دار</h3><div className="platform-doc-list">{selectedCase.documents?.length ? selectedCase.documents.map((document) => <DocCard key={document.id} document={document} onOpen={downloadDocument} />) : <div className="platform-empty-inline">سندی در این پرونده ثبت نشده است.</div>}</div></article><article className="platform-panel"><h3>Customer-X مالی</h3><MoneyBreakdown items={(selectedCase.finance?.settlements || []).map((item) => ({ ...item, label: `${item.relationship_type} · ${item.state}` }))} /><p className="platform-panel__hint">RFQ2، نرخ X-Y و نرخ Y-Driver در این read model وجود ندارد.</p></article></div></section>;

  const renderRfq = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">RFQ1 · Sealed until permitted opening</span><h2>مقایسه پیشنهادهای شرکت X</h2></div></div><div className="shipper-list">{cases.filter((item) => item.commercialState === 'RFQ_OPEN' || item.commercialState === 'OFFERS_RECEIVED').map((item) => <button type="button" className="shipper-list-row" key={item.id} onClick={() => loadQuotes(item)}><span>#{item.caseNumber}</span><strong>{item.cargo?.type || 'محموله'}</strong><small>{item.commercialState === 'RFQ_OPEN' ? 'پنجره پیشنهاد باز' : 'آماده مقایسه'}</small></button>)}</div>{quotes && <div className="shipper-quote-board"><div className="shipper-quote-board__header"><div><span className="platform-eyebrow">{quotes.state} · {quotes.deadlineAt}</span><h3>پیشنهادهای مجاز ({quotes.quoteCount})</h3></div><button className="platform-button platform-button--primary" type="button" disabled={!canAward || !quotes.quotes?.length} onClick={() => { setSelectedWinner(quotes.quotes?.[0]?.bidderOrgId || ''); setAwardOpen(true); }}>Award انسانی</button></div>{quotes.quotes?.length ? <div className="shipper-quote-grid">{quotes.quotes.map((quote) => <article key={quote.id} className="shipper-quote-card"><strong>{quote.companyName || quote.bidderOrgId}</strong><b>{quote.amount ?? 'قفل‌شده'} {quote.currency || ''}</b><span>{quote.qualificationState} · معتبر تا {quote.terms?.validUntil || 'طبق پیشنهاد'}</span><small>{quote.terms?.transitTime || 'زمان حمل طبق پیشنهاد'} · {quote.terms?.sla || 'SLA طبق پیشنهاد'}</small><small>{quote.terms?.includedServices || quote.terms?.services || 'خدمات included/excluded در جزئیات پیشنهاد'}</small></article>)}</div> : <div className="platform-empty-inline">پیشنهادها تا زمان بازگشایی مجاز مهر و موم هستند؛ هر read مجاز در Audit ثبت می‌شود.</div>}</div>}</section>;

  const renderDocuments = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">DMS · immutable versions</span><h2>اسناد مشتری</h2></div></div>{selectedCase ? <><div className="shipper-doc-board">{selectedCase.documents?.map((document) => <DocCard key={document.id} document={document} onOpen={downloadDocument} />)}</div>{canEdit && <div className="shipper-upload-card"><strong>ثبت نسخه جدید سند تجاری</strong><small>Overwrite وجود ندارد؛ سرور version و hash را کنترل می‌کند.</small><div className="shipper-form-grid"><label className="shipper-field"><span>نوع سند</span><select value={documentUpload.docType} onChange={(event) => setDocumentUpload((current) => ({ ...current, docType: event.target.value }))}>{documentOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>{field('File reference', documentUpload.fileRef, (value) => setDocumentUpload((current) => ({ ...current, fileRef: value })), { placeholder: 'storage://...' })}{field('SHA-256 hash', documentUpload.fileHash, (value) => setDocumentUpload((current) => ({ ...current, fileHash: value })), { placeholder: '64 حرف hex' })}{field('Deadline', documentUpload.deadlineAt, (value) => setDocumentUpload((current) => ({ ...current, deadlineAt: value })), { type: 'datetime-local' })}</div><button type="button" className="platform-button platform-button--primary" onClick={uploadDocument} disabled={busy || !documentUpload.fileRef.trim() || !/^[a-f0-9]{64}$/i.test(documentUpload.fileHash.trim())}>ثبت نسخه سند</button></div>}</> : <div className="platform-empty"><strong>یک پرونده را انتخاب کن</strong><span>فهرست اسناد فقط پس از احراز محدوده پرونده از API می‌آید.</span></div>}</section>;

  const renderContracts = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Customer-X · role lock</span><h2>قراردادها</h2></div></div>{selectedCase ? <div className="shipper-contract-card">{selectedCase.contracts?.length ? selectedCase.contracts.map((contract) => <article key={contract.id}><div><strong>نسخه {contract.versionNo}</strong><span>{contract.state} · role lock: {contract.roleLock}</span></div><small>امضا: {contract.signedAt || 'ثبت نشده'} · نسخه قبلی overwrite نشده است.</small><div className="shipper-contract-facts"><span>طرفین: {contract.snapshot?.parties?.customerOrgId || contract.customerOrgId} ↔ {contract.snapshot?.parties?.xOrgId || contract.xOrgId}</span><span>مبلغ Customer-X: {contract.snapshot?.customerFreightPrice ?? 'ثبت نشده'} {contract.snapshot?.currency || ''}</span><span>Milestone: {Array.isArray(contract.snapshot?.paymentMilestones) ? contract.snapshot.paymentMilestones.length : 0} مورد</span><span>بیمه/وظایف/Claim: {contract.snapshot?.insuranceResponsibility || 'طبق نسخه قرارداد'}</span><span>محرمانگی: {contract.snapshot?.confidentiality === false ? 'خیر' : 'فعال'}</span></div></article>) : <div className="platform-empty-inline">هنوز قرارداد Customer-X ثبت نشده است.</div>}{canEdit && selectedCase.commercialState === 'PROVIDER_AWARDED' && <button className="platform-button platform-button--primary" type="button" onClick={signContract} disabled={busy || !delegated('signContract')}>امضای نسخه قرارداد</button>}</div> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>قرارداد فقط برای طرف‌های Customer-X نمایش داده می‌شود.</span></div>}</section>;

  const renderCmr = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">CMR Draft · human review</span><h2>بررسی پیش‌نویس CMR</h2></div></div>{selectedCase ? <div className="shipper-cmr-list">{cmrDrafts.length ? cmrDrafts.map((document) => <article key={document.id}><DocCard document={document} onOpen={downloadDocument} /><div><span>{document.state === 'APPROVED' ? 'نسخه قفل‌شده و تحویل به X/Y' : document.state === 'RETURNED' ? 'برای اصلاح برگشت خورده' : 'در انتظار بررسی مشتری'}</span>{document.state !== 'APPROVED' && <><button className="platform-button platform-button--primary" type="button" onClick={() => approveCmr(document.id)} disabled={busy || !canApproveCmr}>Approve و Lock</button><button className="platform-button" type="button" onClick={() => setRejectOpen(true)} disabled={busy || !canApproveCmr}>Reject با دلیل</button></>}</div></article>) : <div className="platform-empty"><strong>Draft CMR در صف نیست</strong><span>شرکت X پس از قرارداد، Draft نسخه‌دار ایجاد می‌کند.</span></div>}</div> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>از درخواست‌های فعال یک پرونده را باز کن.</span></div>}</section>;

  const renderTracking = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Least privilege tracking</span><h2>رهگیری، Timeline و ETA</h2></div></div>{tracking ? <div className="shipper-tracking-board"><div className="shipper-tracking-summary"><strong>{stateLabel(tracking.state || tracking.trip?.state)}</strong><span>ETA: {tracking.eta || tracking.trip?.etaAt || 'ثبت نشده'}</span><span>آخرین milestone: {tracking.lastMilestone || 'ثبت نشده'}</span><RiskBadge flags={tracking.delayFlags || []} /></div><StatusTimeline items={(tracking.timeline || []).map((item, index) => ({ label: stateLabel(item.eventType), detail: item.createdAt, done: index > 0, current: index === 0 }))} /><p className="platform-panel__hint">موقعیت خام و سفرهای دیگر راننده در این پنل نمایش داده نمی‌شود؛ فقط موقعیت scope‌شده تحویل قابل استفاده است.</p></div> : <div className="platform-empty"><strong>سفر را از یک پرونده انتخاب کن</strong><span>ETA و رویدادهای مرز از API فعال سفر خوانده می‌شوند.</span></div>}</section>;

  const renderPod = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Evidence-grade delivery</span><h2>تحویل و POD</h2></div></div>{pod?.pod ? <div className="shipper-pod-board"><div className="shipper-tracking-summary"><strong>{stateLabel(pod.pod.state)}</strong><span>گیرنده مجاز: {pod.pod.recipientOrgId}</span><span>مرجع اختیار: {pod.pod.authorityRef}</span><span>زمان دریافت: {pod.pod.evidence?.receivedAt || 'ثبت نشده'}</span><span>دامنه مکان: {pod.pod.evidence?.locationScope || 'محدوده مجاز'}</span><span>OTP: {pod.pod.otpVerified ? 'تأیید شده' : 'طبق policy'}</span></div><EvidenceGallery evidence={Object.entries(pod.pod.evidence || {}).filter(([key]) => key !== 'location').map(([key, value]) => ({ type: key, label: Array.isArray(value) ? `${value.length} مورد` : String(value || 'ثبت‌شده') }))} /><p className="platform-panel__hint">POD Submitted با POD Accepted متفاوت است؛ مشتری شواهد را overwrite نمی‌کند.</p></div> : <div className="platform-empty"><strong>POD در این سفر ثبت نشده است</strong><span>پس از تحویل مجاز، Agent/Z یا Consignee شواهد را ثبت می‌کند.</span></div>}</section>;

  const renderFinance = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Relationship-scoped finance</span><h2>پرداخت‌ها و تسویه Customer-X</h2></div></div>{selectedCase ? <div className="shipper-finance-board"><MoneyBreakdown items={(selectedCase.finance?.settlements || []).map((item) => ({ ...item, label: `${item.state} · ${item.currency}` }))} />{selectedCase.finance?.settlements?.map((settlement) => <div className="shipper-finance-row" key={settlement.id}><span>{settlement.relationship_type} · {settlement.state}</span>{canConfirm && settlement.state === 'SETTLEMENT_PENDING' && <button type="button" className="platform-button platform-button--primary" onClick={() => confirmSettlement(settlement.id)} disabled={busy}>Pay / Confirm</button>}</div>)}<p className="platform-panel__hint">فقط رابطه Customer-X در این view وجود دارد؛ نرخ X-Y و Y-Driver عمداً قابل استنتاج نیست.</p></div> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>برای مشاهده فاکتور و milestone مالی یک پرونده را باز کن.</span></div>}</section>;

  const renderClaims = () => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Parallel case domains</span><h2>خسارت، شکایت و اختلاف</h2></div></div>{selectedCase ? <div className="shipper-issue-board"><textarea value={issueReason} onChange={(event) => setIssueReason(event.target.value)} placeholder="شرح موضوع و evidence reference" rows="4" disabled={!canEdit} /><div className="shipper-action-row"><button type="button" className="platform-button" onClick={() => openIssue('claims')} disabled={!canEdit || busy}>باز کردن Claim</button><button type="button" className="platform-button platform-button--primary" onClick={() => openIssue('disputes')} disabled={!canEdit || busy}>باز کردن Dispute</button></div>{issues.length ? issues.map((issue) => <article key={issue.id}><strong>{issue.case_type} · {issue.status}</strong><span>{issue.reason}</span>{issue.timingWarning && <small>{'CLM-408 · هشدار زمان‌بندی'}</small>}</article>) : <div className="platform-empty-inline">پرونده موازی ثبت نشده است.</div>}</div> : <div className="platform-empty"><strong>پرونده‌ای انتخاب نشده است</strong><span>Claim و Dispute از همان محدوده پرونده ایجاد می‌شوند.</span></div>}</section>;

  const renderSimple = (title, description, action) => <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Customer governance</span><h2>{title}</h2></div></div><div className="shipper-simple-card"><strong>{title}</strong><p>{description}</p>{action && <button type="button" className="platform-button" onClick={action.onClick}>{action.label}</button>}</div></section>;

  let content = renderOverview();
  if (section === 'active') content = selectedCase ? renderCaseDetail() : renderCases();
  if (section === 'new-request') content = <Wizard draft={draft} setDraft={setDraft} step={step} setStep={setStep} draftCase={draftCase} review={review} busy={busy} onSave={saveDraft} onPublish={publishRfq} canPublish={canPublish} />;
  if (section === 'rfq') content = renderRfq();
  if (section === 'contracts') content = renderContracts();
  if (section === 'documents') content = renderDocuments();
  if (section === 'cmr') content = renderCmr();
  if (section === 'tracking') content = renderTracking();
  if (section === 'pod') content = renderPod();
  if (section === 'finance') content = renderFinance();
  if (section === 'claims') content = renderClaims();
  if (section === 'notifications') content = <section className="platform-section"><div className="platform-section__heading"><div><span className="platform-eyebrow">Domain-event notifications</span><h2>پیام‌ها و اعلان‌ها</h2></div><button type="button" className="platform-button" onClick={loadDashboard}>بروزرسانی</button></div><div className="shipper-notification-list">{notifications.length ? notifications.map((item) => <article key={item.id}><strong>{item.payload?.eventName || 'اعلان عملیاتی'}</strong><span>{item.payload?.payload?.caseId ? `پرونده ${item.payload.payload.caseId}` : 'رویداد ثبت‌شده'}</span><small>{item.created_at}</small></article>) : <div className="platform-empty"><strong>اعلانی وجود ندارد</strong><span>اعلان‌ها از Domain Event و با scope سازمانی ساخته می‌شوند.</span></div>}</div></section>;
  if (section === 'reports') content = renderSimple('گزارش‌ها', 'گزارش فقط از read model و محدوده سازمان ساخته می‌شود. Export-all در پنل مشتری وجود ندارد.', { label: 'حساب‌رسی پرونده', onClick: openAudit });
  if (section === 'organization') content = renderSimple('سازمان و کاربران', 'عضویت‌ها، Delegation و نقش‌های سازمان باید در دامنه Admin/Organization API مدیریت شوند؛ نقش از route حدس زده نمی‌شود.');
  if (section === 'security') content = renderSimple('پروفایل و امنیت', 'نشست کوتاه‌عمر، refresh چرخشی، step-up برای عملیات پرریسک و ثبت Audit فعال است.');
  if (section === 'support') content = renderSimple('پشتیبانی', 'برای هر درخواست پشتیبانی، شماره پرونده و Correlation ID را همراه داشته باشید.');

  return <div className="shipper-shell" dir="rtl"><ShipperHeader role={role} onLogout={onLogout} /><div className="shipper-layout"><aside className="shipper-sidebar"><div className="shipper-sidebar__intro"><span className="platform-eyebrow">{currentRoleLabel}</span><strong>پنل صاحب بار</strong><small>Market A + Control Tower</small></div><nav>{menu.map(([key, label]) => <button key={key} type="button" className={section === key ? 'is-active' : ''} onClick={() => { if (key === 'new-request') startNewRequest(); else if (key === 'tracking') loadTracking(); else if (key === 'pod') loadPod(); else setSection(key); }}>{label}</button>)}</nav><div className="shipper-sidebar__guard">RFQ2، نرخ X-Y، نرخ Y-Driver و GPS خام در این سطح intentionally hidden.</div></aside><main className="shipper-content"><section className="platform-hero"><div><span className="platform-eyebrow">Server is source of truth · {currentRoleLabel}</span><h1>{section === 'dashboard' ? 'مرکز عملیات صاحب بار' : menu.find(([key]) => key === section)?.[1] || 'پنل مشتری'}</h1><p>تمام اقدام‌ها از عضویت، Permission، ABAC، وضعیت پرونده و Audit عبور می‌کنند.</p></div><div className="platform-hero__status"><i /> tenant-scoped<br /><small>Customer-X finance isolated · RFQ1 sealed</small></div></section><div className="shipper-mobile-nav">{menu.slice(0, 6).map(([key, label]) => <button key={key} type="button" className={section === key ? 'is-active' : ''} onClick={() => key === 'new-request' ? startNewRequest() : setSection(key)}>{label}</button>)}</div><Notice notice={notice} />{busy && <div className="platform-loading">در حال دریافت یا ثبت read model…</div>}{!busy && content}</main></div><ApprovalDialog open={awardOpen} title="Award انسانی شرکت X" description="دلیل انتخاب اجباری است؛ AI فقط رتبه‌بندی و توضیح می‌دهد و نمی‌تواند برنده را ثبت کند." busy={busy} onCancel={() => setAwardOpen(false)} onConfirm={award}><div className="shipper-dialog-fields"><label>برنده شرکت X<select value={selectedWinner} onChange={(event) => setSelectedWinner(event.target.value)}>{quotes?.quotes?.map((quote) => <option key={quote.bidderOrgId} value={quote.bidderOrgId}>{quote.bidderOrgId}</option>)}</select></label><label>دلیل اجباری Award<textarea value={awardReason} onChange={(event) => setAwardReason(event.target.value)} rows="3" /></label></div></ApprovalDialog><ApprovalDialog open={rejectOpen} title="رد Draft CMR" description="نسخه تأییدشده قابل رد نیست. دلیل اصلاح را قبل از ثبت وارد کن." busy={busy} onCancel={() => setRejectOpen(false)} onConfirm={rejectCmr}><div className="shipper-dialog-fields"><label>دلیل رد و اصلاح<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows="3" /></label></div></ApprovalDialog><AuditDrawer open={auditOpen} items={auditItems} onClose={() => setAuditOpen(false)} /></div>;
}
