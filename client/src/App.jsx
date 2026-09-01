import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { provinces } from './data/iranLocations.js';
import PlatformWorkspace from './components/PlatformWorkspace.jsx';
import { Icon, ProductLogo } from './components/ProductIcon.jsx';
const AdminGovernancePanel = lazy(() => import('./components/AdminGovernancePanel.jsx'));

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? APP_BASE : 'http://127.0.0.1:4000');
const onboardingVisuals = {
  driver: {
    src: `${APP_BASE}/images/gomrok-driver-onboarding.jpg`,
    width: 1536,
    height: 1024,
    alt: 'راننده حرفه‌ای در کنار کامیون باری در شبکه حمل‌ونقل گمرک'
  },
  carrier: {
    src: `${APP_BASE}/images/gomrok-carrier-onboarding.jpg`,
    width: 1774,
    height: 887,
    alt: 'مدیر ناوگان و کامیون‌ها در پایانه عملیاتی شرکت حمل'
  }
};
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
  return <div className={`brand${variant === 'welcome' ? ' brand--welcome' : ''}`}><ProductLogo subtitle="شبکه هوشمند حمل‌ونقل و گمرک" /></div>;
}

function FormIcon({ name }) {
  return <Icon className="field-icon" name={name} size={22} />;
}

function OnboardingImage({ role, className = '', decorative = false, loading = 'eager' }) {
  const visual = onboardingVisuals[role] || onboardingVisuals.driver;
  return (
    <img
      className={className}
      src={visual.src}
      width={visual.width}
      height={visual.height}
      alt={decorative ? '' : visual.alt}
      loading={loading}
      decoding="async"
      fetchPriority={loading === 'eager' ? 'high' : 'auto'}
    />
  );
}

function Field({ label, name, value, onChange, type = 'text', placeholder, inputMode, autoComplete, wide = false, compact = false, icon, required = false, maxLength }) {
  const technicalInput = inputMode === 'numeric' || inputMode === 'tel';
  return (
    <label className={`field${wide ? ' field--wide' : ''}${compact ? ' field--compact' : ''}`}>
      <span className={compact ? 'field__compact-label' : 'field__label'}>{label}{required && <b aria-hidden="true"> *</b>}</span>
      {compact && <span className="field__icon">{icon}</span>}
      <input
        name={name}
        value={value}
        onChange={onChange}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        dir={technicalInput ? 'ltr' : 'rtl'}
        required={required}
        maxLength={maxLength}
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
    const closeWithKeyboard = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeWithKeyboard);
    };
  }, []);

  return (
    <label className={`field${compact ? ' field--compact' : ''}`} ref={rootRef}>
      <span className={compact ? 'field__compact-label' : 'field__label'}>{label}</span>
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
          <b aria-hidden="true"><Icon name="chevron" size={18} /></b>
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
      <span className="secure-pill"><Icon name="shield" size={16} /> ارتباط امن</span>
    </header>
  );
}

function LogisticsIllustration() {
  return (
    <div className="logistics-art">
      <div className="logistics-art__primary">
        <OnboardingImage role="carrier" className="logistics-art__image" />
        <span className="logistics-art__route"><Icon name="route" size={17} /> تهران · بازرگان · استانبول</span>
      </div>
      <div className="logistics-art__secondary">
        <OnboardingImage role="driver" className="logistics-art__image" decorative />
        <span><Icon name="tracking" size={16} /> ردیابی زنده</span>
      </div>
      <div className="logistics-art__status">
        <i><Icon name="shield" size={20} /></i>
        <span><strong>عملیات تأییدشده</strong><small>مدارک، مسیر و تحویل در یک جریان امن</small></span>
      </div>
      <span className="logistics-art__pulse logistics-art__pulse--one" />
      <span className="logistics-art__pulse logistics-art__pulse--two" />
    </div>
  );
}

function TruckLineIcon() {
  return <OnboardingImage role="driver" className="role-card__art" decorative />;
}

function WarehouseLineIcon() {
  return <OnboardingImage role="carrier" className="role-card__art" decorative />;
}

