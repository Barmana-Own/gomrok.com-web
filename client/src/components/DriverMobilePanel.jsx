import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlatformRealtime } from '../hooks/usePlatformRealtime.js';
import { DocCard, EvidenceGallery, MoneyBreakdown, StatusTimeline } from './PlatformPrimitives.jsx';
import { Icon, ProductLogo } from './ProductIcon.jsx';
import { PanelMenuButton, PanelSidebar, usePanelNavigation } from './ResponsivePanelNav.jsx';

const DEVICE_KEY = 'gomrok-driver-device-id';
const QUEUE_KEY = 'gomrok-driver-offline-queue';
const UNDERTAKING_VERSION = 'driver-undertaking-v1';
const UNDERTAKING = [
  'صحت اطلاعات و مدارک', 'حضور به‌موقع', 'عدم حمل کالای اضافه یا مغایر', 'همکاری صحیح در بارگیری',
  'ثبت عکس و مدارک', 'حفظ پلمب', 'فعال نگه داشتن GPS', 'حرکت در مسیر مجاز',
  'اعلام فوری حادثه', 'تحویل فقط به گیرنده مجاز', 'اخذ رسید معتبر',
  'پذیرش آثار نقص شواهد تحویل', 'محرمانگی اطلاعات مشتری', 'منع دورزدن پلتفرم'
];
const BORDER_EVENTS = {
  ARRIVED_BORDER: 'رسیدن به مرز', QUEUE_WAITING: 'صف / انتظار', CUSTOMS_CHECK: 'بازرسی گمرکی',
  SEAL_CHECK: 'کنترل پلمب', DOCUMENTS_REQUESTED: 'درخواست سند', FINE_FEE: 'جریمه / هزینه',
  ENTERED_COUNTRY: 'ورود به کشور مقصد', DEPARTED_CHECKPOINT: 'عبور از ایستگاه'
};
const INCIDENTS = ['BREAKDOWN', 'ACCIDENT', 'ROAD_BORDER_CLOSED', 'ABNORMAL_STOP', 'CARGO_DAMAGE', 'TEMPERATURE_ISSUE', 'SEAL_ISSUE', 'SECURITY_ISSUE', 'OTHER'];
const DRIVER_NAV_ITEMS = [
  ['home', 'home', 'خانه'],
  ['opportunities', 'rfq', 'فرصت‌ها و پیشنهادها'],
  ['trips', 'route', 'سفرهای من'],
  ['documents', 'document', 'مدارک'],
  ['account', 'user', 'حساب و تسویه']
];

