# Bounded security audit

> [Persian version](SECURITY-AUDIT.fa.md) | [Persian README](../README.fa.md)

Date: 2026-08-18  
Scope: authentication/IAM, tenant and organization boundaries, BOLA/BOPLA indicators, secrets, legacy routes, document/contact/financial masking, and realtime-relevant security paths.  
Change boundary: only `server/src/security/platform-auth.js` and this report were changed.

This is a source audit, not a production penetration test. Database-backed authorization, object storage, SMS, identity-provider and multi-instance realtime checks remain deployment gates.

## Fixes made in this audit

### SEC-01 — strict platform JWT validation — fixed

`server/src/security/platform-auth.js` now:

- pins verification to `HS256`;
- rejects bearer values containing extra material or tokens above 4096 bytes;
- requires a string subject and role;
- requires integer `iat` and `exp`, rejects future-issued tokens and tokens whose lifetime exceeds the platform maximum;
- requires an explicit `userId` and `membershipId` for non-legacy sessions instead of falling back to `sub`;
- continues to derive tenant, organization, role and ABAC attributes from the active database membership;
- returns a generic `AUTH-503` for unexpected database/authentication failures instead of exposing driver or SQL error details.

### SEC-02 — legacy Super Admin token on platform routes — restricted

The `sub=super-admin` token path inside `platform-auth.js` is disabled by default and cannot be enabled when `NODE_ENV=production`. It is available only when an operator explicitly sets `ALLOW_LEGACY_ADMIN_TOKEN=true` in a non-production environment. This does not remove the separate legacy `/api/admin/*` middleware; that unresolved surface is tracked as P0 below. Production administration must use a traceable organization membership and the governed step-up flow.

### SEC-03 — staff purpose scope — enforced centrally

All canonical staff roles must now provide an eight-character minimum `X-Purpose-Scope` value before any platform route is entered. The value is bounded to 256 characters and is stored on the actor context for downstream ABAC/audit checks. Presence is enforced here; semantic scope matching is still a route/Policy requirement.

## Prioritized remaining findings

### P0 — production admin login is still a legacy shared-secret surface

Files: `server/src/app.js:90-109`, `server/src/app.js:324-334`, `server/src/app.js:353-483`

`/api/admin/login` issues a role-only `super_admin` JWT and the legacy registration routes use a separate `requireAdmin` middleware. This path is not backed by membership lookup, MFA/step-up, rate limiting, a session store or a separate admin signing key, and its list queries are not tenant-filtered. The legacy endpoints can therefore become a cross-tenant registration/PII access path if exposed.

Required closure: remove or isolate `/api/admin/*` behind the same IAM middleware as `/api/platform/admin`, add rate limiting and MFA, and make every registration query tenant-scoped. Do not enable `ALLOW_LEGACY_ADMIN_TOKEN` in production.

### P1 — step-up tokens share the access-token key and verifier

File: `server/src/routes/admin.routes.js:92-104`

The step-up verifier uses the same `JWT_SECRET` as ordinary access tokens and does not pin the algorithm or enforce an issuer, audience, token type, nonce or replay record. The route checks scope, subject and expiry, but a compromised access-token signing key also compromises step-up assurance.

Required closure: use a separate IAM/provider-issued step-up key, pin the algorithm, require `iss`, `aud`, `typ`, `jti` and a short lifetime, and persist one-time use/replay state.

### P1 — access-token revocation is delayed

Files: `server/src/app.js:77-87`, `server/src/app.js:648-687`; `server/src/routes/admin.routes.js:406-425`

Session revoke invalidates refresh-token rows, while already-issued access JWTs remain valid until their expiry. The current platform access lifetime is short, but a stolen token remains usable during that window.

Required closure: add a session identifier and server-side session/version check (or introspection) to every platform access token, and invalidate it on membership suspension, logout-all and security incident.

### P1 — compliance/risk case access is purpose-gated but not purpose-scoped

File: `server/src/routes/platform.routes.js:234-245`

`assertCaseAccess` allows `compliance_officer` and `risk_manager` to bypass organization relation checks. The new central purpose requirement prevents an empty purpose, but any sufficiently long purpose value can still accompany a broad case read. This is a BOPLA risk for sensitive documents, operational data and risk context.

Required closure: resolve a server-side purpose grant against case, route, country, cargo, sensitivity and expiry attributes; deny the case before loading deep data when the grant does not match.

### P1 — file storage and download authorization are not production-grade yet

Files: `server/src/routes/platform.routes.js:3075-3204`, `docs/API-GAPS.md`

The current document flow stores caller-provided file references and returns a short-lived-looking `downloadToken`, but there is no production object-storage signer, malware scan, WORM retention or independently validated download endpoint in this workspace. A database row passing document scope must not be treated as a safe file URL.

