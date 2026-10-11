---
name: frontend-design
description: Design and build MS Social Pilot screens and components to a polished, Facebook-like, Simplified-structured standard. Use for any UI work — new screen, redesign, component, layout, empty state, dialog, chart, responsive fix.
---

# Frontend design for MS Social Pilot

Read `docs/ai/DESIGN.md` first (tokens, component classes, UX rules). Then:

1. **Structure from Simplified, look from Facebook.** Find the matching screen in
   `docs/inspiration/simplified/screens/` and `docs/inspiration/simplified/AUDIT.md`.
   Reuse its information architecture; render it with our tokens (`brand-*`,
   `.card`, `.segmented`, pills, `shadow-surface`).
2. **Navigation is the left sidebar** (`src/components/AppShell.tsx`). A new
   screen gets a sidebar entry in the right section; never a top tab row for a
   module. In-screen view switchers use `.segmented`.
3. **Server component first**; a small client component only for interaction.
   No `@/lib/prisma` imports in client code.
4. **Reuse components**: `Dialog`, `useConfirm()` (never `window.confirm`),
   `EmptyState`, `InfoTip`, `StatTile`, `KpiExplorer`, `charts/*`, `FeedPost`,
   `TargetPicker`, `SplitButton`, `SyncButton`, `PageMenu`, `LabelChips`, `Icon`.
5. **States**: loading (`loading.tsx` skeletons), empty (what it is + why empty +
   one action), error (what happened + why + how to fix), success (say the
   result; clear it when the next task starts).
6. **Responsive**: works at 375 px with no horizontal scroll; wide tables in
   `.scroll-x`; touch targets ≥ 40 px.
7. **Accessibility**: labels on every control, `aria-current` on active nav,
   focus-visible rings, colour never the only signal.
8. **Copy** in `messages/en.json` and `messages/fr.json` (ICU plurals); use
   `scripts/dev/add-messages.py`.
9. **Charts**: one series per axis, labelled, table fallback (`ChartFrame`);
   follow the `dataviz` skill when building new ones.
10. **Verify**: add the route to `e2e/helpers.ts → SIGNED_IN_SCREENS`, run the
    browser walk, deploy, then screenshot it live at 1440 px and phone width in the
    owner's Chrome with real data. Fix anything clipped, truncated or ambiguous.

Quality bar: "as good as Simplified or better". If a screen shows raw API names,
silent buttons, dead links or empty tabs that cannot fill, it is not done.
