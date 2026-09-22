# GOMROK Deployment Readiness

## Build and runtime

- Install: `npm install`
- Frontend production build: `npm run build`
- Database schema: `npm --workspace server run db:migrate`
- API start: `npm start`
- Local development: `npm run dev`

The frontend remains compatible with the existing Vite production base `/app/`. The PWA manifest, theme color, description, title, and SVG application mark now match Route Pulse. The administrator dashboard also exposes a tenant-scoped, masked read model for existing driver, carrier, and registration-request records without changing the legacy write flows.

## Current verification note

The 2026-09-14 browser evidence initially came from a deployed build that predates the current worktree changes and reported repeated `428` responses from `/app/api/platform/realtime` and `500` responses from `/app/api/platform/admin/cases`. After authorized deployment on 2026-09-14, the frontend assets and backend source were replaced atomically while retaining rollback backups. A live, read-only diagnostic returned HTTP 200 for health, governance cases, dashboard, and realtime; the cases failure was caused by the MariaDB-reserved `signal` column being unquoted in the deployed query. No M1/M2/M3 or annex migration was executed on the server.

## Configuration and safety

- `.env.example` and `server/.env.example` contain placeholders only.
- Production config rejects missing/short JWT, step-up, and administrator secrets.
- MySQL Compose configuration requires a root password and mounts the schema read-only.
- CORS remains allowlisted and configurable through `CLIENT_ORIGINS`.
- No new environment variable or secret is required by the redesign.

## Validation

- `docker compose config --quiet`: PASS with a validation-only process environment value.
- Production config import with strong validation-only placeholders: PASS.
- Vite production build: PASS.
- Vite production preview base and `/app/assets/*` JavaScript response: PASS.
- Frontend deployment: PASS on 2026-09-14; the active IIS release path was discovered, the `/app` build was atomically replaced, and the previous app directory was retained as a server-side backup.
- Root homepage deployment: PASS on 2026-09-15 and 2026-09-16; the supplied ZIP `dist` output was staged at `/`, the existing `/app` application was preserved, and the prior root files/configuration were retained in server-side backups.
- Backend deployment: PASS on 2026-09-14; the API source and shared contract were atomically replaced while preserving the existing server `.env`, dependencies, scheduled task and runtime configuration. `GomrokAppApi` restarted successfully.
- Existing server `.env` was repaired from the explicitly provisioned administrator credential file and backed up on the server before restart; no schema/data migration was run.
- Live smoke checks for the current worktree: PASS for health, authenticated admin login, dashboard, legacy registration read model, admin cases, manifest, service worker, and frontend asset checks; authenticated business mutations and migrations remain NOT_RUN.
- Root-site smoke checks: PASS on 2026-09-15 for `/`, `styles.css`, `app.js`, `/app/`, `/admin/v2`, `/driver-login`, and `/app/api/health`; root title and supplied customs homepage content were served with HTTP 200.

## Root homepage mobile and scroll validation

The 2026-09-15 root release corrected the scroll animation runtime failure caused by the missing `priority` parameter in `requestHeroFrame`, and made the hero canvas follow the rendered `.hero-media` viewport instead of the browser width. Mobile safeguards include `100svh` hero sizing, a constrained scroll indicator, a single-column contact form, wrapped feature overlays, and viewport/orientation resize handling. The customer-logo wall was removed from the public homepage at the user's request; navigation links that targeted it were redirected to existing relevant sections.

- Local static regression suite: PASS, `npm test` 6/6.
- Static JavaScript syntax: PASS, `node --check dist/app.js`.
- Typecheck: PASS, `npm run typecheck`.
- Production build: PASS, `npm run build` (Next.js build warnings were limited to workspace-root lockfile inference).
- Browser validation: PASS at 320px and 390px mobile widths; the canvas matched the rendered content viewport, the page had no horizontal overflow, hero frame selection changed at an intermediate scroll position, the feature media became active during scroll, and no console errors/warnings were captured.
- Public post-deploy smoke: PASS for `/`, `styles.css`, `app.js`, `/app/`, `/app/api/health`, and `/admin/v2`; the deployed root served HTTP 200 and the `/app` application remained available.
- Deployment evidence: release `20260915-212329`, root frontend path under `C:\Websites\gomrok.org\releases\20260901-232613\frontend`, server-side backup `root.backup-20260915-212329`, `AppPreserved=True`, and the root rewrite targets `index.html`.

