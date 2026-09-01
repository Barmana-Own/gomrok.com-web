# GOMROK UI Architecture

## Global information architecture

### Public

1. Role selection and product introduction
2. Driver/carrier authentication
3. Driver registration
4. Carrier registration
5. Registration status
6. Administrative authentication

### Role workspaces

- Shipper: action-first cargo control tower with a persistent 16-item desktop sidebar and a complete off-canvas mobile/tablet menu.
- Company X: commercial and operational control tower with 19 sections grouped by demand, capacity, execution and governance.
- Company Y: carrier operations with 16 sections grouped by opportunities, fleet, execution and finance.
- Driver: mobile app with five persistent bottom destinations, a complete hamburger menu and progressive disclosure inside the active trip.
- Agent Z: destination operations with 10 task-oriented sections and case-detail context.
- Admin: desktop-first governance console with a dense role-filtered 19-item sidebar, purpose scope and data workspace.

## Major layout patterns

| Surface | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Public | Split hero and form/choice panel | Balanced two-column or stacked | Single-column, action-first, illustration reduced |
| Shipper/X/Y | Dark sidebar + top header + 12-column workspace | Hamburger drawer + adaptive grids | Sticky top bar + complete off-canvas menu + stacked modules |
| Driver | Centered mobile-app canvas with optional wider two-column details | Same interaction model with more room | Full-width app, 5-item bottom navigation, complete hamburger menu and 56px key actions |
| Agent | Operational header + horizontal task rail + split delivery/detail views | Hamburger drawer + adaptive single/two-column | Complete off-canvas task menu and stacked case actions |
| Admin | 292px sidebar + dense content canvas | Role-filtered off-canvas menu | Off-canvas governance menu, stacked metrics and bounded data tables |

## State matrix

| State | Required treatment |
| --- | --- |
| Loading | Skeleton or clearly labeled busy state preserving page structure |
| Empty | Domain-specific explanation and next valid action |
| Error | Safe Persian message, retry action when supported, no raw internals |
| Success | Inline confirmation or toast-like notice without layout shift |
| Permission denied | Explicit authorization message and safe navigation option |
| Offline | Driver queue/sync state and retry explanation |
| Partial data | Render available content and label missing/refreshing sections |
| No results | Preserve active filters and provide reset action where applicable |

## Navigation and priority

- Every dashboard leads with attention-required items, current operations and the next required action.
- Financial, risk and document warnings are visible but do not compete with the primary operational action.
- Rare governance actions remain in context rather than appearing as dashboard shortcuts.
- Mobile tables become stacked records or retain bounded horizontal scrolling when comparison is essential.
- Mobile/tablet drawers expose every authorized section, lock background scroll while open and close after navigation.

## Accessibility and RTL

- `dir="rtl"` remains at each application shell.
- Direction-sensitive route arrows and chevrons are mirrored; media controls and universal symbols are not.
- IDs, money values, URLs, hashes and coordinates use direction isolation.
- Dialogs retain focus trap, Escape close and focus restoration.
- Responsive navigation drawers use labelled triggers, `aria-expanded`/`aria-controls`, focus containment, Escape/backdrop close and trigger-focus restoration.
- Headings follow document order, labels remain associated, and icon-only controls have accessible names.
- All focus states are visible; color is accompanied by text or icon semantics.

## Requirement traceability

| Requirements | Surfaces |
| --- | --- |
| FR-001, FR-003 | Public and development previews |
| FR-004 | Shipper |
| FR-005 | Company X and Company Y |
| FR-006 | Driver |
| FR-007 | Agent Z |
| FR-008 | Admin |
| FR-009, FR-010, FR-011 | Shared design system and all surfaces |
| NFR-001 through NFR-010 | All routes and components |

## Stage 03 handoff

Implement the shared SVG brand/icon layer first, then apply tokenized foundations and shared primitives, followed by public surfaces, commercial workspaces, Driver, Agent and Admin. Preserve component APIs and server interactions while replacing visual hierarchy and responsive behavior.
