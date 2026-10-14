# Design rules

Look: Facebook. Structure: the best social tools (picker, channel column,
cards, reports builder). Navigation: always on the left.

## Shell

- `src/components/AppShell.tsx`: icon rail with the areas, the area's sidebar
  (grouped links, client switcher, "New post", channel column, screen tools)
  and a slim top bar for utilities only. A new screen gets a link in its area's
  sidebar group; never add a top tab bar for a module. Views inside one screen
  (such as the analytics views) use `SubTabs` or `.segmented`.
- Settings links belong in the Workspace area sidebar. The settings layout
  must not add a third navigation column. Permissions live on Team and roles.
- Segmented controls use compact rectangular tabs. Narrow sidebars stack long
  choices; format choices use an even grid so labels never wrap into a pill.
- Root has its own shell (`RootShell`) with an amber accent and a persistent
  banner; its entry is in the account menu, for root only.
- Phone: one drawer with every link; "New post" one tap away; no horizontal
  page scroll (e2e checks it).

## Tokens (`tailwind.config.ts`, `src/app/globals.css`)

- Brand blue `brand-500 #1877f2` (links, rings, icons), `brand-600` (buttons),
  `brand-50` (selected backgrounds). Slate scale tuned to Facebook greys; page
  background `#f0f2f5`; white cards; `shadow-surface`; cards `rounded-lg`/`xl`,
  pills `rounded-full`.
- `brand-*` and `slate-*` are CSS variables switched by `<html data-theme>`
  (`src/lib/themes.ts`): Facebook (default), Warm, Dark. Never write raw hex for
  brand or greys in components, or themes cannot reach it. Shell classes:
  `.rail`, `.rail-item`, `.shell-sidebar`.
- Chart and series colours come from `src/lib/palette.ts`.
- Status colours: emerald = good / published, rose or red = failed / danger,
  amber = attention, violet = review, slate = neutral / draft.
- Type: the system UI stack. Page title `text-xl sm:text-2xl font-semibold`,
  section title `text-[15px]` bold, body `text-sm`, hints `text-xs text-slate-500`.
- Right-to-left: logical classes only (`ms-*`, `me-*`, `ps-*`, `pe-*`,
  `start-*`, `end-*`, `text-start`, `border-s`, `rounded-s`); directional icons
  are listed in `DIRECTIONAL` in `src/components/Icon.tsx`.

## Components

- Classes: `.card`, `.card-viz`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`,
  `.btn-danger`, `.input` (`.input-sm` in a row), `.label`, `.hint`, `.badge`,
  `.segmented` with `.segmented-item(-active)`, `.scroll-x`, `.filter-row`,
  `.nums` (tabular figures).
- `ScreenHeader`, `SubTabs`, `EmptyState` (icon, title, hint, action),
  `InfoTip` (definition anchored to its card), `Dialog`, `DateRangePicker`,
  `SplitButton`, `Pagination`, `StatusBadge`, `LabelChips`, `PagesSidebar`,
  `PageMenu`, `TargetPicker`, `FeedPost` and `PostPreview` (Facebook-like
  cards), `AutoSyncNote` (when the worker last read the data; there are no pull
  buttons), charts in `src/components/charts/` (time series, bar lists, world
  map, frame with table view), `NetworkMark` (letters in each network's
  colour, not logos), icons in `Icon.tsx` (add new names there).
- Confirmations: `useConfirm()` from `src/components/ConfirmProvider.tsx`,
  never `window.confirm`. Title = the question, body = the consequence, buttons
  named after the action ("Delete from Facebook" / "Keep post"), `danger` for
  destructive ones.

## Copy

- Every string in `messages/en.json` and `messages/fr.json`, same keys and
  placeholders; ICU plurals for anything that counts (`tests/locale.test.ts`).
- Short, specific, sentence case, no jargon; say what happens next. Errors:
  what happened, why, how to fix. Plain names over Graph names ("People
  reached", not "Total Media View Unique"); developer detail goes under
  "Technical details", and only root sees technical connection details.
- Generic examples only ("Client A", "Product launch").

## UX rules

1. Every action reports its outcome (counts, "nothing new", or the platform's
   own refusal).
2. Destructive or public actions confirm in-app with the consequence spelled out.
3. Don't show what cannot work: hide what a switched-off feature or module
   would show, or explain the wait. No empty state that invites a pull that
   returns nothing; say what fills it.
4. Every screen obeys and shows the shared channel selection.
5. Every number has a plain name and a definition; withdrawn metrics are
   explained, never shown as 0.
6. Lists of more than six channels get a search; ticked items stay visible.
7. Clear stale success messages when the next task starts.
8. Tooltips and menus inside scrolling containers are fixed or anchored, never
   clipped. `line-clamp-*` must not be combined with `block`.
9. Accessibility: every control has a name, focus is visible, `aria-current` on
   active links, colour is never the only signal (arrows on changes).

## Before shipping UI

Screenshot the screen at 1440 px and at phone width on real data and check it
against the rules above.