This release changed only the public static homepage package. It did not run migrations, modify backend/database state, or deploy to production through the application path.

## Mobile scroll-jump correction — 2026-09-16

The mobile browser can emit `resize` events while its browser chrome changes size during a scroll. The platform carousel resize handler was reapplying `scrollIntoView` to the active card, which could move the document away from the video boundary and repeat when the user returned to that area. The handler now refreshes carousel state without vertical scrolling during layout changes; explicit tab/previous/next actions retain their intentional horizontal reveal behavior. The runtime also sets `history.scrollRestoration` to `manual`, so a browser refresh starts the homepage at the top instead of restoring the previous lower-page position.

- Regression tests: PASS, `mobile viewport resize cannot scroll the page through the platform carousel`; `refresh does not restore a stale scroll position`.
- Local browser reproduction after the fix: PASS; the scroll position remained `6645.6px` across a 390px→389px viewport resize near the feature section.
- Live browser verification after deployment `20260916-111417`: PASS; the scroll position remained `11076px` at the video-section exit across a 389px→390px resize and remained stable across two up/down cycles. The hero animation continued to update at an intermediate scroll position, and the active feature video remained playable.
- Live console check: PASS; no error or warning entries were captured during the mobile reproduction.
- No section, content, backend route, database record, or `/app` path was removed or changed.

## Refresh scroll restoration correction — 2026-09-16

The public homepage previously allowed the browser to restore the last scroll position after refresh. That behavior made a refresh at the video/feature area appear to trigger an automatic scroll to the bottom. The shipped runtime now sets `window.history.scrollRestoration = "manual"`, and `index.html` references the updated runtime with a cache-busting query string. Explicit hash links remain supported by restoring the requested element after load.

- Artifact regression suite: PASS, 6/6 tests.
- Public browser verification: PASS; after scrolling to `5760px`, refreshing returned the page to `0px` with no hash and loaded `app.js?v=20260916-scroll-refresh-hash`. A `#platform` deep link also remained addressable after refresh.
- Deployment evidence: release `20260916-113632`, server-side backup `root.backup-20260916-113632`, `AppPreserved=True`, and the root rewrite targets `index.html`.
- Static syntax, typecheck, and production build: PASS; the build retained only the existing multiple-lockfile workspace-root warning.

## Secondary partner-logo block removal — 2026-09-16

The explicitly requested `.logo-grid-secondary` block was removed from the public root homepage together with its now-unused `industry-logos` wrapper and CSS rules. The preceding industry introduction and all unrelated homepage sections remain; `/app` and its API remain preserved.

- Artifact regression suite: PASS, `npm test` 6/6; the test now asserts that the secondary logo block and empty wrapper are absent while required sections remain.
- Production build: PASS, `npm run build` (the existing multiple-lockfile workspace-root warning remains non-blocking).
- Live browser verification: PASS; the deployed stylesheet and HTML no longer contain the secondary logo block, and no console errors or warnings were captured.
- Deployment evidence: release `20260916-121640`, server-side backup `root.backup-20260916-121640`, `AppPreserved=True`, and the root rewrite targets `index.html`.

## Mobile platform-card viewport correction — 2026-09-16

The mobile `.platform-track` now removes the inter-card gap and makes active and inactive cards each occupy the full platform viewport width. This prevents a sliver of the following image from appearing beside the current card while preserving the desktop carousel layout and controls.

