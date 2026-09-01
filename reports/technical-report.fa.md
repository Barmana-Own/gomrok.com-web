# گزارش فنی بازطراحی GOMROK

| مشخصه | مقدار |
| --- | --- |
| پروژه | GOMROK |
| نوع گزارش | تحویل فنی |
| زبان | فارسی |
| تاریخ شمسی | ۱۴۰۵/۰۶/۱۰ |
| تاریخ میلادی | 2026-09-01 |
| مبنای مخزن | `dd06d23` به‌همراه تغییرات محلی موجود |
| وضعیت | PASS در محدوده بازطراحی فرانت‌اند |

## دامنه و معماری پایه

مخزن یک workspace شامل React/Vite در `client/`، Express در `server/`، MySQL در `server/schema.sql` و قرارداد مشترک در `shared/contract.js` است. دامنه کار، بازطراحی کامل فرانت‌اند با حفظ backend، schema، API و IAM موجود بود.

## تغییرات فرانت‌اند

- پیاده‌سازی سیستم طراحی Route Pulse در `client/src/route-pulse.css` و `design/tokens.json`.
- ایجاد `ProductIcon.jsx` شامل لوگو، نشان، آیکون‌های دامنه‌ای و تصویرسازی SVG.
- بازطراحی `App.jsx` برای صفحه‌های عمومی، ورود، ثبت‌نام، وضعیت ثبت‌نام، ورود مدیریت و مرکز پیش‌نمایش.
- بازآرایی بصری شش پنل بدون حذف هیچ بخش: Shipper 16، Company X 19، Company Y 16، Driver 5 تب، Agent 10 و Admin 19 بخش پایه/۱۸ بخش قابل مشاهده در نقش پیش‌نمایش.
- ایجاد `ResponsivePanelNav.jsx` برای منوی همبرگری کامل، off-canvas و دسترس‌پذیر هر شش پنل در موبایل و تبلت؛ sidebarهای دسکتاپ و bottom navigation راننده حفظ شدند.
- اصلاح primitiveهای مشترک اسناد، دیالوگ، drawer، timeline، evidence و status.
- افزودن focus trap، Escape close و focus restoration برای overlayها.
- حفظ lazy loading پنل‌ها و عدم افزودن dependency جدید.

## Backend، دیتابیس و API

هیچ endpoint، payload، migration، جدول یا permission تغییر نکرد. درخواست‌های واقعی فرانت‌اند حفظ شدند. تنها اصلاح سازگاری API، encode کردن متن فارسی `X-Purpose-Scope` پیش از قرار گرفتن در header مرورگر بود. قرارداد OpenAPI و منطق role/tenant/relationship همچنان منبع حقیقت هستند.

## امنیت

- مسیرهای پیش‌نمایش با `import.meta.env.DEV` محدود شده‌اند.
- secret، داده تولید، mock تولید یا unsafe HTML sink اضافه نشد.
- بررسی `npm audit` برای همه dependencyها و `--omit=dev` هر دو صفر آسیب‌پذیری گزارش کردند.
- ۱۹ تست نقش، tenant، RFQ، readiness، POD، settlement، audit و realtime همگی PASS شدند.
- Authorization همچنان سمت سرور اعمال می‌شود؛ پنهان‌کردن دکمه جایگزین مجوز نیست.

## نتایج اعتبارسنجی

| بررسی | نتیجه |
| --- | --- |
| `npm run build` | PASS — 44 ماژول، 6 chunk پنل و chunk ناوبری مشترک |
| `npm test` | PASS — 19/19 |
| `npm audit` | PASS — 0 vulnerability |
| `npm audit --omit=dev` | PASS — 0 vulnerability |
| `docker compose config --quiet` | PASS |
| اعتبارسنجی config تولید | PASS |
| QA صفحه‌های عمومی در 360/390/430/768/1024/1440 | PASS |
| QA شش پنل در 390/768/1024/1440 | PASS |
| تعامل منوی همبرگری در شش پنل | PASS — Escape، backdrop، انتخاب بخش، قفل scroll و بازیابی focus |
| سرریز افقی document | PASS — مشاهده نشد |
| کنسول مرورگر | PASS — بدون warning/error |
| migration زنده MySQL | NOT_RUN — schema بدون تغییر و credential آزمایشی موجود نبود |
| mutation زنده با حساب‌های واقعی | NOT_RUN — test data/credentials موجود نبود |
| استقرار خارجی | NOT_PERFORMED |

اجرای اول `npm test` در sandbox با `spawn EPERM` متوقف شد؛ همان فرمان با مجوز spawn اجرا و ۱۹ تست را پاس کرد.

## رفع نقص و بازبینی رگرسیون

- clipping لوگوی Driver/Admin ناشی از selectorهای legacy اصلاح شد.
- فشردگی labelهای ناوبری Admin اصلاح شد.
- خطای header فارسی در Fetch اصلاح و کنسول مجدداً بررسی شد.
- wrapping متن عمومی در موبایل و رفتار responsive مرکز پیش‌نمایش اصلاح شد.
- base مربوط به `vite preview` با مسیر تولید `/app/` هماهنگ و پاسخ JavaScript asset مجدداً بررسی شد.
- منوهای افقی طولانی تبلت و موبایل با drawer کامل و قابل پیمایش جایگزین شدند؛ نسخه دسکتاپ بدون پسرفت باقی ماند.
- هیچ route، section، test، API، schema، permission یا asset ضروری حذف نشد.

## محدودیت و آمادگی تولید

فرانت‌اند برای تحویل و استقرار در pipeline موجود آماده است. پیش از انتشار عمومی، اجرای migration و smoke test با دیتابیس disposable، حساب‌های role-based و reverse proxy واقعی لازم است. broker realtime موجود برای scale افقی نیازمند shared pub/sub است.

## وضعیت مراحل

مراحل 01 تا 12 برای دامنه این تحویل PASS ثبت شده‌اند. بررسی‌های زیرساختی فاقد credential به‌صورت صریح NOT_RUN باقی مانده‌اند و به PASS تبدیل نشده‌اند.
