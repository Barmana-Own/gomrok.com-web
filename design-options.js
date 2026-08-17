const roleCopy = {
  driver: {
    title: 'ورود راننده',
    role: 'راننده',
    subtitle: 'برای دیدن سفرها و مأموریت‌های خود وارد شوید.',
    placeholder: 'شماره موبایل راننده',
  },
  carrier: {
    title: 'ورود باربری',
    role: 'باربری',
    subtitle: 'بارها، رانندگان و مأموریت‌ها را از یک حساب مدیریت کنید.',
    placeholder: 'شماره موبایل نماینده باربری',
  },
};

const selectionLabels = {
  split: 'طرح ۰۱ «اعتماد رسمی»',
  route: 'طرح ۰۲ «مسیر بار»',
  clean: 'طرح ۰۳ «روشن و مینیمال»',
  night: 'طرح ۰۴ «عملیات شبانه»',
};

const roleButtons = document.querySelectorAll('[data-role]');
const optionCards = document.querySelectorAll('[data-option]');
const selectionStatus = document.querySelector('#selection-status');

function applyRole(role) {
  const copy = roleCopy[role];
  if (!copy) return;

  roleButtons.forEach((button) => {
    const active = button.dataset.role === role;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });

  document.querySelectorAll('[data-role-text="title"]').forEach((element) => {
    element.textContent = copy.title;
  });
  document.querySelectorAll('[data-role-text="role"]').forEach((element) => {
    element.textContent = copy.role;
  });
  document.querySelectorAll('[data-role-text="subtitle"]').forEach((element) => {
    element.textContent = copy.subtitle;
  });
  document.querySelectorAll('[data-role-text="placeholder"]').forEach((element) => {
    element.textContent = copy.placeholder;
  });
}

function selectOption(option) {
  optionCards.forEach((card) => {
    card.classList.toggle('is-selected', card.dataset.option === option);
  });
  selectionStatus.textContent = `${selectionLabels[option]} انتخاب شد؛ آماده‌ی تبدیل به نسخه‌ی نهایی.`;
}

roleButtons.forEach((button) => {
  button.addEventListener('click', () => applyRole(button.dataset.role));
});

document.querySelectorAll('[data-select-option]').forEach((button) => {
  button.addEventListener('click', () => selectOption(button.dataset.selectOption));
});

applyRole('driver');
selectOption('split');
