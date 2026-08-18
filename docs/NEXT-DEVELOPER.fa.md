# تحویل GomrokDotCom به توسعه‌دهندهٔ بعدی

این مخزن یک هستهٔ مشترک لجستیک و شش سطح محدود به نقش را دربرمی‌گیرد: Shipper، Company X، Company Y، وب موبایل Driver، مقصد Agent/Z و Admin/Marketplace Governance. اولویت منابع و ناوردایی‌های دامنه در فایل‌های قرارداد محصول که همراه پروژه ارائه شده‌اند مستند است؛ `shared/contract.js` لایهٔ اجرایی enum/permission و `openapi/gomrok-platform-v1.yaml` اسکلت API است.

> این فایل نسخهٔ فارسی `NEXT-DEVELOPER.md` است. [نسخهٔ انگلیسی](NEXT-DEVELOPER.md) | [README فارسی](../README.fa.md)

## راه‌اندازی

1. `.env.example` را به `.env` و `server/.env.example` را به `server/.env` کپی کنید.
2. هر مقدار `replace-*` را با یک مقدار تصادفی یکتا جایگزین کنید. مقدار `MYSQL_ROOT_PASSWORD` در ریشه را برابر `DB_PASSWORD` در سرور قرار دهید و `STEP_UP_SECRET` متفاوتی تنظیم کنید؛ هیچ‌کدام را commit نکنید.
3. `npm install` را اجرا کنید.
4. MySQL را با `docker compose up -d mysql` اجرا کنید.
5. `npm --workspace server run db:migrate` را اجرا کنید.
6. هر دو سطح را با `npm run dev` اجرا کنید.

کلاینت وب در `http://127.0.0.1:5083` و API در `http://127.0.0.1:4000` قرار دارد. اگر `JWT_SECRET` یا `ADMIN_PASSWORD` در production وجود نداشته باشد یا کوتاه باشد، API از راه‌اندازی خودداری می‌کند. در development، ورود legacy مدیر تا زمانی که `ADMIN_PASSWORD` صریحاً تنظیم نشود غیرفعال می‌ماند.

برای bootstrap محلی و فقط مخصوص `/admin/v2`، مقدار `ALLOW_LEGACY_ADMIN_TOKEN=true` را در `server/.env` نگه دارید؛ `server/src/security/platform-auth.js` هرگاه `NODE_ENV=production` باشد این حالت را رد می‌کند. پیش از هر محیط مشترک یا deployشده، از یک نشست واقعی کارکنان مبتنی بر membership استفاده کنید و مقدار را روی `false` بگذارید.

## اعتبارنامه‌ها و حساب‌ها

هیچ گذرواژهٔ متنی در این handoff یا source control ذخیره نشده است.

| حساب | نام کاربری | گذرواژه | نحوهٔ ایجاد |
|---|---|---|---|
| bootstrap قدیمی حاکمیت | `ADMIN_USERNAME` (معمولاً `admin`) | `ADMIN_PASSWORD` از `server/.env` | پیش از `/api/admin/login` به‌صورت محلی تنظیم کنید؛ خارج از مخزن چرخش دهید. |
| Driver | شمارهٔ موبایل | گذرواژهٔ یک‌بارمصرف تولیدشده | `/api/registrations/driver` را ثبت کنید، از endpoint حاکمیتی مدیر تأیید بگیرید، گذرواژهٔ برگشتی را از یک کانال امن تحویل دهید و سپس آن را بچرخانید. |
| Company Y | شمارهٔ موبایل | گذرواژهٔ یک‌بارمصرف تولیدشده | `/api/registrations/carrier` را ثبت کنید، از endpoint حاکمیتی مدیر تأیید بگیرید، گذرواژهٔ برگشتی را از یک کانال امن تحویل دهید و سپس آن را بچرخانید. |
| نقش‌های پلتفرم | membership سازمانی | صادرشده توسط جریان IAM/bootstrap | JWT باید به یک ردیف فعال `organization_memberships` resolve شود؛ هرگز role یا claim مربوط به tenant را در کلاینت نسازید. |

پاسخ تأیید ممکن است گذرواژهٔ تولیدشده را برگرداند، چون حساب پیش از تأیید گذرواژه‌ای ندارد. آن را یک secret یک‌بارمصرف بدانید؛ آن را در ticket، فایل README، log یا chat کپی نکنید. کاربران احراز‌شدهٔ Driver و Company Y می‌توانند آن را از طریق `POST /api/auth/change-password` بچرخانند؛ بازیابی، ثبت MFA و چرخش اجباری در اولین ورود همچنان بخشی از گیت انتشار IAM خارجی است.

## اتصال سطح‌ها

