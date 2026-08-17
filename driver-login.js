const methodButtons = document.querySelectorAll('[data-login-method]');
const loginForm = document.querySelector('#driver-login-form');
const passwordField = document.querySelector('#driver-password-field');
const passwordInput = document.querySelector('#driver-password');
const otpField = document.querySelector('#driver-otp-field');
const otpInput = document.querySelector('#driver-otp');
const primaryButtonLabel = document.querySelector('.driver-primary-button__label');
const toast = document.querySelector('#driver-toast');
const toastMessage = document.querySelector('.driver-toast__message');

let currentMethod = 'password';
let toastTimer;

function normalizeDigits(value = '') {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toastMessage.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 4200);
}

function setFieldError(inputId, message = '') {
  const input = document.getElementById(inputId);
  const field = input?.closest('.driver-field');
  const error = document.querySelector(`[data-error-for="${inputId}"]`);
  field?.classList.toggle('is-invalid', Boolean(message));
  if (message) input?.setAttribute('aria-invalid', 'true');
  else input?.removeAttribute('aria-invalid');
  if (error) error.textContent = message;
}

function clearFormErrors() {
  loginForm.querySelectorAll('.driver-field').forEach((field) => field.classList.remove('is-invalid'));
  loginForm.querySelectorAll('.driver-field__error').forEach((error) => {
    error.textContent = '';
  });
  loginForm.querySelectorAll('input').forEach((input) => input.removeAttribute('aria-invalid'));
}

function switchMethod(method) {
  currentMethod = method;
  const isPassword = method === 'password';

  methodButtons.forEach((button) => {
    const active = button.dataset.loginMethod === method;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });

  passwordField.classList.toggle('is-hidden', !isPassword);
  otpField.classList.toggle('is-hidden', isPassword);
  passwordInput.required = isPassword;
  otpInput.required = !isPassword;
  primaryButtonLabel.textContent = isPassword ? 'ورود به پنل راننده' : 'دریافت کد ورود';
  clearFormErrors();
}

function isValidPhone(value) {
  return /^(?:09\d{9}|9\d{9})$/.test(normalizeDigits(value).replace(/\s|-/g, ''));
}

methodButtons.forEach((button) => {
  button.addEventListener('click', () => switchMethod(button.dataset.loginMethod));
});

document.querySelector('[data-password-toggle]')?.addEventListener('click', (event) => {
  const button = event.currentTarget;
  const shouldShow = passwordInput.type === 'password';
  passwordInput.type = shouldShow ? 'text' : 'password';
  button.setAttribute('aria-label', shouldShow ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور');
});

loginForm.querySelectorAll('input').forEach((input) => {
  input.addEventListener('input', () => setFieldError(input.id));
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearFormErrors();

  const phone = document.querySelector('#driver-phone').value.trim();
  const password = passwordInput.value;
  const otp = normalizeDigits(otpInput.value).replace(/\s/g, '');
  let valid = true;

  if (!isValidPhone(phone)) {
    setFieldError('driver-phone', 'یک شماره موبایل معتبر وارد کن.');
    valid = false;
  }

  if (currentMethod === 'password' && password.length < 6) {
    setFieldError('driver-password', 'رمز عبور باید حداقل ۶ کاراکتر باشد.');
    valid = false;
  }

  if (currentMethod === 'otp' && !/^\d{4}$/.test(otp)) {
    setFieldError('driver-otp', 'کد تأیید باید ۴ رقم باشد.');
    valid = false;
  }

  if (!valid) return;

  if (currentMethod === 'otp') showToast('کد ورود برای شماره موبایل شما ارسال شد.');
  else showToast('ورود راننده با موفقیت انجام شد.');
});

document.querySelector('[data-forgot-password]')?.addEventListener('click', () => {
  showToast('برای بازیابی رمز عبور با پشتیبانی ۱۵۱۲ تماس بگیر.');
});

document.querySelector('[data-driver-signup]')?.addEventListener('click', () => {
  window.location.href = 'driver-register.html';
});
