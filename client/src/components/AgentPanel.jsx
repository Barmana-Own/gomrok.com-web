import { useEffect, useState } from 'react';
import { usePlatformRealtime } from '../hooks/usePlatformRealtime.js';
import { DocCard, EvidenceGallery, MoneyBreakdown, RiskBadge, StatusTimeline } from './PlatformPrimitives.jsx';
import { NavigationIcon, ProductLogo } from './ProductIcon.jsx';
import { PanelMenuButton, PanelSidebar, usePanelNavigation } from './ResponsivePanelNav.jsx';

const stateLabels = {
  AT_DESTINATION: 'ورود به مقصد',
  READY_FOR_DELIVERY: 'آماده تحویل',
  DELIVERED: 'تحویل‌شده',
  POD_SUBMITTED: 'POD در بررسی',
  POD_ACCEPTED: 'POD پذیرفته شد',
  RETURNED: 'برگشت برای تکمیل',
  VERIFIED: 'احراز شد',
  MISMATCH: 'مغایرت',
  HOLD: 'در توقف کنترل‌شده',
  ESCALATE: 'ارجاع به بررسی',
  SUBMITTED: 'ارسال‌شده',
  ACCEPTED: 'تأییدشده',
  SETTLEMENT_PENDING: 'در انتظار تسویه',
  FINANCIALLY_SETTLED: 'تسویه‌شده',
  OPEN: 'باز'
};

const menu = [
  ['dashboard', 'تحویل‌های منتظر'],
  ['delivery', 'احراز تحویل'],
  ['evidence', 'POD و شواهد'],
  ['receipts', 'قبض انبار / تخلیه'],
  ['discrepancies', 'مغایرت‌ها'],
  ['claims', 'Claims / Disputes'],
  ['finance', 'تسویه من'],
  ['authority', 'اسناد اختیار'],
  ['notifications', 'اعلان‌ها'],
  ['security', 'پروفایل و امنیت']
];

const deliveryFilters = [
  ['ALL', 'همه'],
  ['ARRIVING', 'امروز می‌رسد'],
  ['WAITING', 'در انتظار'],
  ['LATE', 'با تأخیر'],
  ['AUTHORITY', 'اختیار رو به پایان'],
  ['INCOMPLETE', 'POD ناقص'],
  ['COMPLETED', 'تکمیل‌شده'],
  ['DISPUTED', 'مورد اختلاف']
];

const discrepancyTypes = [
  ['WRONG_RECIPIENT', 'گیرنده اشتباه'],
  ['SHORTAGE', 'کسری'],
  ['CARGO_DAMAGE', 'آسیب کالا'],
  ['SEAL_ISSUE', 'مغایرت پلمب'],
  ['WEIGHT_MISMATCH', 'مغایرت وزن'],
  ['DOCUMENT_MISMATCH', 'مغایرت سند'],
  ['DRIVER_SUBSTITUTION', 'مغایرت راننده'],
  ['DESTINATION_MISMATCH', 'مغایرت مقصد'],
  ['REFUSED_DELIVERY', 'امتناع از تحویل']
];

const evidenceTypes = [
  ['VEHICLE_AT_DESTINATION', 'خودرو در مقصد'],
  ['SEAL_BEFORE_OPENING', 'پلمب پیش از بازکردن'],
  ['CARGO_BEFORE_UNLOAD', 'کالا پیش از تخلیه'],
  ['UNLOADING', 'فرآیند تخلیه'],
  ['CARGO_AFTER_UNLOAD', 'کالا پس از تخلیه'],
  ['DAMAGE', 'آسیب'],
  ['WAREHOUSE', 'قبض انبار'],
  ['RECEIPT', 'رسید مقصد'],
  ['SIGNATURE', 'امضا'],
  ['STAMP', 'مهر']
];

const documentTypes = [
  ['SIGNED_CMR', 'CMR رسیدشده / Box 24'],
  ['WAREHOUSE_RECEIPT', 'قبض انبار'],
  ['UNLOADING_RECEIPT', 'رسید تخلیه'],
  ['DESTINATION_RECEIPT', 'رسید مقصد'],
  ['RELEASE_DOCUMENT', 'سند Release / ترخیص'],
  ['DOMESTIC_POD', 'POD داخلی'],
  ['AGENT_AUTHORITY', 'سند اختیار Agent']
];

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

function stateLabel(value) {
  return stateLabels[value] || value || 'ثبت نشده';
}