function AuthVisual({ role }) {
  const isCarrier = role === 'carrier';
  return (
    <aside className={`auth-visual auth-visual--${role}`}>
      <OnboardingImage role={role} className="auth-visual__image" />
      <div className="auth-visual__content">
        <span><Icon name="shield" size={16} /> GOMROK CONTROL NETWORK</span>
        <strong>{isCarrier ? 'ناوگان و فرصت‌ها، در یک دید عملیاتی.' : 'هر سفر، یک مسیر روشن و امن.'}</strong>
        <small>{isCarrier ? 'ورود به مرکز عملیات شرکت حمل' : 'ورود به اپ عملیاتی رانندگان'}</small>
      </div>
    </aside>
  );
}

function RoleSelectionPage({ onDriverLogin, onCarrierLogin }) {
  return (
    <div className="screen screen--welcome">
      <main className="role-main">
        <div className="welcome-brand"><Brand variant="welcome" /><span className="secure-pill"><Icon name="shield" size={15} /> زیرساخت امن و قابل حسابرسی</span></div>
        <LogisticsIllustration />
        <section className="welcome-copy">
          <span className="eyebrow"><Icon name="route" size={16} /> شروع یک مسیر مطمئن</span>
          <h1>عملیات حمل‌ونقل،<br /><em>روشن و قابل کنترل.</em></h1>
          <p className="lead">از ثبت بار تا تحویل و تسویه، همه‌چیز در یک شبکه امن، شفاف و متصل.</p>
        </section>

        <section className="role-cards" aria-label="انتخاب نوع حساب">
          <button className="role-card role-card--driver" type="button" onClick={onDriverLogin}>
            <span className="role-card__icon"><TruckLineIcon /></span>
            <span className="role-card__copy"><strong>راننده هستم</strong><small>ورود به حساب یا ثبت‌نام جدید</small></span>
            <b aria-hidden="true"><Icon name="arrow" size={20} /></b>
          </button>
          <button className="role-card role-card--carrier" type="button" onClick={onCarrierLogin}>
            <span className="role-card__icon"><WarehouseLineIcon /></span>
            <span className="role-card__copy"><strong>شرکت حمل هستم</strong><small>ورود به پنل یا ثبت‌نام شرکت</small></span>
            <b aria-hidden="true"><Icon name="arrow" size={20} /></b>
          </button>
        </section>

        <section className="role-benefits" aria-label="مزیت‌های سامانه">
          <div className="role-benefit"><Icon name="shield" size={20} /><span>تسویه امن</span></div>
          <i aria-hidden="true" />
          <div className="role-benefit"><Icon name="support" size={20} /><span>پشتیبانی تخصصی</span></div>
          <i aria-hidden="true" />
          <div className="role-benefit"><Icon name="tracking" size={20} /><span>سریع و شفاف</span></div>
        </section>
        <p className="role-registration-note">ثبت‌نام اولیه رایگان است · اطلاعات شما در محدوده دسترسی سازمانی محافظت می‌شود.</p>
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
    <div className="screen screen--auth">
      <AuthHeader />
      <div className="auth-layout">
        <AuthVisual role={isCarrier ? 'carrier' : 'driver'} />
      <main className="auth-main auth-layout__form">
        <div className="role-switch" aria-label="انتخاب نوع حساب">
          <button className={!isCarrier ? 'role-switch__active' : ''} type="button" onClick={() => changeRole('driver')}>راننده</button>
          <button className={isCarrier ? 'role-switch__active' : ''} type="button" onClick={() => changeRole('carrier')}>شرکت حمل‌ونقل</button>
        </div>
        <span className="eyebrow"><Icon name={isCarrier ? 'fleet' : 'driver'} size={16} /> {isCarrier ? 'پنل اختصاصی شرکت‌های حمل' : 'اپ عملیاتی رانندگان'}</span>
        <h1>{isCarrier ? 'خوش آمدی، شرکت حمل‌ونقل' : 'خوش آمدی، راننده'}</h1>
        <p className="lead">{isCarrier ? 'برای مدیریت ناوگان و بارها وارد حساب شرکت حمل‌ونقل شو.' : 'برای دیدن سفرها و مأموریت‌ها وارد حساب خودت شو.'}</p>

        <form className="auth-card" onSubmit={submit}>
          <div className="card-title"><span>ورود به حساب {isCarrier ? 'شرکت حمل‌ونقل' : 'راننده'}</span><b><Icon name="lock" size={17} /></b></div>
          <Field label="شماره موبایل" name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="۰۹۱۲۱۲۳۴۵۶۷" inputMode="tel" autoComplete="tel" />
          <Field label="رمز عبور" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="رمز عبور خود را وارد کن" autoComplete="current-password" />
          {notice && <p className="notice notice--error">{notice}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'در حال ورود…' : `ورود به پنل ${isCarrier ? 'شرکت حمل‌ونقل' : 'راننده'}`}</button>
          <button className="text-button" type="button">فراموشی رمز عبور؟</button>
        </form>

        <div className="auth-switch">{isCarrier ? 'حساب شرکت حمل‌ونقل نداری؟' : 'حساب راننده نداری؟'} <button type="button" onClick={isCarrier ? onCarrierRegister : onDriverRegister}>ثبت‌نام کن</button></div>
      </main>
      </div>
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
      <main className="register-main">
        <RegistrationVisual role="driver" />
        <section className="register-main__form-column">
        <form className="auth-card auth-card--register register-form" onSubmit={submit}>
          <div className="register-form__intro"><strong>اطلاعات راننده</strong><small>اطلاعات شما پس از بررسی ادمین به حساب کاربری تبدیل می‌شود.</small></div>
          <div className="form-grid form-grid--register">
            <Field label="نام" name="firstName" value={form.firstName} onChange={update} autoComplete="given-name" compact required maxLength={60} icon={<FormIcon name="user" />} />
            <Field label="نام خانوادگی" name="lastName" value={form.lastName} onChange={update} autoComplete="family-name" compact required maxLength={80} icon={<FormIcon name="user" />} />
            <Field label="کد ملی" name="nationalId" value={form.nationalId} onChange={update} inputMode="numeric" compact required maxLength={10} icon={<FormIcon name="identity" />} />
            <Field label="شماره تماس" name="phone" value={form.phone} onChange={update} inputMode="tel" autoComplete="tel" compact required maxLength={11} icon={<FormIcon name="phone" />} />
            <CustomSelect label="استان" value={form.province} onChange={(province) => setForm((current) => ({ ...current, province }))} options={provinces} compact icon={<FormIcon name="location" />} />
          </div>

          {notice && <p className="notice notice--error">{notice}</p>}
          <button className="primary-button register-form__submit" type="submit" disabled={busy}>{busy ? 'در حال ثبت اطلاعات…' : 'ارسال اطلاعات راننده'}</button>
        </form>
        <p className="register-main__privacy"><Icon name="lock" size={15} /> اطلاعات هویتی فقط برای احراز صلاحیت و فعال‌سازی حساب استفاده می‌شود.</p>
        </section>
      </main>
    </div>
  );
}

