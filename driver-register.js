const registerForm = document.querySelector('#driver-register-form');
const toast = document.querySelector('#register-toast');
const provinceSelect = document.querySelector('#driver-province');
const citySelect = document.querySelector('#driver-city');
let toastTimer;

const iranCitiesByProvince = {
  'آذربایجان شرقی': ['تبریز', 'مراغه', 'مرند', 'اهر', 'میانه', 'شبستر', 'جلفا', 'اسکو', 'بناب', 'سراب', 'هشترود', 'عجب‌شیر', 'بستان‌آباد', 'هریس', 'ورزقان', 'کلیبر', 'خداآفرین', 'چاراویماق'],
  'آذربایجان غربی': ['ارومیه', 'خوی', 'مهاباد', 'میاندوآب', 'بوکان', 'سلماس', 'پیرانشهر', 'نقده', 'ماکو', 'سردشت', 'شاهین‌دژ', 'تکاب', 'اشنویه', 'چالدران', 'شوط', 'پلدشت', 'چایپاره', 'چهاربرج'],
  'اردبیل': ['اردبیل', 'پارس‌آباد', 'مشگین‌شهر', 'خلخال', 'گرمی', 'نمین', 'نیر', 'کوثر', 'بیله‌سوار', 'اصلاندوز', 'سرعین'],
  'اصفهان': ['اصفهان', 'کاشان', 'خمینی‌شهر', 'نجف‌آباد', 'شاهین‌شهر', 'شهرضا', 'مبارکه', 'فلاورجان', 'زرین‌شهر', 'گلپایگان', 'نطنز', 'نائین', 'اردستان', 'فریدن', 'فریدون‌شهر', 'سمیرم', 'تیران', 'خوانسار', 'آران و بیدگل', 'خور و بیابانک', 'دهاقان', 'برخوار', 'چادگان', 'بوئین و میاندشت', 'ورزنه'],
  'البرز': ['کرج', 'فردیس', 'نظرآباد', 'ساوجبلاغ', 'هشتگرد', 'طالقان', 'اشتهارد', 'چهارباغ'],
  'ایلام': ['ایلام', 'دهلران', 'مهران', 'آبدانان', 'دره‌شهر', 'ایوان', 'چرداول', 'بدره', 'ملکشاهی', 'سیروان', 'هلیلان'],
  'بوشهر': ['بوشهر', 'برازجان', 'گناوه', 'کنگان', 'عسلویه', 'دیر', 'دیلم', 'جم', 'خورموج', 'اهرم'],
  'تهران': ['تهران', 'ری', 'شمیرانات', 'اسلامشهر', 'شهریار', 'ملارد', 'قدس', 'ورامین', 'پاکدشت', 'رباط‌کریم', 'دماوند', 'فیروزکوه', 'پردیس', 'بهارستان', 'پیشوا', 'قرچک'],
  'چهارمحال و بختیاری': ['شهرکرد', 'بروجن', 'فارسان', 'لردگان', 'سامان', 'بن', 'کیار', 'اردل', 'کوهرنگ', 'خانمیرزا'],
  'خراسان جنوبی': ['بیرجند', 'قائن', 'طبس', 'فردوس', 'نهبندان', 'سربیشه', 'درمیان', 'سرایان', 'بشرویه', 'زیرکوه', 'خوسف'],
  'خراسان رضوی': ['مشهد', 'نیشابور', 'سبزوار', 'تربت حیدریه', 'تربت جام', 'قوچان', 'کاشمر', 'چناران', 'گناباد', 'فریمان', 'درگز', 'خواف', 'تایباد', 'بردسکن', 'سرخس', 'بجستان', 'جغتای', 'جوین', 'خلیل‌آباد', 'فیروزه', 'خوشاب', 'زاوه', 'کوهسرخ', 'باخرز', 'داورزن', 'طرقبه شاندیز', 'مه‌ولات', 'رشتخوار'],
  'خراسان شمالی': ['بجنورد', 'شیروان', 'اسفراین', 'جاجرم', 'گرمه', 'فاروج', 'مانه و سملقان', 'راز و جرگلان'],
  'خوزستان': ['اهواز', 'آبادان', 'خرمشهر', 'دزفول', 'بندر ماهشهر', 'شوشتر', 'بهبهان', 'اندیمشک', 'شوش', 'مسجدسلیمان', 'ایذه', 'رامهرمز', 'امیدیه', 'آغاجاری', 'رامشیر', 'هندیجان', 'باغ‌ملک', 'لالی', 'گتوند', 'هفتکل', 'باوی', 'کارون', 'حمیدیه', 'دشت آزادگان', 'هویزه', 'کرخه', 'اندیکا', 'صیدون', 'سردشت'],
  'زنجان': ['زنجان', 'ابهر', 'خرمدره', 'قیدار', 'خدابنده', 'طارم', 'ماهنشان', 'ایجرود', 'سلطانیه'],
  'سمنان': ['سمنان', 'شاهرود', 'دامغان', 'گرمسار', 'مهدی‌شهر', 'سرخه', 'میامی', 'آرادان'],
  'سیستان و بلوچستان': ['زاهدان', 'چابهار', 'زابل', 'ایرانشهر', 'سراوان', 'خاش', 'نیکشهر', 'کنارک', 'دلگان', 'فنوج', 'سرباز', 'راسک', 'میرجاوه', 'هامون', 'هیرمند', 'نیمروز', 'قصرقند', 'دشتیاری', 'مهرستان', 'سیب و سوران', 'بمپور', 'تفتان', 'گلشن', 'لاشار', 'بنت'],
  'فارس': ['شیراز', 'مرودشت', 'جهرم', 'فسا', 'کازرون', 'لار', 'داراب', 'آباده', 'فیروزآباد', 'نورآباد', 'اقلید', 'لامرد', 'نی‌ریز', 'استهبان', 'زرین‌دشت', 'خرامه', 'سروستان', 'ارسنجان', 'سپیدان', 'ممسنی', 'قیروکارزین', 'خنج', 'اوز', 'گراش', 'بوانات', 'خفر', 'کوار', 'بختگان', 'سرچهان', 'فراشبند', 'بیضا', 'پاسارگاد'],
  'قزوین': ['قزوین', 'تاکستان', 'آبیک', 'بوئین‌زهرا', 'البرز', 'آوج'],
  'قم': ['قم', 'جعفریه', 'کهک', 'سلفچگان', 'دستجرد'],
  'کردستان': ['سنندج', 'سقز', 'مریوان', 'بانه', 'قروه', 'بیجار', 'کامیاران', 'دیواندره', 'دهگلان', 'سروآباد'],
  'کرمان': ['کرمان', 'رفسنجان', 'سیرجان', 'جیرفت', 'بم', 'زرند', 'شهربابک', 'بافت', 'کهنوج', 'بردسیر', 'راور', 'کوهبنان', 'منوجان', 'عنبرآباد', 'قلعه‌گنج', 'فهرج', 'ریگان', 'نرماشیر', 'رودبار جنوب', 'ارزوئیه', 'رابر', 'فاریاب', 'گلباف', 'ماهان'],
  'کرمانشاه': ['کرمانشاه', 'اسلام‌آباد غرب', 'پاوه', 'جوانرود', 'کنگاور', 'صحنه', 'هرسین', 'سنقر', 'قصرشیرین', 'سرپل‌ذهاب', 'گیلانغرب', 'ثلاث باباجانی', 'روانسر', 'دالاهو', 'کوزران'],
  'کهگیلویه و بویراحمد': ['یاسوج', 'دهدشت', 'گچساران', 'سی‌سخت', 'لیکک', 'چرام', 'باشت', 'لنده', 'مارگون'],
  'گلستان': ['گرگان', 'گنبدکاووس', 'علی‌آباد کتول', 'بندر ترکمن', 'بندر گز', 'کردکوی', 'آق‌قلا', 'آزادشهر', 'مینودشت', 'کلاله', 'رامیان', 'گالیکش', 'مراوه‌تپه', 'گمیشان', 'فندرسک'],
  'گیلان': ['رشت', 'بندر انزلی', 'لاهیجان', 'لنگرود', 'آستارا', 'رودسر', 'رودبار', 'فومن', 'صومعه‌سرا', 'آستانه اشرفیه', 'تالش', 'ماسال', 'رضوانشهر', 'شفت', 'سیاهکل', 'املش', 'خمام'],
  'لرستان': ['خرم‌آباد', 'بروجرد', 'دورود', 'کوهدشت', 'الیگودرز', 'دلفان', 'سلسله', 'پلدختر', 'ازنا', 'رومشکان', 'چگنی', 'معمولان'],
  'مازندران': ['ساری', 'بابل', 'آمل', 'قائمشهر', 'بهشهر', 'نکا', 'بابلسر', 'چالوس', 'نوشهر', 'تنکابن', 'رامسر', 'نور', 'محمودآباد', 'فریدونکنار', 'جویبار', 'سوادکوه', 'سوادکوه شمالی', 'میاندورود', 'عباس‌آباد', 'کلاردشت', 'گلوگاه'],
  'مرکزی': ['اراک', 'ساوه', 'خمین', 'محلات', 'دلیجان', 'زرندیه', 'تفرش', 'آشتیان', 'شازند', 'فراهان', 'کمیجان', 'خنداب'],
  'هرمزگان': ['بندرعباس', 'میناب', 'بندر لنگه', 'قشم', 'کیش', 'حاجی‌آباد', 'رودان', 'جاسک', 'پارسیان', 'بستک', 'خمیر', 'سیریک', 'بشاگرد', 'ابوموسی'],
  'همدان': ['همدان', 'ملایر', 'نهاوند', 'تویسرکان', 'کبودرآهنگ', 'رزن', 'اسدآباد', 'بهار', 'فامنین', 'درگزین'],
  'یزد': ['یزد', 'میبد', 'اردکان', 'بافق', 'مهریز', 'تفت', 'ابرکوه', 'اشکذر', 'خاتم', 'بهاباد', 'مروست', 'زارچ']
};

