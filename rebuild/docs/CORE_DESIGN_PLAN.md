# Core design first

## User direction, 2026-10-16

Complete the app core design before expanding Facebook coverage. Use the legacy app as an interaction and capability reference: two left sidebars, richer private Root controls, social-style post cards and feed views. Keep the rebuild platform-neutral and retain its shared branded themes. The user has authorized implementation, testing, commits and GitHub publication; this is a priority change within the existing rebuild objective.

## Approved design and delivery batches

The user approved all four design forms on 2026-10-16: two-sidebar navigation; **Table as the default Posts view, with Feed and Cards available**; a grouped private Root control center; and refinement of the current brand across all four themes. Core design precedes additional Facebook coverage. Implement in independent batches: shared shell and sidebar utilities, scoped post views, and Root surfaces; then integrate automated and real-browser checks before committing/pushing.

1. **Shared shell and navigation.** Compact module rail, contextual sidebar, workspace picker, quick post creation, page links and route filters. Permission-filtered manifests remain authoritative. Context navigation and pickers use one accessible drawer at narrow widths. Account and private Root access remain visible to authorized users. No third menu or nested settings column.
2. **Content-first Publishing.** Shared neutral post preview with channel identity, status/time, actual attachments/link, first comment and destination outcomes. Feed, cards and table views use the same scoped paginated query and action controls; the picker belongs in the sidebar and persists in the URL. The full composer owns creation; import is an explicit secondary task. Reuse the preview in queue/approval/calendar where useful. Never fabricate likes, reach, media or provider capabilities to fill a layout.
3. **Private Root work surface.** Add an installation overview, clear operational health/attention, and a readable audit view around real stored state. Keep users, workspaces, installed platforms and runtime configuration; move configuration search/categories into the contextual sidebar. All controls must call real authorized operations. Missing backups, plans, lifecycle controls and other legacy parity remain explicit work; decorative buttons do not count as implementation.
4. **Complete core visual QA.** Review every route and shared control in Grove, Coast, Clay and Nightfall, on desktop, short laptop and phone. Check focus, drawers, pagination, empty/error/pending states, permission variants and example-data readability. Update architecture and UX evidence. Then resume Facebook engine coverage and live-provider verification.

## First integrated batch

Implemented the two-sidebar shell, shared contextual tools dock, permission-aware quick creation, workspace switcher and recoverable sign-out. Posts now has the approved Table default plus Feed and Cards, collapsed actions/import, first comments and destination outcomes. Root has grouped private navigation, stored-count overview, Operations and a bounded redacted Activity view; config search/categories use the contextual sidebar. Registry version 31 manages the recent-activity limit. Root config saves prevent duplicate writes, preserve failed drafts and show retry feedback.

Local Chrome checks cover Table/Feed/Cards, combined view/status filters, first comment visibility, Root configuration search placement, Root routes, drawer focus/Tab/Escape, and phone/desktop overflow. Four-theme contrast and component regressions pass. These checks do not complete design QA for every route, high-volume lists, every permission variant, or live providers. Next core batches still need composer/queue/calendar preview consistency, remaining shared forms/tables/states, detailed module route polish and the legacy Root control inventory.

## Remaining boundaries

The legacy app is a reference, not a source of shared provider-specific business rules. Existing production remains running. Local previews use synthetic data. Design coverage, implemented actions, automated checks, browser evidence and live-provider evidence must remain distinct. This plan does not declare the design, adapter, MCP parity or cutover complete.

The paused Inbox pagination/MCP deletion expansion is not shipped. The reviewed Graph comment-delete confirmation fix is retained as a safety correction; durable deletion reconciliation is still required before claiming safe complete deletion parity.
