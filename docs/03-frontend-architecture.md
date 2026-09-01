# GOMROK Frontend Architecture — Route Pulse

## Runtime and source layout

The existing React 18 and Vite 6 stack was retained. The redesign introduces no runtime dependency and keeps each role panel lazy-loaded through `PlatformWorkspace`.

| Layer | Implementation |
| --- | --- |
| Application routing and public flows | `client/src/App.jsx` |
| Role dispatch and lazy loading | `client/src/components/PlatformWorkspace.jsx` |
| Brand and icon primitives | `client/src/components/ProductIcon.jsx` |
| Shared operational primitives | `client/src/components/PlatformPrimitives.jsx` |
| Responsive navigation and focus management | `client/src/components/ResponsivePanelNav.jsx` |
| Product-wide design layer | `client/src/route-pulse.css` |
| Legacy compatibility layer | `client/src/styles.css` |
| Role workspaces | `ShipperPanel`, `CompanyXPanel`, `CompanyYPanel`, `DriverMobilePanel`, `AgentPanel`, `AdminGovernancePanel` |

## Route map

- Public: `/app`, `/driver-login`, `/carrier-login`, `/app/driver`, `/app/careers`, `/admin/v2`.
- Development review hub: `/app/preview`.
- Development role previews: `/app/preview/{shipper|company-x|company-y|driver|agent|admin}`.
- Preview routes are gated by `import.meta.env.DEV` and therefore do not create a production authentication bypass.

## Component and state strategy

- `ProductLogo`, `GomrokMark`, `Icon`, `NavigationIcon`, and `LogisticsNetworkIllustration` provide a single SVG language without emoji or a third-party icon package.
- Existing server-state ownership remains in each panel; request functions and API paths were not replaced.
- Empty, loading, error, offline, permission, evidence, timeline, money, dialog, drawer, and status patterns use shared visual semantics.
- Driver remains a mobile application shell with persistent bottom navigation and encrypted local offline queue behavior.
- Shipper, Company X, Company Y, Agent, and Admin retain desktop sidebars while switching to complete off-canvas hamburger navigation at 1080px and below; Driver exposes the same complete menu in addition to its thumb-friendly bottom navigation.
- Dialogs and drawers now close on Escape, trap keyboard focus, and restore focus to the invoking control.
- Panel navigation closes by section selection, backdrop, close control, or Escape; it locks background scrolling while open and restores focus to the trigger.
- Custom selects close on Escape and preserve labelled, keyboard-reachable controls.

## RTL, accessibility, and performance

- Global Persian RTL behavior remains explicit while SVG brand elements and technical values retain deliberate direction.
- Focus rings, semantic headings, labelled icon buttons, minimum touch targets, and `prefers-reduced-motion` are implemented.
- Breakpoints cover 360, 390, 430, 768, 1024, 1280, and 1440+ widths.
- No UI framework, icon package, image runtime, or chart dependency was added.
- Production code continues to call the real API. Empty development preview read models are available only through development routes.

## Validation

- `npm run build`: PASS.
- Browser route and navigation smoke checks: PASS for all six panels and all public routes.
- Responsive horizontal-overflow matrix: PASS at 360, 390, 430, 768, 1024, and 1440.
- Hamburger interaction and accessibility checks: PASS for all six panels, including matching `aria-controls`, focus restoration, backdrop close, and Escape close.
- Console review: no warning or error entries; only Vite and React development informational messages.

STAGE_03_STATUS: PASS
NEXT_STAGE: 04-backend-architecture
