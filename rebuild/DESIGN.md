---
version: alpha
name: "MS Social Pilot"
description: "A calm publishing and measurement desk for teams managing selected social channels."
colors:
  canvas: "#f5f7f4"
  surface: "#ffffff"
  ink: "#18231e"
  inkSoft: "#526159"
  line: "#dce4de"
  accent: "#286b4b"
  accentSoft: "#e4f2e9"
  warning: "#a15d18"
  danger: "#ad3b36"
  focus: "#477ee8"
typography:
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
rounded:
  sm: "8px"
  md: "12px"
  lg: "18px"
spacing:
  unit: "4px"
  content: "36px"
components:
  button: {}
  panel: {}
  table: {}
  dialog: {}
---

# MS Social Pilot Design System

## Overview

### Creative North Star

The app is a social operations desk: a stable work surface where a team can move from channel to post to response to result without losing context. Its signature is a persistent, clearly labeled module rail with route-specific controls attached to that rail. Dense data and consequential actions stay quiet and legible.

The audience is workspace owners, publishers, analysts, and client reviewers. The primary job is to select connected channels, publish responsibly, respond, and understand performance. This is an authenticated product UI, not a marketing page. Current UI language is English; dates follow the workspace timezone where a route provides one. Product support for other locales is not yet established. Desktop supports long sessions; the phone layout supports checking status and acting on a short task.

Do not use pill-shaped control groups that wrap unpredictably, nested settings menus, decorative metrics without clear provenance, or provider setup jargon in customer screens. The design should remain recognizable across Grove, Coast, Clay, and Nightfall.

`src/styles/tokens.css` is the canonical runtime source for colors, spacing, radii, and base component styles. The frontmatter records its Grove values for design review; it does not generate CSS. Theme overrides in that file map the same semantic roles to Coast, Clay, and Nightfall. `src/lib/themes.ts` owns names and swatches. A token change updates both files and this document in one batch.

## Colors

Grove uses the exact frontmatter palette. Accent identifies the active module and primary safe actions; danger is reserved for destructive actions; warning flags recoverable risk. Borders and tonal surfaces establish hierarchy before shadows do. Charts must label metrics and units in text and must not rely on color alone. Nightfall preserves the same semantic hierarchy with lighter text and accent on dark surfaces. Forced-colors mode should retain system contrast.

## Typography

Inter and the system sans stack carry navigation, forms, and prose. Use a restrained display scale for route titles and a tighter tabular/data treatment for counts and IDs. Use sentence case in controls and plain verbs. Numeric totals need visible coverage, period, and source when ambiguity matters. Do not shrink interactive labels merely to make a crowded layout fit.

## Layout

The desktop shell has a 256px sidebar and a main content area capped at 1440px, with a 36px content inset. The sidebar names the current workspace above the module navigation and owns its vertical scroll. A keyboard skip link leads directly to the main content. On narrow screens, primary modules form a bottom rail with device safe-area spacing; route tabs scroll horizontally above it; filters open from an explicit top-bar control. Tables own horizontal overflow. The publishing calendar becomes an agenda below 720px. Forms and data panels keep natural document scrolling unless a component has its own bounded surface.

## Elevation & Depth

Use borders and surface tone for most separation. The panel shadow in `tokens.css` is reserved for raised panels; dialogs receive stronger elevation over a scrim. Avoid stacked shadows on every table row or chip. Error, loading, and confirmation surfaces must preserve enough geometry that controls do not jump while work completes.

## Shapes

Small controls use 8px corners, tables and grouped controls 12px, and prominent panels and dialogs 18px. Badges may be fully rounded because they are compact status marks. Segmented controls must not wrap into irregular multi-row capsules; use a responsive grid or stacked choices when space is limited.

## Components

Buttons use brand/neutral/danger intent with solid, outline, or quiet emphasis. All enabled actions need hover, focus-visible, pressed, and busy states; disabled actions need an explanation when the reason is not obvious. Danger stays separated from frequent safe actions. Tables use native semantics, a named caption, sortable header buttons, and `aria-sort` on the header. Empty states explain the next possible action. Route loading and errors use shared states; errors offer retry.

Forms use visible labels, preserve entered values on recoverable failure, and identify the field that needs correction. Browser-owned selects and date pickers are currently accepted for English-only flows; authored popup styling is not promised. Dialogs for destructive or permission changes must keep focus inside, support Escape, restore focus, name the affected object, and hold their state until the server confirms success. This remains a migration target for older screen-local overlays.

The line icons in `src/components/AppShell.tsx` use a consistent light stroke and retain text labels. Motion communicates a state change, not decoration; reduced-motion preferences suppress it. Product copy names what the user controls and omits internal module/provider setup details.

## Do's and Don'ts

- Do keep the selected channel set and time range visible when explaining analytics totals.
- Do use the same label and feedback for an action across UI, API, and MCP descriptions.
- Do verify each theme on desktop and phone widths before releasing shared style changes.
- Don't use a light-only surface or raw color in a screen-local style.
- Don't imply that a partial archive, metric, or provider capability is complete.
