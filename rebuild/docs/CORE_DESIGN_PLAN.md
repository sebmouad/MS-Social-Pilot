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

Local Chrome checks cover Table/Feed/Cards, combined view/status filters, first comment visibility, Root configuration search placement, Root routes, drawer focus/Tab/Escape, and phone/desktop overflow. Four-theme contrast and component regressions pass. These checks do not complete design QA for every route, high-volume lists, every permission variant, or live providers. The publishing workflow batch below now covers composer/queue/calendar preview consistency. Remaining core batches still need shared form/table/state consistency across other modules, detailed route and permission-variant polish and the legacy Root control inventory.

## Publishing workflow batch

The dedicated composer now pairs a live neutral preview with text/first-comment/attachment editing; destination and schedule pickers, Save and Schedule use the contextual sidebar. Draft saves do not require timing or destinations. Stateful service and transport failures preserve entered values; an unconfirmed save asks the user to check Posts before retrying. Image upload has an exact-once submission handoff, and mobile sidebar submissions reveal the editor rather than leaving feedback inert behind the drawer.

Queue and approvals use the same complete post preview within a readable 720px measure, retaining ordering, time zones, permissions, approval notes and pending controls. Calendar uses that preview in an accessible dialog; Previous/Today/Next now share the sidebar with its existing filters. Server-supplied clock labels, wall times, move options and slot-ended state keep the client aligned when browser/server timezone databases disagree. Final move validity stays with the shared service.

Synthetic campaign images are opt-in repeatable fixtures with guarded local storage. Browser draft-upload and offline-retry checks persisted first comments, were read through authenticated MCP and were cleaned up. HTTP/MCP media errors expose safe typed messages rather than internal paths or Root instructions. This is functional local evidence, not remote publishing or completed UI/API/MCP parity.

## Root access and directory batch

Users and Workspaces search now live in the contextual sidebar. Counts distinguish matches from installation totals, stale page requests clamp to available pages, and empty-state copy stays outside the horizontal table region. Root directory forms and confirmation dialogs use shared theme fields and buttons. Workspace access shows Active/Suspended, with exact resource/action confirmation for suspension or restoration, duplicate-submit protection and retained error input. The private shared service rechecks installation-owner identity, serializes access changes against workspace operations, retains records and audits state changes atomically. UI and authenticated Root MCP use that service; workspace API keys cannot access it.

The shared workspace lock rejects new side effects after suspension. Background provider status, channel/Ads analytics and Inbox sync now hold the same lock across provider requests, retries and storage. Existing operations finish before suspension commits. Customer entitlements hide suspended workspace features; installation owners may inspect retained data and restore access, while ordinary workspace operations still fail closed. Access-limited UI offers workspace switching and sign-out without internal setup instructions.

Root workspace deletion, plans, backups, the complete legacy operator inventory and full MCP parity remain separate work. This batch adds no database schema migration or new configuration key; its lock timeouts use existing validated Root settings.

## Historical audit batch

Root Activity now has action/person search, exact workspace ID and inclusive UTC date filters, all in the contextual sidebar alongside page size and Latest/Newer/Older navigation. A private shared service authorizes current installation owners, validates filters and configured limits, and exposes the existing safe metadata projection. HTTP and MCP use the same service; workspace API keys remain excluded. Cursor pagination handles equal timestamps and new records without offset drift. The UI distinguishes no history, no matches, a changed/empty page, invalid filters and an unavailable store.

Registry version 32 supplies active search/cursor character limits and extends the page limit to historical reads. Local browser checks cover filtered UI/HTTP/MCP agreement, real Root setting changes/restoration, phone drawer keyboard/empty/error recovery and four-theme overflow. PostgreSQL probes cover tied timestamps, reverse pagination, literal wildcard characters, date/workspace scope, demotion and rollback cleanup. Large-installation query plans, audit export/retention and generic log/error administration remain open. The private MCP context batch below closes the former membership dependency for existing Root tools.

## Private MCP and owner recovery batch

