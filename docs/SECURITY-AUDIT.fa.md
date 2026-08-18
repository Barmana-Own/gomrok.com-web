# ممیزی امنیتی محدود

> این فایل نسخهٔ فارسی `SECURITY-AUDIT.md` است. [نسخهٔ انگلیسی](SECURITY-AUDIT.md) | [README فارسی](../README.fa.md)

تاریخ: 2026-08-18  
محدوده: احراز هویت/IAM، مرزهای tenant و سازمان، شاخص‌های BOLA/BOPLA، secretها، routeهای legacy، ماسک‌کردن سند/تماس/اطلاعات مالی و مسیرهای امنیتی مرتبط با realtime.  
مرز تغییر: فقط `server/src/security/platform-auth.js` و این گزارش تغییر کرده‌اند.

این یک ممیزی source است، نه آزمون نفوذ production. مجوزدهی متکی بر پایگاه داده، object storage، SMS، provider هویت و بررسی‌های realtime چندنمونه‌ای همچنان گیت استقرار هستند.

## اصلاحات انجام‌شده در این ممیزی

### SEC-01 — اعتبارسنجی سخت‌گیرانهٔ JWT پلتفرم — رفع شد

`server/src/security/platform-auth.js` اکنون:

- اعتبارسنجی را روی `HS256` قفل می‌کند؛
- مقادیر bearer دارای دادهٔ اضافی یا tokenهای بزرگ‌تر از 4096 بایت را رد می‌کند؛
- subject و role را به‌صورت string الزامی می‌کند؛
- `iat` و `exp` عدد صحیح را الزامی می‌کند، tokenهای صادرشده در آینده و tokenهایی با عمر بیشتر از حداکثر پلتفرم را رد می‌کند؛
- برای نشست‌های غیرlegacy، `userId` و `membershipId` صریح را به‌جای fallback به `sub` الزامی می‌کند؛
- همچنان tenant، سازمان، نقش و ویژگی‌های ABAC را از membership فعال پایگاه داده استخراج می‌کند؛
- به‌جای افشای جزئیات driver یا خطای SQL، برای خطاهای غیرمنتظرهٔ پایگاه داده/احراز هویت `AUTH-503` عمومی برمی‌گرداند.

### SEC-02 — token قدیمی Super Admin در routeهای پلتفرم — محدود شد

مسیر token با `sub=super-admin` داخل `platform-auth.js` به‌صورت پیش‌فرض غیرفعال است و وقتی `NODE_ENV=production` باشد فعال‌سازی آن ممکن نیست. این مسیر فقط وقتی در محیط غیرproduction در دسترس است که operator به‌صراحت `ALLOW_LEGACY_ADMIN_TOKEN=true` را تنظیم کند. این تغییر middleware جداگانهٔ legacy `/api/admin/*` را حذف نمی‌کند؛ آن سطح حل‌نشده در ادامه به‌عنوان P0 ثبت شده است. مدیریت production باید از membership سازمانی قابل ردیابی و جریان step-up حاکمیت‌شده استفاده کند.

### SEC-03 — محدودهٔ purpose کارکنان — به‌صورت مرکزی اعمال شد

اکنون همهٔ نقش‌های canonical کارکنان باید پیش از ورود به هر route پلتفرم، مقدار `X-Purpose-Scope` حداقل هشت‌کاراکتری ارائه کنند. طول این مقدار به 256 کاراکتر محدود است و برای بررسی‌های ABAC/audit بعدی در context بازیگر ذخیره می‌شود. وجود مقدار در اینجا اجباری است؛ تطبیق معنایی محدوده همچنان نیازمند route/Policy است.

## یافته‌های باقی‌مانده بر اساس اولویت

### P0 — ورود مدیر production همچنان یک سطح قدیمی با secret مشترک است

فایل‌ها: `server/src/app.js:90-109`، `server/src/app.js:324-334`، `server/src/app.js:353-483`

