# GOMROK Design System — Route Pulse

## Concept

The new visual language is called **Route Pulse**: a calm lavender operational canvas, dark high-contrast structure, mint readiness signals and blue movement paths. The interface uses connected route lines, compact operational modules and clear next-action emphasis rather than a generic grid of floating white cards.

## Brand foundations

- Ink `#140e04`: primary text, inverse navigation and high-trust framing.
- Canvas `#ededff`: product background and brand recognition.
- Primary `#0afa82`: readiness, progress and primary affirmative action. Dark ink is used on top of it.
- Secondary `#4363ea`: navigation, enterprise structure and selected controls.
- Accent `#4c7cff`: focus, information, tracking and interactive emphasis.

Derived colors are used only for contrast, semantic states and surfaces. Status meaning is never communicated by color alone.

## Typography

The existing variable Vazir font remains the Persian-first family. Body copy uses 15px by default, labels 13px and captions 12px. Operational identifiers, amounts and mixed-direction values use isolated LTR direction where required. Headings use stronger weight and restrained tracking rather than oversized decoration.

## Shape and depth

- Inputs and compact controls: 10–14px radius.
- Operational panels: 18–20px radius.
- Hero and public onboarding modules: up to 28px radius.
- Shadows are cool, low-opacity and limited to elevated or interactive layers.
- Borders remain visible enough to structure dense information on the lavender canvas.

## Brand assets

- Logo: code-native SVG route loop combining a location pin, path and shipment node.
- Icons: one reusable 24px stroke-SVG system with consistent stroke width and optical balance.
- Logistics illustration: code-native SVG scene composed from route paths, a truck, container, control tower and verification nodes. No raster generation is used because project work must remain entirely on drive E.

## Components

- BrandMark and ProductLogo
- Icon and NavigationIcon
- App header, role sidebar, accessible mobile/tablet hamburger drawer and driver bottom navigation
- Page/section header and action group
- Metric, status, risk and money modules
- Timeline, stepper and readiness gate
- Data table with responsive overflow container
- Empty, error, permission, loading and offline states
- Input, select, textarea, checkbox, upload zone and helper/error copy
- Dialog, drawer and mobile sheet
- Document/evidence cards and operational list rows

## Interaction rules

- Minimum target size: 44px; 48–56px for driver-critical actions.
- Primary buttons use mint with dark text; secondary actions use blue or neutral surfaces.
- Destructive actions use semantic red and require explicit labels.
- Focus uses an accent-blue 4px translucent ring.
- Hover raises only actionable surfaces and never shifts dense tables.
- Motion uses 140–220ms transitions; all non-essential motion is disabled under `prefers-reduced-motion`.

## Status language

- Draft / inactive: neutral.
- Waiting / review: warning.
- Action required / risk: danger or warning with icon and text.
- Assigned / active / in transit: info blue.
- Ready / approved / completed: success mint/green.
- Disputed / rejected: danger.
