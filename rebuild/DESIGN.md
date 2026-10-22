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

The audience is workspace owners, publishers, analysts, and client reviewers. The primary job is to select connected channels, publish responsibly, respond, and understand performance. This is an authenticated product UI, not a marketing page. Customer copy is required in English and French; dates follow the workspace timezone where a route provides one. Root-editable bilingual catalogs now cover source slices of Publishing, Inbox, Analytics, Ads, Home, Tasks and Agency. This is partial localization with unit/render evidence, not full translated-route or browser clearance. Desktop supports long sessions; the phone layout supports checking status and acting on a short task.

Do not use pill-shaped control groups that wrap unpredictably, nested settings menus, decorative metrics without clear provenance, or provider setup jargon in customer screens. The design should remain recognizable across Vivid, Meta blue, Warm and Clean, in light and dark modes.

`src/styles/tokens.css` is the canonical runtime source for colors, spacing, radii, and base component styles. Owner decision 2026-10-21: the palette was redesigned to be colorful with icons everywhere. Four themes — **Vivid** (deep indigo rail, one solid color chip per module), **Meta blue** (light rail, blue accent, colorful data), **Warm** (cream and coral) and **Clean** (default for new users; near-white and crisp gray, color only in icons and charts) — each have a light and a dark palette. `data-theme` selects the palette and `data-mode` (`light`, `dark`, `system`) the mode; `system` follows `prefers-color-scheme`. Root sets `theme.default` and `theme.defaultMode`; users switch the mode from the top-bar toggle and the theme in Settings › Appearance. `src/lib/themes.ts` owns names, swatches and modes. A token change updates both files and this document in one batch.

Every theme defines module identity colors `--mod-<module>` (home, publishing, inbox, analytics, ads, tasks, agency, settings, root). Elements tagged `data-module` expose `--mod`, `--mod-soft` and `--mod-ink` (derived with `color-mix`) for icon chips (`.ui-mod-chip`), sidebar page icons and headings. Charts read `--chart-1`…`--chart-8`, `--chart-grid`, `--chart-text`, `--chart-surface` and `--chart-accent` (see docs/CHARTS.md). Icons come from `@tabler/icons-react` through `src/components/icons.tsx` (module and page registry); never hand-draw icon paths. Shared components (tables, Select, Menu, Tabs, PageHeader, MetricCard, toasts, dialogs, forms, filters) and their interaction rules are documented in docs/DESIGN_COMPONENTS.md; their styles live in `src/styles/components.css`. Screens adopt them instead of route-local controls.

## Colors

Accent identifies primary safe actions; module colors identify where you are; danger is reserved for destructive actions; warning flags recoverable risk. Borders and tonal surfaces establish hierarchy before shadows do. Charts must label metrics and units in text and must not rely on color alone. Every theme's light and dark palette is covered by contrast tests (`theme-contrast*.test.ts`): text pairs meet WCAG AA, controls and focus rings 3:1. Forced-colors mode should retain system contrast.

The module rail has its own semantic palette per theme and mode (`--rail-bg`, `--rail-ink`, `--rail-active-bg`, `--rail-active-ink`). Rail entries are icon chips styled per theme: Vivid solid module colors, Meta blue accent icons, Warm amber chips, Clean gray chips with module-colored icons. Active labels sit on the rail itself, so `--rail-active-ink` must contrast with `--rail-bg`.

## Typography

Inter and the system sans stack carry navigation, forms, and prose. Use a restrained display scale for route titles and a tighter tabular/data treatment for counts and IDs. Use sentence case in controls and plain verbs. Numeric totals need visible coverage, period, and source when ambiguity matters. Do not shrink interactive labels merely to make a crowded layout fit.

## Layout