- Regression suite: PASS, `npm test` 6/6; assertions cover the mobile zero-gap and full-width card rules.
- Production build: PASS, `npm run build` (the existing multiple-lockfile workspace-root warning remains non-blocking).
- Live browser verification: PASS; the deployed page has no horizontal overflow and no console errors or warnings were captured.
- Deployment evidence: release `20260916-122719`, server-side backup `root.backup-20260916-122719`, `AppPreserved=True`, and the root rewrite targets `index.html`.

## Homepage transport-positioning copy — 2026-09-22

The public homepage now presents the product as an intelligent international freight-transport and customs-clearance platform. The hero uses the requested wording; pathways, calculator, features, platform cards, contact copy, FAQ and footer were updated to mention transport routes, fleet, shipping documents/bills of lading, cargo and clearance while retaining the existing sections and `/app`.

- Artifact regression suite: PASS, `npm test` 6/6; assertions cover the requested hero wording and transport copy.
- Production build: PASS, `npm run build`; the existing multiple-lockfile workspace-root warning remains non-blocking.
- Public deployment evidence: release `20260922-184518`, server-side backup `root.backup-20260922-184518`, `AppPreserved=True`, and the root rewrite targets `index.html`.
- `/app` and the platform API were preserved.

## Root homepage Vazirmatn font restoration — 2026-09-22

The standalone root homepage now ships the existing `app/fonts/Vazirmatn-wght.woff2` asset under `dist/fonts/`, declares it with a local `@font-face`, and preloads it from `dist/index.html`. This restores the Persian font independently of the Next.js layout class, which is not present when the root static package is served directly.

- Artifact regression suite: PASS, `npm test` 7/7; the added font test verifies the asset, preload link and variable-weight declaration.
- Production build: PASS, `npm run build`; the existing multiple-lockfile workspace-root warning remains non-blocking.
- Public deployment evidence: release `20260922-185621`, server-side backup `root.backup-20260922-185621`, `AppPreserved=True`, and the root rewrite targets `index.html`.

## Root homepage transport and customs content expansion — 2026-09-22

The standalone root homepage source now includes a detailed explanation of the transport/customs operating model, role-specific problem/solution cards for drivers, carriers, forwarders, cargo owners and customs teams, a capability table, and a source-noted comparison with domestic load-board platforms and global logistics platforms. The comparison is explicitly framed as a capability/focus comparison rather than a ranking, price claim, legal claim or independent benchmark.

- Artifact regression suite: PASS, `npm test` 7/7; required sections, transport copy, comparison labels, responsive safeguards, scroll behavior and font checks passed.
- Static JavaScript syntax: PASS, `node --check dist/app.js`.
- Production build: PASS, `npm run build`; the existing multiple-lockfile workspace-root warning remains non-blocking.
- Public deployment: PASS, release `20260922-192043`; the content section, role cards, capability table and competitor comparison are live at `/`, with `/app` preserved.

## Role-panel header menu — 2026-09-22

The public header's `سامانه` menu now replaces the previous anchor list with six role-oriented production entry links: صاحب کالا, فورواردر / شرکت X, کریر / شرکت Y, راننده, نماینده مقصد, and مدیریت سامانه. Each link opens in a new tab with `noopener`; the role-specific paths are `/app/shipper`, `/app/forwarder`, `/app/careers`, `/app/driver`, `/app/agent`, and `/admin/v2`. Server authentication remains the source of truth for the final panel; development-only `/app/preview/*` routes are not exposed.

- Artifact regression suite: PASS, `npm test` 7/7; the existing public-section, responsive, scroll, and font checks passed and the system menu assertions cover all six links and removal of the previous submenu labels.
- Production build: PASS, `npm run build`; the existing multiple-lockfile workspace-root warning remains non-blocking.
- Public deployment evidence: PASS, release `20260922-192043`, server-side backup `root.backup-20260922-192043`, `AppPreserved=True`, and the root rewrite targets `index.html`.
- Live browser verification: PASS; the root homepage returned the expected title/content, the menu opened with six distinct new-tab links and no previous submenu labels, and the root had no horizontal overflow. The initial deployment of this menu was superseded by the role-route correction below.
- Recovery note: the deployment helper recovered the missing root `web.config` from the previous server-side backup before swapping the prepared root package; no `/app` files or application API paths were replaced.

