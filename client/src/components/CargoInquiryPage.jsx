import { useEffect, useMemo, useState } from 'react';
import { Icon, ProductLogo } from './ProductIcon.jsx';

const STORAGE_KEY = 'gomrok-cargo-inquiry-draft-v2';
const LEGACY_STORAGE_KEY = 'gomrok-cargo-inquiry-draft-v1';
const IDEMPOTENCY_KEY = 'gomrok-cargo-inquiry-idempotency-v2';
const continuationPrefix = 'gomrok-cargo-continuation:';

const STAGES = [
  ['مسیر و محل‌ها', 'مبدأ، مقصد و دامنه حمل'],
  ['زمان‌بندی', 'آمادگی بار و مهلت دریافت پیشنهاد'],
  ['شناخت بار', 'نوع، وضعیت و شرح قابل نمایش'],
  ['بسته‌بندی و اندازه‌گیری', 'واحدها، وزن، حجم و ابعاد'],
  ['خودرو و تجهیزات', 'نوع ناوگان و ظرفیت موردنیاز'],
  ['شرایط ویژه', 'ریسک‌ها و الزامات مشروط بار'],
  ['خدمات محل', 'بارگیری، تخلیه و خدمات تکمیلی'],
  ['مدارک و تماس', 'اسناد، پرداخت‌کننده و راه ارتباطی'],
  ['بازبینی و ارسال', 'رضایت‌ها و انتخاب مسیر استعلام']
];

const specialOptions = [
  ['fragile', 'شکستنی'],
  ['temperature_controlled', 'دماکنترل / زنجیره سرد'],
  ['perishable', 'فسادپذیر'],
  ['pharmaceutical', 'دارویی / زیستی'],
  ['valuable', 'ارزشمند'],
  ['dangerous', 'خطرناک / شیمیایی'],
  ['oversized', 'سنگین یا ابعادی'],
  ['liquid', 'مایع'],
  ['live_animal', 'حیوان زنده'],
  ['confidential', 'محرمانه'],
  ['unknown', 'اطمینان ندارم'],
  ['none', 'ویژگی ویژه ندارد']
];

function emptyStop(operation, placeType = 'warehouse') {
  return { operation, country: 'ایران', province: '', city: '', district: '', placeType, address: '', postalCode: '', appointment: 'unknown', receivingHours: '', loadingMethod: 'unknown', availableEquipment: [], labor: 'unknown', operationMinutes: '', accessRestrictions: '', contactName: '', contactPhone: '', coordinationNote: '' };
}

function initialForm() {
  return {
    formVersion: 'v2',
    requester: { kind: 'person', name: '', mobile: '', companyName: '', capacity: '', email: '', alternatePhone: '', preferredNotification: 'sms', allowPhone: true, allowSms: true },
    contact: { channel: 'sms', timeWindow: '', mobileVerified: false },
    route: { scope: 'domestic', routeType: 'intercity', sameLocationMode: '', estimatedDistanceKm: '', extraStops: [] },
    stops: [emptyStop('pickup', 'warehouse'), emptyStop('delivery', 'warehouse')],
    schedule: { readyStatus: 'ready', pickupFrom: '', pickupTo: '', deliveryFrom: '', deliveryTo: '', deliveryDeadline: '', scheduleType: 'one_time', futureDateAllowed: false, deliveryAppointment: false, loadingMinutes: '', unloadingMinutes: '', expirySensitive: false, urgency: 'normal', flexibility: 'unknown', quoteDeadline: '', timezone: 'Asia/Tehran' },
    cargo: {
      title: '', category: 'industrial', cargoType: '', brandModel: '', description: '', descriptionPublic: '', descriptionPrivate: '', condition: 'new', readyForLoading: true, assemblyRequired: false, count: '', unitType: 'piece', loadMode: 'full_truck', measurementStatus: 'measured', packagingStatus: 'ready', totalGrossWeight: '', weightUnit: 'kg', netWeight: '', packagingWeight: '', isWeightEstimated: false, officialWeighing: false, concentrated: false, unbalanced: false, totalVolume: '', volumeUnit: 'm3', largestUnitWeight: '', divisibility: 'unknown', mixAllowed: 'unknown', packaging: { type: 'pallet', stackable: false, waterproof: false, sealed: false, packedBy: '', inspectionRequired: false }, specialFlags: [], notesForDriver: '', temperature: { minC: '', maxC: '', setpointC: '', rangeSource: '', pickupCondition: '', preconditionRequired: '' }, specialRequirements: { high_value: { declaredValue: '', currency: 'IRR', basis: '', insuranceRequired: false, trackingRequired: false, directTransport: false, identityCheck: false, photoRequired: false }, fragile: { itemType: '', sensitivity: '', packaged: false, stackable: false, rotatable: false, shockProhibited: false, coverRequired: false, impactSensorRequired: false, deliveryAcceptance: '' }, hazardous: { materialName: '', technicalName: '', unNumber: '', hazardClass: '', subsidiaryRisk: '', packingGroup: '', physicalState: '', amount: '', amountUnit: '', packagingType: '', packagingSafe: false, labelsPresent: false, emergencyPhone: '', routeRestrictions: '', specializedVehicle: false, qualifiedDriver: false, noMixing: false, incidentInstruction: '' }, oversized: { pieceWeight: '', finalHeightCm: '', centerOfGravity: '', loadingMethod: '', unloadingMethod: '', originCrane: false, destinationCrane: false, permitRequired: false, escortRequired: false, routeSurveyRequired: false, splitLoads: false }, liquid: { liquidType: '', flammable: false, corrosive: false, volume: '', weight: '', containerType: '', containerCount: '', sealing: '', leakageRisk: '', dedicatedTank: false, compatibleContainer: false }, live_animal: { animalType: '', count: '', weight: '', enclosure: '', ventilation: false, foodWater: false, healthDocuments: false, temperature: '', handover: '' } }
    },
    handlingUnits: [{ description: '', packagingType: 'pallet', quantity: 1, weightBasis: 'per_unit', grossWeight: '', netWeight: '', weightUnit: 'kg', volume: '', volumeUnit: 'm3', length: '', width: '', height: '', dimensionUnit: 'm', stackability: 'unknown', maxStackLayers: '', orientation: 'free', rotatable: false, nonStandardShape: false, overhangAllowed: false }],
    vehicle: { preferenceMode: 'known', class: 'truck', body: 'covered', types: [], count: 1, requiredPayload: '', requiredEquipment: [], vehicleId: '' },
    services: { origin: {}, destination: {}, responsibilities: { origin: 'requester', destination: 'requester' }, helpers: { originCount: 0, destinationCount: 0, originMinutes: '', destinationMinutes: '' }, requested: [] },
    documents: [],
    payer: { type: 'requester', name: '', mobile: '', organizationId: '' },
    value: { amount: '', amountMinor: '', currency: 'IRR', budgetAmount: '', budgetCurrency: 'IRR', insuranceRequested: false },
    consent: { shareWithDrivers: false, dataAccuracy: false, prohibitedGoods: false, contractNotFinal: false, priceMayChange: false, contactPermission: true }
  };
}

