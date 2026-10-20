# Shared components and interaction rules

Design system round 2. Visual decisions live in [../DESIGN.md](../DESIGN.md), observable behavior in [../UX-CONTRACT.md](../UX-CONTRACT.md), charts in [CHARTS.md](CHARTS.md). This file documents every shared control in `src/components/` (import from `@/components`) and the interaction rules all of them follow.

Styles: `src/styles/tokens.css` (palettes, base) then `src/styles/components.css` (round 2), both imported by `src/app/globals.css`. Components use theme tokens only, so Vivid, Meta blue, Warm and Clean in light and dark follow automatically. The one addition is `--ui-good` / `--ui-good-soft` (success green) declared in `components.css` because no theme defined a success color. Contrast is enforced by `tests/theme-contrast*.test.ts` and `tests/theme-contrast-components.test.ts`.

Module color: set `data-module="publishing"` (any module id) on an ancestor and `.ui-mod-chip`, `Badge tone="module"`, `MetricCard` and `PageHeader` pick up `--mod`, `--mod-soft`, `--mod-ink`. Module color identifies where you are; it never carries meaning alone.

Server/client: `DataTable`, `EmptyState`, `Badge`, `PageHeader`, `Breadcrumbs`, `StatusChip`, `Skeleton` work in Server Components (no hooks, no `"use client"`). Interactive controls (`Menu`, `Select`, `Tabs`, `Forms`, `Toast`, `Drawer`, `FilterPanel`, `InlineEdit`, `ConfirmDialog`) are client components; pass them serializable props only when used from a Server Component (callbacks need a client parent).

All new props are additive; existing call sites are unchanged.

## Interaction rules (apply to every component and screen)

