# Project Integrity Baseline

Baseline revision: `dd06d23`

## Protected applications and routes

- React/Vite client under `client/`
- Express/MySQL server under `server/`
- Shared policy contract under `shared/contract.js`
- Public routes: `/app`, `/app/driver`, `/app/careers`, `/driver-login`, `/carrier-login`, `/admin/v2`, `/app/admin/v2`
- Development-only role previews: `/app/preview/shipper`, `/app/preview/company-x`, `/app/preview/company-y`, `/app/preview/driver`, `/app/preview/agent`, `/app/preview/admin`

## Protected role surfaces

- ShipperPanel: 16 sections
- CompanyXPanel: 19 sections
- CompanyYPanel: 16 sections
- DriverMobilePanel: 5 primary tabs and nested trip workflows
- AgentPanel: 10 sections
- AdminGovernancePanel: 19 role-filtered governance sections

## Protected business capabilities

- Registration and login
- Tenant- and membership-scoped authorization
- RFQ1/RFQ2 separation and human award
- Contracts and role locks
- Driver/vehicle nomination
- Readiness, GPS and trip lifecycle
- Versioned documents, CMR/TIR and immutable evidence
- OTP, POD and destination authority
- Relationship-scoped settlements
- Claims, disputes, exceptions and audit
- KYC, qualification, Break-Glass, RulePacks, export/contact oversight and technical health

## Protected implementation assets

- `server/schema.sql` and migrations
- `openapi/gomrok-platform-v1.yaml`
- Server test suites under `server/test/`
- PWA manifest and service worker
- Existing public imagery under `client/public/images/`
- Shared responsive navigation and accessibility behavior in `client/src/components/ResponsivePanelNav.jsx`
- Deployment scripts and Docker configuration

## Preservation decision

The redesign may replace visual styling and presentation components, but no protected route, role, section, API call, permission check, workflow or data path may disappear. Any equivalent replacement must remain traceable and runnable.

## Final preservation comparison — 2026-09-01

| Protected area | Result |
| --- | --- |
| Public routes and onboarding | PRESERVED; visual system replaced equivalently |
| Six role workspaces and navigation inventory | PRESERVED; all expected navigation items rendered, desktop sidebars retained, and complete mobile drawers verified |
| API request paths and OpenAPI contract | PRESERVED; no contract removal or production mock |
| Authentication, authorization and membership scope | PRESERVED; 19 policy tests passed |
| Database schema and migrations | PRESERVED; no schema mutation |
| PWA and public assets | PRESERVED; mark and metadata improved, with optimized driver/carrier onboarding artwork added |
| Server tests and deployment configuration | PRESERVED; tests and Compose validation passed |

Added surface: `/app/preview`, a development-only index for the existing six preview workspaces and public routes. No protected element is classified as `INTENTIONALLY_REMOVED` or `REGRESSION`.