function normalizeDigits(value = '') {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));
}

function showPreviewToast() {
  window.clearTimeout(toastTimer);
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 4200);
}

Object.keys(iranCitiesByProvince).forEach((province) => {
  const option = document.createElement('option');
  option.value = province;
  option.textContent = province;
  provinceSelect.append(option);
});

const customSelects = {
  province: {
    native: provinceSelect,
    trigger: document.querySelector('[data-select-trigger="province"]'),
    value: document.querySelector('[data-select-value="province"]'),
    menu: document.querySelector('[data-select-menu="province"]')
  },
  city: {
    native: citySelect,
    trigger: document.querySelector('[data-select-trigger="city"]'),
    value: document.querySelector('[data-select-value="city"]'),
    menu: document.querySelector('[data-select-menu="city"]')
  }
};

function closeCustomMenus() {
  Object.values(customSelects).forEach((select) => {
    select.menu.hidden = true;
    select.trigger.setAttribute('aria-expanded', 'false');
    select.trigger.closest('.register-custom-select').classList.remove('is-open');
  });
}

function syncCustomSelect(name) {
  const select = customSelects[name];
  const selected = select.native.options[select.native.selectedIndex];
  const hasValue = Boolean(select.native.value);

  select.value.textContent = selected?.textContent || '';
  select.value.classList.toggle('is-placeholder', !hasValue);
  select.trigger.disabled = select.native.disabled;
  select.trigger.classList.toggle('is-disabled', select.native.disabled);
  select.menu.innerHTML = '';

  Array.from(select.native.options).forEach((option) => {
    if (!option.value) return;

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'register-custom-select__option';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.selected));
    item.textContent = option.textContent;
    item.addEventListener('click', () => {
      select.native.value = option.value;
      select.native.dispatchEvent(new Event('change', { bubbles: true }));
      closeCustomMenus();
    });
    select.menu.append(item);
  });
}