The v2 shell (owner decision 2026-10-21; transitional adapter removed in B9) uses **one collapsible sidebar** holding the work areas and the channel list that scopes every channel-aware page. The sidebar shows the workspace switcher (only with more than one workspace), a primary Create action, the areas Home · Content · Inbox · Insights (Tasks and Agency appear only when used), then the channel list — All channels, one click-to-scope row per channel with a connection-health dot, and Manage channels — with Settings, Help and the account menu (theme, language, account, Root for owners, sign out) in the footer. Areas use tabs above the content; Settings uses an in-content section list; Root uses the same shell with its own areas and no channel list. Each page has **one Filter button in its header** (a bottom sheet on phones); filters never live in the sidebar. Number caveats sit behind ⓘ. The default theme for new users is **Clean**; Vivid, Meta blue and Warm stay selectable, each in light and dark plus system mode. The work area stays flexible and readable with a capped content measure and responsive inset. A keyboard skip link leads directly to the main content.

Geometry tokens live in `src/styles/tokens.css`: 248px sidebar collapsing to a 64px icon rail (state remembered in the `sp_sidebar` cookie), 56px top bar, 1280px content cap, 32px desktop gutter (24px below 1024px, 16px on phones). Desktop (≥1024px) shows the full sidebar; tablet (760–1023px) starts on the rail with the sidebar as an overlay; phones (≤760px) use a top bar with a channel-scope chip plus a bottom bar with Home, Content, a raised central Create button, Inbox and Insights, and open the channel list as a bottom sheet. The sidebar overlay, sheets, drawers and dialogs trap focus, close with Escape, return focus to their opener and keep the background inert. Tables own horizontal overflow. The Content calendar becomes an agenda below 720px. Forms and data panels keep natural document scrolling unless a component has its own bounded surface.

Content leads with the work rather than setup: the Posts tab is a table with a side preview (Feed and Cards were removed by owner decision 2026-10-21) sharing one scoped query with search, status and channel filters, plus Export and Import CSV as explicit secondary actions. A row opens the full post preview — channel identity, actual status/time, text, media/link content, first comment and per-destination outcomes — in a side panel, shareable by URL, with the same row actions as the post page. Do not invent engagement counts, imitate provider-only controls, or mix platform business rules into shared previews. URL and file controls inherit the active theme rather than browser-default light styling.

First comments and per-destination outcomes appear in previews; safe media references resolve through the authorized media API. Missing author profile data must use an honest fallback rather than an invented identity.

Create is a full-screen composer pairing content editing with a neutral live preview and a sticky action bar (Save draft, Schedule ▾ with Publish now, Add to queue and Schedule…). Creation and local post editing reuse the ordered attachment editor: multiple image/video URLs or local images, per-image descriptions, explicit removal and keyboard-operable Move up/down. A separate link field and current adapter metadata determine allowed combinations; shared UI has no provider rules. Local object URLs stay in the trusted authoring preview and never weaken saved-preview URL validation. Unsupported add choices are omitted; Root count exhaustion has visible guidance. The sidebar scope pre-selects the scoped channels as destinations but can be changed. Validation and transport feedback appears in the editor; failed uploads focus their visible row. Queue and approvals reuse the full saved preview at a readable measure; calendar cards open it in the shared dialog. Client-rendered previews receive server-formatted workspace timestamps so runtime timezone differences cannot silently change the displayed time.

## Elevation & Depth

Use borders and surface tone for most separation. The panel shadow in `tokens.css` is reserved for raised panels; dialogs receive stronger elevation over a scrim. Avoid stacked shadows on every table row or chip. Error, loading, and confirmation surfaces must preserve enough geometry that controls do not jump while work completes.

## Shapes

Small controls use 8px corners, tables and grouped controls 12px, and prominent panels and dialogs 18px. Badges may be fully rounded because they are compact status marks. Segmented controls must not wrap into irregular multi-row capsules; use a responsive grid or stacked choices when space is limited.

## Components

Buttons use brand/neutral/danger intent with solid, outline, or quiet emphasis. All enabled actions need hover, focus-visible, pressed, and busy states; disabled actions need an explanation when the reason is not obvious. Danger stays separated from frequent safe actions. Tables use native semantics, a named caption, sortable header buttons, and `aria-sort` on the header. Empty states explain the next possible action. Route loading and errors use shared states; errors offer retry.