Required closure: implement an object-storage adapter with content scanning, immutable version references, server-issued signed URLs, download-time authorization, watermarking and expiry/revocation audit.

### P1 — realtime stream is organization-scoped, not role/permission-scoped

Files: `server/src/routes/platform.routes.js:1068-1100`, `server/src/realtime/broker.js:17-23`, `server/src/realtime/broker.js:43-74`

An SSE endpoint and a process-local broker exist. The connection is authenticated with `READ`, but event delivery checks only tenant plus recipient organization/user. It does not re-check `SEE_LOCATION`, `SEE_SETTLEMENT`, document sensitivity or active-trip scope for each event. A member such as a Y Document Issuer can therefore receive organization-targeted operational/financial event envelopes that its role should not read. The persisted `platform_notifications` path also stores the original event payload and the ordinary notifications endpoint returns that payload to the recipient organization.

The stream is not re-authenticated when the access token expires; the connection TTL can exceed the normal access-token lifetime. The sanitizer helps with obvious key names, but key filtering is not a substitute for an event-level authorization policy.

Required closure: define an event sensitivity/permission matrix, authorize each event against tenant/org/user/role/active-trip and relationship scope, persist only redacted notification projections, close or re-authenticate streams at token/session expiry, and add cross-role/location/settlement leakage tests.

### P2 — realtime fan-out is process-local and has no replay ledger

File: `server/src/realtime/broker.js:3-40`

The in-memory subscriber map is bounded and cleans up on connection close, but events are lost across restarts and do not reach another API instance. This is primarily availability/consistency risk, but a failover can cause a client to miss a security or compliance event.

Required closure: use Redis/NATS (or equivalent) with tenant-aware fan-out, durable event IDs, bounded replay, backpressure and cross-instance tests. Never move bearer tokens into an SSE query string.

### P1 — repository/deployment secret defaults must be eliminated

Files: `server/.env.example:4-9`, `docker-compose.yml:7-10`, `server/src/config.js:8-22`

`server/src/config.js` now fails closed for weak/missing production JWT and admin secrets, and development secrets are generated in memory when omitted. The example Compose/database and environment files still contain recognizable development defaults. They are not production credentials, but copying them into a shared or exposed deployment would create predictable secrets.

Required closure: replace examples with clearly invalid placeholders, require an external secret manager in deployment, rotate any environment that used the documented defaults, and keep `.env` files out of source control.

### P2 — legacy public registration/auth surfaces expose more data than the platform read models

Files: `server/src/app.js:112-166`, `server/src/app.js:336-483`, `server/src/app.js:700-746`

The older driver/carrier and registration endpoints predate the six-surface read models. Their responses include direct phone, national/business identifiers and other registration fields for callers authorized by the legacy admin middleware. They should be retired or routed through the same masking, purpose and audit policy as the platform endpoints.

## Controls observed during review

- Platform membership lookup binds `userId`, `membershipId`, `tenantId` and `organizationId` together and requires active user, membership and organization rows.
- Core platform object reads reviewed in `server/src/routes/platform.routes.js` include tenant predicates; case/trip/document/POD/settlement helpers add relationship checks.
- Quote reads use a sealed-book helper and the admin governance read model redacts commercial keys.
- Contact reads default to masking and reveal grants are time-bounded and actor-scoped.
- Relationship-ledger reads distinguish Customer-X, X-Y, Y-Driver and X-Agent relationships.
- Document approval and evidence paths use version/lock fields; destructive document deletion is not exposed by the platform router.
- The current realtime implementation uses an authenticated fetch-based SSE connection, a connection cap, heartbeats, a connection TTL and key-based payload redaction; its event-level authorization gaps are listed above.

These observations are static evidence only and do not replace seeded cross-tenant integration tests.

## Validation

Executed after the code change:

- `node --check server/src/security/platform-auth.js`
- `npm test`
- `npm audit --omit=dev --offline`
- production legacy-admin rejection and explicit non-production opt-in JWT smoke checks

Database migration and live cross-tenant UAT require a running MySQL instance and were not treated as completed by this audit.

## Exact changed files

- `server/src/security/platform-auth.js`
- `docs/SECURITY-AUDIT.md`

No credentials, passwords or private keys are stored in this report.

## Post-audit hardening in the shared workspace

After this bounded audit, the workspace also added production fail-closed configuration, authentication rate limiting, masked legacy registration read models, production disabling of the legacy admin login/routes, an authenticated password-change route for Driver and Company Y accounts, a separate `STEP_UP_SECRET` with pinned claims validation, and exact case-reference checks for unrelated governance reads. The realtime broker now applies role permission gates and redacts persisted notification projections. Remaining external gates are the provider-backed IAM/MFA/replay store, object storage and shared realtime bus.