function mergeDraft(base, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value === undefined ? base : value;
  return Object.keys(base).reduce((result, key) => ({ ...result, [key]: mergeDraft(base[key], value[key]) }), { ...base });
}

function loadDraft() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
    return parsed ? mergeDraft(initialForm(), parsed) : initialForm();
  } catch (_error) {
    return initialForm();
  }
}

function stableId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function updateAt(object, path, value) {
  const next = globalThis.structuredClone ? structuredClone(object) : JSON.parse(JSON.stringify(object));
  let cursor = next;
  path.slice(0, -1).forEach((key) => { cursor = cursor[key]; });
  cursor[path[path.length - 1]] = value;
  return next;
}

function withExplicitTimezone(form) {
  const payload = globalThis.structuredClone ? structuredClone(form) : JSON.parse(JSON.stringify(form));
  const timezone = payload.schedule?.timezone || 'Asia/Tehran';
  const offset = timezone === 'UTC' ? 'Z' : '+03:30';
  ['pickupFrom', 'pickupTo', 'deliveryFrom', 'deliveryTo', 'deliveryDeadline', 'quoteDeadline'].forEach((key) => {
    const value = payload.schedule?.[key];
    if (value && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
      const localValue = value.length === 16 ? `${value}:00` : value;
      payload.schedule[key] = `${localValue}${offset}`;
    }
  });
  payload.schedule.timezone = timezone;
  payload.stops = payload.stops.map((stop, index) => ({ ...stop, sequence: index + 1 }));
  payload.route.extraStops = [];
  return payload;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cargoSummary(form) {
  const explicitWeight = form.cargo.totalGrossWeight === '' ? null : numeric(form.cargo.totalGrossWeight) * (form.cargo.weightUnit === 'ton' ? 1000 : 1);
  const weight = explicitWeight ?? form.handlingUnits.reduce((total, unit) => total + (unit.weightBasis === 'total_row' ? numeric(unit.grossWeight) : numeric(unit.grossWeight) * Math.max(1, numeric(unit.quantity))), 0);
  const explicitVolume = form.cargo.totalVolume === '' ? null : numeric(form.cargo.totalVolume) * (form.cargo.volumeUnit === 'l' ? .001 : 1);
  const volume = explicitVolume ?? form.handlingUnits.reduce((total, unit) => total + (numeric(unit.volume) || numeric(unit.length) * numeric(unit.width) * numeric(unit.height) * (unit.dimensionUnit === 'cm' ? .000001 : 1)) * Math.max(1, numeric(unit.quantity)), 0);
  return { weight, volume };
}

function Field({ label, value, onChange, ...props }) {
  return <label className="inquiry-field"><span>{label}</span><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}

function TextAreaField({ label, value, onChange, ...props }) {
  return <label className="inquiry-field inquiry-field--wide"><span>{label}</span><textarea value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}

function SelectField({ label, value, onChange, children }) {
  return <label className="inquiry-field"><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function CheckField({ checked, label, onChange, className = '' }) {
  return <label className={`inquiry-check ${className}`}><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function Section({ number: sectionNumber, title, description, children }) {
  return <section className="inquiry-section"><div className="inquiry-section__heading"><b>{sectionNumber}</b><div><h2>{title}</h2>{description && <p>{description}</p>}</div></div>{children}</section>;
}

function stopTitle(stop, index) {
  if (index === 0) return 'مبدأ بارگیری';
  if (index === 1) return 'مقصد تخلیه';
  return `توقف میانی ${index - 1}`;
}

function formatList(values) {
  return values?.length ? values.join('، ') : 'ثبت نشده';
}

export default function CargoInquiryPage({ apiUrl }) {
  const [form, setForm] = useState(loadDraft);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [saved, setSaved] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [submissionKey] = useState(() => {
    try { return localStorage.getItem(IDEMPOTENCY_KEY) || stableId('form'); } catch (_error) { return stableId('form'); }
  });
  const summary = useMemo(() => cargoSummary(form), [form]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
      localStorage.setItem(IDEMPOTENCY_KEY, submissionKey);
      setSaved(true);
      const timer = window.setTimeout(() => setSaved(false), 1600);
      return () => window.clearTimeout(timer);
    } catch (_error) {
      return undefined;
    }
  }, [form, submissionKey]);

  const set = (path, value) => setForm((current) => updateAt(current, path, value));
  const setStop = (index, key, value) => set(['stops', index, key], value);
  const setUnit = (index, key, value) => set(['handlingUnits', index, key], value);
  const toggleFlag = (flag) => setForm((current) => {
    const currentFlags = current.cargo.specialFlags || [];
    const next = flag === 'none'
      ? (currentFlags.includes('none') ? [] : ['none'])
      : (currentFlags.includes(flag) ? currentFlags.filter((item) => item !== flag) : [...currentFlags.filter((item) => item !== 'none'), flag]);
    return { ...current, cargo: { ...current.cargo, specialFlags: next } };
  });

  function validateStep(currentStep) {
    const errors = [];
    if (currentStep === 0) {
      if (!form.stops[0]?.city) errors.push('شهر مبدأ را وارد کنید.');
      if (!form.stops[1]?.city) errors.push('شهر مقصد را وارد کنید.');
    }
    if (currentStep === 1 && !form.schedule.quoteDeadline) errors.push('مهلت دریافت پیشنهاد را مشخص کنید.');
    if (currentStep === 2 && (!form.cargo.title || !(form.cargo.descriptionPublic || form.cargo.description))) errors.push('عنوان و شرح قابل فهم بار لازم است.');
    if (currentStep === 7 && (!form.requester.name || !form.requester.mobile)) errors.push('نام و شماره موبایل برای پیگیری لازم است.');
    return errors;
  }

  const goNext = () => {
    const errors = validateStep(step);
    if (errors.length) { setNotice({ tone: 'error', message: errors.join(' ') }); return; }
    setNotice(null); setStep((current) => Math.min(STAGES.length - 1, current + 1));
  };

  async function submit(path, body, scope) {
    const response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `cargo-${scope}-${submissionKey}` }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = result.details?.errors || result.details?.missing || [];
      const detailText = details.length ? ` موارد: ${details.map((item) => item.field || item).join('، ')}` : '';
      const error = new Error(`${result.detail || result.message || 'ثبت استعلام انجام نشد.'}${detailText}`);
      error.details = result.details;
      throw error;
    }
    return result;
  }

  const submitSupport = async () => {
    setBusy(true); setNotice(null);
    try {
      const result = await submit('/api/cargo-inquiries/support', withExplicitTimezone(form), 'support');
      setReceipt({ mode: 'support', ...result });
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(IDEMPOTENCY_KEY);
    } catch (error) {
      setNotice({ tone: 'error', message: error.message });
    } finally { setBusy(false); }
  };

  const submitAutomatic = async () => {
    setBusy(true); setNotice(null);
    try {
      const result = await submit('/api/cargo-inquiries/drafts', withExplicitTimezone(form), 'automatic');
      if (!result.continuationToken) throw new Error('پیش‌نویس ذخیره شد اما مجوز ادامه از پاسخ سرور دریافت نشد؛ دوباره تلاش کنید.');
      const handoffKey = stableId('handoff');
      localStorage.setItem(continuationPrefix + handoffKey, JSON.stringify({ publicId: result.inquiry.publicId, continuationToken: result.continuationToken }));
      setReceipt({ mode: 'automatic', ...result, continuationKey: handoffKey });
      const target = `/app/shipper?continuationKey=${encodeURIComponent(handoffKey)}`;
      const tab = window.open(target, '_blank', 'noopener,noreferrer');
      if (!tab) setNotice({ tone: 'info', message: 'تب ورود توسط مرورگر مسدود شد. از دکمه «ورود و ادامه استعلام» استفاده کنید.' });
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(IDEMPOTENCY_KEY);
    } catch (error) {
      setNotice({ tone: 'error', message: error.message });
    } finally { setBusy(false); }
  };

  if (receipt) {
    return <div className="inquiry-page" dir="rtl"><header className="inquiry-header"><ProductLogo subtitle="استعلام قیمت حمل بار" /><a href="/app">بازگشت به سامانه</a></header><main className="inquiry-receipt"><div className="inquiry-receipt__icon"><Icon name="check" size={30} /></div><span className="inquiry-eyebrow">ثبت شد</span><h1>{receipt.mode === 'support' ? 'درخواست به صف پشتیبانی رفت' : 'پیش‌نویس امن شما ذخیره شد'}</h1><p>{receipt.mode === 'support' ? 'کارشناسان پس از بررسی اطلاعات، قیمت‌ها و شرایط را از کانال انتخابی اعلام می‌کنند. این پاسخ نرخ تضمینی یا قرارداد نهایی نیست.' : 'برای دریافت پیشنهاد از رانندگان، وارد پنل صاحب بار شو تا همین پیش‌نویس به حساب صحیح متصل شود.'}</p><div className="inquiry-receipt__code"><span>کد پیگیری</span><strong>{receipt.trackingCode || receipt.inquiry?.trackingCode || receipt.inquiry?.publicReference || receipt.inquiry?.publicId}</strong></div>{receipt.mode === 'automatic' && <a className="inquiry-button inquiry-button--primary" href={`/app/shipper?continuationKey=${encodeURIComponent(receipt.continuationKey)}`}>ورود و ادامه استعلام</a>}<a className="inquiry-button" href="/app/quote">ثبت استعلام جدید</a></main></div>;
  }

  const renderStep = () => {
    if (step === 0) return <Section number="۰۱" title="مسیر و محل‌های عملیات" description="برای تطبیق اولیه شهر، نوع محل و دامنه حمل کافی است؛ آدرس دقیق فقط در صورت نیاز و با دسترسی مجاز استفاده می‌شود."><div className="inquiry-grid"><SelectField label="دامنه حمل" value={form.route.scope} onChange={(value) => set(['route', 'scope'], value)}><option value="domestic">داخلی</option><option value="import">وارداتی</option><option value="export">صادراتی</option><option value="transit">ترانزیت</option></SelectField><SelectField label="نوع مسیر" value={form.route.routeType} onChange={(value) => set(['route', 'routeType'], value)}><option value="intercity">بین‌شهری</option><option value="urban">شهری</option><option value="multi_stop">چندتوقفه</option><option value="round_trip">رفت‌وبرگشت</option><option value="international">بین‌المللی</option></SelectField><Field label="مسافت برآوردی (کیلومتر، اختیاری)" value={form.route.estimatedDistanceKm} onChange={(value) => set(['route', 'estimatedDistanceKm'], value)} type="number" min="0" /></div><div className="inquiry-stop-grid">{form.stops.map((stop, index) => <article className="inquiry-stop" key={`${stop.operation}-${index}`}><strong>{stopTitle(stop, index)}</strong><div className="inquiry-grid"><Field label="کشور" value={stop.country} onChange={(value) => setStop(index, 'country', value)} required /><Field label="استان" value={stop.province} onChange={(value) => setStop(index, 'province', value)} /><Field label="شهر" value={stop.city} onChange={(value) => setStop(index, 'city', value)} required /><Field label="محدوده / شهرک" value={stop.district} onChange={(value) => setStop(index, 'district', value)} /><SelectField label="نوع محل" value={stop.placeType} onChange={(value) => setStop(index, 'placeType', value)}><option value="warehouse">انبار</option><option value="factory">کارخانه</option><option value="customs">گمرک</option><option value="port">بندر</option><option value="store">فروشگاه</option><option value="construction">پروژه / کارگاه</option><option value="other">سایر</option></SelectField><SelectField label="نحوه هماهنگی" value={stop.appointment} onChange={(value) => setStop(index, 'appointment', value)}><option value="unknown">نیازمند هماهنگی</option><option value="required">وقت قبلی الزامی</option><option value="not_required">بدون وقت قبلی</option></SelectField></div><TextAreaField label="نشانی یا توضیح دسترسی (اختیاری)" value={stop.address} onChange={(value) => setStop(index, 'address', value)} rows="2" placeholder="در استعلام رانندگان منتشر نمی‌شود" /></article>)}</div><div className="inquiry-inline-actions"><button type="button" className="inquiry-link-button" onClick={() => setForm((current) => ({ ...current, route: { ...current.route, routeType: 'multi_stop' }, stops: [...current.stops, emptyStop('intermediate', 'warehouse')] }))}>+ افزودن توقف میانی</button>{form.stops.length > 2 && <button type="button" className="inquiry-link-button inquiry-link-button--danger" onClick={() => setForm((current) => ({ ...current, stops: current.stops.slice(0, -1) }))}>حذف آخرین توقف</button>}</div></Section>;
    if (step === 1) return <Section number="۰۲" title="زمان‌بندی و آمادگی بار" description="زمان‌ها با منطقه زمانی انتخاب‌شده ثبت می‌شوند. مهلت پیشنهاد باید پیش از شروع بارگیری باشد."><div className="inquiry-grid"><SelectField label="وضعیت آمادگی بار" value={form.schedule.readyStatus} onChange={(value) => set(['schedule', 'readyStatus'], value)}><option value="ready">آماده بارگیری</option><option value="ready_on_date">آماده در تاریخ مشخص</option><option value="not_ready">هنوز آماده نیست</option><option value="unknown">نامشخص؛ نیازمند راهنمایی</option></SelectField><SelectField label="فوریت" value={form.schedule.urgency} onChange={(value) => set(['schedule', 'urgency'], value)}><option value="normal">عادی</option><option value="today">امروز</option><option value="urgent">فوری</option><option value="scheduled">زمان‌بندی‌شده</option></SelectField><Field label="شروع بازه بارگیری" value={form.schedule.pickupFrom} onChange={(value) => set(['schedule', 'pickupFrom'], value)} type="datetime-local" required /><Field label="پایان بازه بارگیری" value={form.schedule.pickupTo} onChange={(value) => set(['schedule', 'pickupTo'], value)} type="datetime-local" /><Field label="شروع بازه تحویل" value={form.schedule.deliveryFrom} onChange={(value) => set(['schedule', 'deliveryFrom'], value)} type="datetime-local" /><Field label="آخرین مهلت تحویل" value={form.schedule.deliveryDeadline} onChange={(value) => set(['schedule', 'deliveryDeadline'], value)} type="datetime-local" /><Field label="مهلت دریافت پیشنهاد" value={form.schedule.quoteDeadline} onChange={(value) => set(['schedule', 'quoteDeadline'], value)} type="datetime-local" required /><SelectField label="منطقه زمانی" value={form.schedule.timezone} onChange={(value) => set(['schedule', 'timezone'], value)}><option value="Asia/Tehran">ایران (Asia/Tehran)</option><option value="UTC">UTC</option></SelectField></div><div className="inquiry-grid inquiry-conditional"><Field label="زمان بارگیری تقریبی (دقیقه)" value={form.schedule.loadingMinutes} onChange={(value) => set(['schedule', 'loadingMinutes'], value)} type="number" min="0" /><Field label="زمان تخلیه تقریبی (دقیقه)" value={form.schedule.unloadingMinutes} onChange={(value) => set(['schedule', 'unloadingMinutes'], value)} type="number" min="0" /><SelectField label="انعطاف زمانی" value={form.schedule.flexibility} onChange={(value) => set(['schedule', 'flexibility'], value)}><option value="unknown">نامشخص</option><option value="fixed">کاملاً ثابت</option><option value="flexible">قابل انعطاف</option></SelectField><CheckField checked={form.schedule.expirySensitive} label="بار تاریخ‌مصرف یا حساسیت زمانی دارد" onChange={(value) => set(['schedule', 'expirySensitive'], value)} /></div></Section>;
    if (step === 2) return <Section number="۰۳" title="شناخت عمومی بار" description="شرح عمومی برای تطبیق راننده استفاده می‌شود؛ اطلاعات محرمانه، ارزش و نشانی دقیق در این بخش وارد نشود."><div className="inquiry-grid"><Field label="عنوان کوتاه بار" value={form.cargo.title} onChange={(value) => set(['cargo', 'title'], value)} placeholder="مثلاً قطعات صنعتی بسته‌بندی‌شده" required /><Field label="نوع / گروه کالا" value={form.cargo.cargoType} onChange={(value) => set(['cargo', 'cargoType'], value)} placeholder="مثلاً ماشین‌آلات، مواد غذایی" required /><SelectField label="دسته کالا" value={form.cargo.category} onChange={(value) => set(['cargo', 'category'], value)}><option value="industrial">صنعتی</option><option value="food">خوراکی</option><option value="agricultural">کشاورزی</option><option value="pharmaceutical">دارویی / بهداشتی</option><option value="chemical">شیمیایی</option><option value="construction">ساختمانی</option><option value="other">سایر</option></SelectField><Field label="برند / مدل (اختیاری)" value={form.cargo.brandModel} onChange={(value) => set(['cargo', 'brandModel'], value)} /><SelectField label="وضعیت کالا" value={form.cargo.condition} onChange={(value) => set(['cargo', 'condition'], value)}><option value="new">نو</option><option value="used">کارکرده</option><option value="refurbished">بازسازی‌شده</option><option value="perishable">فسادپذیر</option><option value="unknown">نامشخص</option></SelectField><SelectField label="شیوه حمل" value={form.cargo.loadMode} onChange={(value) => set(['cargo', 'loadMode'], value)}><option value="full_truck">دربست</option><option value="part_load">خرده‌بار</option><option value="guidance">نیازمند راهنمایی</option></SelectField></div><TextAreaField label="شرح عمومی بار" value={form.cargo.descriptionPublic || form.cargo.description} onChange={(value) => setForm((current) => ({ ...current, cargo: { ...current.cargo, descriptionPublic: value, description: value } }))} placeholder="آنچه راننده برای تشخیص نوع عملیات لازم است بداند" rows="4" required /><TextAreaField label="توضیح خصوصی برای پشتیبانی (اختیاری)" value={form.cargo.descriptionPrivate} onChange={(value) => set(['cargo', 'descriptionPrivate'], value)} placeholder="در نمایش رانندگان قرار نمی‌گیرد" rows="3" /><div className="inquiry-grid"><CheckField checked={form.cargo.readyForLoading} label="بار از نظر آماده‌سازی عملیاتی آماده است" onChange={(value) => set(['cargo', 'readyForLoading'], value)} /><CheckField checked={form.cargo.assemblyRequired} label="مونتاژ یا دمونتاژ موردنیاز است" onChange={(value) => set(['cargo', 'assemblyRequired'], value)} /></div></Section>;
    if (step === 3) return <Section number="۰۴" title="بسته‌بندی، وزن، حجم و ابعاد" description="وزن هر واحد با وزن کل ردیف جداست. اگر وزن یا ابعاد تقریبی است، آن را صریحاً علامت بزنید."><div className="inquiry-grid"><Field label="وزن ناخالص کل" value={form.cargo.totalGrossWeight} onChange={(value) => set(['cargo', 'totalGrossWeight'], value)} type="number" min="0" step="any" /><SelectField label="واحد وزن کل" value={form.cargo.weightUnit} onChange={(value) => set(['cargo', 'weightUnit'], value)}><option value="kg">کیلوگرم</option><option value="ton">تن متریک</option></SelectField><Field label="حجم کل (اختیاری)" value={form.cargo.totalVolume} onChange={(value) => set(['cargo', 'totalVolume'], value)} type="number" min="0" step="any" /><SelectField label="واحد حجم" value={form.cargo.volumeUnit} onChange={(value) => set(['cargo', 'volumeUnit'], value)}><option value="m3">مترمکعب</option><option value="l">لیتر</option></SelectField><Field label="وزن خالص کل (اختیاری)" value={form.cargo.netWeight} onChange={(value) => set(['cargo', 'netWeight'], value)} type="number" min="0" step="any" /><SelectField label="وضعیت اندازه‌گیری" value={form.cargo.measurementStatus} onChange={(value) => set(['cargo', 'measurementStatus'], value)}><option value="measured">اندازه‌گیری‌شده</option><option value="estimated">تخمینی</option><option value="unknown">نامشخص</option></SelectField></div><div className="inquiry-units">{form.handlingUnits.map((unit, index) => <article className="inquiry-unit" key={index}><div className="inquiry-unit__heading"><strong>واحد حمل {index + 1}</strong>{form.handlingUnits.length > 1 && <button type="button" onClick={() => setForm((current) => ({ ...current, handlingUnits: current.handlingUnits.filter((_, unitIndex) => unitIndex !== index) }))}>حذف ردیف</button>}</div><div className="inquiry-grid"><Field label="شرح واحد" value={unit.description} onChange={(value) => setUnit(index, 'description', value)} /><SelectField label="نوع بسته‌بندی" value={unit.packagingType} onChange={(value) => setUnit(index, 'packagingType', value)}><option value="pallet">پالت</option><option value="carton">کارتن</option><option value="crate">صندوق</option><option value="bag">کیسه</option><option value="roll">رول</option><option value="other">سایر</option></SelectField><Field label="تعداد" value={unit.quantity} onChange={(value) => setUnit(index, 'quantity', value)} type="number" min="1" step="1" /><SelectField label="مبنای وزن" value={unit.weightBasis} onChange={(value) => setUnit(index, 'weightBasis', value)}><option value="per_unit">وزن هر واحد</option><option value="total_row">وزن کل ردیف</option></SelectField><Field label="وزن ناخالص" value={unit.grossWeight} onChange={(value) => setUnit(index, 'grossWeight', value)} type="number" min="0" step="any" /><Field label="وزن خالص" value={unit.netWeight} onChange={(value) => setUnit(index, 'netWeight', value)} type="number" min="0" step="any" /><Field label="طول" value={unit.length} onChange={(value) => setUnit(index, 'length', value)} type="number" min="0" step="any" /><Field label="عرض" value={unit.width} onChange={(value) => setUnit(index, 'width', value)} type="number" min="0" step="any" /><Field label="ارتفاع" value={unit.height} onChange={(value) => setUnit(index, 'height', value)} type="number" min="0" step="any" /><SelectField label="واحد ابعاد" value={unit.dimensionUnit} onChange={(value) => setUnit(index, 'dimensionUnit', value)}><option value="m">متر</option><option value="cm">سانتی‌متر</option></SelectField></div><div className="inquiry-grid inquiry-conditional"><SelectField label="چیدمان" value={unit.stackability} onChange={(value) => setUnit(index, 'stackability', value)}><option value="unknown">نامشخص</option><option value="stackable">قابل چیدمان</option><option value="not_stackable">غیرقابل چیدمان</option></SelectField><SelectField label="جهت‌گیری" value={unit.orientation} onChange={(value) => setUnit(index, 'orientation', value)}><option value="free">آزاد</option><option value="fixed">جهت ثابت</option><option value="this_side_up">این سمت بالا</option></SelectField><CheckField checked={unit.nonStandardShape} label="شکل غیرمتعارف / بیرون‌زدگی" onChange={(value) => setUnit(index, 'nonStandardShape', value)} /><CheckField checked={unit.rotatable} label="قابل چرخش نیست" onChange={(value) => setUnit(index, 'rotatable', value)} /></div></article>)}<button type="button" className="inquiry-link-button" onClick={() => setForm((current) => ({ ...current, handlingUnits: [...current.handlingUnits, { ...current.handlingUnits[0], description: '', quantity: 1, grossWeight: '', netWeight: '' }] }))}>+ افزودن ردیف کالای متفاوت</button></div><div className="inquiry-calculation"><span>وزن قابل حمل: <b>{summary.weight ? `${summary.weight.toLocaleString('fa-IR')} کیلوگرم` : 'نامشخص'}</b></span><span>حجم برآوردی: <b>{summary.volume ? `${summary.volume.toFixed(2)} مترمکعب` : 'نامشخص'}</b></span><span>ردیف‌های دارای ابعاد: <b>{form.handlingUnits.filter((unit) => unit.length && unit.width && unit.height).length}</b></span></div></Section>;
    if (step === 4) return <Section number="۰۵" title="خودرو، بارگیر و تجهیزات" description="پیشنهاد راننده بر اساس ظرفیت، نوع بارگیر، تجهیزات، مسیر و وضعیت مدارک بررسی می‌شود؛ انتخاب خودرو به‌تنهایی تضمین قیمت نیست."><div className="inquiry-grid"><SelectField label="روش انتخاب خودرو" value={form.vehicle.preferenceMode} onChange={(value) => set(['vehicle', 'preferenceMode'], value)}><option value="known">نوع خودرو را می‌دانم</option><option value="guidance">راهنمایی می‌خواهم</option><option value="multiple">چند گزینه قابل قبول است</option></SelectField><SelectField label="رده خودرو" value={form.vehicle.class} onChange={(value) => set(['vehicle', 'class'], value)}><option value="pickup">وانت</option><option value="truck">کامیون</option><option value="trailer">تریلی</option><option value="van">ون / کامیونت</option><option value="specialized">تخصصی</option></SelectField><SelectField label="نوع بارگیر" value={form.vehicle.body} onChange={(value) => set(['vehicle', 'body'], value)}><option value="covered">مسقف</option><option value="flatbed">کفی</option><option value="reefer">یخچالی</option><option value="container">کانتینربر</option><option value="tanker">تانکر</option><option value="lowbed">بوژی / کم‌ارتفاع</option><option value="other">سایر</option></SelectField><Field label="ظرفیت مفید موردنیاز (کیلوگرم)" value={form.vehicle.requiredPayload} onChange={(value) => set(['vehicle', 'requiredPayload'], value)} type="number" min="0" /><Field label="تعداد خودرو" value={form.vehicle.count} onChange={(value) => set(['vehicle', 'count'], value)} type="number" min="1" step="1" /></div><div className="inquiry-flag-grid inquiry-equipment-grid">{['tail_lift|بالابر', 'forklift|لیفتراک', 'crane|جرثقیل', 'straps|تسمه و مهار بار', 'reefer|کنترل دما', 'gps|رهگیری'].map((option) => { const [value, label] = option.split('|'); const checked = form.vehicle.requiredEquipment.includes(value); return <label key={value} className={checked ? 'is-selected' : ''}><input type="checkbox" checked={checked} onChange={() => setForm((current) => ({ ...current, vehicle: { ...current.vehicle, requiredEquipment: checked ? current.vehicle.requiredEquipment.filter((item) => item !== value) : [...current.vehicle.requiredEquipment, value] } }))} /><span>{label}</span></label>; })}</div><TextAreaField label="راهنمایی یا محدودیت خودرو" value={form.cargo.notesForDriver} onChange={(value) => set(['cargo', 'notesForDriver'], value)} rows="3" placeholder="مثلاً محدودیت ارتفاع، عدم ترکیب بار یا الزام مسیر خاص" /></Section>;
    if (step === 5) return <Section number="۰۶" title="شرایط ویژه و ریسک بار" description="بار خطرناک، دماکنترل، ابعادی، مایع، حیوان زنده و موارد نامشخص پیش از انتشار نیازمند بررسی تخصصی است؛ سامانه بدون تأیید کارشناس آن را خودکار منتشر نمی‌کند."><div className="inquiry-flag-grid">{specialOptions.map(([value, label]) => { const checked = form.cargo.specialFlags.includes(value); return <label key={value} className={checked ? 'is-selected' : ''}><input type="checkbox" checked={checked} onChange={() => toggleFlag(value)} /><span>{label}</span></label>; })}</div>{form.cargo.specialFlags.includes('temperature_controlled') && <div className="inquiry-conditional"><h3>اطلاعات زنجیره سرد</h3><div className="inquiry-grid"><Field label="حداقل دما (°C)" value={form.cargo.temperature.minC} onChange={(value) => set(['cargo', 'temperature', 'minC'], value)} type="number" step="any" /><Field label="حداکثر دما (°C)" value={form.cargo.temperature.maxC} onChange={(value) => set(['cargo', 'temperature', 'maxC'], value)} type="number" step="any" /><Field label="نقطه تنظیم (°C)" value={form.cargo.temperature.setpointC} onChange={(value) => set(['cargo', 'temperature', 'setpointC'], value)} type="number" step="any" /><Field label="نوع محصول / منبع بازه" value={form.cargo.temperature.rangeSource} onChange={(value) => set(['cargo', 'temperature', 'rangeSource'], value)} /><SelectField label="شرط پیش‌سردسازی" value={form.cargo.temperature.preconditionRequired} onChange={(value) => set(['cargo', 'temperature', 'preconditionRequired'], value)}><option value="">مشخص نشده</option><option value="required">الزامی</option><option value="not_required">لازم نیست</option></SelectField></div></div>}{form.cargo.specialFlags.includes('valuable') && <div className="inquiry-conditional"><h3>اطلاعات بار ارزشمند</h3><div className="inquiry-grid"><Field label="ارزش اظهارشده (ریال)" value={form.cargo.specialRequirements.high_value.declaredValue} onChange={(value) => set(['cargo', 'specialRequirements', 'high_value', 'declaredValue'], value)} type="number" min="0" /><SelectField label="مبنای ارزش" value={form.cargo.specialRequirements.high_value.basis} onChange={(value) => set(['cargo', 'specialRequirements', 'high_value', 'basis'], value)}><option value="">انتخاب کنید</option><option value="invoice">فاکتور</option><option value="customs">اظهار گمرکی</option><option value="replacement">ارزش جایگزینی</option></SelectField><CheckField checked={form.cargo.specialRequirements.high_value.insuranceRequired} label="درخواست بررسی پوشش بیمه" onChange={(value) => set(['cargo', 'specialRequirements', 'high_value', 'insuranceRequired'], value)} /><CheckField checked={form.cargo.specialRequirements.high_value.trackingRequired} label="رهگیری و تحویل با احراز هویت" onChange={(value) => set(['cargo', 'specialRequirements', 'high_value', 'trackingRequired'], value)} /></div></div>}{form.cargo.specialFlags.includes('fragile') && <div className="inquiry-conditional"><h3>الزامات بار شکستنی</h3><div className="inquiry-grid"><Field label="نوع کالای حساس" value={form.cargo.specialRequirements.fragile.itemType} onChange={(value) => set(['cargo', 'specialRequirements', 'fragile', 'itemType'], value)} /><SelectField label="سطح حساسیت" value={form.cargo.specialRequirements.fragile.sensitivity} onChange={(value) => set(['cargo', 'specialRequirements', 'fragile', 'sensitivity'], value)}><option value="">مشخص نشده</option><option value="high">بالا</option><option value="medium">متوسط</option><option value="low">کم</option></SelectField><CheckField checked={form.cargo.specialRequirements.fragile.shockProhibited} label="ضربه و تکان شدید ممنوع" onChange={(value) => set(['cargo', 'specialRequirements', 'fragile', 'shockProhibited'], value)} /><CheckField checked={form.cargo.specialRequirements.fragile.coverRequired} label="پوشش محافظ لازم است" onChange={(value) => set(['cargo', 'specialRequirements', 'fragile', 'coverRequired'], value)} /></div></div>}{form.cargo.specialFlags.some((flag) => ['dangerous', 'hazardous', 'chemical'].includes(flag)) && <div className="inquiry-conditional inquiry-conditional--danger"><h3>اطلاعات ماده خطرناک / شیمیایی</h3><div className="inquiry-grid"><Field label="نام ماده" value={form.cargo.specialRequirements.hazardous.materialName} onChange={(value) => set(['cargo', 'specialRequirements', 'hazardous', 'materialName'], value)} /><Field label="نام فنی" value={form.cargo.specialRequirements.hazardous.technicalName} onChange={(value) => set(['cargo', 'specialRequirements', 'hazardous', 'technicalName'], value)} /><Field label="شماره UN" value={form.cargo.specialRequirements.hazardous.unNumber} onChange={(value) => set(['cargo', 'specialRequirements', 'hazardous', 'unNumber'], value)} /><Field label="کلاس خطر" value={form.cargo.specialRequirements.hazardous.hazardClass} onChange={(value) => set(['cargo', 'specialRequirements', 'hazardous', 'hazardClass'], value)} /><Field label="مقدار" value={form.cargo.specialRequirements.hazardous.amount} onChange={(value) => set(['cargo', 'specialRequirements', 'hazardous', 'amount'], value)} type="number" min="0" step="any" /><Field label="نوع بسته‌بندی ایمن" value={form.cargo.specialRequirements.hazardous.packagingType} onChange={(value) => set(['cargo', 'specialRequirements', 'hazardous', 'packagingType'], value)} /><TextAreaField label="محدودیت مسیر یا دستور حادثه" value={form.cargo.specialRequirements.hazardous.routeRestrictions} onChange={(value) => set(['cargo', 'specialRequirements', 'hazardous', 'routeRestrictions'], value)} rows="2" /></div></div>}{form.cargo.specialFlags.includes('oversized') && <div className="inquiry-conditional"><h3>محموله ابعادی یا سنگین</h3><div className="inquiry-grid"><Field label="وزن سنگین‌ترین قطعه (کیلوگرم)" value={form.cargo.specialRequirements.oversized.pieceWeight} onChange={(value) => set(['cargo', 'specialRequirements', 'oversized', 'pieceWeight'], value)} type="number" min="0" /><Field label="ارتفاع نهایی (سانتی‌متر)" value={form.cargo.specialRequirements.oversized.finalHeightCm} onChange={(value) => set(['cargo', 'specialRequirements', 'oversized', 'finalHeightCm'], value)} type="number" min="0" /><CheckField checked={form.cargo.specialRequirements.oversized.originCrane} label="جرثقیل در مبدأ" onChange={(value) => set(['cargo', 'specialRequirements', 'oversized', 'originCrane'], value)} /><CheckField checked={form.cargo.specialRequirements.oversized.destinationCrane} label="جرثقیل در مقصد" onChange={(value) => set(['cargo', 'specialRequirements', 'oversized', 'destinationCrane'], value)} /><CheckField checked={form.cargo.specialRequirements.oversized.permitRequired} label="مجوز تردد یا بار لازم است" onChange={(value) => set(['cargo', 'specialRequirements', 'oversized', 'permitRequired'], value)} /></div></div>}{form.cargo.specialFlags.includes('liquid') && <div className="inquiry-conditional"><h3>محموله مایع</h3><div className="inquiry-grid"><Field label="نوع مایع" value={form.cargo.specialRequirements.liquid.liquidType} onChange={(value) => set(['cargo', 'specialRequirements', 'liquid', 'liquidType'], value)} /><Field label="نوع مخزن / ظرف" value={form.cargo.specialRequirements.liquid.containerType} onChange={(value) => set(['cargo', 'specialRequirements', 'liquid', 'containerType'], value)} /><CheckField checked={form.cargo.specialRequirements.liquid.flammable} label="قابل اشتعال" onChange={(value) => set(['cargo', 'specialRequirements', 'liquid', 'flammable'], value)} /><CheckField checked={form.cargo.specialRequirements.liquid.corrosive} label="خورنده" onChange={(value) => set(['cargo', 'specialRequirements', 'liquid', 'corrosive'], value)} /></div></div>}{form.cargo.specialFlags.includes('live_animal') && <div className="inquiry-conditional"><h3>محموله حیوان زنده</h3><div className="inquiry-grid"><Field label="نوع حیوان" value={form.cargo.specialRequirements.live_animal.animalType} onChange={(value) => set(['cargo', 'specialRequirements', 'live_animal', 'animalType'], value)} /><Field label="تعداد" value={form.cargo.specialRequirements.live_animal.count} onChange={(value) => set(['cargo', 'specialRequirements', 'live_animal', 'count'], value)} type="number" min="1" /><CheckField checked={form.cargo.specialRequirements.live_animal.ventilation} label="تهویه لازم است" onChange={(value) => set(['cargo', 'specialRequirements', 'live_animal', 'ventilation'], value)} /><CheckField checked={form.cargo.specialRequirements.live_animal.healthDocuments} label="مدارک سلامت موجود است" onChange={(value) => set(['cargo', 'specialRequirements', 'live_animal', 'healthDocuments'], value)} /></div></div>}<p className="inquiry-security-note">اطلاعات ویژه در نمایش عمومی رانندگان منتشر نمی‌شود و بر اساس سطح ریسک به صف بررسی پشتیبانی یا کارشناس ارجاع می‌شود.</p></Section>;
    if (step === 6) return <Section number="۰۷" title="بارگیری، تخلیه و خدمات محل" description="این اطلاعات برای محاسبه اجزای خدمت، زمان عملیات و تطبیق تجهیزات استفاده می‌شود."><div className="inquiry-grid"><h3 className="inquiry-subheading">مبدأ</h3><h3 className="inquiry-subheading">مقصد</h3><CheckField checked={form.services.origin.dockAvailable} label="سکوی بارگیری" onChange={(value) => set(['services', 'origin', 'dockAvailable'], value)} /><CheckField checked={form.services.destination.dockAvailable} label="سکوی تخلیه" onChange={(value) => set(['services', 'destination', 'dockAvailable'], value)} /><CheckField checked={form.services.origin.forkliftAvailable} label="لیفتراک در محل" onChange={(value) => set(['services', 'origin', 'forkliftAvailable'], value)} /><CheckField checked={form.services.destination.forkliftAvailable} label="لیفتراک در محل" onChange={(value) => set(['services', 'destination', 'forkliftAvailable'], value)} /><CheckField checked={form.services.origin.craneAvailable} label="جرثقیل در محل" onChange={(value) => set(['services', 'origin', 'craneAvailable'], value)} /><CheckField checked={form.services.destination.craneAvailable} label="جرثقیل در محل" onChange={(value) => set(['services', 'destination', 'craneAvailable'], value)} /></div><div className="inquiry-grid inquiry-conditional"><SelectField label="مسئولیت عملیات مبدأ" value={form.services.responsibilities.origin} onChange={(value) => set(['services', 'responsibilities', 'origin'], value)}><option value="requester">متقاضی</option><option value="driver">راننده</option><option value="shared">مشترک</option><option value="unknown">نامشخص</option></SelectField><SelectField label="مسئولیت عملیات مقصد" value={form.services.responsibilities.destination} onChange={(value) => set(['services', 'responsibilities', 'destination'], value)}><option value="requester">متقاضی</option><option value="driver">راننده</option><option value="shared">مشترک</option><option value="unknown">نامشخص</option></SelectField><Field label="تعداد نیروی مبدأ" value={form.services.helpers.originCount} onChange={(value) => set(['services', 'helpers', 'originCount'], value)} type="number" min="0" /><Field label="تعداد نیروی مقصد" value={form.services.helpers.destinationCount} onChange={(value) => set(['services', 'helpers', 'destinationCount'], value)} type="number" min="0" /></div><div className="inquiry-flag-grid">{['loading_unloading|بارگیری و تخلیه', 'packaging|بسته‌بندی', 'weighing|وزن‌کشی', 'waybill|صدور بارنامه', 'insurance_review|بررسی بیمه', 'tracking|رهگیری'].map((option) => { const [value, label] = option.split('|'); const checked = form.services.requested.includes(value); return <label key={value} className={checked ? 'is-selected' : ''}><input type="checkbox" checked={checked} onChange={() => setForm((current) => ({ ...current, services: { ...current.services, requested: checked ? current.services.requested.filter((item) => item !== value) : [...current.services.requested, value] } }))} /><span>{label}</span></label>; })}</div><TextAreaField label="توضیحات عملیاتی محل" value={form.stops[0]?.coordinationNote || ''} onChange={(value) => setStop(0, 'coordinationNote', value)} rows="3" /></Section>;
    if (step === 7) return <Section number="۰۸" title="مدارک، پرداخت‌کننده و راه ارتباطی" description="مدارک به‌صورت خصوصی نگهداری می‌شوند. در این محیط اتصال ذخیره‌ساز و اسکن فایل فعال نیست؛ مشخصات سند ثبت می‌شود و بارگذاری واقعی پس از پیکربندی سرویس خصوصی انجام خواهد شد."><div className="inquiry-grid"><Field label="نام / شرکت متقاضی" value={form.requester.name} onChange={(value) => set(['requester', 'name'], value)} required /><Field label="موبایل" value={form.requester.mobile} onChange={(value) => set(['requester', 'mobile'], value)} inputMode="tel" required /><Field label="ایمیل (اختیاری)" value={form.requester.email} onChange={(value) => set(['requester', 'email'], value)} type="email" /><Field label="شماره جایگزین (اختیاری)" value={form.requester.alternatePhone} onChange={(value) => set(['requester', 'alternatePhone'], value)} inputMode="tel" /><SelectField label="کانال پاسخ" value={form.contact.channel} onChange={(value) => set(['contact', 'channel'], value)}><option value="sms">پیامک</option><option value="phone">تماس</option><option value="email">ایمیل</option></SelectField><Field label="بازه مناسب تماس" value={form.contact.timeWindow} onChange={(value) => set(['contact', 'timeWindow'], value)} /></div><div className="inquiry-grid inquiry-conditional"><SelectField label="پرداخت‌کننده" value={form.payer.type} onChange={(value) => set(['payer', 'type'], value)}><option value="requester">متقاضی</option><option value="shipper">صاحب کالا</option><option value="consignee">گیرنده</option><option value="third_party">شخص ثالث</option><option value="unknown">نامشخص</option></SelectField><Field label="نام پرداخت‌کننده" value={form.payer.name} onChange={(value) => set(['payer', 'name'], value)} /><Field label="ارزش اظهارشده (اختیاری)" value={form.value.amountMinor} onChange={(value) => set(['value', 'amountMinor'], value)} type="number" min="0" /><SelectField label="ارز" value={form.value.currency} onChange={(value) => set(['value', 'currency'], value)}><option value="IRR">ریال</option><option value="IRT">تومان</option><option value="EUR">یورو</option><option value="USD">دلار</option><option value="AED">درهم</option></SelectField></div><div className="inquiry-document-list">{form.documents.map((document, index) => <article key={`${document.originalName}-${index}`} className="inquiry-document"><strong>{document.originalName}</strong><span>{document.documentType || 'سند بار'} · {document.mimeType || 'نوع نامشخص'} · {document.sizeBytes ? `${Math.round(document.sizeBytes / 1024)} KB` : 'اندازه نامشخص'}</span><button type="button" onClick={() => setForm((current) => ({ ...current, documents: current.documents.filter((_, documentIndex) => documentIndex !== index) }))}>حذف مشخصات</button></article>)}<label className="inquiry-file-picker"><span>افزودن مشخصات سند یا تصویر</span><input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setForm((current) => ({ ...current, documents: [...current.documents, { documentType: 'supporting_document', originalName: file.name, mimeType: file.type, sizeBytes: file.size, visibility: 'PRIVATE', status: 'PENDING_UPLOAD' }] })); event.target.value = ''; }} /></label></div></Section>;
    return <Section number="۰۹" title="بازبینی و انتخاب مسیر دریافت قیمت" description="استعلام از رانندگان یک بازار پیشنهادی است و نرخ تضمینی، بیمه مستقل یا قرارداد نهایی ایجاد نمی‌کند. پشتیبانی می‌تواند اطلاعات را بررسی و قیمت دستی ارائه کند."><div className="inquiry-summary-grid"><div><span>مسیر</span><strong>{form.stops[0]?.city || '—'} ← {form.stops[1]?.city || '—'}</strong></div><div><span>بار</span><strong>{form.cargo.title || 'بدون عنوان'} · {summary.weight ? `${summary.weight.toLocaleString('fa-IR')} kg` : 'وزن نامشخص'}</strong></div><div><span>خودرو</span><strong>{form.vehicle.class || 'راهنمایی'} · {form.vehicle.body || 'نوع بارگیر مشخص نشده'}</strong></div><div><span>شرایط ویژه</span><strong>{formatList(form.cargo.specialFlags.map((flag) => specialOptions.find(([value]) => value === flag)?.[1] || flag))}</strong></div><div><span>خدمات درخواستی</span><strong>{formatList(form.services.requested)}</strong></div><div><span>مدارک</span><strong>{form.documents.length ? `${form.documents.length} مورد مشخص شده` : 'مدرکی ثبت نشده'}</strong></div></div><div className="inquiry-consent-list"><CheckField checked={form.consent.dataAccuracy} label="اطلاعات واردشده را تا حد اطلاع خود صحیح می‌دانم و در صورت تغییر، به‌روزرسانی می‌کنم." onChange={(value) => set(['consent', 'dataAccuracy'], value)} /><CheckField checked={form.consent.prohibitedGoods} label="کالاهای ممنوع یا اطلاعات گمراه‌کننده را در این درخواست ثبت نکرده‌ام." onChange={(value) => set(['consent', 'prohibitedGoods'], value)} /><CheckField checked={form.consent.contractNotFinal} label="می‌دانم دریافت پیشنهاد به‌تنهایی قرارداد نهایی یا تعهد حمل نیست." onChange={(value) => set(['consent', 'contractNotFinal'], value)} /><CheckField checked={form.consent.priceMayChange} label="می‌پذیرم قیمت پس از بررسی جزئیات و انتخاب پیشنهاد ممکن است تغییر کند." onChange={(value) => set(['consent', 'priceMayChange'], value)} /><CheckField checked={form.consent.shareWithDrivers} label="در مسیر رانندگان، اطلاعات لازم و غیرخصوصی بار برای رانندگان واجد شرایط نمایش داده شود؛ نشانی دقیق، تماس، ارزش و بودجه منتشر نشود." onChange={(value) => set(['consent', 'shareWithDrivers'], value)} /></div><div className="inquiry-actions"><button type="button" className="inquiry-button inquiry-button--primary" onClick={submitAutomatic} disabled={busy || !form.consent.shareWithDrivers}>{busy ? 'در حال ذخیره…' : 'استعلام قیمت از رانندگان'}</button><button type="button" className="inquiry-button" onClick={submitSupport} disabled={busy}>{busy ? 'در حال ثبت…' : 'درخواست استعلام از پشتیبانی'}</button></div><p className="inquiry-actions__hint">در مسیر رانندگان، پیش‌نویس مهمان ابتدا ذخیره و سپس پس از ورود به حساب صاحب بار متصل می‌شود. مسیر پشتیبانی با کد پیگیری و لینک امن قابل پیگیری است.</p></Section>;
  };

  return <div className="inquiry-page" dir="rtl"><header className="inquiry-header"><ProductLogo subtitle="شبکه هوشمند حمل‌ونقل و گمرک" /><a href="/app">ورود به سامانه</a></header><main className="inquiry-main"><section className="inquiry-hero"><span className="inquiry-eyebrow">فرم جامع استعلام حمل بار</span><h1>قیمت، ظرفیت و مسیر را با داده درست پیدا کنید.</h1><p>۹ مرحله کوتاه برای ثبت استعلام از رانندگان واجد شرایط یا ارسال پرونده به پشتیبانی؛ بدون حدس‌زدن زمینه و با تفکیک اطلاعات عمومی و خصوصی.</p></section><nav className="inquiry-stepper" aria-label="مراحل فرم">{STAGES.map(([title, description], index) => <button type="button" key={title} className={`inquiry-stepper__item ${index === step ? 'is-active' : ''} ${index < step ? 'is-complete' : ''}`} onClick={() => { if (index <= step) setStep(index); }}><b>{index + 1}</b><span><strong>{title}</strong><small>{description}</small></span></button>)}</nav>{notice && <div className={`inquiry-notice inquiry-notice--${notice.tone}`} role="alert" aria-live="polite">{notice.message}</div>}{saved && !notice && <div className="inquiry-save-status" role="status">پیش‌نویس این فرم به‌صورت محلی ذخیره شد.</div>}{renderStep()}<div className="inquiry-mobile-actions"><button type="button" className="inquiry-button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || busy}>مرحله قبل</button>{step < STAGES.length - 1 && <button type="button" className="inquiry-button inquiry-button--primary" onClick={goNext}>مرحله بعد</button>}{step === STAGES.length - 1 && <button type="button" className="inquiry-button" onClick={() => setStep(0)} disabled={busy}>بازبینی از ابتدا</button>}</div></main></div>;
}