function RegisterHeader({ role, onBack }) {
  const isCarrier = role === 'carrier';
  const steps = ['اطلاعات پایه', 'بررسی اطلاعات', 'ایجاد حساب'];

  return (
    <header className={`register-header register-header--${role}`}>
      <button className="register-header__back" type="button" onClick={onBack} aria-label="بازگشت به انتخاب نقش"><Icon name="arrow" size={22} /></button>
      <div className="register-header__title"><strong>ثبت‌نام {isCarrier ? 'شرکت حمل‌ونقل' : 'راننده'}</strong><small>gomrok.org</small></div>
      <span className="register-header__icon"><OnboardingImage role={isCarrier ? 'carrier' : 'driver'} decorative /></span>
      <div className="register-steps" aria-label="مراحل ثبت‌نام">
        {steps.map((step, index) => (
          <span className={`register-step${index === 0 ? ' register-step--active' : ''}`} key={step}>
            <b>{index === 0 ? <Icon name="check" size={15} /> : index + 1}</b><small>{step}</small>
          </span>
        )).reduce((items, step, index, stepsList) => (index < stepsList.length - 1 ? [...items, step, <i key={`line-${index}`} />] : [...items, step]), [])}
      </div>
    </header>
  );
}

function CarrierRegisterHeader({ onBack }) {
  return <RegisterHeader role="carrier" onBack={onBack} />;
}

