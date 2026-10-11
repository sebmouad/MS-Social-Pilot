# Design system and UX rules

**Look:** Facebook (default). Planned: a selectable *Warm* theme (cream + amber)
and an icon-rail shell — `NEXT_PHASES.md` Phase D2. **Structure:** Simplified (see
`docs/inspiration/simplified/README.md` and its screenshots). **Navigation:**
always the left sidebar (`src/components/AppShell.tsx`).

## Tokens (`tailwind.config.ts`, `src/app/globals.css`)
- Brand blue `brand-500 #1877f2` (links, rings, icons), `brand-600 #1467d6`
  (buttons), `brand-50 #e7f3ff` (selected backgrounds). Slate scale tuned to
  Facebook greys; page background `#f0f2f5`; cards white.
- Font: the system UI stack (Facebook's). Sizes: page title `text-xl sm:text-2xl
  font-semibold`, section title `text-[15px]/[17px] font-bold`, body `text-sm` /
  `text-[15px]`, hints `text-xs text-slate-500`.
- Shadow: `shadow-surface` (one soft 1px edge). Radius: cards `rounded-lg/xl`,
  pills `rounded-full`.
- Status colours: emerald = good/published, rose/red = failed/danger, amber =
  warning/attention, violet = review, slate = neutral/draft.
- Network marks: `NetworkMark.tsx` (letters in each network's colour, not logos).

## Component classes and components
- `.card`, `.card-viz`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`,
  `.btn-danger`, `.input`, `.label`, `.hint`, `.badge`, `.segmented` +
  `.segmented-item(-active)`, `.scroll-x`, `.filter-row`, `.nums` (tabular figures).
- `Dialog` (centred, Escape/backdrop close, focus trap-lite), `ConfirmProvider` /
  `useConfirm()` (title = question, body = consequence, action-named buttons,
  `danger` for destructive, `cancelLabel` when "Cancel" is ambiguous).
- `EmptyState` (icon, title, hint, action), `InfoTip` (ⓘ definition, anchored to
  its card), `StatTile`, `KpiExplorer`, `charts/*` (TimeSeries, BarList,
  WorldMap, ChartFrame with table view), `FeedPost` (Facebook post card),
  `PostPreview`, `FeedAvatar`, `LabelChips`, `PagesSidebar`, `PageMenu`,
  `TargetPicker`, `SplitButton`, `DateRangePicker`, `SyncButton` (reports
  outcome), `DismissibleCard`.
- Icons: `Icon.tsx` (inline SVG paths, `name` union). Add new names there.

## UX rules learned from real use
1. Every action reports its outcome (counts, "nothing new", or the platform's own
   refusal). A button that changes nothing on screen reads as broken.
2. Destructive or public actions confirm in-app with the consequence spelled out;
   buttons named after the action ("Delete from Facebook" / "Keep post").
3. Don't show what cannot work: hide tabs for switched-off features (Instagram),
   or explain the wait (Inbox → Meta approval). Never an empty state that
   invites a pull that will return nothing.
4. Plain language over Graph names ("People reached", not
   "Total Media View Unique"); developer detail goes under "Technical details".
5. Lists of Pages longer than 6 get a search; ticked items stay visible.
6. Clear stale success messages when the user starts the next task.
7. Long post text is clamped in calendar chips; `line-clamp-*` must not be
   combined with `block` (Tailwind's display utility wins).
8. Tooltips/menus inside scrolling containers are `position: fixed` or anchored to
   the card, never clipped.
9. Phone: no horizontal page scroll (e2e checks it); sidebar becomes a drawer;
   "New post" always one tap away.
10. Copy: short, specific, both languages; ICU plurals; no jargon; say what
    happens next. Use the `design:ux-copy` approach (what happened + why + how
    to fix) for errors and empty states.
11. Accessibility: every control has a name (e2e checks), focus visible,
    `aria-current` on active nav, colour never the only signal (arrows on deltas).

## Root section
Root (first user) has a separate area `/root/*` with its own sidebar, a
persistent "Root — changes affect the whole installation" banner and a distinct
accent; its only entry is a "Root" item at the bottom of the main sidebar,
visible to root alone (PERMISSIONS.md).

## Before shipping UI
Screenshot the screen at 1440 px and at phone width in the real browser, on real
data, compare with the Simplified equivalent in `docs/inspiration/simplified/screens`.