const statusText = (value) => ({ DISPATCHED: 'اعزام شده', AT_BORDER: 'مرز', EXITED_IRAN: 'خروج از ایران', IN_TRANSIT: 'در مسیر', AT_DESTINATION: 'مقصد', READY_FOR_DELIVERY: 'آماده تحویل', POD_SUBMITTED: 'POD در بررسی', ACCEPTED: 'پذیرفته شد', available: 'آزاد', in_trip: 'در سفر', inactive: 'غیرفعال' }[value] || String(value || 'ثبت نشده').replaceAll('_', ' '));
const dateText = (value) => { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
const getDeviceId = () => { const existing = window.localStorage.getItem(DEVICE_KEY); if (existing) return existing; const id = window.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(36).slice(2)}`; window.localStorage.setItem(DEVICE_KEY, id); return id; };
async function hashValue(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  if (!window.crypto?.subtle) return '0'.repeat(64);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}
function currentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS روی این دستگاه در دسترس نیست.'));
    navigator.geolocation.getCurrentPosition((position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, speed: position.coords.speed, timestamp: new Date(position.timestamp).toISOString() }), () => reject(new Error('اجازه دسترسی به موقعیت صادر نشد.')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  });
}
const QUEUE_DB_NAME = 'gomrok-driver-secure-queue';
const QUEUE_STORE_NAME = 'keys';
function openQueueDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('ذخیره‌سازی امن آفلاین روی این دستگاه در دسترس نیست.'));
    const request = window.indexedDB.open(QUEUE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(QUEUE_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('ذخیره‌سازی امن آفلاین در دسترس نیست.'));
  });
}
async function queueKey() {
  if (!window.crypto?.subtle) throw new Error('رمزگذاری صف آفلاین روی این دستگاه در دسترس نیست.');
  const db = await openQueueDb();
  const existing = await new Promise((resolve, reject) => { const request = db.transaction(QUEUE_STORE_NAME, 'readonly').objectStore(QUEUE_STORE_NAME).get('driver-queue-key'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  if (existing) { db.close(); return existing; }
  const key = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise((resolve, reject) => { const transaction = db.transaction(QUEUE_STORE_NAME, 'readwrite'); transaction.objectStore(QUEUE_STORE_NAME).put(key, 'driver-queue-key'); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
  db.close();
  return key;
}
const encodeBytes = (value) => { let binary = ''; for (const byte of value) binary += String.fromCharCode(byte); return window.btoa(binary); };
const decodeBytes = (value) => Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0));
async function readQueue() {
  const stored = window.localStorage.getItem(QUEUE_KEY);
  if (!stored) return [];
  try {
    const [ivText, dataText] = stored.split('.');
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBytes(ivText) }, await queueKey(), decodeBytes(dataText));
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (_error) { return []; }
}
async function writeQueue(value) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await queueKey(), new TextEncoder().encode(JSON.stringify(value)));
  window.localStorage.setItem(QUEUE_KEY, `${encodeBytes(iv)}.${encodeBytes(new Uint8Array(encrypted))}`);
}

function Pill({ value, active = false }) { return <span className={`driver-mobile-pill${active ? ' driver-mobile-pill--active' : ''}`}>{statusText(value)}</span>; }
function Empty({ title, detail }) { return <div className="driver-mobile-empty"><strong>{title}</strong><span>{detail}</span></div>; }
function SectionTitle({ eyebrow, title, action }) { return <div className="driver-mobile-section-title"><div><span className="platform-eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action}</div>; }
function Metric({ value, title, detail }) { return <article className="driver-mobile-metric"><strong>{value}</strong><span>{title}</span><small>{detail}</small></article>; }

export default function DriverMobilePanel({ user, token, apiUrl, onLogout }) {
  const { menuId, menuOpen, closeMenu, toggleMenu } = usePanelNavigation('driver-menu');
  const [deviceId] = useState(getDeviceId);
  const [tab, setTab] = useState('home');
  const [home, setHome] = useState(null);
  const [profile, setProfile] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [trips, setTrips] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [gps, setGps] = useState('خاموش');
  const watchRef = useRef(null);
  const [bid, setBid] = useState(null);
  const [bidForm, setBidForm] = useState({ amount: '', currency: 'EUR', note: '', submit: false });
  const [acceptChecked, setAcceptChecked] = useState(false);
  const [checkInReason, setCheckInReason] = useState('');
  const [checks, setChecks] = useState({ correctVehicle: false, cleanFit: false, capacity: false, securement: false, temperatureReady: false });
  const [evidence, setEvidence] = useState({ type: 'LOADING_PHOTO', ref: '', file: null });
  const [incident, setIncident] = useState({ incidentType: 'BREAKDOWN', severity: 'high', reason: '' });
  const [borderType, setBorderType] = useState('ARRIVED_BORDER');
  const [otp, setOtp] = useState({ challengeId: '', code: '', devCode: '' });
  const [pod, setPod] = useState({ authorityRef: '', photos: '', signatureRef: '', stampRef: '', signedCmrRef: '', warehouseReceiptRef: '', remarks: '' });
  const [vehicle, setVehicle] = useState({ plateNumber: '', vehicleType: '', capacity: '', cargoScope: '', reeferCapable: false });
  const [driverDoc, setDriverDoc] = useState({ docType: 'DRIVER_LICENSE', fileRef: '', expiresAt: '' });
  const [settlementIssue, setSettlementIssue] = useState({ id: null, reason: '' });

  const api = useCallback(async (path, options = {}, key = null) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId, ...(options.headers || {}) };
    if (key) headers['X-Idempotency-Key'] = key;
    const response = await fetch(`${apiUrl}${path}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.detail || body.message || 'عملیات انجام نشد.'); error.status = response.status; error.code = body.code; throw error; }
    return body;
  }, [apiUrl, deviceId, token]);

  const flushQueue = useCallback(async () => {
    const queued = await readQueue();
    if (!queued.length || !navigator.onLine) return;
    const remaining = [];
    let discarded = 0;
    for (const item of queued) {
      try { await api(item.path, { method: item.method, body: item.body }, item.key); } catch (error) {
        if (error.status && error.status < 500) discarded += 1;
        else remaining.push(item);
      }
    }
    await writeQueue(remaining);
    if (discarded) setNotice(`${discarded} اقدام آفلاین به دلیل تغییر وضعیت سفر قابل ارسال نبود.`);
    else if (remaining.length !== queued.length) setNotice('صف آفلاین همگام شد.');
  }, [api]);

  const write = useCallback(async (path, body = {}, { queueable = false, key = `driver-${Date.now()}-${Math.random().toString(36).slice(2)}` } = {}) => {
    if (queueable && !navigator.onLine) { const queued = await readQueue(); if (!queued.some((item) => item.key === key)) await writeQueue([...queued, { path, method: 'POST', body, key }]); setNotice('اقدام در صف آفلاین ذخیره شد.'); return null; }
    try { return await api(path, { method: 'POST', body }, key); } catch (error) {
      if (queueable && (!navigator.onLine || error.status >= 500)) { const queued = await readQueue(); if (!queued.some((item) => item.key === key)) await writeQueue([...queued, { path, method: 'POST', body, key }]); setNotice('اقدام در صف آفلاین ذخیره شد.'); return null; }
      throw error;
    }
  }, [api]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextHome, nextProfile, nextOpportunities, nextTrips, nextSettlements] = await Promise.all([
        api('/api/platform/driver/dashboard'), api('/api/platform/driver/profile'), api('/api/platform/driver/opportunities'), api('/api/platform/driver/trips'), api('/api/platform/driver/settlements')
      ]);
      setHome(nextHome); setProfile(nextProfile); setOpportunities(nextOpportunities.opportunities || []); setTrips(nextTrips.trips || []); setSettlements(nextSettlements.settlements || []);
    } catch (error) { setNotice(error.message); } finally { setLoading(false); }
  }, [api]);

  usePlatformRealtime({ apiUrl, token, onEvent: refresh });

  useEffect(() => {
    const bindDevice = async () => { try { await write('/api/platform/driver/devices/bind', { deviceId, platform: 'web-mobile', appVersion: '1.0.0', integrity: { online: navigator.onLine } }, { key: `bind-${deviceId}` }); } catch (_error) { setNotice('اتصال دستگاه کامل نشد؛ اقدامات حساس پس از اتصال دوباره فعال می‌شوند.'); } };
    const setup = async () => { await bindDevice(); refresh(); };
    setup();
    const online = async () => { setOffline(false); await bindDevice(); await flushQueue(); refresh(); };
    const offlineHandler = () => setOffline(true);
    window.addEventListener('online', online); window.addEventListener('offline', offlineHandler);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineHandler); };
  }, [deviceId]);
  useEffect(() => () => { if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current); }, []);
  useEffect(() => {
    if (selected?.trip?.trackingState === 'ACTIVE' || watchRef.current === null) return undefined;
    navigator.geolocation?.clearWatch(watchRef.current);
    watchRef.current = null;
    setGps('خاموش');
    return undefined;
  }, [selected?.trip?.trackingState]);

  const openTrip = async (trip) => {
    try {
      const [detail, tracking, delivery, incidents] = await Promise.all([
        api(`/api/platform/driver/trips/${trip.id}`), api(`/api/platform/trips/${trip.id}/tracking`).catch(() => null), api(`/api/platform/driver/trips/${trip.id}/delivery`).catch(() => null), api(`/api/platform/driver/trips/${trip.id}/incidents`).catch(() => ({ incidents: [] }))
      ]);
      setSelected({ ...detail, tracking, delivery, incidents: incidents.incidents || [] }); setTab('trips');
    } catch (error) { setNotice(error.message); }
  };
  const action = async (path, body, options = {}) => { try { const result = await write(path, body, options); if (result) { setNotice(result.message || 'ثبت شد.'); await refresh(); if (selected) await openTrip({ id: selected.trip.id }); } } catch (error) { setNotice(error.message); } };
  const locate = async () => { try { return await currentLocation(); } catch (error) { setNotice(error.message); return null; } };

  const acceptTrip = () => { if (!selected || !acceptChecked) return setNotice('۱۴ بند تعهدنامه را بخوان و تأیید کن.'); action(`/api/platform/driver/trips/${selected.trip.id}/accept`, { undertakingVersion: UNDERTAKING_VERSION }, { key: `accept-${selected.trip.id}` }); };
  const checkIn = async () => { const geo = await locate(); if (geo) action(`/api/platform/driver/trips/${selected.trip.id}/check-in`, { geo, outsideReason: checkInReason }, { key: `checkin-${selected.trip.id}-${geo.timestamp}` }); };
  const submitChecks = () => action(`/api/platform/driver/trips/${selected.trip.id}/preload-checklist`, { checks }, { key: `preload-${selected.trip.id}` });
  const submitEvidence = async () => { if (!evidence.file && !evidence.ref) return setNotice('عکس یا مرجع شاهد را وارد کن.'); const fileHash = await hashValue(evidence.file ? await evidence.file.arrayBuffer() : evidence.ref); action(`/api/platform/trips/${selected.trip.id}/loading-evidence`, { evidenceType: evidence.type, fileRef: evidence.file?.name || evidence.ref, fileHash, deviceRef: deviceId, metadata: { source: 'driver-mobile' } }, { queueable: true, key: `evidence-${selected.trip.id}-${evidence.type}-${fileHash}` }); setEvidence((current) => ({ ...current, file: null, ref: '' })); };
  const startTrip = async () => { try { const result = await write(`/api/platform/trips/${selected.trip.id}/start`, {}, { key: `start-${selected.trip.id}` }); if (result) { setNotice(result.message); await refresh(); await openTrip({ id: selected.trip.id }); } } catch (error) { setNotice(error.message); } };
  const startGps = () => { if (!selected || selected.trip.trackingState !== 'ACTIVE') return setNotice('GPS پس از شروع رسمی سفر فعال می‌شود.'); if (!navigator.geolocation) return setNotice('GPS در دسترس نیست.'); if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); setGps('فعال'); watchRef.current = navigator.geolocation.watchPosition(async (position) => { const point = { location: { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }, speed: position.coords.speed || null, deviceTimestamp: new Date(position.timestamp).toISOString(), localSequence: Date.now(), source: 'driver_phone_gps' }; try { await write(`/api/platform/driver/trips/${selected.trip.id}/location-batch`, { points: [point] }, { queueable: true, key: `gps-${selected.trip.id}-${point.localSequence}` }); } catch (error) { setNotice(error.message); } }, () => { setGps('قطع'); setNotice('GPS قطع شد؛ وضعیت را بررسی کن.'); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }); };
  const border = async () => { const geo = await locate(); if (geo) action(`/api/platform/driver/trips/${selected.trip.id}/border-events`, { eventType: borderType, geo }, { queueable: true, key: `border-${selected.trip.id}-${borderType}-${geo.timestamp}` }); };
  const arrive = async () => { const geo = await locate(); if (geo) action(`/api/platform/driver/trips/${selected.trip.id}/destination-arrival`, { geo }, { key: `destination-${selected.trip.id}-${geo.timestamp}` }); };
  const reportIncident = async () => { const geo = await locate(); action(`/api/platform/driver/trips/${selected.trip.id}/incidents`, { ...incident, geo }, { queueable: true, key: `incident-${selected.trip.id}-${Date.now()}` }); };
  const requestOtp = async () => { try { const result = await write(`/api/platform/driver/trips/${selected.trip.id}/delivery/otp/request`, {}, { key: `otp-request-${selected.trip.id}-${Date.now()}` }); if (result) { setOtp({ challengeId: result.challengeId, code: '', devCode: result.devCode || '' }); setNotice(result.devCode ? `کد آزمایشی گیرنده: ${result.devCode}` : result.message); } } catch (error) { setNotice(error.message); } };
  const verifyOtp = async () => { try { const result = await write(`/api/platform/driver/trips/${selected.trip.id}/delivery/otp/verify`, { challengeId: otp.challengeId, code: otp.code }, { key: `otp-verify-${otp.challengeId}` }); if (result) setNotice(result.message); } catch (error) { setNotice(error.message); } };
  const submitPod = async () => { const geo = await locate(); if (!geo) return; const photos = pod.photos.split(',').map((value) => value.trim()).filter(Boolean); const evidence = { recipientOrgId: selected.authorizedAgent?.organizationId || selected.trip.authorizedAgent?.organizationId, authorityRef: pod.authorityRef, receivedAt: new Date().toISOString(), location: geo, photos, signatureRef: pod.signatureRef, stampRef: pod.stampRef, signedCmrRef: pod.signedCmrRef, warehouseReceiptRef: pod.warehouseReceiptRef, remarks: pod.remarks, otpVerified: true }; action(`/api/platform/trips/${selected.trip.id}/pod`, { evidence, otpRequired: true, otpChallengeId: otp.challengeId }, { key: `pod-${selected.trip.id}-${Date.now()}` }); };
  const submitBid = () => { if (!bid) return; const amount = Number(bidForm.amount); if (!Number.isFinite(amount) || amount < 0) return setNotice('مبلغ پیشنهاد معتبر نیست.'); const state = bidForm.submit ? 'SUBMITTED' : 'DRAFT'; action(`/api/platform/driver/opportunities/${bid.rfqId}/bid`, { yOrgId: bid.yOrgId, amount, currency: bidForm.currency || 'EUR', terms: { note: bidForm.note }, state, undertakingVersion: state === 'SUBMITTED' ? UNDERTAKING_VERSION : undefined }, { key: `bid-${bid.rfqId}-${bid.yOrgId}-${state}` }); setBid(null); };
  const saveVehicle = async (event) => { event.preventDefault(); action('/api/platform/driver/vehicles', { ...vehicle, capacity: vehicle.capacity ? Number(vehicle.capacity) : null, cargoScope: vehicle.cargoScope.split(',').map((value) => value.trim()).filter(Boolean) }, { key: `vehicle-${vehicle.plateNumber}` }); };
  const saveDocument = async (event) => { event.preventDefault(); if (!driverDoc.fileRef) return setNotice('مرجع فایل الزامی است.'); action('/api/platform/driver/documents', { ...driverDoc, fileHash: await hashValue(driverDoc.fileRef) }, { key: `document-${driverDoc.docType}-${driverDoc.fileRef}` }); };
  const updateAvailability = async (availabilityState) => {
    try {
      const result = await api('/api/platform/driver/profile', { method: 'PATCH', body: { availabilityState } }, `availability-${availabilityState}-${Date.now()}`);
      setNotice(result.message || 'وضعیت دسترسی به‌روزرسانی شد.');
      await refresh();
      if (selected) await openTrip({ id: selected.trip.id });
    } catch (error) { setNotice(error.message); }
  };
  const disputeSettlement = () => { if (!settlementIssue.id || settlementIssue.reason.trim().length < 8) return setNotice('شرح اعتراض حداقل ۸ کاراکتر باشد.'); action(`/api/platform/driver/settlements/${settlementIssue.id}/dispute`, { reason: settlementIssue.reason }, { key: `settlement-dispute-${settlementIssue.id}` }); setSettlementIssue({ id: null, reason: '' }); };
  const activeTrip = useMemo(() => trips.find((trip) => trip.trackingState === 'ACTIVE') || trips.find((trip) => ['AT_DESTINATION', 'READY_FOR_DELIVERY'].includes(trip.state)), [trips]);
  const selectDriverTab = (nextTab) => {
    closeMenu();
    setTab(nextTab);
  };

  return <div className="driver-mobile-shell" dir="rtl">
    <header className="driver-mobile-header"><div className="driver-mobile-brand"><ProductLogo subtitle="همراه عملیات راننده" /></div><div className="driver-mobile-header-actions"><span className={`driver-mobile-connect${offline ? ' is-offline' : ''}`}><i />{offline ? 'آفلاین' : 'آنلاین'}</span><PanelMenuButton open={menuOpen} onClick={toggleMenu} controls={menuId} inverse alwaysVisible /></div></header>
    <PanelSidebar open={menuOpen} onClose={closeMenu} id={menuId} className="driver-mobile-menu" title="منوی راننده" subtitle="دسترسی سریع به عملیات سفر" dark alwaysDrawer>
      <div className="driver-mobile-menu__profile"><span>راننده فعال</span><strong>{profile?.profile?.firstName || user?.firstName || 'راننده'} {profile?.profile?.lastName || user?.lastName || ''}</strong><small>{offline ? 'حالت آفلاین؛ اقدامات مجاز در صف امن می‌مانند' : 'اتصال امن به مرکز عملیات برقرار است'}</small></div>
      <nav>{DRIVER_NAV_ITEMS.map(([key, icon, label]) => <button type="button" key={key} className={tab === key ? 'is-active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => selectDriverTab(key)}><Icon name={icon} size={21} /><span>{label}</span>{key === 'opportunities' && opportunities.length > 0 ? <b>{opportunities.length.toLocaleString('fa-IR')}</b> : null}</button>)}</nav>
      <div className="driver-mobile-menu__connection"><i className={offline ? 'is-offline' : ''} /><div><strong>{offline ? 'آفلاین' : 'آنلاین و همگام'}</strong><small>GPS: {gps} · دستگاه ثبت‌شده</small></div></div>
      <button className="driver-mobile-menu__logout" type="button" onClick={onLogout}><Icon name="logout" size={19} /><span>خروج امن از حساب</span></button>
    </PanelSidebar>
    {notice && <div className="driver-mobile-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')}>×</button></div>}
    {loading && <div className="driver-mobile-loading">در حال دریافت سفرهای اختصاصی…</div>}
    <main className="driver-mobile-main">
      {tab === 'home' && <><section className="driver-mobile-welcome"><span className="platform-eyebrow">مرکز راننده</span><h1>سلام {profile?.profile?.firstName || user?.firstName || 'راننده'}</h1><p>کارهای جاده، مدارک و تحویل را با کمترین تایپ انجام بده.</p><div className="driver-mobile-status-row"><Pill value={profile?.profile?.availabilityState || 'available'} active /><span>{profile?.profile?.operationallyEligible ? 'مدارک پایه برای عملیات آماده است' : 'تکمیل KYC و مدارک لازم است'}</span></div></section><section className="driver-mobile-metrics"><Metric value={home?.metrics?.activeTrips || 0} title="سفر فعال" detail="رهگیری فقط همین سفر" /><Metric value={home?.metrics?.opportunities || 0} title="فرصت داخلی" detail="تحت پوشش شرکت Y" /><Metric value={home?.metrics?.settlements || 0} title="تسویه من" detail="رابطه Y–Driver" /></section>{activeTrip ? <button className="driver-mobile-active-card" type="button" onClick={() => openTrip(activeTrip)}><div><span className="platform-eyebrow">سفر فعال</span><strong>{activeTrip.caseNumber}</strong><small>{activeTrip.route?.origin} ← {activeTrip.route?.destination}</small></div><Pill value={activeTrip.state} active /></button> : <Empty title="سفر فعالی نداری" detail="فرصت‌های داخلی یا سفرهای اختصاص‌یافته در بخش‌های پایین نمایش داده می‌شوند." />}<section className="driver-mobile-panel"><SectionTitle eyebrow="آمادگی عملیات" title="وضعیت مدارک" /><div className="driver-mobile-check-row"><span className={profile?.profile?.kycState === 'approved' ? 'is-done' : ''}>KYC</span><span className={profile?.profile?.licenseState === 'approved' ? 'is-done' : ''}>گواهینامه</span><span className={profile?.profile?.passportState === 'approved' ? 'is-done' : ''}>گذرنامه</span><span className={profile?.profile?.driverCardState === 'approved' ? 'is-done' : ''}>کارت راننده</span></div><p className="driver-mobile-hint">نسخه جدید مدارک را از «مدارک» ثبت کن؛ تأیید نهایی سمت سرور است.</p></section></>}
      {tab === 'opportunities' && <section className="driver-mobile-page"><SectionTitle eyebrow="داخل سازمان شرکت Y" title="فرصت‌های بار" action={<button className="driver-mobile-icon-button" type="button" onClick={refresh} aria-label="به‌روزرسانی"><Icon name="refresh" size={20} /></button>} />{opportunities.length ? opportunities.map((item) => <article className="driver-mobile-opportunity" key={`${item.rfqId}-${item.yOrgId}`}><div className="driver-mobile-card-top"><Pill value={item.ownBid?.state || 'NEW'} active={Boolean(item.ownBid)} /><small>تا {dateText(item.deadlineAt)}</small></div><strong>{item.route?.origin} ← {item.route?.destination}</strong><p>{item.cargo?.type || 'محموله'} · {item.cargo?.weight || '—'} {item.cargo?.unit || ''}</p><span>شرکت Y: {item.yName}</span><div className="driver-mobile-card-actions">{item.ownBid && <b>{Number(item.ownBid.amount).toLocaleString('fa-IR')} {item.ownBid.currency}</b>}<button type="button" onClick={() => { setBid(item); setBidForm({ amount: item.ownBid?.amount || '', currency: item.ownBid?.currency || 'EUR', note: '', submit: false }); }}>ثبت پیشنهاد داخلی</button></div></article>) : <Empty title="فرصت داخلی در دسترس نیست" detail="فرصت فقط با پوشش معتبر و دعوت همان شرکت Y نمایش داده می‌شود." />}</section>}
      {tab === 'trips' && <section className="driver-mobile-page"><SectionTitle eyebrow="فقط سفرهای من" title="سفرهای اختصاص‌یافته" action={<button className="driver-mobile-icon-button" type="button" onClick={refresh} aria-label="به‌روزرسانی"><Icon name="refresh" size={20} /></button>} />{trips.length ? <div className="driver-mobile-trip-list">{trips.map((trip) => <button type="button" key={trip.id} className={`driver-mobile-trip-card${selected?.trip?.id === trip.id ? ' is-selected' : ''}`} onClick={() => openTrip(trip)}><div><strong>{trip.caseNumber}</strong><small>{trip.route?.origin} ← {trip.route?.destination}</small></div><Pill value={trip.state} active={trip.trackingState === 'ACTIVE'} /></button>)}</div> : <Empty title="سفری اختصاص نیافته است" detail="پس از معرفی معتبر شرکت Y، سفر اینجا قرار می‌گیرد." />}{selected && <TripDetail selected={selected} acceptChecked={acceptChecked} setAcceptChecked={setAcceptChecked} acceptTrip={acceptTrip} checkInReason={checkInReason} setCheckInReason={setCheckInReason} checkIn={checkIn} checks={checks} setChecks={setChecks} submitChecks={submitChecks} evidence={evidence} setEvidence={setEvidence} submitEvidence={submitEvidence} startTrip={startTrip} startGps={startGps} gps={gps} borderType={borderType} setBorderType={setBorderType} border={border} incident={incident} setIncident={setIncident} reportIncident={reportIncident} arrive={arrive} otp={otp} setOtp={setOtp} requestOtp={requestOtp} verifyOtp={verifyOtp} pod={pod} setPod={setPod} submitPod={submitPod} />}</section>}
      {tab === 'documents' && <Documents profile={profile} selected={selected} api={api} setNotice={setNotice} form={driverDoc} setForm={setDriverDoc} save={saveDocument} />}
      {tab === 'account' && <Account profile={profile} vehicle={vehicle} setVehicle={setVehicle} saveVehicle={saveVehicle} updateAvailability={updateAvailability} settlements={settlements} issue={settlementIssue} setIssue={setSettlementIssue} dispute={disputeSettlement} />}
    </main>
    <nav className="driver-mobile-nav" aria-label="ناوبری اصلی راننده"><NavButton active={tab === 'home'} onClick={() => selectDriverTab('home')} icon="home" text="خانه" /><NavButton active={tab === 'opportunities'} onClick={() => selectDriverTab('opportunities')} icon="rfq" text="پیشنهادها" badge={opportunities.length} /><NavButton active={tab === 'trips'} onClick={() => selectDriverTab('trips')} icon="route" text="سفرهای من" /><NavButton active={tab === 'documents'} onClick={() => selectDriverTab('documents')} icon="document" text="مدارک" /><NavButton active={tab === 'account'} onClick={() => selectDriverTab('account')} icon="user" text="حساب" /></nav>
    {bid && <div className="driver-mobile-modal-backdrop"><section className="driver-mobile-modal"><span className="platform-eyebrow">Bid داخلی</span><h2>پیشنهاد به {bid.yName}</h2><p>{bid.route?.origin} ← {bid.route?.destination}</p><label><span>مبلغ</span><input inputMode="decimal" value={bidForm.amount} onChange={(event) => setBidForm((current) => ({ ...current, amount: event.target.value }))} /></label><label><span>واحد</span><input value={bidForm.currency} onChange={(event) => setBidForm((current) => ({ ...current, currency: event.target.value }))} /></label><textarea value={bidForm.note} onChange={(event) => setBidForm((current) => ({ ...current, note: event.target.value }))} placeholder="یادداشت عملیاتی" /><label className="driver-mobile-check"><input type="checkbox" checked={bidForm.submit} onChange={(event) => setBidForm((current) => ({ ...current, submit: event.target.checked }))} /> ارسال نهایی با تعهدنامه</label><div className="driver-mobile-modal-actions"><button type="button" onClick={() => setBid(null)}>انصراف</button><button className="driver-mobile-primary" type="button" onClick={submitBid}>ذخیره / ارسال</button></div></section></div>}
  </div>;
}

function NavButton({ active, onClick, icon, text, badge }) { return <button className={active ? 'is-active' : ''} type="button" onClick={onClick} aria-current={active ? 'page' : undefined}><b><Icon name={icon} size={22} /></b><span>{text}</span>{badge ? <i>{badge}</i> : null}</button>; }

function TripDetail({ selected, acceptChecked, setAcceptChecked, acceptTrip, checkInReason, setCheckInReason, checkIn, checks, setChecks, submitChecks, evidence, setEvidence, submitEvidence, startTrip, startGps, gps, borderType, setBorderType, border, incident, setIncident, reportIncident, arrive, otp, setOtp, requestOtp, verifyOtp, pod, setPod, submitPod }) {
  const trip = selected.trip;
  const readiness = selected.readiness || {};
  return <article className="driver-mobile-trip-detail"><div className="driver-mobile-detail-head"><div><span className="platform-eyebrow">#{trip.caseNumber}</span><h3>{trip.route?.origin} ← {trip.route?.destination}</h3><small>{trip.cargo?.type} · {trip.cargo?.weight || '—'} {trip.cargo?.unit || ''} · {trip.yName || trip.yOrgId}</small></div><Pill value={trip.state} active={trip.trackingState === 'ACTIVE'} /></div><StatusTimeline items={[{ label: 'Nomination', detail: trip.driverAssigned ? 'راننده و خودرو معتبر' : 'در انتظار', done: trip.driverAssigned }, { label: 'Check-in', detail: readiness.preloadState || 'در انتظار', done: readiness.preloadState === 'CHECKED_IN' }, { label: 'گیت‌های حرکت', detail: 'سرور منبع حقیقت', current: trip.trackingState !== 'ACTIVE' }, { label: 'GPS', detail: trip.trackingState, done: trip.trackingState === 'ACTIVE' }, { label: 'POD', detail: selected.pod?.state || 'در انتظار' }]} />{!trip.undertakingAcceptedAt && <section className="driver-mobile-action-card"><strong>قبول سفر و تعهدنامه ۱۴ بندی</strong><div className="driver-mobile-undertaking-list">{UNDERTAKING.map((item, index) => <span key={item}><b>{index + 1}</b>{item}</span>)}</div><label className="driver-mobile-check"><input type="checkbox" checked={acceptChecked} onChange={(event) => setAcceptChecked(event.target.checked)} /> همه بندها را خواندم و می‌پذیرم</label><button className="driver-mobile-primary" type="button" onClick={acceptTrip}>قبول سفر</button></section>}{trip.loadingSchedule && <div className="driver-mobile-info"><strong>برنامه بارگیری</strong><span>{trip.loadingSchedule.checkInAt || trip.loadingSchedule.loadingWindow || 'ثبت شده'}</span><small>{trip.loadingSchedule.instructions || 'دستور عملیات در سفر موجود است.'}</small></div>}<section className="driver-mobile-action-grid"><button type="button" onClick={checkIn}>به محل رسیدم</button><button type="button" onClick={submitChecks}>ثبت چک‌لیست</button><button type="button" onClick={startGps}>GPS {gps}</button><button type="button" onClick={arrive}>رسیدن به مقصد</button></section><label className="driver-mobile-inline-input"><span>دلیل رسیدن خارج از geofence، در صورت نیاز</span><input value={checkInReason} onChange={(event) => setCheckInReason(event.target.value)} /></label><section className="driver-mobile-checklist"><h4>Preload checklist</h4>{Object.entries(checks).map(([key, value]) => <label className="driver-mobile-check" key={key}><input type="checkbox" checked={value} onChange={(event) => setChecks((current) => ({ ...current, [key]: event.target.checked }))} /> {key}</label>)}</section><section className="driver-mobile-form"><h4>شاهد بارگیری immutable</h4><select value={evidence.type} onChange={(event) => setEvidence((current) => ({ ...current, type: event.target.value }))}>{['LOADING_PHOTO', 'LOADING_LIST', 'SCALE_TICKET', 'SEAL', 'INCIDENT'].map((item) => <option key={item}>{item}</option>)}</select><input type="file" accept="image/*,.pdf" onChange={(event) => setEvidence((current) => ({ ...current, file: event.target.files?.[0] || null }))} /><input value={evidence.ref} onChange={(event) => setEvidence((current) => ({ ...current, ref: event.target.value }))} placeholder="یا مرجع عکس / فایل" /><button className="driver-mobile-primary" type="button" onClick={submitEvidence}>ثبت شاهد</button></section><section className="driver-mobile-action-card"><h4>گیت شروع سفر</h4><div className="driver-mobile-gates"><span className={readiness.customsReady ? 'is-done' : ''}>گمرک</span><span className={readiness.routePermitReady ? 'is-done' : ''}>مجوز مسیر</span><span className={readiness.documentsReady ? 'is-done' : ''}>اسناد</span><span className={readiness.vehicleReady ? 'is-done' : ''}>خودرو</span><span className={readiness.driverReady ? 'is-done' : ''}>راننده</span></div><button className="driver-mobile-primary" type="button" onClick={startTrip}>شروع سفر پس از آمادگی</button><small>Hard Gate سمت سرور قابل دورزدن نیست.</small></section><section className="driver-mobile-form"><h4>رویداد مرز / گمرک</h4><select value={borderType} onChange={(event) => setBorderType(event.target.value)}>{Object.entries(BORDER_EVENTS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select><button className="driver-mobile-secondary" type="button" onClick={border}>ثبت رویداد مرزی</button></section><section className="driver-mobile-form"><h4>حادثه / خرابی</h4><select value={incident.incidentType} onChange={(event) => setIncident((current) => ({ ...current, incidentType: event.target.value }))}>{INCIDENTS.map((item) => <option key={item}>{item}</option>)}</select><select value={incident.severity} onChange={(event) => setIncident((current) => ({ ...current, severity: event.target.value }))}>{['medium', 'high', 'critical'].map((item) => <option key={item}>{item}</option>)}</select><textarea value={incident.reason} onChange={(event) => setIncident((current) => ({ ...current, reason: event.target.value }))} placeholder="شرح حادثه و اقدام" /><button className="driver-mobile-danger" type="button" onClick={reportIncident}>اعلام حادثه</button></section><section className="driver-mobile-form"><h4>تحویل به Agent / Consignee مجاز</h4><p className="driver-mobile-hint">گیرنده: {selected.authorizedAgent?.name || trip.authorizedAgent?.name || 'تعیین نشده'}</p><input value={pod.authorityRef} onChange={(event) => setPod((current) => ({ ...current, authorityRef: event.target.value }))} placeholder="مرجع اختیار" /><input value={pod.signatureRef} onChange={(event) => setPod((current) => ({ ...current, signatureRef: event.target.value }))} placeholder="مرجع امضا" /><input value={pod.stampRef} onChange={(event) => setPod((current) => ({ ...current, stampRef: event.target.value }))} placeholder="مرجع مهر" /><input value={pod.photos} onChange={(event) => setPod((current) => ({ ...current, photos: event.target.value }))} placeholder="مرجع عکس‌ها با کاما" /><input value={pod.signedCmrRef} onChange={(event) => setPod((current) => ({ ...current, signedCmrRef: event.target.value }))} placeholder="CMR رسیدشده / Box 24" /><input value={pod.warehouseReceiptRef} onChange={(event) => setPod((current) => ({ ...current, warehouseReceiptRef: event.target.value }))} placeholder="رسید انبار / تخلیه" /><button className="driver-mobile-secondary" type="button" onClick={requestOtp}>درخواست OTP گیرنده</button>{otp.challengeId && <div className="driver-mobile-otp"><small>چالش {otp.challengeId.slice(0, 12)}… {otp.devCode ? `کد آزمایشی ${otp.devCode}` : ''}</small><input inputMode="numeric" value={otp.code} onChange={(event) => setOtp((current) => ({ ...current, code: event.target.value }))} placeholder="کد ۶ رقمی" /><button type="button" onClick={verifyOtp}>تأیید OTP</button></div>}<textarea value={pod.remarks} onChange={(event) => setPod((current) => ({ ...current, remarks: event.target.value }))} placeholder="رزرو / توضیح تحویل" /><button className="driver-mobile-primary" type="button" onClick={submitPod}>ارسال POD برای بررسی X</button></section>{selected.documents?.length ? <section><h4>اسناد سفر</h4>{selected.documents.map((document) => <DocCard key={document.id} document={document} />)}</section> : null}<EvidenceGallery evidence={(selected.events || []).slice(0, 8).map((event) => ({ type: event.type, label: dateText(event.createdAt) }))} /></article>;
}

function Documents({ profile, selected, api, setNotice, form, setForm, save }) {
  return <section className="driver-mobile-page"><SectionTitle eyebrow="نسخه‌گذاری و قفل" title="مدارک من" /><form className="driver-mobile-form" onSubmit={save}><select value={form.docType} onChange={(event) => setForm((current) => ({ ...current, docType: event.target.value }))}>{['DRIVER_LICENSE', 'DRIVER_CARD', 'PASSPORT', 'INTERNATIONAL_TRAVEL_DOC', 'IDENTITY', 'SELFIE', 'VEHICLE_TECHNICAL', 'VEHICLE_INSURANCE'].map((item) => <option key={item}>{item}</option>)}</select><input value={form.fileRef} onChange={(event) => setForm((current) => ({ ...current, fileRef: event.target.value }))} placeholder="نام عکس / مرجع فایل" /><input type="date" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} /><button className="driver-mobile-primary" type="submit">ثبت نسخه جدید</button></form><div className="driver-mobile-doc-list">{profile?.documents?.length ? profile.documents.map((document) => <DocCard key={document.id} document={document} />) : <Empty title="مدرکی ثبت نشده است" detail="نسخه جدید مدرک را ثبت کن." />}</div>{selected?.documents?.length ? <><SectionTitle eyebrow="Travel required" title="اسناد سفر" />{selected.documents.map((document) => <DocCard key={document.id} document={document} onOpen={async () => { try { const result = await api(`/api/platform/documents/${document.id}/download`); setNotice(result.message || `مرجع سند: ${result.fileRef || 'ثبت شد'}`); } catch (error) { setNotice(error.message); } }} />)}</> : null}</section>;
}

function Account({ profile, vehicle, setVehicle, saveVehicle, updateAvailability, settlements, issue, setIssue, dispute }) {
  return <section className="driver-mobile-page"><SectionTitle eyebrow="امنیت و همکاری" title="حساب راننده" /><article className="driver-mobile-profile-card"><strong>{profile?.profile?.firstName} {profile?.profile?.lastName}</strong><span>{profile?.profile?.phone || '—'}</span><small>دستگاه متصل · Device Binding · نشست کوتاه‌عمر</small></article><div className="driver-mobile-availability"><span>وضعیت دسترسی</span><div><button type="button" onClick={() => updateAvailability('available')}>آزاد</button><button type="button" onClick={() => updateAvailability('inactive')}>غیرفعال</button></div></div><SectionTitle eyebrow="Truck / Trailer" title="وسیله من" /><form className="driver-mobile-form" onSubmit={saveVehicle}><input required value={vehicle.plateNumber} onChange={(event) => setVehicle((current) => ({ ...current, plateNumber: event.target.value }))} placeholder="پلاک / پلاک ترانزیت" /><input value={vehicle.vehicleType} onChange={(event) => setVehicle((current) => ({ ...current, vehicleType: event.target.value }))} placeholder="نوع خودرو" /><input inputMode="decimal" value={vehicle.capacity} onChange={(event) => setVehicle((current) => ({ ...current, capacity: event.target.value }))} placeholder="ظرفیت" /><input value={vehicle.cargoScope} onChange={(event) => setVehicle((current) => ({ ...current, cargoScope: event.target.value }))} placeholder="دامنه کالا با کاما" /><label className="driver-mobile-check"><input type="checkbox" checked={vehicle.reeferCapable} onChange={(event) => setVehicle((current) => ({ ...current, reeferCapable: event.target.checked }))} /> یخچالی / ویژه</label><button className="driver-mobile-primary" type="submit">ثبت وسیله</button></form><div className="driver-mobile-vehicle-grid">{profile?.vehicles?.map((item) => <article key={item.id}><strong>{item.plateNumber}</strong><span>{item.vehicleType || 'خودرو'} · {item.capacity || '—'}</span><small>{item.availabilityState}</small></article>)}</div><SectionTitle eyebrow="رابطه مالی محدود" title="تسویه من" />{settlements.length ? settlements.map((item) => <article className="driver-mobile-settlement" key={item.id}><div><strong>{item.caseNumber || `#${item.caseId}`}</strong><small>{item.state} · {item.counterpartyOrgId}</small></div><b>{Number(item.amount).toLocaleString('fa-IR')} {item.currency}</b>{item.state === 'SETTLEMENT_PENDING' && <button type="button" onClick={() => setIssue({ id: item.id, reason: '' })}>اعتراض</button>}</article>) : <Empty title="تسویه‌ای ثبت نشده است" detail="این صفحه فقط رابطه Y-Driver را نشان می‌دهد." />}{issue.id && <div className="driver-mobile-inline-form"><textarea value={issue.reason} onChange={(event) => setIssue((current) => ({ ...current, reason: event.target.value }))} placeholder="شرح اعتراض" /><button className="driver-mobile-primary" type="button" onClick={dispute}>ثبت اعتراض</button></div>}<MoneyBreakdown items={[]} /></section>;
}