## Separate role-panel entry routes — 2026-09-22

The six public role links now resolve to separate application entry paths. `App.jsx` maps an authenticated server-issued role to the matching existing workspace component (ShipperPanel, CompanyXPanel, CompanyYPanel, DriverMobilePanel, AgentPanel, or AdminGovernancePanel). A session with a different role receives a role-mismatch denial screen; a missing organization role/session receives the matching gateway and never falls back to the driver panel. No new login bypass or production preview route was added.

- Client regression test: PASS, `node --test client/test/*.test.js` 4/4; route declarations, mismatch guard, and non-driver fallback assertions passed.
- Client production build: PASS, `npm.cmd run build`.
- Public root regression suite: PASS, `npm.cmd test` 7/7; desktop and mobile menu assertions cover `/app/shipper`, `/app/forwarder`, `/app/careers`, `/app/driver`, `/app/agent`, and `/admin/v2`.
- Frontend deployment evidence: PASS, final app release `20260922-200242`; `RegistrationImageCount=4`, with the previous `/app` retained at `app.backup-20260922-200242`.
- Root deployment evidence: PASS, release `20260922-195840`; `RootIndexBytes=56514`, `RootScriptBytes=25759`, `AppPreserved=True`, and `RootRuleTargetsRootIndex=True`.
- Live browser verification: PASS; desktop and mobile menus returned the six expected distinct hrefs with `target="_blank"`. `/app/shipper`, `/app/forwarder`, and `/app/agent` displayed their own role gateway without the authenticated driver view; `/app/careers`, `/app/driver`, and `/admin/v2` displayed their existing role-specific entry screens. Root and gateway console error/warning logs were empty.
- Scope/security note: non-driver organization login remains dependent on the existing server IAM/membership session; the route fix does not fabricate accounts, expose another role's data, or weaken authorization.

## Root homepage font cache-busting repair — 2026-09-22

The standalone homepage now version-pins the stylesheet and Vazirmatn font URLs. This prevents browsers that cached the pre-font stylesheet from continuing to render the root page with fallback typography; the deployed CSS contains the local `@font-face` rule and points to the versioned WOFF2 asset.

- Artifact regression suite: PASS, `npm test` 7/7.
- Production build: PASS, `npm run build`; the existing multiple-lockfile workspace-root warning remains non-blocking.
- Static JavaScript syntax: PASS, `node --check dist/app.js`.
- Public deployment evidence: PASS, release `20260922-194017`, `RootIndexBytes=56472`, `AppPreserved=True`, and `RootRuleTargetsRootIndex=True`.
- Live browser verification: PASS; the root loaded `styles.css?v=font-fix-20260922`, the preload and `@font-face` rule referenced `Vazirmatn-wght.woff2?v=font-fix-20260922`, `document.fonts.check('16px Vazirmatn')` returned true, and the body resolved to `Vazirmatn` before fallback families.

## Organization-panel login deployment — 2026-09-22

The latest role-specific frontend and backend source were deployed to the authorized IIS/Node server using the existing rollback-preserving deployment helpers. The `/app` release was swapped atomically and the scheduled API task was restarted; existing server configuration, database contents and rollback backups were preserved.

- Backend deployment: `deploy-backend.ps1` completed with exit code 0; public `GET /app/api/health` returned HTTP 200.
- Frontend deployment: `deploy-frontend.ps1` completed with exit code 0; release `20260922-211454`, with the prior `/app` retained at `app.backup-20260922-211454`.
- Public route smoke checks: `/app/shipper`, `/app/forwarder` and `/app/agent` each returned HTTP 200.
- Synthetic organization-login probe: HTTP 503. Organization login is not claimed as operational because the new credential table/membership provisioning was not migrated or provisioned on production; no production database migration was executed.
- No production data, credentials, IAM records, or database schema were modified by this deployment.

STAGE_11_STATUS: PASS
NEXT_STAGE: 12-fullstack-final-review