`/api/admin/login` یک JWT فقط‌حاوی نقش `super_admin` صادر می‌کند و routeهای قدیمی ثبت‌نام از middleware جداگانهٔ `requireAdmin` استفاده می‌کنند. این مسیر به lookup عضویت، MFA/step-up، rate limiting، session store یا کلید امضای جداگانهٔ مدیر متصل نیست و queryهای فهرست آن tenant-filtered نیستند. بنابراین اگر endpointهای قدیمی در معرض دسترسی قرار گیرند، می‌توانند به مسیر دسترسی cross-tenant به ثبت‌نام و PII تبدیل شوند.

راه‌بسته‌شدن لازم: `/api/admin/*` را حذف یا پشت همان middleware IAM مربوط به `/api/platform/admin` ایزوله کنید، rate limiting و MFA اضافه کنید و هر query ثبت‌نام را محدود به tenant کنید. در production، `ALLOW_LEGACY_ADMIN_TOKEN` را فعال نکنید.

### P1 — tokenهای step-up و verifier از کلید access-token مشترک استفاده می‌کنند

فایل: `server/src/routes/admin.routes.js:92-104`

verifier مربوط به step-up از همان `JWT_SECRET` مربوط به access tokenهای معمول استفاده می‌کند و algorithm را قفل نمی‌کند یا `issuer`، `audience`، نوع token، nonce، یا رکورد replay را enforce نمی‌کند. route scope، subject و expiry را بررسی می‌کند، اما compromiseشدن کلید امضای access token، assurance مربوط به step-up را نیز compromise می‌کند.

راه‌بسته‌شدن لازم: از کلید step-up جداگانه و صادرشده توسط IAM/provider استفاده کنید، algorithm را قفل کنید، `iss`، `aud`، `typ` و `jti` و عمر کوتاه را الزامی کنید و وضعیت استفادهٔ یک‌باره/replay را ذخیره کنید.

### P1 — ابطال access token با تأخیر انجام می‌شود

فایل‌ها: `server/src/app.js:77-87`، `server/src/app.js:648-687`؛ `server/src/routes/admin.routes.js:406-425`

لغو session ردیف‌های refresh-token را بی‌اعتبار می‌کند، درحالی‌که JWTهای access از پیش صادرشده تا پایان expiry معتبر می‌مانند. عمر فعلی access کوتاه است، اما token سرقت‌شده در همین بازه قابل استفاده است.

راه‌بسته‌شدن لازم: یک شناسهٔ session و بررسی نسخهٔ session در سمت سرور (یا introspection) را به هر access token پلتفرم اضافه کنید و هنگام تعلیق membership، logout-all و رخداد امنیتی آن را بی‌اعتبار کنید.

### P1 — دسترسی به پروندهٔ compliance/risk به purpose محدود شده اما purpose-scoped نیست

فایل: `server/src/routes/platform.routes.js:234-245`

`assertCaseAccess` به `compliance_officer` و `risk_manager` اجازه می‌دهد بررسی‌های ارتباط سازمانی را دور بزنند. الزام مرکزی جدید از purpose خالی جلوگیری می‌کند، اما هر مقدار به‌اندازهٔ کافی طولانی هنوز می‌تواند همراه با خواندن گستردهٔ پرونده ارسال شود. این موضوع برای اسناد حساس، داده‌های عملیاتی و context ریسک یک خطر BOPLA است.

راه‌بسته‌شدن لازم: یک grant سمت سرور را بر اساس ویژگی‌های پرونده، route، کشور، محموله، حساسیت و انقضا resolve کنید؛ وقتی grant تطبیق ندارد، پیش از بارگذاری دادهٔ عمیق پرونده را رد کنید.

### P1 — ذخیره‌سازی فایل و مجوز دانلود هنوز در حد production نیست

فایل‌ها: `server/src/routes/platform.routes.js:3075-3204`، `docs/API-GAPS.md`

جریان فعلی سند، reference فایل ارائه‌شده توسط caller را ذخیره و یک `downloadToken` با ظاهر کوتاه‌عمر برمی‌گرداند، اما در این workspace signer برای object storage production، اسکن بدافزار، نگهداری WORM یا endpoint دانلود مستقل و اعتبارسنجی‌شده وجود ندارد. یک ردیف پایگاه داده که از محدودهٔ سند عبور کرده است نباید URL فایل امن تلقی شود.