function RegistrationVisual({ role }) {
  const isCarrier = role === 'carrier';
  const benefits = isCarrier
    ? ['احراز هویت سازمانی', 'فعال‌سازی فرصت‌های RFQ', 'کنترل امن ناوگان']
    : ['احراز هویت راننده', 'دسترسی امن به مأموریت‌ها', 'ثبت مدارک و تحویل'];

  return (
    <aside className={`register-visual register-visual--${role}`}>
      <OnboardingImage role={role} className="register-visual__image" />
      <div className="register-visual__content">
        <span className="register-visual__eyebrow"><Icon name={isCarrier ? 'building' : 'identity'} size={17} /> ثبت‌نام تأییدمحور</span>
        <h2>{isCarrier ? 'شرکت حمل خود را به شبکه عملیاتی متصل کنید.' : 'مسیر حرفه‌ای خود را از یک حساب امن آغاز کنید.'}</h2>
        <p>{isCarrier ? 'اطلاعات سازمان، مدیر و محدوده فعالیت برای فعال‌سازی پنل بررسی می‌شود.' : 'اطلاعات پایه شما برای احراز هویت و تخصیص مأموریت‌های معتبر بررسی می‌شود.'}</p>
        <ul>{benefits.map((benefit) => <li key={benefit}><Icon name="check" size={15} /> {benefit}</li>)}</ul>
      </div>
    </aside>
  );
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
      <main className="register-main">
        <RegistrationVisual role="carrier" />
        <section className="register-main__form-column">
        <form className="auth-card auth-card--register auth-card--carrier register-form" onSubmit={submit}>
          <div className="register-form__intro"><strong>اطلاعات شرکت حمل‌ونقل</strong><small>اطلاعات شرکت پس از بررسی ادمین به حساب تبدیل می‌شود.</small></div>
          <div className="form-grid form-grid--register">
            <Field label="نام شرکت" name="businessName" value={form.businessName} onChange={update} autoComplete="organization" compact required maxLength={120} icon={<FormIcon name="building" />} />
            <Field label="شماره ثبت" name="registrationNumber" value={form.registrationNumber} onChange={update} inputMode="numeric" compact required maxLength={20} icon={<FormIcon name="identity" />} />
            <Field label="شناسه ملی" name="nationalIdentifier" value={form.nationalIdentifier} onChange={update} inputMode="numeric" compact required maxLength={11} icon={<FormIcon name="identity" />} />
            <Field label="نام مدیرعامل" name="managerName" value={form.managerName} onChange={update} autoComplete="name" compact required maxLength={100} icon={<FormIcon name="user" />} />
            <Field label="شماره تماس" name="phone" value={form.phone} onChange={update} inputMode="tel" autoComplete="tel" compact required maxLength={11} icon={<FormIcon name="phone" />} />
            <CustomSelect label="استان" value={form.province} onChange={(province) => setForm((current) => ({ ...current, province }))} options={provinces} compact icon={<FormIcon name="location" />} />
          </div>

          {notice && <p className="notice notice--error">{notice}</p>}
          <button className="primary-button register-form__submit" type="submit" disabled={busy}>{busy ? 'در حال ثبت اطلاعات…' : 'ارسال اطلاعات شرکت حمل‌ونقل'}</button>
        </form>
        <p className="register-main__privacy"><Icon name="lock" size={15} /> اطلاعات سازمانی در محدوده دسترسی تأییدشده نگهداری می‌شود.</p>
        </section>
      </main>
    </div>
  );
}

