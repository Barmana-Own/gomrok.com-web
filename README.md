# Gomrok.org

Mobile-first customs and transport platform foundation.

## Stack

- `client/`: React + Vite
- `server/`: Node.js + Express
- `server/schema.sql`: MySQL schema for driver/carrier auth and CRM foundation
- `docker-compose.yml`: MySQL 8.4 container with a persistent volume

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start MySQL in Docker:

   ```bash
   cp .env.example .env
   cp server/.env.example server/.env
   # Replace every replace-* value with locally generated secrets.
   docker compose up -d mysql
   ```

   `MYSQL_ROOT_PASSWORD` in the root `.env` must equal `DB_PASSWORD` in `server/.env`. No username or password is committed to this repository; generate values with `openssl rand -base64 36` and keep both `.env` files private.

3. Create the database tables:

   ```bash
   npm --workspace server run db:migrate
   ```

4. Start the API and React app:

   ```bash
   npm run dev
   ```

The React mobile app runs on `http://127.0.0.1:5083`. The API runs on `http://127.0.0.1:4000`.

The current `/app/driver` and `/app/careers` flows collect the requested base information as pending registration requests. An admin must approve a request before the driver or carrier account is created. The `/admin/v2` workspace is the Marketplace Governance console: staff roles, tenant-scoped organizations, human KYC/qualification decisions, sealed RFQ monitoring, risk/compliance/conflict queues, append-only audit, dual-control Break-Glass, versioned RulePacks, relationship-ledger governance, contact-reveal/export oversight, AI monitor and technical health are separately authorized by the server.

## Shared platform contract foundation

The shared contract is implemented in `shared/contract.js` and consumed by the server domain policy and client workspace. It provides canonical roles, permissions, RFQ levels, state graphs, relationship boundaries, error codes and event names for the six surfaces.

The tenant-scoped platform API is mounted under `/api/platform` and includes cargo cases, isolated RFQ1/RFQ2 books, human award, Company Y nomination, readiness-gated trip start, GPS events, versioned documents, CMR draft/final flow, authorized-recipient POD review, relationship-scoped settlement, masked contact reveal, governed export approval and append-only audit read models. The contract-facing OpenAPI file is `openapi/gomrok-platform-v1.yaml`.

The Shipper / Customer surface is implemented in `client/src/components/ShipperPanel.jsx`. Its server-owned eight-step draft wizard, RFQ1 sealed comparison, delegated human award, Customer-X contract versioning, CMR review, least-privilege tracking/POD, relationship-scoped finance, claims/disputes and notifications use the platform routes. Shipper logistics approvals require explicit `organization_memberships.delegation_json`; finance memberships do not receive trip or raw-location mutation permissions.

The Driver surface is implemented in `client/src/components/DriverMobilePanel.jsx` as an installable RTL mobile web app. It binds a device, keeps a local action queue for offline GPS/evidence drafts, limits read models to the assigned driver, and uses server-gated undertaking acceptance, check-in, preload evidence, active-trip tracking, authorized-recipient OTP/POD, Y-Driver settlement and claims workflows.

The Agent/Z destination surface is implemented in `client/src/components/AgentPanel.jsx`. It is assignment- and authority-scoped, binds the Agent device, separates destination verification from POD acceptance, appends versioned photos/signature/stamp/CMR/warehouse evidence, supports audited delivery OTP, discrepancy and claim evidence, and exposes only the X-Agent settlement relationship.

The Admin / Marketplace Governance surface is implemented in `client/src/components/AdminGovernancePanel.jsx` and `server/src/routes/admin.routes.js`. Super Admin is not granted blanket commercial access: quote bodies and raw contacts remain redacted, RFQ governance exposes only seal/deadline/access metadata, RulePacks cannot be silently edited, critical notifications cannot be disabled, and high-risk actions require an attributable step-up token plus idempotency key.

Sensitive platform writes require `X-Idempotency-Key`. Access JWTs are short-lived and `/api/auth/refresh` rotates refresh tokens. Platform JWTs are tied to an active organization membership; the server derives tenant and organization scope from that membership rather than trusting request payloads.

All six surfaces share the same tenant-scoped API and domain event stream. `/api/platform/realtime` is an authenticated SSE stream for safe event metadata; each panel falls back to bounded polling when the stream is unavailable. The MVP broker is process-local, so production horizontal scaling requires a shared pub/sub adapter before running multiple API instances.

## Developer handoff

See [`docs/NEXT-DEVELOPER.md`](docs/NEXT-DEVELOPER.md) for the surface-by-surface contract map, environment setup, API gaps, test commands, security boundaries, realtime behavior and deployment checklist. See [`docs/SECURITY-AUDIT.md`](docs/SECURITY-AUDIT.md) for the bounded security audit and remaining release gates. Credentials are provisioned through environment variables or the registration approval response and are intentionally not stored in documentation or source control.

Carrier auth endpoints:

- `POST /api/auth/register-carrier`
- `POST /api/auth/login-carrier`

Registration endpoints:

- `POST /api/registrations/driver`
- `POST /api/registrations/carrier`
- `PATCH /api/admin/registrations/:role/:id/status`
- `PUT /api/admin/registrations/:role/:id`
- `DELETE /api/admin/registrations/:role/:id`

## Production app path

The production build for the mobile web app uses `/app/` as its base path and `/app/api` as its same-origin API prefix. The Windows deployment helper is `deploy-apk.ps1`; it prompts for the server password without writing it to the repository, stages the frontend, copies the Docker Compose file, runs the database migration, and registers the API as the `GomrokAppApi` scheduled task. When Docker is available, it starts the `gomrok-mysql` service on port `3308`; otherwise it keeps the existing local database on port `3307` and does not interrupt the site.

Public routes:

- `https://gomrok.org/app` — role selection
- `https://gomrok.org/app/driver` — driver registration
- `https://gomrok.org/app/careers` — carrier registration
- `https://gomrok.org/admin/v2` — admin panel