Root has a session-authenticated installation MCP context that does not depend on workspace membership, roles or grants. Its five currently implemented tools and three resources share one private dispatcher, current-owner checks, registry validation, exact confirmations and domain audits. Explicit workspace context hides Root privileges; workspace bearer keys keep their stored workspace scopes even when an owner cookie is present. Workspace keys and explicit workspace sessions no longer inherit an owner creator's suspended-workspace inspection exception. Protocol/auth responses are no-store; global MCP availability and request budgets remain active.

Root overview includes private connection guidance and a copy action. Membership-free installation owners recover from the empty workspace route into Root. Customers retain invitation/sign-out recovery and see workspace policy copy rather than internal Root setup instructions. Real local password/TOTP testing uses disposable identifiable records and verifies cleanup and exact configuration restoration. Private long-lived credential issuance/OAuth, remaining Root operations, general workspace MCP error hardening and full release gates remain unfinished.

## Shared MCP recovery batch

Workspace MCP failures now follow the same safe error contract as Root, Ads and media. Shared Publishing, Inbox, connection selection and data-control validation/access errors retain useful public codes; unexpected infrastructure/provider text is masked. Invalid argument containers and calendar-date rollover are rejected. Secondary MCP audit failures preserve the returned service outcome with an explicit warning, so clients do not repeat a completed write merely to repair an audit entry. Unknown write outcomes direct clients to inspect current state first. This closes the generic MCP message-leak gap above; domain audit durability and remote reconciliation remain separate work.

No visual controls, theme tokens, route structure, schema or Root configuration keys changed in this batch. Live local Chrome MCP tests created, read, updated and deleted a disposable draft, verified all three write audit records and removed those probe audit records. Broader core design coverage, Root controls and Facebook coverage remain unfinished.

## Remaining boundaries

The legacy app is a reference, not a source of shared provider-specific business rules. Existing production remains running. Local previews use synthetic data. Design coverage, implemented actions, automated checks, browser evidence and live-provider evidence must remain distinct. This plan does not declare the design, adapter, MCP parity or cutover complete.

The paused Inbox pagination/MCP deletion expansion is not shipped. The reviewed Graph comment-delete confirmation fix is retained as a safety correction; durable deletion reconciliation is still required before claiming safe complete deletion parity.


## Root user workflow batch

The existing Users workflow now shares a current-Root-authorized directory across UI/HTTP/MCP and current-actor-checked transactional account actions. Search, account-state filters and pagination use the contextual sidebar; safe counts and both factor types are visible. Confirmation dialogs recover from failed/unconfirmed responses without erasing input or repeating submissions. Actual local checks cover directory/session semantics, all four account actions and audits, non-Root/key denial and a Chrome confirmation with persisted state/audit verification and cleanup. User deletion and other operator controls remain incomplete.

User clarification also applies module boundaries to design, menus and sections. The shared architecture/UX contracts now explicitly require Root shared controls, product module controls and platform module controls to be organized by ownership. The current scattered module controls are recorded as incomplete; the next Root design batch must implement that organization, not just move source files.


## Root module organization batch

Root design now reflects the user's clarified module ownership: native expandable Shared controls, Product modules and Platform modules groups; installed-manifest navigation; product module overview and per-product/per-platform settings screens. Shared configuration excludes all module-owned settings. Product manifests declare namespaces and additional owned keys; platform entries declare their owner in the adapter, with precedence over legacy key prefixes. Root availability controls and feature policies stay with their module, as do owned sync/retention/image settings. Shared infrastructure remains separate.

Existing validation, encrypted secret handling, current-Root guards and audit paths are reused. Registry 34 includes safe owner metadata for UI/HTTP/MCP. Availability appears before product parameters, provider inner categories are readable, and boolean inputs have unique accessible names. Actual Chrome verified every new route, same-value module setting write/MCP/audit agreement and exact restoration, and four-theme phone drawer/overflow behavior. Source and operation encapsulation and missing per-module health/actions are still work; a clean menu is not proof of complete module implementation.
