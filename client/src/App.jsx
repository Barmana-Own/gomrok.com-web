import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { provinces } from './data/iranLocations.js';
import PlatformWorkspace from './components/PlatformWorkspace.jsx';
const AdminGovernancePanel = lazy(() => import('./components/AdminGovernancePanel.jsx'));

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? APP_BASE : 'http://127.0.0.1:4000');
const LOGISTICS_HERO = `${import.meta.env.BASE_URL}images/gomrok-logistics-hero.webp`;
const LOGISTICS_WAVE = `${import.meta.env.BASE_URL}images/gomrok-hero-wave.webp`;
const LOGISTICS_ROUTE_TOP = `${import.meta.env.BASE_URL}images/gomrok-route-line-top.png`;
const LOGISTICS_ROUTE_BOTTOM = `${import.meta.env.BASE_URL}images/gomrok-route-line-bottom.png`;
const DRIVER_TRUCK_ICON = `${import.meta.env.BASE_URL}images/gomrok-driver-truck.webp`;
const CARRIER_WAREHOUSE_ICON = `${import.meta.env.BASE_URL}images/gomrok-carrier-warehouse.webp`;
const CARRIER_REGISTER_ICON = `${import.meta.env.BASE_URL}images/gomrok-carrier-register-icon.webp`;
const BENEFIT_SPEED_ICON = `${import.meta.env.BASE_URL}images/gomrok-benefit-speed.webp`;
const BENEFIT_SECURITY_ICON = `${import.meta.env.BASE_URL}images/gomrok-benefit-security.webp`;
const BENEFIT_SUPPORT_ICON = `${import.meta.env.BASE_URL}images/gomrok-benefit-support.webp`;

const emptyRegistration = {
  firstName: '',
  lastName: '',
  nationalId: '',
  phone: '',
  province: ''
};

const emptyCarrierRegistration = {
  businessName: '',
  registrationNumber: '',
  nationalIdentifier: '',
  managerName: '',
  phone: '',
  province: ''
};

function readSessionUser() {
  try { return JSON.parse(sessionStorage.getItem('gomrok-session-user') || 'null'); } catch (_error) { return null; }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'ارتباط با سرور برقرار نشد.');
  return body;
}

function Brand({ variant = 'default' }) {
  return (
    <div className="brand">
      <span className={`brand__mark${variant === 'welcome' ? ' brand__mark--wing' : ''}`} aria-hidden="true">
        {variant === 'welcome' ? (
          <svg viewBox="0 0 44 32" role="presentation">
            <path d="M2 18 31 4l10 4-20 11-9 10-7-3 8-8Z" fill="currentColor" />
            <path d="m17 20 18-9 6 3-17 10-9 5-5-2 7-7Z" fill="currentColor" opacity=".82" />
            <path d="m5 12 11-5 7 2-12 6-6 1Z" fill="#ef6b4f" />
            <path d="m14 8 8-3 7 2-8 4Z" fill="#4c85ed" />
          </svg>
        ) : '✓'}
      </span>
      <span>
        <strong>سامانه گمرک</strong>
        <small>gomrok.org · حمل‌ونقل بین‌المللی</small>
      </span>
    </div>
  );
}

function FormIcon({ name }) {
  const icons = {
    building: <><path d="M3 20h18" /><path d="M5 20V7l7-4 7 4v13" /><path d="M8 9h2v3H8zm6 0h2v3h-2zM8 15h2v3H8zm6 0h2v3h-2z" /></>,
    user: <><circle cx="12" cy="7" r="3.2" /><path d="M5.5 20c.5-4 2.5-6 6.5-6s6 2 6.5 6" /></>,
    identity: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="10" r="2" /><path d="M13 9h5M13 13h5M6 16h12" /></>,
    phone: <path d="M7.2 3.5 5.6 5.1c-.8.8-.7 2.4.1 4.2 1.3 2.9 4.1 5.7 7 7 .1 0 .2.1.3.1 1.7.7 3.3.8 4.1 0l1.7-1.7c.4-.4.4-1 0-1.4l-2.2-2.2c-.4-.4-1-.4-1.4 0l-1 1c-1.3-.6-3-2.3-3.6-3.6l1-1c.4-.4.4-1 0-1.4L8.6 3.5c-.4-.4-1-.4-1.4 0Z" />,
    location: <><path d="M19 10c0 4.3-7 10-7 10s-7-5.7-7-10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    address: <><path d="M4 20h16M6 20V8l6-4 6 4v12" /><path d="M9 20v-5h6v5M9 10h1M14 10h1" /></>
  };
  return <svg className="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name] || icons.user}</svg>;
}

function Field({ label, name, value, onChange, type = 'text', placeholder, inputMode, autoComplete, wide = false, compact = false, icon }) {
  return (
    <label className={`field${wide ? ' field--wide' : ''}${compact ? ' field--compact' : ''}`}>
      {!compact && <span>{label}</span>}
      {compact && <span className="field__icon">{icon}</span>}
      <input
        name={name}
        value={value}
        onChange={onChange}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={compact ? (placeholder || label) : placeholder}
        aria-label={compact ? label : undefined}
      />
    </label>
  );
}