Forms use visible labels, preserve entered values on recoverable failure, and identify the field that needs correction. `FormValidation` supplies associated field-error text, native-constraint checks without browser bubbles, and first-invalid focus; domain services remain authoritative. `AutoTextarea` is the canonical multiline control: it keeps natural document height, grows/shrinks with content and width, resets with the form, and removes the resize handle. It inherits each route's existing themed field styles. Field errors use the shared danger token through `.ui-field-error`. Browser-owned selects and date pickers follow the device/browser locale; application-owned labels must have English/French copy. Authored popup styling is not promised. Dialogs for destructive or permission changes must keep focus inside, support Escape, restore focus, name the affected object, and hold their state until the server confirms success. This remains a migration target for older screen-local overlays.

The line icons in `src/components/AppShell.tsx` use a consistent light stroke and retain text labels. Motion communicates a state change, not decoration; reduced-motion preferences suppress it. Product copy names what the user controls and omits internal module/provider setup details.

## Do's and Don'ts

- Do keep the selected channel set and time range visible when explaining analytics totals.
- Do use the same label and feedback for an action across UI, API, and MCP descriptions.
- Do verify each theme on desktop and phone widths before releasing shared style changes.
- Don't use a light-only surface or raw color in a screen-local style.
- Don't imply that a partial archive, metric, or provider capability is complete.

Ads report sidebar filters reuse the shared `.ui-field`, `.ui-input` and `Button`
primitives. Their error descriptions sit outside labels, and custom-date
correction retains invalid text. Preset date fields are visibly disabled. These
controls inherit all four themes and use 44px input targets.

Root directory forms use `.ui-field` and `.ui-input` primitives: stacked labels, a 44px input target, semantic surface/line/text colors, invalid borders and disabled state. These primitives currently cover Root directory search, creation and confirmations; other route-specific fields remain to be consolidated. Root dialog actions use the shared `Button` variants. Avoid directory-specific CSS that overrides those variants or restores native unthemed controls.

Ads presets and their labels now come from the validated Ads-owned Root policy.
The shared sidebar form shows the configured custom-range ceiling beside date
controls; error views retain the same choices and input. This adds no new visual
component or third menu. Root edits the coupled policy in its existing themed
JSON setting control within the Ads product module.

Ads report paging sits below the sidebar filter form, separated by the shared
line token. It shows range/count and current page above two aligned 40px shared
secondary controls. Unavailable directions are noninteractive text with a clear
disabled state. The same layout fits the phone drawer; it adds no content-side
menu. Report headers explain the visible slice, while metric cards retain scoped
totals. Page/size failures reuse the existing focused notice and sidebar controls.

Ads and Publishing use `CsvExportButton` for confirmed downloads and focused
feedback. Product wrappers own scope/copy; the shared control owns pending,
receipt checks, cancellation and stale-result suppression. Ads export sits below
report paging in the same sidebar/drawer. Daily Ads details use one semantic
metric presentation across account cards and object table/mobile views, including
report day, separate fetch time, units and unknown provenance. Existing tokens,
shared buttons and natural detail scrolling govern the component; no new menu,
theme palette or provider-specific visual rule is introduced.


Sharing desktop polish (batch79b): data tables use the available panel width;
form measure caps apply to fields only. Grid tracks use minmax(0, 1fr) so wide
tables scroll inside their region on phones. Text/select sizing must not apply
to nested checkboxes; input widths remain within their field. Settings fallback
button CSS excludes shared ui-button controls, preserving semantic variants.

Reports (batch82) use the same contextual sidebar for preparation, creation and
paging. Templates, schedules and history are separate semantic tables within
one work area; each table owns narrow-screen horizontal overflow. No third
menu, wrapping pill group or new visual identity is introduced. Shared Dialog,
Button, FormValidation, AutoTextarea and RouteNotice retain their established
roles. Native selects/date controls follow the browser-owned popup decision;
application labels use the selected English/French catalog. Browser-owned
control text can follow the device locale. Preparation offers CSV and a downloaded printable
page, with explicit UTC periods and honest preparation/delivery status.

## Publishing format controls (batch85)

