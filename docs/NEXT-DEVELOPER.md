# GomrokDotCom developer handoff

This repository contains one shared logistics kernel and six role-scoped surfaces: Shipper, Company X, Company Y, Driver mobile web, Agent/Z destination and Admin/Marketplace Governance. The source precedence and domain invariants are documented in the product contract files supplied with the project; `shared/contract.js` is the executable enum/permission layer and `openapi/gomrok-platform-v1.yaml` is the API skeleton.

## Start-up

1. Copy `.env.example` to `.env` and `server/.env.example` to `server/.env`.
2. Replace every `replace-*` value with a unique random value. Set root `MYSQL_ROOT_PASSWORD` equal to server `DB_PASSWORD`, and set a different `STEP_UP_SECRET`; never commit either file.
3. Run `npm install`.
4. Start MySQL with `docker compose up -d mysql`.
5. Run `npm --workspace server run db:migrate`.
6. Start both surfaces with `npm run dev`.

The web client is `http://127.0.0.1:5083`; the API is `http://127.0.0.1:4000`. The API refuses production startup when `JWT_SECRET` or `ADMIN_PASSWORD` is missing or too short. In development, the legacy admin login remains disabled until `ADMIN_PASSWORD` is explicitly configured.

For local-only `/admin/v2` bootstrap, keep `ALLOW_LEGACY_ADMIN_TOKEN=true` in `server/.env`; `server/src/security/platform-auth.js` rejects that mode whenever `NODE_ENV=production`. Use a real membership-backed staff session and set it to `false` before any shared or deployed environment.

## Credentials and accounts

No plaintext password is stored in this handoff or in source control.

| Account | Username | Password | Provisioning |
|---|---|---|---|
| Legacy governance bootstrap | `ADMIN_USERNAME` (normally `admin`) | `ADMIN_PASSWORD` from `server/.env` | Set locally before `/api/admin/login`; rotate outside the repository. |
| Driver | mobile number | generated one-time password | Submit `/api/registrations/driver`, approve through the governed admin endpoint, deliver the returned password through a secure channel, then rotate it. |
| Company Y | mobile number | generated one-time password | Submit `/api/registrations/carrier`, approve through the governed admin endpoint, deliver the returned password through a secure channel, then rotate it. |
| Platform roles | organization membership | issued by the IAM/bootstrap workflow | The JWT must resolve to an active `organization_memberships` row; never construct a client role or tenant claim. |

The approval response may contain a generated password because the account has no password before approval. Treat it as a one-time secret; do not paste it into tickets, README files, logs or chat. Authenticated Driver and Company Y users can rotate it through `POST /api/auth/change-password`; recovery, MFA enrollment and forced first-login rotation still belong in the external IAM release gate.

## Surface wiring

- Shipper: `client/src/components/ShipperPanel.jsx` → `/api/platform/cases`, sealed RFQ1, human award, Customer-X contract, CMR review, tracking, POD read model and Customer-X ledger.
- Company X: `client/src/components/CompanyXPanel.jsx` → Market A pricing and award, isolated RFQ2, Y award, nomination, loading, CMR draft, readiness gates, Control Tower, POD review and X relationships.
- Company Y: `client/src/components/CompanyYPanel.jsx` → RFQ2 invitation/bid, DriverCarrierCoverage, vehicle/driver eligibility, nomination, final CMR, TIR Holder gate, own trips and X-Y/Y-Driver ledgers.
- Driver: `client/src/components/DriverMobilePanel.jsx` → device binding, internal Y opportunities, encrypted offline evidence/GPS queue, readiness-gated trip start, border/incident/POD events and Y-Driver settlement.
- Agent/Z: `client/src/components/AgentPanel.jsx` → assignment/authority checks, destination matching, location, OTP, signature/stamp, versioned evidence, warehouse receipts, POD submission and X-Agent ledger.
- Admin: `client/src/components/AdminGovernancePanel.jsx` + `server/src/routes/admin.routes.js` → scoped governance read models, KYC decisions, RFQ seal monitor, risk/compliance/conflict queues, append-only audit, Break-Glass, RulePacks, finance/CRM/export governance, AI monitor and health.

All six panels use `client/src/hooks/usePlatformRealtime.js`. The server sends only tenant/org/user-recipient events through `server/src/realtime/broker.js`; payloads are sanitized and the dashboard remains the source of truth. The broker is process-local and intentionally does not claim cross-instance replay or delivery guarantees.

## Security rules to preserve

- Every write must pass server RBAC + ABAC + membership/ownership checks and use idempotency where required.
- RFQ1 and RFQ2 remain isolated; direct X-to-Driver award is forbidden; human award is mandatory.
- Never expose competitor quotes, X-Y/customer rates, raw contact data, raw GPS history or unrelated documents.
- Approved documents/evidence and audit records are append-only/versioned; no overwrite or normal destructive delete.
- TIR requires an authorized Holder; trip start requires customs, permit, document, vehicle, driver and preload readiness.
- Agent delivery requires valid assignment/authority and configured recipient/OTP/evidence checks; POD submit is not POD accepted.
- Admin roles are not blanket business-data roles. Purpose, step-up, dual control, attributable audit and CRM/export caps remain mandatory.

## Verification

```bash
npm test
npm run build
npm audit --omit=dev --offline
node --check server/src/app.js
node --check server/src/routes/platform.routes.js
node --check server/src/routes/admin.routes.js
```

OpenAPI can be parsed with Ruby/Psych or another YAML parser. Database-backed UAT additionally requires a reachable MySQL instance; a successful frontend build or open port is not proof that migrations or authorization flows work.

## Known release gates

- `API-GAP-IAM-PASSWORD-ROTATION`: add a server-side password-change/reset flow before handing out generated credentials beyond local UAT.
- `API-GAP-REALTIME-BUS`: replace the process-local broker with Redis/NATS or equivalent for multi-instance delivery, replay and backpressure.
- `API-GAP-FILE-STORE`: connect an object store with short-lived signed downloads, malware scanning, WORM retention and hash verification.
- `API-GAP-OIDC`, `API-GAP-SMS-OTP`, `API-GAP-MOBILE-RUNTIME`: integrate the production identity, messaging and native/offline runtime providers.
- `API-GAP-ADMIN-WEBHOOK-WRITE`: add governed HMAC endpoint management, replay protection and delivery worker APIs.

Do not mark the platform production-ready until these external dependencies are either implemented and tested or explicitly accepted as release risks.