1. **States.** Every interactive element has distinct rest, hover, focus-visible, active (pressed), disabled and busy states. Busy = `aria-busy`, spinner, blocks a second activation. Disabled controls explain why when the reason is not obvious (`title`, helper text or `disabledReason`).
2. **Focus.** Visible 3px focus ring (`--focus`) on everything; inputs also show the soft ring. Dialogs, drawers and menus move focus in, trap it (native `<dialog>`), and return it to the opener on close. Destructive confirmations focus Cancel first.
3. **Keyboard.** Menus, selects, tabs and segmented controls use arrow keys, Home/End and Escape. Escape closes the innermost popup or dialog, never the page. Typing in a non-searchable select jumps to a match. Every pointer action has a keyboard path; row click shortcuts (`onRowClick`) always sit beside a real link or button.
4. **Touch.** On `pointer: coarse`, icon buttons, menu items, options, tabs, segmented options, switches and chip removers are at least 44px.
5. **Feedback.** Saved or failed actions show a toast: success auto-closes after ~5s, a failure with Retry stays until dismissed (`useToast().failed`). Never rely on a toast alone for validation: field errors stay beside the field (`Field error`) and keep typed input.
6. **Undo before confirm.** Reversible actions (archive, unschedule, remove from selection, move) run immediately and offer `toast.undoable(...)` (8s). Only irreversible or spend/remote-affecting actions use a confirmation dialog.
7. **Confirmations name the object and consequence.** `ConfirmDialog`: title = verb phrase, bold object name, one sentence on what happens and what cannot be undone, danger button labelled with the verb ("Delete post", not "OK"). Failures keep the dialog open with the message so nothing is lost.
8. **Fewer clicks.** Edit single values in place (`InlineEdit`), keep bulk actions on selected rows (`DataTable selection`), keep frequent actions visible and secondary ones in the row `Menu`, show applied filters as removable chips, remember the last range/view. Document shortcuts next to the action with `ShortcutHint` and bind them with `useShortcut`.
9. **Empty, loading, error.** Every list has all three: skeleton rows or `Skeleton` (keeps footprint, one `role=status` label), `EmptyState`/`DataTable emptyMessage` with an icon and a next action (create, clear filters, connect), and `EmptyState tone="error"` with a recovery action. Unknown values show a dash with an explanation, never `0`.
10. **No wrapping controls.** Segmented choices share one grid row and truncate; long option lists use `Select`; tab strips scroll horizontally.
11. **Copy.** All strings are props (English and French come from the caller's catalog); components only ship neutral English defaults for rarely overridden labels. No provider or operator jargon.

## Buttons

`Button` (`variant` primary | secondary | quiet | danger; `size` sm | md; `leading`, `trailing`, `busy`). New: pressed feedback and a primary shadow. A Button with only `leading` and no children renders as a square icon button; give it `aria-label`. `.ui-icon-button` is the lightweight 32px icon-only element used inside inputs, rows and toasts.

## DataTable

```tsx
<DataTable caption="Posts" rows={rows} rowKey={r => r.id} columns={cols}
  sort={{ key, direction, onChange }}
  selection={{ selected, onChange: setSelected, rowLabel: r => `Select ${r.title}`, selectAllLabel: 'Select all posts' }}
  rowActions={r => [{ key: 'edit', label: 'Edit', icon: <IconPencil size={16} />, onSelect: () => edit(r) },
                    { key: 'del', label: 'Delete', danger: true, onSelect: () => ask(r) }]}
  rowActionsLabel={r => `Actions for ${r.title}`}
  emptyIcon={<IconInbox />} emptyMessage="No posts match" emptyAction={<Button onClick={clear}>Clear filters</Button>} />
```

Sticky header (within a 78vh scroll region), zebra rows, hover, selected-row tint, tabular numbers, `density="compact"`, sortable headers with an arrow icon plus `aria-sort`, skeleton rows when `loading`, icon empty state. Column options: `align: "end"`, `width`, `hideCardLabel`. Props `stickyHeader`, `zebra`, `stackOnPhone` default true; `onRowClick` for whole-row activation.

At 480px and below each row becomes a labeled card (`td[data-label]`), so no sideways scroll; header sorting is not shown in the card layout, so offer sort in the sidebar filters for phone-critical lists. Select-all uses the mixed (indeterminate) state when some rows are selected.

## Forms

- `Field` (label, `help`, `error`, `required`, `hint`) wires id, `aria-describedby`, `aria-invalid`, `aria-required` to its control. `TextInput` consumes it automatically and accepts `leading` / `trailing` (icon or button; the leading icon is decorative). Custom controls call `useFieldProps()`.
- `FieldGroup legend description` groups related fields in a bordered fieldset.
- `Switch` (role=switch) is for settings that apply immediately; use a checkbox for choices that wait for Save. Optional `name` posts `"on"`/`""`.
- `RadioCards` for choices that need explanation (publish now / schedule / draft); real radio inputs, so native keyboard behavior applies.
- `SegmentedControl` for 2 to 5 short options in one row; roving tabindex, arrows move and select. `DatePresets` wraps it for date ranges (presets come from the caller's Root-managed policy).
- `FileDropzone` is a drop target and a real button; limits are shown via `help`; chosen files list with named remove buttons. Type and size validation stays in the service.
- Native `.ui-input` / `select.ui-input` remain valid. Keep `FormValidation` for first-invalid focus and native-constraint messages.

## Select / Combobox

`<Select options value onChange aria-label | label htmlFor id name searchable />`; options take `icon`, `description`, `disabled`. Opt-in replacement for native `<select>`: use it where icons, descriptions or search help (channels, ad accounts, timezones); a native select is still right for 2 to 5 plain choices on phones. Keys: Arrow Up/Down/Home/End, Enter or Space picks, Escape closes and refocuses the trigger, type-ahead (or the search box when `searchable`). ARIA: `role=combobox` + `listbox`/`option`, `aria-activedescendant`.

## Menus, tabs, breadcrumbs

- `Menu` (kebab by default; `trigger` for a labelled button). Items: `label`, `icon`, `shortcut`, `danger`, `disabled`, `disabledReason`. Arrows, Home/End, Escape returns focus to the trigger, outside click closes. Selecting an item closes the menu first.
- `Tabs` (underline). `items: {id,label,icon,count,disabled,content}`; controlled (`value`) or uncontrolled; arrows activate; strip scrolls. Use tabs to switch views of one object, not for navigation between routes (use sidebar links).
- `Breadcrumbs` ends at the current page (`aria-current`).

## Filters

`FilterPanel` (title, active count, reset disabled when nothing is active) with `FilterSection` blocks, `FilterChips` (removable chips: "Channel: Studio"), `DatePresets`. They belong in the contextual sidebar, never in the content area. Keep the applied scope visible via chips in the content header as well.

## Dialogs, drawers, feedback

- `Dialog` (existing) and `ConfirmDialog` (object + consequence + failure retention). Mobile: action buttons stack full width.
- `Drawer` (side panel via the same `ModalDialog`: Escape, backdrop, focus return, full width on phones) for detail/edit work that keeps the list visible.
- `ToastProvider` once near the root; `useToast()` gives `notify`, `undoable`, `failed`, `dismiss` (no-op without a provider). Stack bounded by `maxVisible`; toasts pause while hovered or focused; errors use `role=alert`.
- `EmptyState` gains `icon`; `Skeleton` unchanged.

## Data display

- `PageHeader` (module chip, title, description, breadcrumbs, actions). One `h1` per page (`level={2}` for panels).
- `MetricCard` (label, value, delta, hint, sparkline, unavailable, loading). Delta text states direction and amount; `good="down"` for cost/latency; always set `comparedTo`. `sparkline` uses `@/components/charts` `Sparkline` (null = unknown gap). `unavailable` shows a dash with the reason instead of 0.
- `Badge` tones neutral | brand | success | warning | danger | module (with `icon`, `solid`). Product statuses keep using `StatusChip`.

## Keyboard shortcuts

`ShortcutHint chord="mod+k"` renders platform keycaps (⌘K on Apple, Ctrl+K elsewhere; sequences read "G then P"). `useShortcut(chord, handler, enabled)` binds it: plain keys and sequences are ignored while typing in a field; pass `enabled={false}` while a dialog is open. Every shortcut must also exist as a visible control; list shortcuts in the Menu item `shortcut` field or next to the button. Do not bind browser-reserved chords.

## Tests

`tests/design-components.test.ts` (keyboard, ARIA, state behavior, 24 cases), `tests/shared-components-states.test.ts`, `tests/modal-dialog.test.ts`, `tests/theme-contrast*.test.ts` (all themes and modes, including the new component pairs).

## Known gaps

No browser/visual run was done for round 2; verify light/dark in all four themes at 1440px and 390px before release. Popups (`Select`, `Menu`) are positioned below the trigger and do not flip near the viewport bottom. Phone card layout drops header sort controls. Existing screens still use native selects and local table markup until their owners opt in.