`DestinationFormats` reuses `ui-field`, `ui-input` and `ui-field-error` tokens.
Keep controls in the contextual sidebar; do not add a third menu or wrapped
segmented pills. A single module format is a plain label. Multiple format choices
use the existing native-select policy, with channel-specific accessible labels
and a retained unavailable option for stale selections. All four themes inherit
the same tokens and dimensions.

Batch85 review sources: installed Frontend Design/Premium UX plus freshly fetched official Vercel Web Interface Guidelines and React Best Practices. Apply the existing brand and UX contract when generic guidance differs. This is review guidance, not evidence that every screen passes.

Root technical search headings and keys wrap within their content width. Preserve complete identifiers and existing internal table scrolling; never mask document overflow to hide an oversized heading. Batch87 corrects an observed phone overflow.


Root publication evidence (batch89) supports module-declared compact summary
columns. Keep technical row IDs and complete receipt fields in an accessible
native details disclosure; retain separately confirmed module actions in their
own column. Use theme tokens, visible summary focus, wrapped long identifiers
and a locally scrollable table. This generic control contains no provider rules.


Batch91 Root publication actions use neutral inspection intent and the canonical
shared action dialog with the existing secondary Button variant; recovery/delete
controls retain danger emphasis. Keep provider rules out of the shared styling,
retain the two-sidebar navigation, and keep proof rows free of content. The
confirmation names the final identity/Page and displayed revision because
acceptance changes local recovery state. Built-server probes covered eight views
across four themes at desktop and phone sizes. Screenshot inspection caught and fixed Cancel wrapping at390px. The responsive
single-column shared-dialog footer passed the final eight-view probe and phone
screenshot inspection. This is scoped Root evidence, not whole-app
UX clearance.


Batch92 asynchronous receipt recovery keeps the shared Root dialog bounded and
internally scrollable when its evidence fields exceed the viewport. Keep the
saved remote submission ID read-only and selectable and preserve the action footer while the dialog content
scrolls. A known submitted receipt exposes no “ABSENT” action and no control to
replace its remote ID; confirmation must refer to the displayed identity. Use
the shared dialog and Button tokens, with keyboard focus and narrow-screen
footer behavior intact. Root and customer status surfaces require separate
verification. Root verification passed16 views across four themes at1440px
and390px with screenshot inspection. Customer recovery component tests passed;
its full browser matrix remains open. This is not whole-app UX clearance.


### First-comment delay control (batch94)
Use the existing full-width numeric input, visible label and associated muted
12px helper/error text in composer and editor. Keep delay adjacent to its first
comment; channel/format choices remain docked in the contextual sidebar. Saved
delivery timing and early-send confirmation use existing status/dialog patterns,
including Cancel-first focus, Escape and opener restoration. Four-theme desktop/
phone probe evidence is scoped in docs/FIRST_COMMENT_SCHEDULING.md.

Channel organization (2026-10-20) reuses Settings panels, shared `.ui-field` /
`.ui-input`, Button and `useConfirm`; it adds no palette or navigation system.
The compact group/label forms retain values after failed or unconfirmed writes.
Group shortcuts live beside the current channel controls in the existing sidebar
and composer. Profile labels are text beside channel names, independent of post
labels. English/French strings follow request language. Browser/theme/viewport
verification remains open; DOM interaction evidence is in CHANNEL_PROFILES.md.

## Design pass, round 4 — 2026-10-21 (owner: "the design is ugly")

Decisions, implemented as one layer at the end of `src/styles/components.css` (tokens only; four themes, light and dark unchanged):

- **Card system.** One surface recipe: hairline border, 16px radius and a soft two-part lift (`--card-lift`, `--card-lift-hover`; dark mode swaps to an inset highlight). Panels, home cards, metric tiles and tables share it. A tile inside a panel sits flat on a tinted surface so cards never stack lifted cards.
- **Color by module.** The page-header chip is a solid module color with a white icon (tinted-soft in Clean). The top bar shows a module-colored dot and name. The sidebar page icons get a faint module wash.
- **Typography.** 14px body, 29px page title at weight 780 with −0.028em tracking, 34px metric figures, 16px card titles; table headers are sentence case 12px instead of tiny uppercase. Sidebar section labels are 11px, quieter.
- **Chrome.** The top bar no longer repeats the page title (the page `h1` owns it), the content gutter is 36px on desktop, and the primary action in the sidebar carries a colored lift.
- **Empty states.** A filled calm surface with a module-tinted icon replaces the dashed wireframe border.
- **Defect fixed.** In Inbox the bulk "Select all" bar was taking the list's 1fr grid row and left a large blank gap; the list pane is now a flex column and only the list scrolls.

