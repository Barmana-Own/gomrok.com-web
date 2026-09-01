# GOMROK Redesign Requirements

## Functional requirements

| ID | Requirement |
| --- | --- |
| FR-001 | Every current public route must retain its behavior while receiving the new visual system. |
| FR-002 | All six authenticated role surfaces must retain every existing navigation item and workflow. |
| FR-003 | Development preview links must allow visual review of each role without registration and must be disabled in production builds. |
| FR-004 | The Shipper eight-step cargo wizard, RFQ, contract, document, tracking, POD, finance and claim flows must remain available. |
| FR-005 | Company X and Company Y operational actions and read models must retain their existing API contracts. |
| FR-006 | Driver controls must remain mobile-first, thumb-reachable and ordered around the next required trip action. |
| FR-007 | Agent destination verification, evidence, OTP, POD, discrepancy and settlement surfaces must remain available. |
| FR-008 | Admin navigation must remain role-filtered and all governance, audit and critical-control views must be preserved. |
| FR-009 | Forms, dialogs, drawers, tables, cards, notices, empty states and loading states must share a coherent system. |
| FR-010 | Navigation icons and brand marks must use reusable SVG components rather than emoji or inconsistent Unicode glyphs. |
| FR-011 | The supplied color palette must be the basis of the design tokens and final interface. |
| FR-012 | The pre-redesign working tree must be backed up on drive E before implementation. |

## Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-001 | RTL behavior must be correct at 360, 390, 430, 768, 1024, 1280 and 1440+ widths. |
| NFR-002 | Text contrast, focus visibility, semantic labels and touch targets must meet professional accessibility expectations. |
| NFR-003 | Motion must be subtle and disabled or reduced under `prefers-reduced-motion`. |
| NFR-004 | The redesign must not add a large UI framework or unnecessary runtime dependency. |
| NFR-005 | Production build and all runnable tests must pass after the redesign. |
| NFR-006 | No authorization rule, session boundary, API contract or backend-owned state transition may be weakened. |
| NFR-007 | No real credentials, production data or hidden production mock may be introduced. |
| NFR-008 | Page layouts must avoid horizontal document overflow at supported widths. |
| NFR-009 | The design system must use semantic tokens rather than scattered raw colors. |
| NFR-010 | Raster assets must be optimized and referenced from the workspace, while icons and logos remain code-native SVG. |

