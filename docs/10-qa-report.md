# GOMROK QA and Debugging Report

## Tested journeys and environments

- Public role selection, driver/carrier login, driver/carrier registration, admin login, and the consolidated preview hub.
- Shipper, Company X, Company Y, Driver, Agent Z, and Admin Governance dashboards plus secondary navigation.
- Chromium-based in-app browser at 360, 390, 430, 768, 1024, 1280, 1440 widths.
- RTL layout, keyboard select interaction, mobile bottom navigation, desktop sidebars, loading and empty read models.

## Defects and fixes

| ID | Severity | Root cause | Fix | Status |
| --- | --- | --- | --- | --- |
| QA-001 | P2 | Legacy direct-child brand selectors clipped the Driver and Admin logo. | Added scoped logo resets for the new component structure. | FIXED / visually rechecked |
| QA-002 | P2 | Legacy Admin nav span sizing collapsed Persian labels. | Reset nested nav label sizing while retaining dense layout. | FIXED / visually rechecked |
| QA-003 | P1 | Unicode Persian purpose text caused Fetch to reject an HTTP header before an Admin request. | Percent-encoded the bounded purpose header. | FIXED / no console errors |
| QA-004 | P2 | Public mobile lead copy could appear clipped under narrow embedded review. | Added explicit width, wrapping, and min-width rules at 430px. | FIXED / direct 390px screenshot verified |
| QA-005 | P2 | Preview users still had to know six separate URLs. | Added a development-only consolidated preview hub with all panels and public pages. | FIXED / 12 links rendered |
| QA-006 | P2 | Shared overlays lacked complete keyboard focus behavior. | Added focus trap, Escape close, and focus restoration. | FIXED / build verified |
| QA-007 | P1 | Vite used the development root base during `vite preview`, so `/app/assets/*` resolved to the HTML fallback instead of JavaScript. | Applied `/app/` base when `isPreview` is true and revalidated the built asset response. | FIXED / HTTP asset smoke PASS |
| QA-008 | P2 | Tablet and mobile operational panels exposed long horizontal navigation strips, making sections hard to discover and scan. | Added one reusable, focus-managed hamburger drawer across all six role panels while preserving desktop sidebars and the Driver bottom navigation. | FIXED / interactive browser matrix PASS |
| QA-009 | P1 | Legacy onboarding selectors retained absolute positioning and LTR step direction after the redesign, producing incorrect RTL placement in registration views. | Reset the public cascade, implemented logical RTL ordering, corrected directional controls and mixed-direction inputs, and introduced responsive generated artwork for driver/carrier onboarding. | FIXED / 360, 390, 768 and 1440 visual QA PASS |
| QA-010 | P1 | Public role cards opened driver/carrier registration directly, skipping the role-specific login step. | Role cards now route to the matching login page first; the existing «ثبت‌نام کن» CTA on each login page routes to the matching registration form. | FIXED / browser click flow PASS for both roles |
| QA-011 | P2 | Registration inputs displayed example placeholder text and inherited a second focus rectangle inside the field shell. | Removed registration placeholders and scoped focus rules so the field keeps one clean outline without an inner focus box. | FIXED / driver and carrier 390px browser QA PASS |
| QA-012 | P2 | Welcome header alignment depended on inherited RTL direction and hid the status pill at narrow widths. | Made the brand/status ordering explicit and retained the status pill on the left of the logo block across mobile and desktop. | FIXED / 390px browser screenshot and geometry QA PASS |
| QA-013 | P2 | User-facing Persian auth, registration and account copy used a transliterated carrier label. | Replaced the visible terminology with «شرکت حمل‌ونقل» while preserving the internal carrier role, endpoints and permissions. | FIXED / carrier login and registration 390px browser QA PASS |

## Visual review

The final review found consistent spacing, card language, professional vector controls, optimized raster onboarding artwork, Persian hierarchy, status semantics, mobile touch sizing, and desktop density. Driver retains an app-like 5-item bottom navigation plus a complete hamburger menu. Admin retains a dense enterprise console on desktop and an off-canvas governance menu on tablet/mobile.

## Release blockers

No open P0 or P1 defect remains within redesign scope.

STAGE_10_STATUS: PASS
NEXT_STAGE: 11-deployment-production