- Shipper: `client/src/components/ShipperPanel.jsx` → `/api/platform/cases`، RFQ1 مهروموم‌شده، تخصیص انسانی، قرارداد Customer-X، بازبینی CMR، مدل خواندنی tracking و POD و دفترکل Customer-X.
- Company X: `client/src/components/CompanyXPanel.jsx` → قیمت‌گذاری و تخصیص Market A، RFQ2 جداشده، تخصیص Y، nomination، بارگیری، پیش‌نویس CMR، گیت‌های آمادگی، Control Tower، بازبینی POD و ارتباط‌های X.
- Company Y: `client/src/components/CompanyYPanel.jsx` → دعوت/پیشنهاد RFQ2، DriverCarrierCoverage، صلاحیت خودرو/راننده، nomination، CMR نهایی، گیت TIR Holder، سفرهای خود و دفترکل‌های X-Y/Y-Driver.
- Driver: `client/src/components/DriverMobilePanel.jsx` → اتصال دستگاه، فرصت‌های داخلی Y، صف رمزنگاری‌شدهٔ شواهد/GPS آفلاین، رویدادهای آغاز سفر با گیت آمادگی، مرز/حادثه/POD و تسویهٔ Y-Driver.
- Agent/Z: `client/src/components/AgentPanel.jsx` → بررسی assignment/authority، تطبیق مقصد، location، OTP، امضا/مهر، شواهد نسخه‌دار، رسیدهای انبار، ارسال POD و دفترکل X-Agent.
- Admin: `client/src/components/AdminGovernancePanel.jsx` + `server/src/routes/admin.routes.js` → مدل‌های خواندنی حاکمیتی محدودشده، تصمیم‌های KYC، پایش مهر RFQ، صف‌های ریسک/انطباق/تعارض، ممیزی فقط‌الحاقی، Break-Glass، RulePackها، حاکمیت مالی/CRM/export، پایش AI و سلامت.

هر شش پنل از `client/src/hooks/usePlatformRealtime.js` استفاده می‌کنند. سرور فقط رویدادهای tenant/org/user-recipient را از طریق `server/src/realtime/broker.js` می‌فرستد؛ payloadها پاک‌سازی می‌شوند و dashboard منبع حقیقت باقی می‌ماند. broker درون‌فرایندی است و عمداً ادعای replay یا تضمین تحویل بین نمونه‌ها را ندارد.

## قواعد امنیتی که باید حفظ شوند

- هر write باید از RBAC + ABAC سمت سرور و بررسی‌های membership/ownership عبور کند و هرجا لازم است از idempotency استفاده کند.
- RFQ1 و RFQ2 جدا باقی می‌مانند؛ تخصیص مستقیم X به Driver ممنوع است و تخصیص انسانی اجباری است.
- هرگز quoteهای رقیب، نرخ‌های X-Y/customer، اطلاعات تماس خام، تاریخچهٔ GPS خام یا اسناد نامرتبط را افشا نکنید.
- اسناد/شواهد تأییدشده و رکوردهای ممیزی فقط‌الحاقی و نسخه‌دار هستند؛ overwrite یا حذف معمول و مخرب مجاز نیست.
- TIR به Holder مجاز نیاز دارد؛ آغاز سفر به آمادگی customs، permit، document، vehicle، driver و preload نیاز دارد.
- تحویل Agent به assignment/authority معتبر و بررسی‌های recipient/OTP/evidence تنظیم‌شده نیاز دارد؛ ارسال POD به معنی پذیرش POD نیست.
- نقش‌های Admin مجوز عمومی داده‌های کسب‌وکار نیستند. purpose، step-up، کنترل دوگانه، ممیزی قابل انتساب و سقف‌های CRM/export همچنان الزامی‌اند.

## راستی‌آزمایی

```bash
npm test
npm run build
npm audit --omit=dev --offline
node --check server/src/app.js
node --check server/src/routes/platform.routes.js
node --check server/src/routes/admin.routes.js
```

OpenAPI را می‌توان با Ruby/Psych یا parser دیگری برای YAML parse کرد. UAT متکی بر پایگاه داده علاوه بر این به MySQL قابل دسترس نیاز دارد؛ build موفق frontend یا باز بودن یک پورت، اثبات اجرای migration یا درست‌بودن جریان‌های authorization نیست.

## گیت‌های شناخته‌شدهٔ انتشار

- `API-GAP-IAM-PASSWORD-ROTATION`: پیش از تحویل اعتبارنامه‌های تولیدشده خارج از UAT محلی، جریان تغییر/بازنشانی گذرواژه را در سمت سرور اضافه کنید.
- `API-GAP-REALTIME-BUS`: broker درون‌فرایندی را برای تحویل چندنمونه‌ای، replay و backpressure با Redis/NATS یا معادل آن جایگزین کنید.
- `API-GAP-FILE-STORE`: object store را با دانلودهای امضاشدهٔ کوتاه‌عمر، اسکن بدافزار، نگهداری WORM و راستی‌آزمایی hash متصل کنید.
- `API-GAP-OIDC`، `API-GAP-SMS-OTP`، `API-GAP-MOBILE-RUNTIME`: providerهای production هویت، پیام‌رسانی و runtime بومی/آفلاین را یکپارچه کنید.
- `API-GAP-ADMIN-WEBHOOK-WRITE`: APIهای مدیریت endpoint با HMAC حاکمیت‌شده، حفاظت replay و worker تحویل را اضافه کنید.

تا زمانی که این وابستگی‌های خارجی پیاده‌سازی و آزموده نشده‌اند یا صراحتاً به‌عنوان ریسک انتشار پذیرفته نشده‌اند، پلتفرم را آمادهٔ production اعلام نکنید.
