# فهرست شکاف‌های API

> این فایل نسخهٔ فارسی `API-GAPS.md` است. [نسخهٔ انگلیسی](API-GAPS.md) | [README فارسی](../README.fa.md)

routeهای مشترک پلتفرم زیر `/api/platform` پیاده‌سازی شده‌اند. موارد زیر عمداً خارج از پایهٔ فعلی هستند و پیش از freeze رابط کاربری production باید بسته شوند:

- `API-GAP-CRM-READ-MODEL`: قراردادهای کامل خواندن/نوشتن حساب، رضایت و کمپین در CRM سطح L1/L2.
- `API-GAP-FILE-STORE`: بارگذاری در object storage production، اسکن بدافزار، نگهداری WORM و provider تولیدکنندهٔ URL کوتاه‌عمر برای دانلود.
- `API-GAP-OIDC`: اتصال به provider خارجی OAuth2/OIDC؛ جریان فعلی نشست از JWT کوتاه‌عمر محلی و قرارداد refresh-token چرخشی استفاده می‌کند.
- `API-GAP-SMS-OTP`: provider تولیدی SMS/voice برای OTP تحویل؛ پاسخ‌های توسعه فقط خارج از production یک کد آزمایشی ارائه می‌کنند.
- `API-GAP-MOBILE-RUNTIME`: ذخیره‌سازی امن native در Android/iOS، GPS پس‌زمینه هنگام تعلیق، سیگنال‌های یکپارچگی سیستم‌عامل/root-jailbreak، certificate pinning و adapter اعلان native؛ سطح فعلی راننده یک PWA قابل نصب با GPS در حالت foreground و اتصال دستگاه در سمت سرور است.
- `API-GAP-STEP-UP-IAM`: اتصال به provider هویت production که `X-Step-Up-Token` کوتاه‌عمر مورد استفادهٔ Admin Break-Glass، فعال‌سازی RulePack، تصمیم‌های حیاتی حاکمیتی و تغییر policy اعلان را صادر می‌کند. سرور اکنون `STEP_UP_SECRET` جداگانه، HS256، صادرکننده/مخاطب/نوع، `jti` و طول عمر پنج‌دقیقه‌ای را اعتبارسنجی می‌کند؛ برنامهٔ محلی توکن step-up تولیدی را mint نمی‌کند و وضعیت replay را نگه نمی‌دارد.
- `API-GAP-ADMIN-WEBHOOK-WRITE`: ثبت endpoint یکپارچه‌سازی، worker ارسال امضاشده، دفترکل replay و عملیات retry به‌عنوان مدل‌های خواندنی قرارداد دارند، اما پیش از freeze رابط کاربری هنوز به connector worker production نیاز دارند.
- `API-GAP-IAM-PASSWORD-RESET`: تغییر احراز‌شدهٔ گذرواژه برای حساب‌های Driver و Company Y پیاده‌سازی شده است؛ IAM خارجی همچنان باید پیش از راه‌اندازی production بازیابی، ثبت MFA و چرخش اجباری در اولین ورود را فراهم کند.
- `API-GAP-REALTIME-BUS`: endpoint احراز هویت‌شدهٔ SSE و فیلتر گیرندگان با broker درون‌فرایندی پیاده‌سازی شده‌اند؛ برای مقیاس‌پذیری افقی، pub/sub مشترک، replay، backpressure و معیارهای تحویل لازم است.

routeهای پیاده‌سازی‌شده این رفتارها را جعل نمی‌کنند؛ فراخوان‌ها یک پاسخ دامنهٔ محدود دریافت می‌کنند یا باید از endpoint جریان کاری ثبت‌شده استفاده کنند.
