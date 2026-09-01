# GOMROK Technical Redesign Report

| Field | Value |
| --- | --- |
| Project | GOMROK |
| Report type | Technical handoff |
| Language | English |
| Jalali date | 1405/06/10 |
| Gregorian date | 2026-09-01 |
| Repository baseline | `dd06d23` plus existing local changes |
| Status | PASS within frontend redesign scope |

## Scope and baseline architecture

The repository is a workspace containing React/Vite under `client/`, Express under `server/`, MySQL schema in `server/schema.sql`, and the shared policy contract in `shared/contract.js`. The task was a complete frontend redesign while preserving the existing backend, schema, API, and IAM boundaries.

## Frontend changes

- Implemented the Route Pulse design system in `client/src/route-pulse.css` and `design/tokens.json`.
- Added `ProductIcon.jsx` with the product logo, mark, domain icon system, and SVG logistics illustration.
- Redesigned public selection, login, registration, registration status, Admin login, and a consolidated review hub in `App.jsx`.
- Restyled all six panels without removing any section: 16 Shipper, 19 Company X, 16 Company Y, 5 Driver tabs, 10 Agent, and 19 base Admin sections/18 visible to the preview Super Admin role.
- Added `ResponsivePanelNav.jsx` for complete, accessible off-canvas hamburger navigation across all six panels on mobile/tablet while preserving desktop sidebars and Driver bottom navigation.
- Refined shared document, dialog, drawer, timeline, evidence, and status primitives.
- Added focus trapping, Escape close, and focus restoration to overlays.
- Preserved role-level lazy loading and added no dependency.

## Backend, database, and API

No endpoint, payload, migration, table, or permission changed. Real frontend requests remain in place. The only API compatibility repair percent-encodes Persian `X-Purpose-Scope` text before assigning it to a browser request header. OpenAPI and role/tenant/relationship policies remain authoritative.

## Security

- Preview routes remain gated by `import.meta.env.DEV`.
- No secret, production data, production mock, or unsafe HTML sink was introduced.
- Both full and production-only npm audits reported zero known vulnerabilities.
- All 19 role, tenant, RFQ, readiness, POD, settlement, audit, and realtime tests passed.
- Authorization remains server-enforced; UI visibility is not treated as a security boundary.

## Validation results

| Check | Result |
| --- | --- |
| `npm run build` | PASS — 44 modules, 6 role chunks, and the shared navigation chunk |
| `npm test` | PASS — 19/19 |
| `npm audit` | PASS — 0 vulnerabilities |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `docker compose config --quiet` | PASS |
| Production configuration validation | PASS |
| Public QA at 360/390/430/768/1024/1440 | PASS |
| Six-panel QA at 390/768/1024/1440 | PASS |
| Six-panel hamburger interaction | PASS — Escape, backdrop, section selection, scroll lock, and focus restoration |
| Horizontal document overflow | PASS — none observed |
| Browser console | PASS — no warning/error |
| Live MySQL migration | NOT_RUN — schema unchanged and no disposable credentials supplied |
| Live authenticated mutations | NOT_RUN — no test data/accounts supplied |
| External deployment | NOT_PERFORMED |

The first sandboxed `npm test` invocation stopped with `spawn EPERM`; the identical command passed all 19 tests when test-worker spawning was permitted.

## Defect repair and regression review

- Fixed Driver/Admin logo clipping caused by legacy direct-child selectors.
- Fixed collapsed Admin navigation labels.
- Fixed the Persian Fetch header transport failure and rechecked browser diagnostics.
- Strengthened mobile public copy wrapping and preview-hub responsive behavior.
- Aligned the `vite preview` base with the production `/app/` path and rechecked the JavaScript asset response.
- Replaced long tablet/mobile horizontal menus with complete scrollable drawers while retaining desktop behavior without regression.
- No required route, section, test, API, schema, permission, or asset was removed.

## Limitations and production readiness

The frontend is ready for handoff through the existing deployment pipeline. Before public release, run migration and role-based smoke tests with a disposable populated database and the real reverse proxy. The existing process-local realtime broker requires shared pub/sub before horizontal API scaling.

## Stage status

Stages 01 through 12 are recorded as PASS for this delivery scope. Infrastructure checks lacking credentials remain explicitly NOT_RUN and were not represented as successful.
