# Morrow interface system

This interface uses a quiet editorial look for a focused social publishing workspace: warm gray-green canvas, white panels, deep forest actions, restrained amber and red status colors, and a compact sans serif type scale. The visual identity and navigation language are original to this rebuild.

## Foundations

`src/styles/tokens.css` is the shared source for color, spacing, radius, focus, shadow, and typography tokens. Import it once from the application entry point. Components use the `ui-` and `shell-` class prefixes. Keep layouts fluid, preserve readable contrast, and avoid encoding meaning through color alone. Focus rings are visible on keyboard navigation and reduced motion is respected globally.

## App shell

`AppShell` owns the responsive navigation frame and content region. It reads the module registry in `src/lib/product.ts` so links and labels use the registered product routes. Its API requires the active registry module and the real user and workspace names:

```tsx
<AppShell activeModule="home" userName={user.name} workspaceName={workspace.name}>
  <section>...</section>
</AppShell>
```

`activeModule` is a `ModuleId`. The desktop layout uses a persistent left navigation and a compact context header. At narrow widths, navigation becomes a fixed bottom bar and the content keeps its own scrolling space. Navigation links are real registry routes. The shell displays the supplied user and workspace names and does not fabricate notification counts or nonfunctional controls.

## Components

- `Button`: native button with `primary`, `secondary`, `quiet`, and `danger` variants, compact or regular size, and optional leading/trailing decorative content. Supply an accessible name for icon-only use.
- `DataTable<T>`: semantic table with a required caption and stable row key. Columns can align values, render custom cells, and optionally sort through the caller-provided sort callback. It includes an empty state and horizontal scrolling on small screens.
- `FilterBar` and `FilterSelect`: labeled native select filters with an optional reset action. The owning screen keeps filter state.
- `Dialog`: native modal dialog, controlled by `open`, with title, optional description, body, and optional action row. Provide a clear action and handle `onClose` in the owner.
- `StatusChip`: post status as a text label plus a distinct shape (never colour alone) in neutral, ok, warning or danger tone; `compact` for dense cells. Use it wherever a post status is shown.
- `ChannelBadge`: a channel name with its platform mark. Resolve the mark and platform name from the platform registry (`src/lib/channel-badge.ts`) and pass them in; shared screens never name a platform. `compact` shows the mark alone with the full name for assistive technology.

## Composition guidance

Use a single clear page title followed by supporting context and actions. Keep filters adjacent to the data they affect. Place important actions first in the action group and destructive actions last. Use table captions even when visually hidden, label every filter, and keep keyboard focus inside native modal dialogs. Use text or shape alongside status colors.