function CustomSelect({ label, value, onChange, options, placeholder, disabled = false, compact = false, icon }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedLabel = options.find((option) => option === value) || placeholder;

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  return (
    <label className={`field${compact ? ' field--compact' : ''}`} ref={rootRef}>
      {!compact && <span>{label}</span>}
      {compact && <span className="field__icon">{icon}</span>}
      <div className={`select ${open ? 'select--open' : ''}`}>
        <button
          className={`select__trigger${compact ? ' select__trigger--compact' : ''}`}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className={value ? '' : 'select__placeholder'}>{selectedLabel}</span>
          <b aria-hidden="true">⌄</b>
        </button>
        {open && !disabled && (
          <div className="select__menu" role="listbox">
            {options.map((option) => (
              <button
                className={option === value ? 'select__option select__option--selected' : 'select__option'}
                key={option}
                type="button"
                role="option"
                aria-selected={option === value}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

function AuthHeader() {
  return (
    <header className="auth-header">
      <Brand />
      <span className="secure-pill"><i /> ارتباط امن</span>
    </header>
  );
}

function LogisticsIllustration() {
  return (
    <div className="logistics-art" aria-hidden="true">
      <img className="logistics-art__scene" src={LOGISTICS_HERO} alt="" width="1000" height="1000" fetchPriority="high" decoding="async" />
      <img className="logistics-art__wave" src={LOGISTICS_WAVE} alt="" width="960" height="320" decoding="async" />
    </div>
  );
}

function TruckLineIcon() {
  return (
    <img className="role-card__art" src={DRIVER_TRUCK_ICON} alt="" width="640" height="480" loading="lazy" decoding="async" />
  );
}

function WarehouseLineIcon() {
  return (
    <img className="role-card__art" src={CARRIER_WAREHOUSE_ICON} alt="" width="640" height="480" loading="lazy" decoding="async" />
  );
}

function RoleSelectionPage({ onDriverRegister, onCarrierRegister }) {
  return (
    <div className="screen screen--welcome">
      <main className="role-main">
        <LogisticsIllustration />
        <img className="role-main__route role-main__route--top" src={LOGISTICS_ROUTE_TOP} alt="" aria-hidden="true" width="887" height="1774" fetchPriority="high" decoding="async" />
        <img className="role-main__route role-main__route--bottom" src={LOGISTICS_ROUTE_BOTTOM} alt="" aria-hidden="true" width="887" height="1774" loading="lazy" decoding="async" />
        <section className="welcome-copy">
          <span className="eyebrow">شروع همکاری</span>
          <h1>سامانه حمل و نقل گمرک</h1>
          <p className="lead">برای دریافت خدمات هوشمند گمرکی و حمل‌ونقل بین‌المللی، نقش خودت را انتخاب کن.</p>
        </section>

        <section className="role-cards" aria-label="انتخاب نوع حساب">
          <button className="role-card role-card--driver" type="button" onClick={onDriverRegister}>
            <span className="role-card__icon"><TruckLineIcon /></span>
            <span className="role-card__copy"><strong>راننده</strong><small>حمل بار و انجام تشریفات</small></span>
            <b aria-hidden="true">←</b>
          </button>
          <button className="role-card role-card--carrier" type="button" onClick={onCarrierRegister}>
            <span className="role-card__icon"><WarehouseLineIcon /></span>
            <span className="role-card__copy"><strong>کرییر</strong><small>مدیریت حمل‌ونقل و ناوگان</small></span>
            <b aria-hidden="true">←</b>
          </button>
        </section>

        <section className="role-benefits" aria-label="مزیت‌های سامانه">
          <div className="role-benefit"><img src={BENEFIT_SECURITY_ICON} alt="" width="128" height="128" loading="lazy" decoding="async" /><span>تسویه امن</span></div>
          <i aria-hidden="true" />
          <div className="role-benefit"><img src={BENEFIT_SUPPORT_ICON} alt="" width="128" height="128" loading="lazy" decoding="async" /><span>پشتیبانی تخصصی</span></div>
          <i aria-hidden="true" />
          <div className="role-benefit"><img src={BENEFIT_SPEED_ICON} alt="" width="128" height="128" loading="lazy" decoding="async" /><span>سریع و شفاف</span></div>
        </section>
        <p className="role-registration-note">ثبت‌نام اولیه رایگان است؛ سامانه در حال توسعه است.</p>
      </main>
    </div>
  );
}

function LoginPage({ initialRole = 'driver', onRoleChange, onDriverRegister, onCarrierRegister, onLoggedIn }) {
  const [role, setRole] = useState(initialRole);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const isCarrier = role === 'carrier';

  const changeRole = (nextRole) => {
    setRole(nextRole);
    setNotice('');
    onRoleChange?.(nextRole);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await apiRequest(isCarrier ? '/api/auth/login-carrier' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password })
      });
      onLoggedIn(result.user, result.token, result.refreshToken);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <AuthHeader />
      <main className="auth-main">
        <div className="role-switch" aria-label="انتخاب نوع حساب">
          <button className={!isCarrier ? 'role-switch__active' : ''} type="button" onClick={() => changeRole('driver')}>راننده</button>
          <button className={isCarrier ? 'role-switch__active' : ''} type="button" onClick={() => changeRole('carrier')}>کرییر</button>
        </div>
        <span className="eyebrow">{isCarrier ? 'پنل اختصاصی کرییرها' : 'پنل اختصاصی رانندگان'}</span>
        <h1>{isCarrier ? 'خوش آمدی، کرییر' : 'خوش آمدی، راننده'}</h1>
        <p className="lead">{isCarrier ? 'برای مدیریت ناوگان و بارها وارد حساب کرییر شو.' : 'برای دیدن سفرها و مأموریت‌ها وارد حساب خودت شو.'}</p>

        <form className="auth-card" onSubmit={submit}>
          <div className="card-title"><span>ورود به حساب {isCarrier ? 'کرییر' : 'راننده'}</span><b>۱</b></div>
          <Field label="شماره موبایل" name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="۰۹۱۲۱۲۳۴۵۶۷" inputMode="tel" autoComplete="tel" />
          <Field label="رمز عبور" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="رمز عبور خود را وارد کن" autoComplete="current-password" />
          {notice && <p className="notice notice--error">{notice}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'در حال ورود…' : `ورود به پنل ${isCarrier ? 'کرییر' : 'راننده'}`}</button>
          <button className="text-button" type="button">فراموشی رمز عبور؟</button>
        </form>

        <div className="auth-switch">{isCarrier ? 'حساب کرییر نداری؟' : 'حساب راننده نداری؟'} <button type="button" onClick={isCarrier ? onCarrierRegister : onDriverRegister}>ثبت‌نام کن</button></div>
      </main>
    </div>
  );
}

function RegisterPage({ onBack, onRegistered }) {
  const [form, setForm] = useState(emptyRegistration);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await apiRequest('/api/registrations/driver', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      onRegistered(result.registration);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen screen--register screen--driver-register">
      <RegisterHeader role="driver" onBack={onBack} />
      <main className="auth-main auth-main--register register-main">
        <form className="auth-card auth-card--register register-form" onSubmit={submit}>
          <div className="register-form__intro"><strong>اطلاعات راننده</strong><small>اطلاعات شما پس از بررسی ادمین به حساب کاربری تبدیل می‌شود.</small></div>
          <div className="form-grid form-grid--register">
            <Field label="نام" name="firstName" value={form.firstName} onChange={update} placeholder="نام" autoComplete="given-name" compact icon={<FormIcon name="user" />} />
            <Field label="نام خانوادگی" name="lastName" value={form.lastName} onChange={update} placeholder="نام خانوادگی" autoComplete="family-name" compact icon={<FormIcon name="user" />} />
            <Field label="کد ملی" name="nationalId" value={form.nationalId} onChange={update} placeholder="کد ملی" inputMode="numeric" compact icon={<FormIcon name="identity" />} />
            <Field label="شماره تماس" name="phone" value={form.phone} onChange={update} placeholder="شماره تماس" inputMode="tel" autoComplete="tel" compact icon={<FormIcon name="phone" />} />
            <CustomSelect label="استان" value={form.province} onChange={(province) => setForm((current) => ({ ...current, province }))} options={provinces} placeholder="استان محل سکونت" compact icon={<FormIcon name="location" />} />
          </div>

          {notice && <p className="notice notice--error">{notice}</p>}
          <button className="primary-button register-form__submit" type="submit" disabled={busy}>{busy ? 'در حال ثبت اطلاعات…' : 'ارسال اطلاعات راننده'}</button>
        </form>
      </main>
    </div>
  );
}

function RegisterHeader({ role, onBack }) {
  const isCarrier = role === 'carrier';
  const steps = ['اطلاعات پایه', 'بررسی اطلاعات', 'ایجاد حساب'];
  const icon = isCarrier ? CARRIER_REGISTER_ICON : DRIVER_TRUCK_ICON;

  return (
    <header className={`register-header register-header--${role}`}>
      <button className="register-header__back" type="button" onClick={onBack} aria-label="بازگشت به انتخاب نقش">←</button>
      <div className="register-header__title"><strong>ثبت‌نام {isCarrier ? 'کرییر' : 'راننده'}</strong><small>gomrok.org</small></div>
      <span className="register-header__icon"><img src={icon} alt="" /></span>
      <div className="register-steps" aria-label="مراحل ثبت‌نام">
        {steps.map((step, index) => (
          <span className={`register-step${index === 0 ? ' register-step--active' : ''}`} key={step}>
            <b>{index === 0 ? '✓' : index + 1}</b><small>{step}</small>
          </span>
        )).reduce((items, step, index, stepsList) => (index < stepsList.length - 1 ? [...items, step, <i key={`line-${index}`} />] : [...items, step]), [])}
      </div>
    </header>
  );
}

function CarrierRegisterHeader({ onBack }) {
  return <RegisterHeader role="carrier" onBack={onBack} />;
}

function CarrierRegisterPage({ onBack, onRegistered }) {
  const [form, setForm] = useState(emptyCarrierRegistration);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await apiRequest('/api/registrations/carrier', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      onRegistered(result.registration);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen screen--register screen--carrier-register">
      <CarrierRegisterHeader onBack={onBack} />
      <main className="auth-main auth-main--register register-main">
        <form className="auth-card auth-card--register auth-card--carrier register-form" onSubmit={submit}>
          <div className="register-form__intro"><strong>اطلاعات کرییر</strong><small>اطلاعات شرکت پس از بررسی ادمین به حساب تبدیل می‌شود.</small></div>
          <div className="form-grid form-grid--register">
            <Field label="نام شرکت" name="businessName" value={form.businessName} onChange={update} placeholder="نام شرکت" autoComplete="organization" compact icon={<FormIcon name="building" />} />
            <Field label="شماره ثبت" name="registrationNumber" value={form.registrationNumber} onChange={update} placeholder="شماره ثبت" inputMode="numeric" compact icon={<FormIcon name="identity" />} />
            <Field label="شناسه ملی" name="nationalIdentifier" value={form.nationalIdentifier} onChange={update} placeholder="شناسه ملی" inputMode="numeric" compact icon={<FormIcon name="identity" />} />
            <Field label="نام مدیرعامل" name="managerName" value={form.managerName} onChange={update} placeholder="نام مدیرعامل" autoComplete="name" compact icon={<FormIcon name="user" />} />
            <Field label="شماره تماس" name="phone" value={form.phone} onChange={update} placeholder="شماره تماس" inputMode="tel" autoComplete="tel" compact icon={<FormIcon name="phone" />} />
            <CustomSelect label="استان" value={form.province} onChange={(province) => setForm((current) => ({ ...current, province }))} options={provinces} placeholder="استان محل شرکت" compact icon={<FormIcon name="location" />} />
          </div>

          {notice && <p className="notice notice--error">{notice}</p>}
          <button className="primary-button register-form__submit" type="submit" disabled={busy}>{busy ? 'در حال ثبت اطلاعات…' : 'ارسال اطلاعات کرییر'}</button>
        </form>
      </main>
    </div>
  );
}

function MaintenancePage({ user, onLogout }) {
  const isCarrier = user?.role === 'carrier';
  const accountLabel = isCarrier ? 'کرییر' : 'راننده';

  return (
    <div className="screen screen--maintenance">
      <AuthHeader />
      <main className="maintenance-main">
        <div className="maintenance-icon" aria-hidden="true"><span>↻</span></div>
        <span className="eyebrow">حساب {accountLabel} آماده شد</span>
        <h1>در حال بروزرسانی هستیم</h1>
        <p className="lead">ورودت با موفقیت انجام شد. بخش‌های اصلی سامانه را برای یک تجربه بهتر در حال آماده‌سازی هستیم.</p>

        <section className="maintenance-card">
          <div className="maintenance-card__row"><i className="maintenance-card__dot maintenance-card__dot--done" /><span>حساب شما با موفقیت ثبت شد</span><b>✓</b></div>
          <div className="maintenance-card__line" />
          <div className="maintenance-card__row"><i className="maintenance-card__dot" /><span>راه‌اندازی پنل {accountLabel}</span><small>به‌زودی</small></div>
        </section>

        <button className="primary-button maintenance-button" type="button" onClick={onLogout}>بازگشت به صفحه ورود</button>
        <p className="maintenance-note">اطلاعات حساب شما محفوظ است و بعد از آماده‌شدن نسخه جدید، ادامه مسیر از همین‌جا انجام می‌شود.</p>
      </main>
    </div>
  );
}

function RegistrationSubmittedPage({ registration, onBack }) {
  const isCarrier = registration?.role === 'carrier';
  const title = 'از ثبت‌نام شما متشکریم';
  const name = isCarrier ? registration?.businessName : `${registration?.firstName || ''} ${registration?.lastName || ''}`.trim();

  return (
    <div className="screen screen--maintenance screen--registration-submitted">
      <AuthHeader />
      <main className="maintenance-main">
        <div className="maintenance-icon maintenance-icon--success" aria-hidden="true"><span>✓</span></div>
        <span className="eyebrow">ثبت اطلاعات با موفقیت انجام شد</span>
        <h1>{title}</h1>
        <p className="lead">{name || 'اطلاعات شما'} با موفقیت ثبت شد. سامانه در حال توسعه است و درخواست شما پس از بررسی در صف آماده‌سازی حساب قرار می‌گیرد.</p>

        <section className="maintenance-card">
          <div className="maintenance-card__row"><i className="maintenance-card__dot maintenance-card__dot--done" /><span>اطلاعات اولیه دریافت شد</span><b>✓</b></div>
          <div className="maintenance-card__line" />
          <div className="maintenance-card__row"><i className="maintenance-card__dot" /><span>سامانه در حال توسعه است</span><small>به‌زودی</small></div>
        </section>

        <button className="primary-button maintenance-button" type="button" onClick={onBack}>بازگشت به انتخاب نقش</button>
        <p className="maintenance-note">شماره پیگیری درخواست: #{registration?.id || '—'}</p>
      </main>
    </div>
  );
}

function DriverHome({ user, onLogout }) {
  return (
    <div className="screen screen--home">
      <header className="home-header"><Brand /><button className="logout-button" type="button" onClick={onLogout}>خروج</button></header>
      <main className="home-main">
        <p className="eyebrow">امروز من</p>
        <h1>سلام {user?.firstName || 'راننده'} 👋</h1>
        <p className="lead">وضعیت همکاری و کارهای بعدی‌ات را از همین‌جا دنبال کن.</p>
        <section className="status-card"><span>وضعیت حساب</span><strong>فعال</strong><small>{user?.province || 'ایران'} · {user?.city || 'محل سکونت ثبت‌شده'}</small></section>
        <div className="home-grid">
          <article><b>۰</b><span>مأموریت امروز</span><small>فعلاً موردی ثبت نشده</small></article>
          <article><b>۰</b><span>تیکت باز</span><small>پشتیبانی در دسترس است</small></article>
          <article><b>—</b><span>امتیاز ایمنی</span><small>پس از شروع فعالیت</small></article>
          <article><b>۰</b><span>سفر تکمیل‌شده</span><small>در این بازه</small></article>
        </div>
        <section className="next-card"><div><span className="eyebrow">گام بعدی</span><strong>تکمیل اطلاعات کاری</strong><p>هر زمان آماده بودی، اطلاعات وسیله و مدارک را از پنل اضافه می‌کنیم.</p></div><button type="button">بعداً</button></section>
      </main>
      <nav className="bottom-nav"><button className="bottom-nav__active" type="button">خانه</button><button type="button">سفرها</button><button type="button">پشتیبانی</button><button type="button">پروفایل</button></nav>
    </div>
  );
}

function CarrierHome({ user, onLogout }) {
  return (
    <div className="screen screen--home screen--carrier-home">
      <header className="home-header"><Brand /><button className="logout-button" type="button" onClick={onLogout}>خروج</button></header>
      <main className="home-main">
        <p className="eyebrow">پنل کرییر</p>
        <h1>{user?.businessName || 'کرییر شما'} 👋</h1>
        <p className="lead">ناوگان، راننده‌ها و درخواست‌های حمل را از همین‌جا مدیریت کن.</p>
        <section className="status-card"><span>وضعیت حساب کرییر</span><strong>فعال</strong><small>{user?.province || 'ایران'} · {user?.city || 'محل دفتر ثبت‌شده'}</small></section>
        <div className="home-grid">
          <article><b>۰</b><span>راننده‌های فعال</span><small>برای اتصال به ناوگان</small></article>
          <article><b>۰</b><span>خودروهای ثبت‌شده</span><small>فعلاً موردی ثبت نشده</small></article>
          <article><b>۰</b><span>درخواست حمل</span><small>در انتظار بررسی</small></article>
          <article><b>۰</b><span>تیکت باز</span><small>پشتیبانی در دسترس است</small></article>
        </div>
        <section className="next-card"><div><span className="eyebrow">گام بعدی</span><strong>تکمیل پروفایل کرییر</strong><p>مجوز، ناوگان و راننده‌های خودت را در مرحله بعد به حساب اضافه می‌کنیم.</p></div><button type="button">بعداً</button></section>
      </main>
      <nav className="bottom-nav"><button className="bottom-nav__active" type="button">خانه</button><button type="button">ناوگان</button><button type="button">درخواست‌ها</button><button type="button">پروفایل</button></nav>
    </div>
  );
}

function formatAdminDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function AdminLoginPage({ form, setForm, busy, notice, onSubmit }) {
  return (
    <div className="admin-shell admin-shell--login">
      <div className="admin-login-card">
        <div className="admin-login-brand"><span className="admin-login-brand__mark">✓</span><span><strong>سامانه گمرک</strong><small>gomrok.org · پنل ادمین</small></span></div>
        <span className="admin-eyebrow">دسترسی مدیریتی امن</span>
        <h1>ورود به پنل مدیریت</h1>
        <p className="admin-muted">اطلاعات ثبت‌نام راننده‌ها و کرییرها را از اینجا مدیریت کن.</p>
        <form className="admin-login-form" onSubmit={onSubmit}>
          <label><span>نام کاربری</span><input name="username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} autoComplete="username" placeholder="نام کاربری مدیر" /></label>
          <label><span>رمز عبور</span><input name="password" type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} autoComplete="current-password" placeholder="رمز عبور" /></label>
          {notice && <p className="admin-notice admin-notice--error">{notice}</p>}
          <button className="admin-primary-button" type="submit" disabled={busy}>{busy ? 'در حال ورود…' : 'ورود به پنل'}</button>
        </form>
      </div>
    </div>
  );
}

function adminStatusLabel(status) {
  return { pending: 'در انتظار تأیید', active: 'فعال', disabled: 'غیرفعال', rejected: 'رد شده' }[status] || status || 'نامشخص';
}

function AdminUserCard({ item, type, busyKey, onAction, onEdit }) {
  const isDriver = type === 'drivers';
  const role = isDriver ? 'driver' : 'carrier';
  const title = isDriver ? `${item.firstName || ''} ${item.lastName || ''}`.trim() : item.businessName;
  const subtitle = isDriver ? `راننده · ${item.phone}` : `باربری · ${item.managerName || 'مدیر ثبت نشده'}`;
  const details = isDriver
    ? [
      ['کد ملی', item.nationalId],
      ['شماره تماس', item.phone],
      ['استان', item.province],
      ['تاریخ ثبت', formatAdminDate(item.createdAt)]
    ]
    : [
      ['شماره ثبت', item.registrationNumber],
      ['شناسه ملی', item.nationalIdentifier],
      ['نام مدیرعامل', item.managerName],
      ['شماره تماس', item.phone],
      ['استان', item.province],
      ['تاریخ ثبت', formatAdminDate(item.createdAt)]
    ];
  const primaryAction = item.status === 'active' ? 'disable' : item.status === 'disabled' ? 'enable' : 'approve';
  const primaryLabel = primaryAction === 'approve' ? 'تأیید و ایجاد حساب' : primaryAction === 'disable' ? 'غیرفعال‌سازی' : 'فعال‌سازی';
  const primaryBusy = busyKey === `${role}-${item.id}-${primaryAction}`;

  return (
    <article className="admin-user-card">
      <div className="admin-user-card__header">
        <div><span className="admin-user-card__id">#{item.id}</span><h3>{title || 'بدون نام'}</h3><p>{subtitle}</p></div>
        <span className={`admin-status admin-status--${item.status === 'active' ? 'active' : item.status === 'disabled' ? 'disabled' : 'muted'}`}>{adminStatusLabel(item.status)}</span>
      </div>
      <dl className="admin-details">
        {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
      </dl>
      <div className="admin-user-card__footer">
        <span>{item.accountCreated ? 'حساب ایجاد شده' : 'حساب هنوز ایجاد نشده'}</span>
        <div className="admin-user-actions">
          <button className="admin-action admin-action--primary" type="button" onClick={() => onAction(item, role, primaryAction)} disabled={Boolean(busyKey)}>{primaryBusy ? 'در حال انجام…' : primaryLabel}</button>
          {item.status === 'pending' && <button className="admin-action admin-action--muted" type="button" onClick={() => onAction(item, role, 'reject')} disabled={Boolean(busyKey)}>رد درخواست</button>}
          <button className="admin-action" type="button" onClick={() => onEdit(item, role)} disabled={Boolean(busyKey)}>ویرایش</button>
          <button className="admin-action admin-action--danger" type="button" onClick={() => onAction(item, role, 'delete')} disabled={Boolean(busyKey)}>آرشیو غیرمخرب</button>
        </div>
      </div>
    </article>
  );
}

function AdminEditDialog({ item, role, notice, busy, onClose, onSubmit }) {
  const isDriver = role === 'driver';
  const [form, setForm] = useState(() => isDriver
    ? { firstName: item.firstName || '', lastName: item.lastName || '', nationalId: item.nationalId || '', phone: item.phone || '', province: item.province || '' }
    : { businessName: item.businessName || '', registrationNumber: item.registrationNumber || '', nationalIdentifier: item.nationalIdentifier || '', managerName: item.managerName || '', phone: item.phone || '', province: item.province || '' });
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  return (
    <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title">
        <div className="admin-dialog__header"><div><span className="admin-eyebrow">ویرایش اطلاعات</span><h2 id="admin-dialog-title">{isDriver ? 'ویرایش راننده' : 'ویرایش کرییر'}</h2></div><button type="button" onClick={onClose} aria-label="بستن">×</button></div>
        <form className="admin-edit-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
          {isDriver ? <>
            <label><span>نام</span><input name="firstName" value={form.firstName} onChange={update} /></label>
            <label><span>نام خانوادگی</span><input name="lastName" value={form.lastName} onChange={update} /></label>
            <label><span>کد ملی</span><input name="nationalId" inputMode="numeric" value={form.nationalId} onChange={update} /></label>
          </> : <>
            <label><span>نام شرکت</span><input name="businessName" value={form.businessName} onChange={update} /></label>
            <label><span>شماره ثبت</span><input name="registrationNumber" inputMode="numeric" value={form.registrationNumber} onChange={update} /></label>
            <label><span>شناسه ملی</span><input name="nationalIdentifier" inputMode="numeric" value={form.nationalIdentifier} onChange={update} /></label>
            <label><span>نام مدیرعامل</span><input name="managerName" value={form.managerName} onChange={update} /></label>
          </>}
          <label><span>شماره تماس</span><input name="phone" inputMode="tel" value={form.phone} onChange={update} /></label>
          <label><span>استان</span><select name="province" value={form.province} onChange={update}><option value="">انتخاب استان</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
          {notice && <p className="admin-notice admin-notice--error">{notice}</p>}
          <div className="admin-dialog__actions"><button className="admin-action" type="button" onClick={onClose}>انصراف</button><button className="admin-primary-button" type="submit" disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیره تغییرات'}</button></div>
        </form>
      </section>
    </div>
  );
}

function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem('gomrok-admin-token') || '');
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState('success');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [activeTab, setActiveTab] = useState('drivers');
  const [summary, setSummary] = useState({ drivers: 0, carriers: 0, pendingDrivers: 0, pendingCarriers: 0, activeDrivers: 0, activeCarriers: 0 });
  const [drivers, setDrivers] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [busyKey, setBusyKey] = useState('');
  const [editing, setEditing] = useState(null);
  const [editNotice, setEditNotice] = useState('');

  const login = async (event) => {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const result = await apiRequest('/api/admin/login', { method: 'POST', body: JSON.stringify(form) });
      sessionStorage.setItem('gomrok-admin-token', result.token);
      setToken(result.token);
      setForm({ username: '', password: '' });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = () => setRefreshNonce((current) => current + 1);

  const performAction = async (item, role, action) => {
    const key = `${role}-${item.id}-${action}`;
    if (action === 'delete' && !window.confirm('این رکورد به‌صورت غیرمخرب غیرفعال شود؟')) return;
    setBusyKey(key);
    setNoticeTone('success');
    setNotice('');
    try {
      const result = await apiRequest(action === 'delete' ? `/api/admin/registrations/${role}/${item.id}` : `/api/admin/registrations/${role}/${item.id}/status`, {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        ...(action === 'delete' ? {} : { body: JSON.stringify({ action }) })
      });
      setNotice(result.generatedPassword ? `${result.message} رمز موقت حساب: ${result.generatedPassword}` : result.message);
      refresh();
    } catch (error) {
      setNoticeTone('error');
      setNotice(error.message);
    } finally {
      setBusyKey('');
    }
  };

  const saveEdit = async (values) => {
    if (!editing) return;
    setBusy(true);
    setEditNotice('');
    try {
      const result = await apiRequest(`/api/admin/registrations/${editing.role}/${editing.item.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(values) });
      setEditing(null);
      setNoticeTone('success');
      setNotice(result.message);
      refresh();
    } catch (error) {
      setNoticeTone('error');
      setEditNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem('gomrok-admin-token');
    sessionStorage.removeItem('gomrok-admin-step-up-token');
    setToken('');
    setDrivers([]);
    setCarriers([]);
    setSummary({ drivers: 0, carriers: 0, pendingDrivers: 0, pendingCarriers: 0, activeDrivers: 0, activeCarriers: 0 });
  };

  if (!token) return <AdminLoginPage form={form} setForm={setForm} busy={busy} notice={notice} onSubmit={login} />;

  return <Suspense fallback={<div className="platform-loading" dir="rtl">در حال آماده‌سازی پنل مدیریت…</div>}><AdminGovernancePanel user={{ role: 'super_admin', tenantId: 'platform', organizationId: 'platform' }} token={token} apiUrl={API_URL} onLogout={logout} /></Suspense>;

  const items = activeTab === 'drivers' ? drivers : carriers;
  const pendingCount = activeTab === 'drivers' ? summary.pendingDrivers : summary.pendingCarriers;
  const activeCount = activeTab === 'drivers' ? summary.activeDrivers : summary.activeCarriers;
  return (
    <div className="admin-shell">
      <div className="admin-workspace">
        <aside className="admin-sidebar">
          <div className="admin-sidebar__brand"><span className="admin-sidebar__mark">G</span><span><strong>سامانه گمرک</strong><small>gomrok.org</small></span></div>
          <span className="admin-sidebar__caption">مدیریت کاربران</span>
          <nav className="admin-sidebar__nav" aria-label="بخش‌های پنل ادمین">
            <button type="button" className={activeTab === 'drivers' ? 'admin-sidebar__item admin-sidebar__item--active' : 'admin-sidebar__item'} onClick={() => setActiveTab('drivers')}>
              <span className="admin-sidebar__item-icon">▣</span><span className="admin-sidebar__item-copy"><b>راننده‌ها</b><small>ثبت‌نام و حساب رانندگان</small></span><strong>{summary.drivers}</strong>
            </button>
            <button type="button" className={activeTab === 'carriers' ? 'admin-sidebar__item admin-sidebar__item--active' : 'admin-sidebar__item'} onClick={() => setActiveTab('carriers')}>
              <span className="admin-sidebar__item-icon">▤</span><span className="admin-sidebar__item-copy"><b>باربری‌ها</b><small>شرکت‌ها و اطلاعات ثبت‌نام</small></span><strong>{summary.carriers}</strong>
            </button>
          </nav>
          <div className="admin-sidebar__footer"><span>دسترسی ادمین</span><strong><i /> فعال و امن</strong></div>
        </aside>
        <div className="admin-content">
          <header className="admin-header">
            <div><span className="admin-header__kicker">GOMROK.ORG</span><strong>پنل ادمین</strong></div>
            <button type="button" onClick={logout}>خروج</button>
          </header>
          <main className="admin-main">
            <section className="admin-intro"><span className="admin-eyebrow">مرکز مدیریت کاربران</span><h1>اطلاعات ثبت‌نام</h1><p>راننده‌ها و باربری‌ها را جداگانه ببین، تأیید کن و حساب‌های ایجادشده را مدیریت کن.</p></section>
            <section className="admin-stats" aria-label="خلاصه کاربران">
              <button type="button" className={activeTab === 'drivers' ? 'admin-stat admin-stat--active' : 'admin-stat'} onClick={() => setActiveTab('drivers')}><span>راننده‌ها</span><strong>{summary.drivers}</strong><small>{summary.pendingDrivers || 0} در انتظار تأیید</small></button>
              <button type="button" className={activeTab === 'carriers' ? 'admin-stat admin-stat--active' : 'admin-stat'} onClick={() => setActiveTab('carriers')}><span>باربری‌ها</span><strong>{summary.carriers}</strong><small>{summary.pendingCarriers || 0} در انتظار تأیید</small></button>
            </section>
            <section className="admin-list-section">
              <div className="admin-list-heading"><div><h2>{activeTab === 'drivers' ? 'فهرست راننده‌ها' : 'فهرست باربری‌ها'}</h2><span>{items.length} مورد · {pendingCount || 0} در انتظار · {activeCount || 0} فعال</span></div><div className="admin-list-actions"><button type="button" onClick={refresh} disabled={loading || Boolean(busyKey)}>{loading ? 'در حال بروزرسانی…' : 'بروزرسانی'}</button></div></div>
              {notice && <p className={`admin-notice admin-notice--${noticeTone}`}>{notice}</p>}
              {!loading && !items.length && <div className="admin-empty"><b>هنوز داده‌ای برای نمایش نیست</b><span>بعد از ثبت فرم، اطلاعات کاربر در این بخش دیده می‌شود.</span></div>}
              <div className="admin-user-list">{items.map((item) => <AdminUserCard key={`${activeTab}-${item.id}`} item={item} type={activeTab} busyKey={busyKey} onAction={performAction} onEdit={(nextItem, nextRole) => { setEditNotice(''); setEditing({ item: nextItem, role: nextRole }); }} />)}</div>
            </section>
          </main>
        </div>
      </div>
      {editing && <AdminEditDialog item={editing.item} role={editing.role} notice={editNotice} busy={busy} onClose={() => setEditing(null)} onSubmit={saveEdit} />}
    </div>
  );
}

export default function App() {
  const initialPath = window.location.pathname;
  const isCarrierRegisterPath = ['/app/careers', '/app/careers/', '/carrier-register'].includes(initialPath);
  const isDriverRegisterPath = ['/app/driver', '/app/driver/', '/driver-register'].includes(initialPath);
  const isAdminPath = ['/admin/v2', '/admin/v2/', '/app/admin/v2', '/app/admin/v2/'].includes(initialPath);
  const initialPage = isAdminPath ? 'admin' : isCarrierRegisterPath ? 'carrier-register' : isDriverRegisterPath ? 'driver-register' : ['/carrier-login', '/driver-login'].includes(initialPath) ? 'login' : 'role-select';
  const initialRole = initialPath.startsWith('/carrier') || initialPath === '/app/careers' ? 'carrier' : 'driver';
  const [page, setPage] = useState(initialPage);
  const [loginRole, setLoginRole] = useState(initialRole);
  const [user, setUser] = useState(readSessionUser);
  const [token, setToken] = useState(() => sessionStorage.getItem('gomrok-session-token') || '');
  const [registration, setRegistration] = useState(null);

  const navigateAuth = (nextPage, nextRole) => {
    const path = nextPage === 'carrier-register' ? '/app/careers' : nextPage === 'driver-register' ? '/app/driver' : nextPage === 'role-select' ? '/app' : nextRole === 'carrier' ? '/carrier-login' : '/driver-login';
    window.history.pushState({}, '', path);
    if (nextRole) setLoginRole(nextRole);
    setPage(nextPage);
  };

  if (registration) return <RegistrationSubmittedPage registration={registration} onBack={() => { setRegistration(null); navigateAuth('role-select'); }} />;
  if (user && token) return <PlatformWorkspace user={user} token={token} apiUrl={API_URL} onLogout={() => { sessionStorage.removeItem('gomrok-session-token'); sessionStorage.removeItem('gomrok-refresh-token'); sessionStorage.removeItem('gomrok-session-user'); sessionStorage.removeItem('gomrok-admin-step-up-token'); setToken(''); setUser(null); navigateAuth('login', user.role === 'carrier' ? 'carrier' : 'driver'); }} />;
  if (page === 'admin') return <AdminPage />;
  if (page === 'role-select') return <RoleSelectionPage onDriverRegister={() => navigateAuth('driver-register', 'driver')} onCarrierRegister={() => navigateAuth('carrier-register', 'carrier')} />;
  if (page === 'driver-register') return <RegisterPage onBack={() => navigateAuth('role-select')} onRegistered={setRegistration} />;
  if (page === 'carrier-register') return <CarrierRegisterPage onBack={() => navigateAuth('role-select')} onRegistered={setRegistration} />;
  return (
    <LoginPage
      initialRole={loginRole}
      onRoleChange={(nextRole) => navigateAuth('login', nextRole)}
      onDriverRegister={() => navigateAuth('driver-register', 'driver')}
      onCarrierRegister={() => navigateAuth('carrier-register', 'carrier')}
      onLoggedIn={(nextUser, nextToken, nextRefreshToken) => { sessionStorage.setItem('gomrok-session-token', nextToken); sessionStorage.setItem('gomrok-session-user', JSON.stringify(nextUser)); if (nextRefreshToken) sessionStorage.setItem('gomrok-refresh-token', nextRefreshToken); setToken(nextToken); setUser(nextUser); }}
    />
  );
}