function openCustomMenu(name) {
  const select = customSelects[name];
  if (select.native.disabled) return;

  const isOpen = !select.menu.hidden;
  closeCustomMenus();
  if (!isOpen) {
    select.menu.hidden = false;
    select.trigger.setAttribute('aria-expanded', 'true');
    select.trigger.closest('.register-custom-select').classList.add('is-open');
  }
}

Object.keys(customSelects).forEach((name) => {
  const select = customSelects[name];
  select.trigger.addEventListener('click', () => openCustomMenu(name));
  select.native.addEventListener('change', () => syncCustomSelect(name));
  syncCustomSelect(name);
});

provinceSelect.addEventListener('change', () => {
  const cities = iranCitiesByProvince[provinceSelect.value] || [];
  citySelect.innerHTML = '<option value="">انتخاب شهر</option>';
  citySelect.disabled = cities.length === 0;

  cities.forEach((city) => {
    const option = document.createElement('option');
    option.value = city;
    option.textContent = city;
    citySelect.append(option);
  });

  syncCustomSelect('province');
  syncCustomSelect('city');
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.register-custom-select')) closeCustomMenus();
});

registerForm.querySelectorAll('input[inputmode="numeric"], input[type="tel"]').forEach((input) => {
  input.addEventListener('input', () => {
    input.value = normalizeDigits(input.value);
  });
});

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  showPreviewToast();
});