راه‌بسته‌شدن لازم: adapter مربوط به object storage را با اسکن محتوا، referenceهای نسخهٔ تغییرناپذیر، URLهای signed صادرشده توسط سرور، مجوزدهی هنگام دانلود، watermark و audit انقضا/لغو پیاده‌سازی کنید.

### P1 — جریان realtime در محدودهٔ سازمان است، نه محدودهٔ نقش/مجوز

فایل‌ها: `server/src/routes/platform.routes.js:1068-1100`، `server/src/realtime/broker.js:17-23`، `server/src/realtime/broker.js:43-74`

یک endpoint SSE و broker درون‌فرایندی وجود دارد. اتصال با `READ` احراز هویت می‌شود، اما تحویل رویداد فقط tenant و سازمان/کاربر گیرنده را بررسی می‌کند. برای هر رویداد، `SEE_LOCATION`، `SEE_SETTLEMENT`، حساسیت سند یا محدودهٔ سفر فعال دوباره بررسی نمی‌شود. درنتیجه عضوی مانند Y Document Issuer ممکن است envelopeهای رویداد عملیاتی/مالی محدودهٔ سازمان را دریافت کند، درحالی‌که role او نباید آن‌ها را بخواند. مسیر ماندگار `platform_notifications` نیز payload اصلی رویداد را ذخیره می‌کند و endpoint عادی اعلان‌ها همان payload را به سازمان گیرنده برمی‌گرداند.

جریان هنگام منقضی‌شدن access token دوباره احراز هویت نمی‌شود؛ TTL اتصال می‌تواند از عمر معمول access token بیشتر باشد. sanitizer به نام‌های کلیدی واضح کمک می‌کند، اما فیلتر کلید جایگزین policy مجوزدهی در سطح رویداد نیست.

راه‌بسته‌شدن لازم: ماتریس حساسیت/مجوز رویداد تعریف کنید، هر رویداد را بر اساس tenant/org/user/role/سفر فعال و محدودهٔ رابطه مجاز کنید، فقط projectionهای redacted اعلان را ذخیره کنید، جریان‌ها را هنگام انقضا یا پایان session ببندید یا دوباره احراز کنید و آزمون‌های نشت cross-role/location/settlement اضافه کنید.

### P2 — fan-out realtime درون‌فرایندی است و دفتر replay ندارد

فایل: `server/src/realtime/broker.js:3-40`

نقشهٔ subscriberهای درون‌حافظه‌ای محدود است و با بسته‌شدن اتصال پاک‌سازی می‌شود، اما رویدادها با restart از بین می‌روند و به نمونهٔ API دیگر نمی‌رسند. این عمدتاً ریسک availability/consistency است، ولی failover می‌تواند باعث شود کلاینت یک رویداد امنیتی یا انطباقی را از دست بدهد.

راه‌بسته‌شدن لازم: از Redis/NATS یا معادل آن با fan-out tenant-aware، شناسه‌های پایدار رویداد، replay محدود، backpressure و آزمون‌های بین‌نمونه‌ای استفاده کنید. هرگز bearer token را در query string مربوط به SSE قرار ندهید.

### P1 — defaultهای secret در مخزن/استقرار باید حذف شوند

فایل‌ها: `server/.env.example:4-9`، `docker-compose.yml:7-10`، `server/src/config.js:8-22`

`server/src/config.js` اکنون برای JWT و secretهای مدیر ضعیف/ناقص در production fail-closed عمل می‌کند و وقتی secretهای development حذف شده باشند آن‌ها را در حافظه تولید می‌کند. فایل‌های نمونهٔ Compose/database و environment هنوز defaultهای قابل تشخیص development دارند. این‌ها credentialهای production نیستند، اما کپی‌کردنشان در یک استقرار مشترک یا در معرض دسترسی، secretهای قابل پیش‌بینی ایجاد می‌کند.

راه‌بسته‌شدن لازم: نمونه‌ها را با placeholderهای آشکارا نامعتبر جایگزین کنید، در استقرار secret manager خارجی را الزامی کنید، هر محیطی را که از defaultهای مستندشده استفاده کرده rotate کنید و فایل‌های `.env` را خارج از source control نگه دارید.

