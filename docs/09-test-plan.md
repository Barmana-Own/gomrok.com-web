# GOMROK Redesign Test Plan

## Risk-based matrix

| Requirement/risk | Test evidence |
| --- | --- |
| FR-001, FR-003 public routes and previews | Browser route matrix for seven public surfaces and preview hub |
| FR-002, FR-004–FR-008 all role workspaces | Six role previews loaded and navigation actions clicked |
| FR-009 shared UI states | Existing empty/error/loading states rendered; dialog and select keyboard behavior checked |
| FR-010, FR-011 visual system | SVG/icon source inspection and visual screenshots |
| NFR-001, NFR-008 responsive/overflow | 360, 390, 430, 768, 1024, and 1440 viewport matrix |
| NFR-002 accessibility | Keyboard-select Escape test, focus-layer implementation review, semantic DOM review |
| NFR-003 reduced motion | CSS source assertion for `prefers-reduced-motion` |
| NFR-004 dependency weight | Package manifest comparison; no dependency added |
| NFR-005 build/regression | Vite production build and Node test suite |
| NFR-006 authorization | Existing 19-test server suite including negative role/tenant boundaries |
| NFR-007 security | Secret/sink review and npm audits |

## Commands

- `npm run build`
- `npm test`
- `npm audit`
- `npm audit --omit=dev`
- `git diff --check`
- Browser route, interaction, console, screenshot, and viewport checks against `http://127.0.0.1:5083`

STAGE_09_TEST_PLAN_STATUS: COMPLETE