function idempotency(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function deviceId() {
  const key = 'gomrok-agent-device-id';
  const current = window.localStorage.getItem(key);
  if (current) return current;
  const next = globalThis.crypto?.randomUUID?.() || `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, next);
  return next;
}

async function hashFile(file) {
  if (!file) return '';
  const buffer = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function Field({ label, value, onChange, ...props }) {
  return <label className="agent-field"><span>{label}</span><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}

function SelectField({ label, value, onChange, options }) {
  return <label className="agent-field"><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>{options.map(([key, title]) => <option value={key} key={key}>{title}</option>)}</select></label>;
}

function Notice({ notice }) {
  if (!notice) return null;
  return <div className="platform-notice"><strong>{notice.code ? `${notice.code} · ` : ''}</strong>{notice.message}</div>;
}

function Card({ title, eyebrow, children, actions }) {
  return <section className="agent-card"><div className="agent-card__heading"><div><span className="platform-eyebrow">{eyebrow}</span><h2>{title}</h2></div>{actions}</div>{children}</section>;
}

function deliveryTimeline(trip) {
  const current = trip?.podState || trip?.verificationState || trip?.state;
  return [
    { label: 'ورود مقصد', detail: stateLabel(trip?.state), done: ['READY_FOR_DELIVERY', 'DELIVERED', 'POD_SUBMITTED', 'POD_ACCEPTED'].includes(trip?.state) },
    { label: 'احراز گیرنده', detail: stateLabel(trip?.verificationState), current: current === trip?.verificationState, done: trip?.verificationState === 'VERIFIED' },
    { label: 'POD', detail: stateLabel(trip?.podState), current: current === trip?.podState, done: trip?.podState === 'POD_ACCEPTED' },
    { label: 'تسویه X-Agent', detail: trip?.settlements?.[0] ? stateLabel(trip.settlements[0].state) : 'در انتظار شرط قرارداد', current: Boolean(trip?.settlements?.length) }
  ];
}

function agentCaseControl(selected) {
  const verification = selected?.verificationHistory?.[0]?.outcome;
  const pod = selected?.pod;
  const documents = new Set((selected?.documents || []).map((item) => item.docType));
  const missingEvidence = [];
  if (verification !== 'VERIFIED') missingEvidence.push('احراز گیرنده و تطبیق CMR');
  if (!documents.has('SIGNED_CMR') && !pod?.evidence?.signedCmrRef) missingEvidence.push('CMR رسیدشده / Box 24');
  if (!pod && verification === 'VERIFIED') missingEvidence.push('بسته کامل POD و تصاویر تحویل');
  if (pod?.state === 'RETURNED') missingEvidence.push('اصلاحات درخواستی شرکت X');
  const criticalExceptions = (selected?.exceptions || []).filter((item) => ['high', 'critical'].includes(String(item.severity).toLowerCase()));
  let nextAction = 'بررسی پرونده';
  let responsible = 'Agent/Z';
  if (verification !== 'VERIFIED') nextAction = 'تکمیل احراز تحویل';
  else if (!pod || pod.state === 'RETURNED') nextAction = 'ارسال POD برای Review شرکت X';
  else if (pod.state === 'SUBMITTED') { nextAction = 'انتظار بررسی شرکت X'; responsible = 'Company X'; }
  else if (pod.state === 'ACCEPTED') { nextAction = 'پیگیری شرط تسویه'; responsible = 'Company X / Finance'; }
  return {
    nextAction,
    responsible,
    missingEvidence,
    blockingReason: criticalExceptions.length ? 'مغایرت با شدت بالا یا بحرانی ثبت شده است.' : pod?.state === 'RETURNED' ? 'POD برای تکمیل برگشت داده شده است.' : 'بدون مانع ثبت‌شده',
    deadline: selected?.trip?.deadlineAt || selected?.assignment?.validTo || null,
    riskFlags: criticalExceptions.map((item) => `${item.exceptionType}:${item.severity}`)
  };
}

export default function AgentPanel({ user, token, apiUrl, onLogout }) {
  const { menuId, menuOpen, closeMenu, toggleMenu } = usePanelNavigation('agent-menu');
  const [section, setSection] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [deliveryFilter, setDeliveryFilter] = useState('ALL');
  const [verifyForm, setVerifyForm] = useState({ recipientRef: '', cmrRef: '', packageCount: '', sealState: 'INTACT', reason: '', outsideReason: '', lat: '', lng: '', signatureRef: '', stampRef: '', correctShipment: false, correctCmr: false, correctRecipient: false });
  const [evidenceForm, setEvidenceForm] = useState({ evidenceType: 'VEHICLE_AT_DESTINATION', fileRef: '', fileHash: '', note: '', lat: '', lng: '' });
  const [documentForm, setDocumentForm] = useState({ docType: 'SIGNED_CMR', fileRef: '', fileHash: '', note: '' });
  const [otp, setOtp] = useState({ challengeId: '', code: '', devCode: '', state: '' });
  const [podForm, setPodForm] = useState({ authorityRef: '', signatureRef: '', stampRef: '', photos: '', signedCmrRef: '', warehouseReceiptRef: '', remarks: '', otpRequired: true });
  const [discrepancy, setDiscrepancy] = useState({ exceptionType: 'WRONG_RECIPIENT', severity: 'high', reason: '' });
  const [claim, setClaim] = useState({ reason: '', evidenceRef: '' });

  const deliveries = dashboard?.deliveries || [];
  const settlements = dashboard?.settlements || [];
  const kycState = dashboard?.kyc?.state || 'pending';
  const filteredDeliveries = deliveries.filter((item) => {
    if (deliveryFilter === 'ALL') return true;
    if (deliveryFilter === 'ARRIVING') return item.etaAt && new Date(item.etaAt).toDateString() === new Date().toDateString();
    if (deliveryFilter === 'WAITING') return !['POD_SUBMITTED', 'POD_ACCEPTED', 'ACCEPTED'].includes(item.podState) && item.verificationState !== 'VERIFIED';
    if (deliveryFilter === 'LATE') return Boolean(item.delayFlags?.length);
    if (deliveryFilter === 'AUTHORITY') return item.authorityStatus === 'PENDING' || (item.assignment?.validTo && new Date(item.assignment.validTo).getTime() - Date.now() < 72 * 60 * 60 * 1000);
    if (deliveryFilter === 'INCOMPLETE') return item.podState === 'RETURNED' || (item.verificationState && item.verificationState !== 'VERIFIED');
    if (deliveryFilter === 'COMPLETED') return ['POD_SUBMITTED', 'POD_ACCEPTED', 'ACCEPTED'].includes(item.podState);
    if (deliveryFilter === 'DISPUTED') return item.podState === 'DISPUTED';
    return true;
  });

  const notify = (error) => setNotice(error?.message ? { code: error.code, message: error.message } : { message: String(error) });

  const loadDashboard = async () => {
    setBusy(true);
    try {
      const result = await requestJson(apiUrl, '/api/platform/agent/dashboard', token);
      setDashboard(result);
      if (!selectedId && result.deliveries?.[0]) setSelectedId(result.deliveries[0].id);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  usePlatformRealtime({ apiUrl, token, onEvent: loadDashboard });

  const loadTrip = async (tripId, nextSection = 'delivery') => {
    setBusy(true);
    try {
      const result = await requestJson(apiUrl, `/api/platform/agent/trips/${tripId}`, token);
      setSelected(result);
      setSelectedId(tripId);
      setPodForm((current) => ({ ...current, authorityRef: result.assignment?.authorityRef || current.authorityRef }));
      setSection(nextSection);
    } catch (error) {
      notify(error);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const currentDevice = deviceId();
    requestJson(apiUrl, '/api/platform/agent/devices/bind', token, { method: 'POST', headers: { 'X-Device-Id': currentDevice }, body: JSON.stringify({ deviceId: currentDevice, platform: 'web', appVersion: 'agent-panel-v1' }), idempotencyKey: `agent-device-${currentDevice}` })
      .then(() => setDeviceReady(true))
      .catch((error) => notify(error));
    loadDashboard();
  }, [token]);

  const action = async (path, body, key) => {
    setBusy(true);
    try {
      const result = await requestJson(apiUrl, path, token, { method: 'POST', headers: { 'X-Device-Id': deviceId() }, body: JSON.stringify(body), idempotencyKey: key || idempotency('agent-action') });
      setNotice({ message: result.message || 'عملیات ثبت شد.' });
      await loadDashboard();
      if (selectedId) await loadTrip(selectedId, section === 'dashboard' ? 'delivery' : section);
      return result;
    } catch (error) {
      notify(error);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const locate = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: Number(verifyForm.lat), lng: Number(verifyForm.lng), accuracy: null });
    navigator.geolocation.getCurrentPosition((position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: new Date(position.timestamp).toISOString() }), () => resolve({ lat: Number(verifyForm.lat), lng: Number(verifyForm.lng), accuracy: null }), { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 });
  });

  const verifyDelivery = async () => {
    if (!selected?.trip?.id) return;
    const location = await locate();
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return notify({ message: 'موقعیت تحویل لازم است.' });
    setVerifyForm((current) => ({ ...current, lat: String(location.lat), lng: String(location.lng) }));
    await action(`/api/platform/agent/trips/${selected.trip.id}/verify`, {
      outcome: verifyForm.correctShipment && verifyForm.correctCmr && verifyForm.correctRecipient ? 'VERIFIED' : 'MISMATCH',
      recipientOrgId: selected.assignment?.agentOrgId,
      representativeRef: verifyForm.recipientRef,
      cmrRef: verifyForm.cmrRef,
      authorityRef: selected.assignment?.authorityRef,
      packageCount: verifyForm.packageCount || null,
      sealState: verifyForm.sealState,
      reason: verifyForm.reason,
      outsideReason: verifyForm.outsideReason,
      signatureRef: verifyForm.signatureRef,
      stampRef: verifyForm.stampRef,
      location,
      checklist: { correctShipment: verifyForm.correctShipment, correctCmr: verifyForm.correctCmr, correctRecipient: verifyForm.correctRecipient }
    }, `agent-verify-${selected.trip.id}-${Date.now()}`);
  };

  const requestOtp = async () => {
    if (!selected?.trip?.id) return;
    const result = await action(`/api/platform/agent/trips/${selected.trip.id}/delivery/otp/request`, { recipientRef: verifyForm.recipientRef }, `agent-otp-${selected.trip.id}-${Date.now()}`);
    if (result) setOtp({ challengeId: result.challengeId, code: '', devCode: result.devCode || '', state: 'SENT' });
  };

  const verifyOtp = async () => {
    if (!selected?.trip?.id || !otp.challengeId) return;
    const result = await action(`/api/platform/agent/trips/${selected.trip.id}/delivery/otp/verify`, { challengeId: otp.challengeId, code: otp.code }, `agent-otp-verify-${selected.trip.id}-${Date.now()}`);
    if (result) setOtp((current) => ({ ...current, state: 'VERIFIED' }));
  };

  const submitPod = async () => {
    if (!selected?.trip?.id) return;
    const evidence = { recipientOrgId: selected.assignment?.agentOrgId, authorityRef: selected.assignment?.authorityRef, receivedAt: new Date().toISOString(), location: { lat: Number(verifyForm.lat), lng: Number(verifyForm.lng) }, photos: podForm.photos.split(',').map((item) => item.trim()).filter(Boolean), signatureRef: podForm.signatureRef, stampRef: podForm.stampRef, signedCmrRef: podForm.signedCmrRef, warehouseReceiptRef: podForm.warehouseReceiptRef, remarks: podForm.remarks, otpVerified: otp.state === 'VERIFIED' };
    await action(`/api/platform/trips/${selected.trip.id}/pod`, { evidence, otpRequired: podForm.otpRequired, otpChallengeId: otp.challengeId }, `agent-pod-${selected.trip.id}-${Date.now()}`);
  };

  const submitEvidence = async (event) => {
    event?.preventDefault();
    if (!selected?.trip?.id) return;
    await action(`/api/platform/agent/trips/${selected.trip.id}/evidence`, { evidenceType: evidenceForm.evidenceType, fileRef: evidenceForm.fileRef, fileHash: evidenceForm.fileHash, note: evidenceForm.note, location: { lat: Number(evidenceForm.lat), lng: Number(evidenceForm.lng) } }, `agent-evidence-${selected.trip.id}-${Date.now()}`);
  };

  const submitDocument = async (event) => {
    event?.preventDefault();
    if (!selected?.trip?.id) return;
    await action(`/api/platform/agent/trips/${selected.trip.id}/documents`, documentForm, `agent-document-${selected.trip.id}-${Date.now()}`);
  };

  const selectFile = async (event, setter) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileHash = await hashFile(file);
    setter((current) => ({ ...current, fileRef: file.name, fileHash }));
  };

  const renderDeliveryCards = () => <div className="agent-delivery-list">{filteredDeliveries.length ? filteredDeliveries.map((item) => <button type="button" className={`agent-delivery-card${String(item.id) === String(selectedId) ? ' is-selected' : ''}`} key={item.id} onClick={() => loadTrip(item.id)}><div><span>#{item.caseNumber}</span><strong>{item.destination?.location || item.route?.destination || 'مقصد ثبت نشده'}</strong><small>{item.driver?.name || 'راننده ثبت‌شده'} · {item.vehicle?.plateNumber || 'خودرو ثبت‌شده'}</small></div><b>{stateLabel(item.podState || item.verificationState || item.state)}</b></button>) : <div className="platform-empty"><strong>موردی در این فیلتر نیست</strong><span>صف فقط از Assignmentهای همین Agent تشکیل می‌شود.</span></div>}</div>;

  const renderVerification = () => <Card title="احراز تحویل و تطبیق CMR" eyebrow="AUTHORITY · RECIPIENT · LOCATION"><div className="agent-form-grid"><Field label="نماینده / شناسه گیرنده" value={verifyForm.recipientRef} onChange={(value) => setVerifyForm((current) => ({ ...current, recipientRef: value }))} placeholder="شناسه نماینده مجاز" /><Field label="مرجع CMR" value={verifyForm.cmrRef} onChange={(value) => setVerifyForm((current) => ({ ...current, cmrRef: value }))} placeholder="CMR number / reference" /><Field label="تعداد بسته" value={verifyForm.packageCount} onChange={(value) => setVerifyForm((current) => ({ ...current, packageCount: value }))} inputMode="numeric" /><SelectField label="وضعیت پلمب" value={verifyForm.sealState} onChange={(value) => setVerifyForm((current) => ({ ...current, sealState: value }))} options={[['INTACT', 'سالم'], ['BROKEN', 'بازشده'], ['MISSING', 'مفقود'], ['CHANGED', 'تعویض‌شده']]} /><Field label="مرجع امضا" value={verifyForm.signatureRef} onChange={(value) => setVerifyForm((current) => ({ ...current, signatureRef: value }))} placeholder="signature evidence ref" /><Field label="مرجع مهر" value={verifyForm.stampRef} onChange={(value) => setVerifyForm((current) => ({ ...current, stampRef: value }))} placeholder="stamp evidence ref" /><Field label="Latitude (در صورت نیاز)" value={verifyForm.lat} onChange={(value) => setVerifyForm((current) => ({ ...current, lat: value }))} inputMode="decimal" /><Field label="Longitude (در صورت نیاز)" value={verifyForm.lng} onChange={(value) => setVerifyForm((current) => ({ ...current, lng: value }))} inputMode="decimal" /><label className="agent-field agent-field--wide"><span>شرح مغایرت / دلیل خارج از محدوده</span><textarea value={verifyForm.reason} onChange={(event) => setVerifyForm((current) => ({ ...current, reason: event.target.value }))} placeholder="در صورت مغایرت یا هشدار geofence، دلیل کنترل‌شده را ثبت کنید." /></label></div><div className="agent-checks"><label><input type="checkbox" checked={verifyForm.correctShipment} onChange={(event) => setVerifyForm((current) => ({ ...current, correctShipment: event.target.checked }))} /> محموله صحیح</label><label><input type="checkbox" checked={verifyForm.correctCmr} onChange={(event) => setVerifyForm((current) => ({ ...current, correctCmr: event.target.checked }))} /> CMR منطبق</label><label><input type="checkbox" checked={verifyForm.correctRecipient} onChange={(event) => setVerifyForm((current) => ({ ...current, correctRecipient: event.target.checked }))} /> گیرنده مجاز</label></div><div className="agent-actions"><button className="platform-button platform-button--primary" type="button" disabled={busy || !selected} onClick={verifyDelivery}>ثبت نتیجه احراز</button><button className="platform-button" type="button" disabled={busy || !selected} onClick={requestOtp}>درخواست OTP تحویل</button></div>{otp.challengeId && <div className="agent-otp"><span>Challenge: {otp.challengeId.slice(0, 14)}… {otp.devCode ? `کد آزمایشی ${otp.devCode}` : ''}</span><input inputMode="numeric" value={otp.code} onChange={(event) => setOtp((current) => ({ ...current, code: event.target.value }))} placeholder="کد ۶ رقمی" /><button type="button" onClick={verifyOtp} disabled={busy}>تأیید OTP</button><b>{otp.state === 'VERIFIED' ? 'OTP تأیید شد' : 'در انتظار تأیید'}</b></div>}</Card>;

  const renderPod = () => <Card title="POD و زنجیره شواهد" eyebrow="SUBMIT · X REVIEW"><div className="agent-form-grid"><Field label="مرجع اختیار" value={podForm.authorityRef || selected?.assignment?.authorityRef} onChange={(value) => setPodForm((current) => ({ ...current, authorityRef: value }))} /><Field label="مرجع امضا" value={podForm.signatureRef} onChange={(value) => setPodForm((current) => ({ ...current, signatureRef: value }))} /><Field label="CMR رسیدشده / Box 24" value={podForm.signedCmrRef} onChange={(value) => setPodForm((current) => ({ ...current, signedCmrRef: value }))} /><Field label="قبض انبار / تخلیه" value={podForm.warehouseReceiptRef} onChange={(value) => setPodForm((current) => ({ ...current, warehouseReceiptRef: value }))} /><Field label="مرجع مهر" value={podForm.stampRef} onChange={(value) => setPodForm((current) => ({ ...current, stampRef: value }))} /><Field label="مرجع عکس‌ها با کاما" value={podForm.photos} onChange={(value) => setPodForm((current) => ({ ...current, photos: value }))} /><label className="agent-field agent-field--wide"><span>یادداشت / Reservation</span><textarea value={podForm.remarks} onChange={(event) => setPodForm((current) => ({ ...current, remarks: event.target.value }))} /></label></div><label className="agent-checks"><input type="checkbox" checked={podForm.otpRequired} onChange={(event) => setPodForm((current) => ({ ...current, otpRequired: event.target.checked }))} /> OTP طبق Policy قرارداد لازم است</label><button className="platform-button platform-button--primary" type="button" disabled={busy || selected?.verificationHistory?.[0]?.outcome !== 'VERIFIED'} onClick={submitPod}>ارسال POD برای Review شرکت X</button><p className="agent-hint">POD Submitted به معنی POD Accepted نیست؛ پذیرش نهایی و شرط تسویه با شرکت X است.</p></Card>;

  const renderEvidence = () => <Card title="Evidence Gallery و اسناد مقصد" eyebrow="IMMUTABLE · VERSIONED"><form className="agent-form-grid" onSubmit={submitEvidence}><SelectField label="دسته شاهد" value={evidenceForm.evidenceType} onChange={(value) => setEvidenceForm((current) => ({ ...current, evidenceType: value }))} options={evidenceTypes} /><label className="agent-field"><span>فایل شاهد</span><input type="file" accept="image/*,.pdf" onChange={(event) => selectFile(event, setEvidenceForm)} /></label><Field label="File reference" value={evidenceForm.fileRef} onChange={(value) => setEvidenceForm((current) => ({ ...current, fileRef: value }))} /><Field label="SHA-256" value={evidenceForm.fileHash} onChange={(value) => setEvidenceForm((current) => ({ ...current, fileHash: value }))} /><Field label="Latitude" value={evidenceForm.lat} onChange={(value) => setEvidenceForm((current) => ({ ...current, lat: value }))} /><Field label="Longitude" value={evidenceForm.lng} onChange={(value) => setEvidenceForm((current) => ({ ...current, lng: value }))} /><label className="agent-field agent-field--wide"><span>یادداشت</span><textarea value={evidenceForm.note} onChange={(event) => setEvidenceForm((current) => ({ ...current, note: event.target.value }))} /></label><button className="platform-button platform-button--primary" type="submit" disabled={busy}>ثبت شاهد نسخه جدید</button></form>{selected?.documents?.length ? <div className="agent-doc-list">{selected.documents.map((document) => <DocCard key={document.id} document={document} />)}</div> : null}<EvidenceGallery evidence={(selected?.verificationHistory || []).map((item) => ({ type: item.outcome, label: `نسخه ${item.versionNo} · ${item.createdAt}` }))} /></Card>;

  const renderReceipts = () => <Card title="قبض انبار، تخلیه و Release" eyebrow="IMPORT / DESTINATION DEPENDENCIES"><form className="agent-form-grid" onSubmit={submitDocument}><SelectField label="نوع سند" value={documentForm.docType} onChange={(value) => setDocumentForm((current) => ({ ...current, docType: value }))} options={documentTypes} /><label className="agent-field"><span>فایل سند</span><input type="file" accept="image/*,.pdf" onChange={(event) => selectFile(event, setDocumentForm)} /></label><Field label="File reference" value={documentForm.fileRef} onChange={(value) => setDocumentForm((current) => ({ ...current, fileRef: value }))} /><Field label="SHA-256" value={documentForm.fileHash} onChange={(value) => setDocumentForm((current) => ({ ...current, fileHash: value }))} /><label className="agent-field agent-field--wide"><span>توضیح سند</span><textarea value={documentForm.note} onChange={(event) => setDocumentForm((current) => ({ ...current, note: event.target.value }))} /></label><button className="platform-button platform-button--primary" type="submit" disabled={busy}>ثبت سند نسخه‌دار</button></form><p className="agent-hint">نسخه تأییدشده overwrite نمی‌شود. برای Import، Warehouse Receipt و Release می‌توانند شرط تسویه باشند.</p></Card>;

  const renderDiscrepancies = () => <Card title="ثبت مغایرت مقصد" eyebrow="HOLD · CLAIM · RISK"><div className="agent-form-grid"><SelectField label="نوع مغایرت" value={discrepancy.exceptionType} onChange={(value) => setDiscrepancy((current) => ({ ...current, exceptionType: value }))} options={discrepancyTypes} /><SelectField label="شدت" value={discrepancy.severity} onChange={(value) => setDiscrepancy((current) => ({ ...current, severity: value }))} options={[['medium', 'متوسط'], ['high', 'بالا'], ['critical', 'بحرانی']]} /><label className="agent-field agent-field--wide"><span>شرح و ارجاع شواهد</span><textarea value={discrepancy.reason} onChange={(event) => setDiscrepancy((current) => ({ ...current, reason: event.target.value }))} placeholder="شرح حداقل ۸ کاراکتر" /></label></div><button className="platform-button platform-button--primary" type="button" disabled={busy || !selected} onClick={() => action(`/api/platform/agent/trips/${selected.trip.id}/discrepancies`, discrepancy, `agent-discrepancy-${selected?.trip?.id}-${Date.now()}`)}>ثبت مغایرت و اطلاع X</button>{selected?.exceptions?.length ? <div className="agent-issue-list">{selected.exceptions.map((item) => <article key={item.id}><strong>{item.exceptionType} · {stateLabel(item.status)}</strong><span>{item.reason}</span></article>)}</div> : null}</Card>;

  const renderClaims = () => <Card title="Claims / Disputes و Evidence Chain" eyebrow="CASE EVIDENCE"><div className="agent-form-grid"><label className="agent-field agent-field--wide"><span>شرح Claim / اعتراض</span><textarea value={claim.reason} onChange={(event) => setClaim((current) => ({ ...current, reason: event.target.value }))} placeholder="شرح مرتبط با تحویل یا رابطه X-Agent" /></label><Field label="مرجع شاهد" value={claim.evidenceRef} onChange={(value) => setClaim((current) => ({ ...current, evidenceRef: value }))} /></div><button className="platform-button platform-button--primary" type="button" disabled={busy || !selected} onClick={() => action(`/api/platform/cases/${selected.trip.caseId}/claims`, { tripId: selected.trip.id, reason: claim.reason, evidence: { fileRef: claim.evidenceRef } }, `agent-claim-${selected?.trip?.id}-${Date.now()}`)}>ثبت Claim</button>{selected?.issues?.length ? <div className="agent-issue-list">{selected.issues.map((item) => <article key={item.id}><strong>{item.caseType || item.case_type} · {stateLabel(item.status)}</strong><span>{item.reason}</span></article>)}</div> : null}</Card>;

  const renderFinance = () => <Card title="تسویه رابطه X-Agent" eyebrow="RELATIONSHIP-SCOPED"><MoneyBreakdown items={settlements.map((item) => ({ ...item, label: `${item.caseNumber || item.caseId} · ${stateLabel(item.state)}` }))} />{settlements.map((item) => <div className="agent-finance-row" key={item.id}><span>{item.caseNumber || item.caseId} · {stateLabel(item.state)}</span><strong>{item.amount} {item.currency}</strong>{item.state === 'SETTLEMENT_PENDING' && <button type="button" onClick={() => { const reason = window.prompt('دلیل اختلاف تسویه را وارد کنید.'); if (reason) action(`/api/platform/agent/settlements/${item.id}/dispute`, { reason }, `agent-settlement-dispute-${item.id}-${Date.now()}`); }}>اعتراض</button>}</div>)}<p className="agent-hint">فقط رابطه X-Agent نمایش داده می‌شود؛ Customer-X، X-Y و Y-Driver خارج از این پنل هستند.</p></Card>;

  const renderProfile = () => <Card title="پروفایل، KYC و امنیت" eyebrow="ABAC · DEVICE BINDING"><div className="agent-profile-grid"><div><span>سازمان</span><strong>{dashboard?.organization?.name || user?.organizationId || '—'}</strong></div><div><span>وضعیت KYC</span><strong>{stateLabel(kycState)}</strong></div><div><span>دستگاه</span><strong>{deviceReady ? 'ثبت‌شده' : 'در انتظار ثبت'}</strong></div><div><span>Role</span><strong>{user?.role || 'agent_z'}</strong></div></div><p className="agent-hint">ثبت نهایی تحویل، OTP، شواهد و تسویه فقط با نشست سازمانی، دستگاه ثبت‌شده، Assignment معتبر و Audit append-only انجام می‌شود.</p></Card>;

  const renderDetail = () => {
    if (!selected) return <div className="platform-empty"><strong>یک تحویل را انتخاب کن</strong><span>داده‌های مقصد فقط برای Assignment معتبر همان پرونده نمایش داده می‌شود.</span></div>;
    const control = agentCaseControl(selected);
    return <div className="agent-detail"><Card title={`پرونده #${selected.trip.caseNumber}`} eyebrow="ASSIGNED DESTINATION CASE" actions={<button className="platform-button" type="button" onClick={() => setSection('dashboard')}>بازگشت به لیست</button>}><div className="agent-facts"><span><b>مقصد</b>{selected.trip.destination?.location || '—'}</span><span><b>کالا</b>{selected.trip.cargo?.type || '—'} · {selected.trip.cargo?.weight || '—'} {selected.trip.cargo?.unit || ''}</span><span><b>راننده / خودرو</b>{selected.trip.driver?.name || '—'} · {selected.trip.vehicle?.plateNumber || '—'}</span><span><b>شرکت‌های عملیاتی</b>{selected.trip.parties?.forwarderRef || '—'} · {selected.trip.parties?.carrierRef || '—'}</span><span><b>Assignment</b>{stateLabel(selected.assignment?.state)} · {selected.assignment?.authorityRef || '—'}</span></div><div className="agent-case-control"><div><span>عمل بعدی</span><strong>{control.nextAction}</strong></div><div><span>مسئول اقدام</span><strong>{control.responsible}</strong></div><div><span>Deadline / SLA</span><strong>{control.deadline ? new Date(control.deadline).toLocaleString('fa-IR') : 'طبق قرارداد'}</strong></div><div><span>شواهد ناقص</span><strong>{control.missingEvidence.length ? control.missingEvidence.join('، ') : 'کامل'}</strong></div><div className="agent-case-control__wide"><span>دلیل توقف / استثنا</span><strong>{control.blockingReason}</strong></div><div className="agent-case-control__risk"><span>ریسک</span><RiskBadge flags={control.riskFlags} /></div></div><StatusTimeline items={deliveryTimeline({ ...selected.trip, podState: selected.pod?.state, verificationState: selected.verificationHistory?.[0]?.outcome, settlements: selected.settlements })} /></Card>{section === 'delivery' && renderVerification()}{section === 'evidence' && renderEvidence()}{section === 'receipts' && renderReceipts()}{section === 'discrepancies' && renderDiscrepancies()}{section === 'claims' && renderClaims()}{section === 'authority' && renderReceipts()}{(section === 'delivery' || section === 'evidence') && renderPod()}</div>;
  };

  const selectMenuSection = (key) => {
    closeMenu();
    setSection(key);
    if (['delivery', 'evidence', 'receipts', 'discrepancies', 'claims', 'authority'].includes(key) && selectedId && !selected) loadTrip(selectedId, key);
  };

  return <main className="agent-shell" dir="rtl">
    <header className="platform-header"><div className="platform-header__primary"><PanelMenuButton open={menuOpen} onClick={toggleMenu} controls={menuId} inverse /><div className="platform-brand"><ProductLogo subtitle="عامل مقصد و شواهد تحویل" /></div></div><div className="platform-header__user"><span>عامل مقصد · {dashboard?.organization?.name || user?.organizationId || '—'}</span><button type="button" onClick={onLogout}>خروج</button></div></header>
    <div className="agent-main">
      <div className="platform-hero"><div><span className="platform-eyebrow">کنترل تحویل تخصیص‌یافته</span><h1>تحویل مقصد با شواهد قابل دفاع</h1><p>احراز گیرنده، تطبیق CMR، موقعیت، OTP و POD در یک زنجیره نسخه‌دار برای بررسی شرکت X.</p></div><div className="platform-hero__status"><i /> KYC: {stateLabel(kycState)}<small> · دستگاه: {deviceReady ? 'متصل' : 'در انتظار'}</small></div></div>
      <PanelSidebar open={menuOpen} onClose={closeMenu} id={menuId} className="agent-sidebar" title="منوی عامل مقصد" subtitle="تحویل، شواهد و امور مالی">
        <nav className="agent-nav" aria-label="منوی عامل مقصد">{menu.map(([key, label]) => <button type="button" className={section === key ? 'is-active' : ''} aria-current={section === key ? 'page' : undefined} key={key} onClick={() => selectMenuSection(key)}><NavigationIcon section={key} size={18} /><span>{label}</span></button>)}</nav>
      </PanelSidebar>
      <Notice notice={notice} />
      {section === 'dashboard' && <><div className="platform-metrics"><article><span>تحویل‌های تخصیص‌یافته</span><strong>{dashboard?.metrics?.deliveries || 0}</strong><small>در محدوده مأموریت</small></article><article><span>در انتظار اقدام</span><strong>{dashboard?.metrics?.waiting || 0}</strong><small>احراز یا POD</small></article><article><span>شاهد ناقص یا برگشتی</span><strong>{dashboard?.metrics?.incompletePod || 0}</strong><small>بررسی کنترل‌شده</small></article></div><Card title="صف تحویل مقصد" eyebrow="تحویل‌های در انتظار" actions={<div className="agent-card-actions"><select className="agent-filter" value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value)} aria-label="فیلتر تحویل"><option value="ALL">همه تحویل‌ها</option>{deliveryFilters.slice(1).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><button className="platform-button" type="button" disabled={busy} onClick={loadDashboard}>به‌روزرسانی</button></div>}>{renderDeliveryCards()}</Card>{dashboard?.notifications?.length ? <Card title="اعلان‌ها" eyebrow="رویدادهای عملیاتی"><div className="agent-notification-list">{dashboard.notifications.slice(0, 8).map((item) => <span key={item.id}>{item.payload?.eventName || 'رویداد'} · {item.created_at}</span>)}</div></Card> : null}</>}
      {section === 'finance' && renderFinance()}
      {section === 'notifications' && <Card title="اعلان‌ها" eyebrow="اعلان‌های حسابرسی‌شده"><div className="agent-notification-list">{(dashboard?.notifications || []).map((item) => <span key={item.id}>{item.payload?.eventName || 'رویداد'} · {item.created_at}</span>)}</div></Card>}
      {section === 'security' && renderProfile()}
      {['delivery', 'evidence', 'receipts', 'discrepancies', 'claims', 'authority'].includes(section) && renderDetail()}
    </div>
  </main>;
}
