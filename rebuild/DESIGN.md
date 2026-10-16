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
  content: "32px"
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

Grove uses the exact frontmatter palette. Accent identifies the active module and primary safe actions; danger is reserved for destructive actions; warning flags recoverable risk. Borders and tonal surfaces establish hierarchy before shadows do. Charts must label metrics and units in text and must not rely on color alone. Muted text uses `#5f6c62` in Grove, `#596e78` in Coast, and `#7e6558` in Clay so small helper text meets WCAG AA on their canvas, panels, and muted surfaces. Nightfall preserves the same semantic hierarchy with lighter text and accent on dark surfaces. Forced-colors mode should retain system contrast.

The module rail has its own semantic palette: Grove `#172e24`, Coast `#162e3b`, Clay `#392a23`, Nightfall `#0b141a`. Use `--rail-ink`, `--rail-active-bg` and `--rail-active-ink` for its controls, and `--on-accent` for primary action text. Contrast regressions cover normal/selected rail labels and primary action normal/hover text in all four themes.

## Typography

Inter and the system sans stack carry navigation, forms, and prose. Use a restrained display scale for route titles and a tighter tabular/data treatment for counts and IDs. Use sentence case in controls and plain verbs. Numeric totals need visible coverage, period, and source when ambiguity matters. Do not shrink interactive labels merely to make a crowded layout fit.

## Layout

The desktop shell uses **two left sidebars**: a narrow module rail and a contextual sidebar for the active module. This restores the legacy structure at the user's explicit request on 2026-10-16; it supersedes the earlier single 256px sidebar direction. Workspace selection, quick creation, page links, filters, view pickers and Root configuration categories belong in the contextual sidebar. Do not add a third settings/category menu inside the content. The work area remains flexible and readable, with a capped content measure and responsive inset. Each sidebar owns its vertical scroll. A keyboard skip link leads directly to the main content. On narrow screens, module navigation stays accessible and contextual navigation/filters open from a labeled top-bar control with focus trapping, Escape and focus return. Tables own horizontal overflow. The publishing calendar becomes an agenda below 720px. Forms and data panels keep natural document scrolling unless a component has its own bounded surface.

Current geometry is an 84px module rail and 252px contextual sidebar, reduced to 74px/224px from 1024–1240px. Below 1024px the context opens as a drawer; at phone widths the module rail becomes bottom navigation. Content caps at 1600px, with responsive insets. The drawer makes the work area and module rail inert, locks background scrolling and keeps its own close control. Root uses the same shell with separate private navigation; route-local controls use `SidebarDock` rather than creating a content-side menu.

Publishing should lead with content rather than an always-expanded composer and import form. Its shared social-style post preview shows channel identity, actual status/time, text, media/link content, first comment and destination outcomes. Feed, card and table views share the same scoped data and actions, with the view picker in the contextual sidebar. Full creation has its own composer; batch import is an explicit secondary task. Do not invent engagement counts, imitate provider-only controls, or mix platform business rules into shared previews. URL and file controls inherit the active theme rather than browser-default light styling.

The user approved Table as the default, with Feed and Cards available. Keep row actions collapsed under Manage post and CSV import as a secondary disclosure. First comments and per-destination outcomes appear in previews; safe media references resolve through the authorized media API. Missing author profile data must use an honest fallback rather than an invented identity.

The dedicated composer pairs content editing with a neutral live preview. Use one attachment choice at a time; local object URLs stay in the trusted file preview and do not weaken the saved-preview URL validator. Destination and timing controls are docked in the contextual sidebar, with Save/Schedule first for discoverability. Validation and transport feedback appears at the top of the editor. A drawer submission reveals that feedback and focuses the work area. Queue and approvals reuse the same full preview at a readable measure; calendar cards open it in the shared dialog. Client-rendered previews receive server-formatted workspace timestamps so runtime timezone differences cannot silently change the displayed time.

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