function MaintenancePage({ user, onLogout }) {
  const isCarrier = user?.role === 'carrier';
  const accountLabel = isCarrier ? 'شرکت حمل‌ونقل' : 'راننده';

  return (
    <div className="screen screen--maintenance">
      <AuthHeader />
      <main className="maintenance-main">
        <div className="maintenance-icon" aria-hidden="true"><Icon name="refresh" size={34} /></div>
        <span className="eyebrow">حساب {accountLabel} آماده شد</span>
        <h1>در حال بروزرسانی هستیم</h1>
        <p className="lead">ورودت با موفقیت انجام شد. بخش‌های اصلی سامانه را برای یک تجربه بهتر در حال آماده‌سازی هستیم.</p>

        <section className="maintenance-card">
          <div className="maintenance-card__row"><i className="maintenance-card__dot maintenance-card__dot--done" /><span>حساب شما با موفقیت ثبت شد</span><b><Icon name="check" size={20} /></b></div>
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
        <div className="maintenance-icon maintenance-icon--success" aria-hidden="true"><Icon name="check" size={34} /></div>
        <span className="eyebrow">ثبت اطلاعات با موفقیت انجام شد</span>
        <h1>{title}</h1>
        <p className="lead">{name || 'اطلاعات شما'} با موفقیت ثبت شد. سامانه در حال توسعه است و درخواست شما پس از بررسی در صف آماده‌سازی حساب قرار می‌گیرد.</p>

        <section className="maintenance-card">
          <div className="maintenance-card__row"><i className="maintenance-card__dot maintenance-card__dot--done" /><span>اطلاعات اولیه دریافت شد</span><b><Icon name="check" size={20} /></b></div>
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
        <h1>سلام {user?.firstName || 'راننده'}</h1>
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
        <p className="eyebrow">پنل شرکت حمل‌ونقل</p>
        <h1>{user?.businessName || 'شرکت حمل شما'}</h1>
        <p className="lead">ناوگان، راننده‌ها و درخواست‌های حمل را از همین‌جا مدیریت کن.</p>
        <section className="status-card"><span>وضعیت حساب شرکت حمل‌ونقل</span><strong>فعال</strong><small>{user?.province || 'ایران'} · {user?.city || 'محل دفتر ثبت‌شده'}</small></section>
        <div className="home-grid">
          <article><b>۰</b><span>راننده‌های فعال</span><small>برای اتصال به ناوگان</small></article>
          <article><b>۰</b><span>خودروهای ثبت‌شده</span><small>فعلاً موردی ثبت نشده</small></article>
          <article><b>۰</b><span>درخواست حمل</span><small>در انتظار بررسی</small></article>
          <article><b>۰</b><span>تیکت باز</span><small>پشتیبانی در دسترس است</small></article>
        </div>
        <section className="next-card"><div><span className="eyebrow">گام بعدی</span><strong>تکمیل پروفایل شرکت حمل‌ونقل</strong><p>مجوز، ناوگان و راننده‌های خودت را در مرحله بعد به حساب اضافه می‌کنیم.</p></div><button type="button">بعداً</button></section>
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
        <div className="admin-login-brand"><ProductLogo subtitle="ورود امن مدیریت" /></div>
        <span className="admin-eyebrow">دسترسی مدیریتی امن</span>
        <h1>ورود به پنل مدیریت</h1>
        <p className="admin-muted">اطلاعات ثبت‌نام راننده‌ها و شرکت‌های حمل‌ونقل را از اینجا مدیریت کن.</p>
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
        <div className="admin-dialog__header"><div><span className="admin-eyebrow">ویرایش اطلاعات</span><h2 id="admin-dialog-title">{isDriver ? 'ویرایش راننده' : 'ویرایش شرکت حمل‌ونقل'}</h2></div><button type="button" onClick={onClose} aria-label="بستن">×</button></div>
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
          <div className="admin-sidebar__brand"><ProductLogo subtitle="مدیریت کاربران" /></div>
          <span className="admin-sidebar__caption">مدیریت کاربران</span>
          <nav className="admin-sidebar__nav" aria-label="بخش‌های پنل ادمین">
            <button type="button" className={activeTab === 'drivers' ? 'admin-sidebar__item admin-sidebar__item--active' : 'admin-sidebar__item'} onClick={() => setActiveTab('drivers')}>
              <span className="admin-sidebar__item-icon"><Icon name="driver" size={20} /></span><span className="admin-sidebar__item-copy"><b>راننده‌ها</b><small>ثبت‌نام و حساب رانندگان</small></span><strong>{summary.drivers}</strong>
            </button>
            <button type="button" className={activeTab === 'carriers' ? 'admin-sidebar__item admin-sidebar__item--active' : 'admin-sidebar__item'} onClick={() => setActiveTab('carriers')}>
              <span className="admin-sidebar__item-icon"><Icon name="fleet" size={20} /></span><span className="admin-sidebar__item-copy"><b>باربری‌ها</b><small>شرکت‌ها و اطلاعات ثبت‌نام</small></span><strong>{summary.carriers}</strong>
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

const DESIGN_PREVIEW_USERS = {
  shipper: { role: 'shipper_admin', tenantId: 'preview-tenant', organizationId: 'preview-shipper', userId: 'preview-shipper-admin' },
  'company-x': { role: 'company_x_owner', tenantId: 'preview-tenant', organizationId: 'preview-company-x', userId: 'preview-company-x-owner' },
  'company-y': { role: 'company_y_owner', tenantId: 'preview-tenant', organizationId: 'preview-company-y', userId: 'preview-company-y-owner' },
  driver: { role: 'driver', tenantId: 'preview-tenant', organizationId: 'preview-company-y', userId: 'preview-driver' },
  agent: { role: 'agent_z', tenantId: 'preview-tenant', organizationId: 'preview-agent-z', userId: 'preview-agent' },
  admin: { role: 'super_admin', tenantId: 'preview-tenant', organizationId: 'preview-platform', userId: 'preview-admin' }
};

const DESIGN_PREVIEW_PANELS = [
  { slug: 'shipper', title: 'صاحب بار', description: 'بار، RFQ، قرارداد، رهگیری، اسناد و تسویه', icon: 'cargo', meta: 'Shipper / Customer' },
  { slug: 'company-x', title: 'شرکت لجستیک X', description: 'فرصت‌ها، قیمت‌گذاری، پروژه‌ها و عملیات حمل', icon: 'route', meta: 'Logistics Company X' },
  { slug: 'company-y', title: 'شرکت حمل Y', description: 'ناوگان، راننده، تخصیص بار، سفر و مالی', icon: 'fleet', meta: 'Carrier / Company Y' },
  { slug: 'driver', title: 'راننده', description: 'ماموریت، چک‌این، GPS، مدارک، POD و تسویه', icon: 'driver', meta: 'Driver Mobile App' },
  { slug: 'agent', title: 'نماینده مقصد Z', description: 'تحویل، احراز مقصد، شواهد، CMR و مغایرت', icon: 'agent', meta: 'Destination Agent' },
  { slug: 'admin', title: 'حاکمیت پلتفرم', description: 'KYC، ریسک، حسابرسی، امنیت و کنترل بازار', icon: 'shield', meta: 'Admin / Governance' }
];

const DESIGN_PREVIEW_PUBLIC_SURFACES = [
  { href: '/app', title: 'انتخاب نوع حساب', description: 'صفحه شروع عمومی', icon: 'home' },
  { href: '/driver-login', title: 'ورود راننده', description: 'ورود به اپ عملیاتی', icon: 'driver' },
  { href: '/carrier-login', title: 'ورود شرکت حمل', description: 'ورود به پنل شرکت حمل‌ونقل', icon: 'fleet' },
  { href: '/app/driver', title: 'ثبت‌نام راننده', description: 'فرآیند درخواست عضویت', icon: 'user' },
  { href: '/app/careers', title: 'ثبت‌نام شرکت حمل', description: 'درخواست عضویت سازمانی', icon: 'organization' },
  { href: '/admin/v2', title: 'ورود مدیریت', description: 'درگاه امن راهبری', icon: 'shield' }
];

function DesignPreviewHub() {
  return (
    <div className="preview-hub" dir="rtl">
      <header className="preview-hub__header">
        <ProductLogo subtitle="مرکز بازبینی تجربه محصول" />
        <span><Icon name="audit" size={16} /> فقط محیط توسعه</span>
      </header>
      <main className="preview-hub__main">
        <section className="preview-hub__hero">
          <div>
            <span className="eyebrow"><Icon name="route" size={16} /> GOMROK ROUTE PULSE</span>
            <h1>تمام تجربه محصول،<br /><em>بدون ثبت‌نام.</em></h1>
            <p>هر شش پنل عملیاتی و همه مسیرهای عمومی را از همین صفحه باز کن. این لینک‌ها فقط در حالت توسعه فعال هستند.</p>
          </div>
          <OnboardingImage role="carrier" className="preview-hub__illustration preview-hub__illustration--photo" decorative loading="lazy" />
        </section>

        <section className="preview-hub__section" aria-labelledby="panel-preview-title">
          <div className="preview-hub__section-heading">
            <div><span>۶ فضای کاری</span><h2 id="panel-preview-title">پنل‌های عملیاتی</h2></div>
            <small>داده نمایشی محلی · بدون دور زدن مجوزهای تولید</small>
          </div>
          <div className="preview-hub__panel-grid">
            {DESIGN_PREVIEW_PANELS.map((panel, index) => (
              <a className="preview-hub__panel" href={`/app/preview/${panel.slug}`} key={panel.slug}>
                <span className="preview-hub__index">۰{index + 1}</span>
                <span className="preview-hub__panel-icon"><Icon name={panel.icon} size={25} /></span>
                <span className="preview-hub__panel-copy"><small dir="ltr">{panel.meta}</small><strong>{panel.title}</strong><em>{panel.description}</em></span>
                <span className="preview-hub__open" aria-hidden="true"><Icon name="arrow" size={18} /></span>
              </a>
            ))}
          </div>
        </section>

        <section className="preview-hub__section preview-hub__section--public" aria-labelledby="public-preview-title">
          <div className="preview-hub__section-heading"><div><span>ورود و عضویت</span><h2 id="public-preview-title">صفحه‌های عمومی</h2></div></div>
          <div className="preview-hub__public-grid">
            {DESIGN_PREVIEW_PUBLIC_SURFACES.map((surface) => (
              <a className="preview-hub__public-card" href={surface.href} key={surface.href}>
                <span><Icon name={surface.icon} size={21} /></span>
                <strong>{surface.title}</strong>
                <small>{surface.description}</small>
                <Icon name="arrow" size={16} />
              </a>
            ))}
          </div>
        </section>
      </main>
      <footer className="preview-hub__footer"><span>GOMROK DESIGN SYSTEM 2026</span><small>RTL · Responsive · Accessible</small></footer>
    </div>
  );
}

function readDesignPreviewRole(pathname) {
  if (!import.meta.env.DEV) return '';
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const match = normalizedPath.match(/^\/app\/preview\/([^/]+)$/);
  return match && DESIGN_PREVIEW_USERS[match[1]] ? match[1] : '';
}

export default function App() {
  const initialPath = window.location.pathname;
  const normalizedInitialPath = initialPath.replace(/\/+$/, '') || '/';
  const isDesignPreviewHub = import.meta.env.DEV && normalizedInitialPath === '/app/preview';
  const designPreviewRole = readDesignPreviewRole(initialPath);
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

  if (isDesignPreviewHub) return <DesignPreviewHub />;

  if (designPreviewRole) {
    return <PlatformWorkspace user={DESIGN_PREVIEW_USERS[designPreviewRole]} token="local-design-preview" apiUrl="" onLogout={() => { window.history.pushState({}, '', '/app'); window.location.reload(); }} />;
  }

  const navigateAuth = (nextPage, nextRole) => {
    const path = nextPage === 'carrier-register' ? '/app/careers' : nextPage === 'driver-register' ? '/app/driver' : nextPage === 'role-select' ? '/app' : nextRole === 'carrier' ? '/carrier-login' : '/driver-login';
    window.history.pushState({}, '', path);
    if (nextRole) setLoginRole(nextRole);
    setPage(nextPage);
  };

  if (registration) return <RegistrationSubmittedPage registration={registration} onBack={() => { setRegistration(null); navigateAuth('role-select'); }} />;
  if (user && token) return <PlatformWorkspace user={user} token={token} apiUrl={API_URL} onLogout={() => { sessionStorage.removeItem('gomrok-session-token'); sessionStorage.removeItem('gomrok-refresh-token'); sessionStorage.removeItem('gomrok-session-user'); sessionStorage.removeItem('gomrok-admin-step-up-token'); setToken(''); setUser(null); navigateAuth('login', user.role === 'carrier' ? 'carrier' : 'driver'); }} />;
  if (page === 'admin') return <AdminPage />;
  if (page === 'role-select') return <RoleSelectionPage onDriverLogin={() => navigateAuth('login', 'driver')} onCarrierLogin={() => navigateAuth('login', 'carrier')} />;
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