Evidence: local production build, synthetic data, Chromium screenshots (home, publishing queue/calendar/compose, inbox, analytics, ads, settings, root) at 1440 and 390 wide in light and dark across Vivid, Meta blue, Warm and Clean. This is visual review, not a full browser matrix rerun.

## Current language and theme evidence — 2026-10-21

Source checked at `6fb0e57f`: Publishing, Inbox, Analytics, Ads, Home, Tasks and
Agency have module-owned Root-editable English/French catalogs (merged through
`38ab34f4`). Schema-checked readers use `configOrDefault` (`fb42b056`): missing,
unreadable or invalid stored catalogs fall back to the registry default validated
by the same schema. `configValueOrDefault` only checks broad type/array shape;
it is not equivalent to full schema validation. These fallback mechanisms do
not establish that all customer strings use a catalog.

`tests/ui-copy-coverage.test.ts` checks literal `t(...)` keys in Agency, Tasks and
Analytics Reports screens and nonempty English/French entries in those catalogs.
Other module copy tests have their own scopes; this test does not scan every
module, dynamic metric label, error, browser control or downloaded report.
Remaining Root/service copy, AI prompt language and other literal gaps are in
[CONFIG_LITERAL_AUDIT.md](docs/CONFIG_LITERAL_AUDIT.md). Current palettes are
Vivid/Meta blue/Warm/Clean in light/dark; older Grove/Coast/Clay/Nightfall browser
results retain only their original dated scope. Verify current language, keyboard,
failure recovery, desktop/phone and theme states with synthetic local data;
production planning/provider results cannot substitute for that UI evidence.

## Design v2 decisions (batch B0, 2026-10-21)

Source: [docs/design-v2/README.md](docs/design-v2/README.md) decision record (owner-approved), with tokens in [docs/design-v2/02-FOUNDATIONS.md](docs/design-v2/02-FOUNDATIONS.md). Where these lines conflict with older text above, these win.

- **Default theme is Clean** for new users (decision 2026-10-21, "Default theme for new users is Clean (Root `theme.default`); Vivid, Meta blue and Warm stay selectable"). Existing users keep their saved theme. Supersedes the Vivid default.
- **One collapsible sidebar with areas and a channel list; tabs inside areas; a Filter button in the page header** (decision 2026-10-21). Supersedes the "two left sidebars" rule and filters in the sidebar. The shell changes in B1; until then the current shell remains.
- **Areas Home · Content · Inbox · Insights** (FR Accueil · Contenu · Messages · Statistiques); Tasks and Agency only when used. Area colours are `--area-*` tokens, pairwise distinct per palette and mode.
- **Content is Table plus side preview**; Feed and Cards are removed (decision 2026-10-21). Supersedes "Table as the default, with Feed and Cards available".
- **Number caveats live behind ⓘ**, partial results show ⚠ (decision 2026-10-21).
- **Tokens (B0):** Inter loaded with `next/font` (`--font-inter`); nine type sizes `--text-2xs…--text-metric`; five radii; `--shadow-card/pop/sheet`; `--ease-fast/ease/ease-sheet`; control heights 32/40/44; `--on-mod`; `--success`/`--success-soft` for positive states (`--ui-good*` remain as deprecated aliases); fields and controls draw their border with `--control-border`; every chart slot is at least 3:1 on the surface; focus is a 2 px `--focus` outline with 2 px offset everywhere.
- The "round 4" override layer is deleted; its values are folded into the base declarations. The card, page-header and chrome descriptions in "Design pass 2026-10-21" above describe those folded values.