### P2 — سطح‌های عمومی قدیمی ثبت‌نام/احراز هویت بیش از مدل‌های خواندنی پلتفرم داده افشا می‌کنند

فایل‌ها: `server/src/app.js:112-166`، `server/src/app.js:336-483`، `server/src/app.js:700-746`

endpointهای قدیمی راننده/حامل و ثبت‌نام پیش از مدل‌های خواندنی شش‌سطحی ایجاد شده‌اند. پاسخ‌های آن‌ها برای callerهایی که middleware قدیمی مدیر به آن‌ها مجوز داده است، شامل phone مستقیم، شناسه‌های ملی/کسب‌وکار و دیگر فیلدهای ثبت‌نام است. این endpointها باید بازنشسته شوند یا از همان policy ماسک‌کردن، purpose و audit مربوط به endpointهای پلتفرم استفاده کنند.

## کنترل‌های مشاهده‌شده در بازبینی

- lookup مربوط به membership پلتفرم، `userId`، `membershipId`، `tenantId` و `organizationId` را به هم متصل می‌کند و فعال‌بودن ردیف‌های user، membership و organization را الزامی می‌کند.
- خواندن‌های اصلی اشیای پلتفرم که در `server/src/routes/platform.routes.js` بررسی شدند، predicateهای tenant دارند؛ helperهای case/trip/document/POD/settlement بررسی‌های رابطه‌ای را اضافه می‌کنند.
- خواندن quote از helper دفتر مهروموم‌شده استفاده می‌کند و مدل خواندنی حاکمیت مدیر، کلیدهای تجاری را redacted می‌کند.
- خواندن تماس به‌صورت پیش‌فرض ماسک‌شده است و grantهای reveal به زمان و actor محدود هستند.
- خواندن دفترکل ارتباطی، رابطه‌های Customer-X، X-Y، Y-Driver و X-Agent را از هم جدا می‌کند.
- مسیرهای تأیید سند و شواهد از فیلدهای version/lock استفاده می‌کنند؛ حذف مخرب سند در router پلتفرم ارائه نشده است.
- پیاده‌سازی فعلی realtime از اتصال SSE احراز هویت‌شدهٔ مبتنی بر fetch، سقف اتصال، heartbeat، TTL اتصال و redaction payload مبتنی بر کلید استفاده می‌کند؛ شکاف‌های مجوزدهی در سطح رویداد در بالا آمده‌اند.

این مشاهده‌ها فقط شواهد ایستا هستند و جایگزین آزمون‌های integration با دادهٔ seedشدهٔ cross-tenant نمی‌شوند.

## اعتبارسنجی

پس از تغییر کد اجرا شد:

- `node --check server/src/security/platform-auth.js`
- `npm test`
- `npm audit --omit=dev --offline`
- smoke check ردکردن legacy-admin در production و opt-in صریح JWT در محیط غیرproduction

migration پایگاه داده و UAT زندهٔ cross-tenant به MySQL در حال اجرا نیاز دارند و در این ممیزی به‌عنوان تکمیل‌شده محسوب نشدند.

## فایل‌های دقیقاً تغییرکرده

- `server/src/security/platform-auth.js`
- `docs/SECURITY-AUDIT.md`

هیچ credential، گذرواژه یا private key در این گزارش ذخیره نشده است.

## سخت‌سازی پس از ممیزی در workspace مشترک

پس از این ممیزی محدود، workspace همچنین پیکربندی fail-closed برای production، rate limiting احراز هویت، مدل‌های خواندنی ماسک‌شده برای ثبت‌نام legacy، غیرفعال‌سازی ورود/routeهای قدیمی مدیر در production، route تغییر گذرواژهٔ احراز‌شده برای حساب‌های Driver و Company Y، `STEP_UP_SECRET` جداگانه با اعتبارسنجی claimهای قفل‌شده و بررسی دقیق reference پرونده برای خواندن‌های حاکمیتی نامرتبط را اضافه کرده است. broker realtime اکنون gateهای مجوز role را اعمال و projectionهای ماندگار اعلان را redacted می‌کند. گیت‌های خارجی باقی‌مانده عبارت‌اند از provider مربوط به IAM/MFA/replay، object storage و bus مشترک realtime.
