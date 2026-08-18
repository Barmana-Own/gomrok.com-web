# API-GAP register

> [نسخهٔ فارسی](API-GAPS.fa.md) | [Persian README](../README.fa.md)

The shared platform routes are implemented under `/api/platform`. These items remain explicitly outside the current foundation and must be closed before production UI freeze:

- `API-GAP-CRM-READ-MODEL`: full CRM L1/L2 account, consent and campaign read/write contracts.
- `API-GAP-FILE-STORE`: production object-storage upload, malware scan, WORM retention and short-lived download URL provider.
- `API-GAP-OIDC`: external OAuth2/OIDC provider integration; current session flow uses the local short-lived JWT plus rotating refresh-token contract.
- `API-GAP-SMS-OTP`: production SMS/voice provider for delivery OTP; development responses expose a test code only outside production.
- `API-GAP-MOBILE-RUNTIME`: native Android/iOS secure storage, background GPS while suspended, OS integrity/root-jailbreak signals, certificate pinning and native push adapter; the current driver surface is an installable PWA with foreground GPS and server-side device binding.
- `API-GAP-STEP-UP-IAM`: production identity-provider integration that issues the short-lived `X-Step-Up-Token` consumed by Admin Break-Glass, RulePack activation, critical governance decisions and notification policy changes. The server now validates a separate `STEP_UP_SECRET`, HS256, issuer/audience/type, jti and a five-minute lifetime; the local app does not mint a production step-up token or persist replay state.
- `API-GAP-ADMIN-WEBHOOK-WRITE`: integration endpoint registration, signed delivery worker, replay ledger and retry operations are contracted as read models but still require the production connector worker before UI freeze.
- `API-GAP-IAM-PASSWORD-RESET`: authenticated password change is implemented for Driver and Company Y accounts; external IAM still must provide recovery, MFA enrollment and first-login forced rotation before production launch.
- `API-GAP-REALTIME-BUS`: the authenticated SSE endpoint and recipient filtering are implemented with an in-process broker; shared pub/sub, replay, backpressure and delivery metrics are required for horizontal scaling.

The implemented routes do not fabricate these behaviors; callers receive a scoped domain response or must use the registered workflow endpoint.
