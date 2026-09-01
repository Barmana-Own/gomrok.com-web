# GOMROK Full UI/UX Redesign Brief

## Project identity

- Product: GOMROK logistics, customs and transport marketplace
- Repository: `gomrok-web`
- Redesign baseline: commit `dd06d23` plus the existing local preview-route changes
- Requested palette: `#140e04`, `#ededff`, `#0afa82`, `#4363ea`, `#4c7cff`
- Delivery scope: frontend redesign only; backend behavior, API contracts and authorization remain authoritative

## Objective

Rebuild the visual and interaction layer of every public surface and all six operational workspaces as one coherent Persian-first, RTL-first product. The result must feel purpose-built for logistics operations, remain usable at mobile and desktop widths, and preserve every existing workflow and permission boundary.

## Actors and surfaces

| Actor | Primary intent | Existing surface inventory |
| --- | --- | --- |
| Public visitor | Select role, authenticate or submit onboarding | Role selection, driver/carrier login, driver registration, carrier registration, registration status, admin login |
| Shipper / Customer | Create and govern cargo demand | 16 sections including wizard, RFQ1, contracts, documents, tracking, POD, finance and claims |
| Company X | Price, source capacity and operate awarded cargo | 19 sections spanning RFQ1, pricing, RFQ2, dispatch, documents, tracking, POD and finance |
| Company Y / Carrier | Manage carrier capacity and awarded trips | 16 sections including RFQ2, bids, drivers, vehicles, nomination, CMR/TIR, tracking and settlement |
| Driver | Execute assigned transport safely | 5 mobile tabs plus trip acceptance, check-in, evidence, GPS, border, incident, OTP and POD flows |
| Agent Z | Verify destination delivery and evidence | 10 sections covering assigned deliveries, verification, evidence, receipts, discrepancies, claims and settlement |
| Admin / Governance | Govern marketplace, risk and security | 19 role-filtered areas including KYC, RFQ governance, audit, Break-Glass, RulePacks, finance, security, AI and health |

## Primary journeys

1. Public onboarding and authentication.
2. Shipper cargo request to RFQ1 award, contract, active movement, POD and settlement.
3. Company X opportunity review, pricing, capacity RFQ2, dispatch and control-tower operations.
4. Company Y bid, driver/vehicle nomination, document issuance, active trip and settlement.
5. Driver assignment acceptance, readiness, check-in, evidence, GPS, destination OTP/POD and issue reporting.
6. Agent destination verification, discrepancy handling, evidence/POD and relationship settlement.
7. Admin qualification, governance queues, audit, security controls and operational health.

## Design direction

- Confident dark text and navigation anchored by `#140e04`.
- Lavender operational canvas based on `#ededff`.
- Mint `#0afa82` reserved for primary progress, readiness and affirmative actions.
- Royal blue `#4363ea` for navigation and enterprise structure.
- Bright blue `#4c7cff` for information, focus and active data states.
- Vector-first logo and iconography; one bespoke raster logistics illustration only where it improves public onboarding.
- Deliberate information density: mobile app ergonomics for Driver, adaptive control towers for commercial roles, dense desktop workspace for Admin.

## Scope constraints

- Preserve routes, API requests, server-owned state, role checks, session behavior and security boundaries.
- Do not replace live production behavior with fixture data.
- Development-only preview routes may continue to show empty read models without authentication.
- No backend, schema or contract changes unless a frontend regression exposes a necessary compatibility repair.
- All project work and backup artifacts remain on drive E.

## Risks

- Large legacy stylesheet with duplicated role-specific rules can create cascade regressions.
- Very small legacy font sizes reduce readability and accessibility.
- Unicode navigation glyphs create inconsistent iconography.
- Dense tables and long Persian labels require deliberate mobile transformations.
- Development preview routes must remain unavailable in production builds.

## Stage 02 handoff

Build a token-driven design system, a reusable SVG icon/brand layer, shared shell patterns, clear status semantics, responsive rules and a complete page-state matrix before applying the new visual system to all surfaces.

