# Inbox

The Inbox stores channel conversations plus comments attached to locally stored published posts. Today Facebook Pages are the only channel type; names, badges and capabilities on screen come from the platform registry (`src/platforms`, `src/modules/inbox/server/providers.ts`), so the screen does not name a platform itself.

## Screen

Two panes. The left list merges all stored conversations and top-level comments of the authorized selected channels, newest first, through one bounded keyset query. Root controls page sizes; Older/Newer/Latest links in the contextual sidebar reach the remaining items. Each row shows author, time in the workspace time zone, a preview, the channel badge and text-plus-shape tags: Message or Comment, `N unread` (conversations; the count comes from the platform), **Needs reply** and Resolved or Hidden. The right pane shows the selected thread (`?thread=message:<id>` or `?thread=comment:<id>`): the newest stored history with Earlier/Newer/Latest continuation, without the former 300-entry truncation, who wrote each entry and, for replies sent from this app, which teammate sent it. For a comment it also quotes the post it is under. On phones the list and the thread are separate screens with a back link.

Filters live in the sidebar and URL: channel, type (messages/comments), status (open/resolved/all), hidden comments, literal message/person search and page size. List and history positions are separate URL cursors; paging preserves the selected thread even outside the current list page. Filter changes reset positions. Invalid or changed positions have Latest recovery. Counts explicitly describe stored activity, not complete provider history. Empty states distinguish no channel, nothing synced yet, no open items, and no match for the filters.

**Needs reply** means: open, and for a conversation the newest stored message is not from the channel; for a comment, visible and nobody on the channel side (this app or the channel's own account) has replied under it (`src/modules/inbox/server/threads.ts`). It reflects only what is stored.

**Last synced** is the newest of the stored refresh times for the visible channels and the latest `inbox.synced` audit entry for the workspace. Replies, resolve and hide no longer touch it. **Sync now** refreshes the selected channel or every visible channel and reports the outcome: channels checked, conversations, messages and comments, and how many channels could not be read (for example a connection that needs reconnecting). One unreadable channel no longer blocks the others; the request fails only when no channel could be read. Provider reads for a channel finish before its local transaction, so a read failure writes nothing for that channel.

## Reply rule

The shared view asks the selected platform host for reply eligibility and plain-language metadata. For Facebook message threads, the reply box states "Replies are possible until <time> (workspace zone)" with the window length, "The reply window closed <time>", or that there is no message from the person to reply to. The Facebook module owns the Messenger window and its Root configuration read (`inbox.messengerReplyWindowHours`, at most 24 hours); the mutation checks it again before contacting the platform. Facebook comment replies have no window and are public under the comment. Other modules supply their own rules through the same contract. The box shows a character count against the 2,000 limit and is disabled, with the reason, when a reply is not possible.

UI and MCP Inbox reads use the same channel predicate: selected, in the current workspace, within the member's channel grant, backed by a non-revoked connection in that workspace, and provided by an enabled Inbox-capable module. Expired credentials retain accessible stored history; write operations still require a usable connection.

## Actions and checks

Reply, resolve/reopen, hide/unhide and delete go through `/api/inbox/actions` and the functions in `src/modules/inbox/server/actions.ts`. Local resolve/reopen now dispatches to the platform-neutral `modules/inbox/server/workflow.ts`; it rechecks current write/channel grants but does not require usable remote credentials. Its scoped state change and domain audit are atomic. The obsolete Facebook local-resolution implementation and host hook were removed. All actions enforce active membership, Inbox entitlement/feature permission, selected channel scope and ownership. Remote actions additionally require current token validity and configured provider grants. `meta.inboxReadScopes` gates reads and `meta.inboxWriteScopes` gates replies, moderation and deletion. Existing connections must reconnect and grant any missing configured scopes.

- Replies are sent to the platform first, then stored with the acting user and audited.
- Resolve/reopen is local workflow state, including when credentials have expired and stored history remains available. UI, HTTP and MCP use one shared service with a single service-owned workspace operation lock; transports do not nest that lock. MCP additionally passes its current channel scope for intersection.
- Hide/unhide is sent to the platform; the local state changes only after provider success.
- Comment deletion now uses the shared durable journal: exact object confirmation, committed intent before one provider dispatch, conservative uncertainty, stored remote confirmation and atomic local finalization/audit. Status checks never repeat the provider call; recovery only finishes local work. Existing operations remain in the dialog until both sides are confirmed. Local cleanup follows the scoped stored descendant graph; durable alias IDs preserve completed status, and tombstones propagate through parent-first sync batches. Full provider reply discovery remains open. See `docs/INBOX_WRITE_RECOVERY.md`.
- Controls appear only for members who can write to the channel; others see a plain statement that replying is unavailable.

Audit details contain workspace and object identifiers but no message content or credentials. A provider failure is shown as a generic customer-safe error and never as a confirmed action.

## Known gaps

Stored visitor replies are read recursively and rendered as nested threads, with moderation/deletion and direct public replies to each visitor entry through the same shared services as the opening comment. The Facebook module reads flattened comments and bounded reply expansions; this is not proof of complete provider history. Assignment, notes and saved replies have shared productivity services and UI. MCP deletion/status/local recovery now share the durable workflow described below. Delete and the other operations have only mocked provider tests; no live platform calls were made.

Run the isolated checks from `app/rebuild` with `npm test` and `npm run typecheck`. Mocked provider tests do not send live messages or moderation operations.

## Shared read services — 2026-10-16

`src/modules/inbox/server/read.ts` owns list and thread authorization, filtering and bounded persistence reads. UI, HTTP `GET /api/inbox`, HTTP `GET /api/inbox/threads/[key]`, MCP `list_inbox` and `get_inbox_thread` use these services. Every call reloads active identity, membership/feature grants, selected usable Inbox channels and workspace state; bearer resource scope is intersected with current grants. The page shell explicitly permits this scoped read path for non-admin members. Expired credentials retain stored history; revoked/unselected channels do not.

Stable `(time, kind, id)` cursors bind normalized filters, workspace, current channel set and thread identity where relevant. They carry no authority and are validated again after current authorization. SQL values are bound and literal search escapes wildcard characters. Histories load newest entries chronologically; original comments remain visible on every reply page. Reply-window eligibility uses the latest stored inbound message independently of the shown history window. Local reply/workflow timestamps do not claim provider synchronization.

Registry version 36 supplies `inbox.listPageSize`, `inbox.threadPageSize`, `inbox.searchMaxCharacters` and `inbox.cursorMaxCharacters`; MCP result bounds can reduce page sizes further. The old duplicate overview/list read paths have been removed. `msp://inbox` returns a configured first page; use returned cursors with tools to continue. No DDL or provider writes were introduced.

Evidence and limitations are recorded in `docs/PREVIEW_QA.md`. Stored browsing is paginated; complete provider visitor-reply discovery and automatic remote-write reconciliation remain unfinished.

## Failure and receipt handling

HTTP returns typed safe codes/messages and no-store on every response; unexpected provider/database text is masked even if it contains a formerly whitelisted phrase. A non-sync write succeeds only with an explicit `{ok:true}` receipt. The UI validates successful responses and sync counts/timestamps before claiming completion. Malformed/false receipts or lost responses preserve reply text/delete dialog and direct the user to inspect current Inbox/platform state before repeating. The durable journal and manual Root recovery now extend these boundaries; automatic provider verification and full provider visitor-reply discovery remain incomplete. See `docs/INBOX_WRITE_RECOVERY.md` for its required journal, concurrency, tombstone, lifecycle and cutover work.

## Moderation rules — 2026-10-19

Ported from legacy `src/lib/moderation.ts`/`moderation-rules.ts` onto the existing `moderation_rules` and `moderation_actions` tables (no migration). `src/modules/inbox/moderation.ts` holds the pure matcher (links, phone numbers, accent/case-folded keywords), reply placeholders (`{first_name}`, `{page}`), schemas, exact confirmations and en/fr copy. `src/modules/inbox/server/moderation.ts` is the single service for `/inbox/moderation` (UI), `GET/POST /api/inbox/moderation` and the MCP tools `get_inbox_moderation`, `create/update/delete_inbox_moderation_rule`, `run_inbox_moderation_rules` and `undo_inbox_moderation_action` (resource-scoped in the MCP tool policy).

Rules naming no channel apply to every channel and need full channel access; scoped members and resource-limited keys see and manage only rules whose channels are all visible to them. A run is started by a person and uses that person's current authority: it examines recent stored comments (Root `inbox.moderationFreshHours`, `inbox.moderationRunMaxComments`), skips the channel's own words and app-sent replies, honours the daily cap and once-per-person replies, claims a log row per rule/comment before acting, and dispatches through the shared `moderateInboxComment`/`replyToInbox` services only where the channel's module declares hide/reply. Failures are logged and the run continues. Undo restores a hidden comment; rule replies are removed with the normal durable comment deletion. "Record for the team" writes a log entry; legacy email alerts are not sent. Root bounds: `inbox.moderationRuleLimit`, `inbox.moderationLogLimit` (registry version not bumped in this change; the integrator owns that).

Evidence: unit tests in `tests/inbox-moderation.test.ts` (matcher, copy parity, provider-neutrality, confirmations, scope, claim-once, capability skip, failure log, cap, undo, MCP). No PostgreSQL, browser or live-provider run. Open: automatic application after each sync, export/erasure coverage review of the moderation tables, Root diagnostics.


## Direct nested replies — 2026-10-20

`NestedReply` reuses `ReplyBox`, shared form validation and the module's existing
HTTP action. Each visitor entry has its own retained draft addressed to that
entry's ID. Channel-authored entries do not receive this composer. Current write
authority and declared reply capability govern visibility; the neutral reply
policy governs availability. English/French copy follows the document language,
and a synchronous in-flight guard prevents racing submit events. Unknown or lost
receipts retain the draft and never claim success. No new Root keys or migration.

HTTP `/api/inbox/actions` and MCP `reply_to_inbox` already share `replyToInbox`,
which intersects current channel grants and credential ceilings before module
dispatch. The new UI uses that path without adding provider rules.

Evidence: `tests/pubinbox-gap-ui.test.ts` covers descendant addressing, scope/
capability presentation, French copy, retained drafts and duplicate submission;
`tests/pubinbox-gap-surfaces.test.ts` executes HTTP/MCP through the existing
services and checks current-authority refusal. These use synthetic data/mocked
persistence and provider boundaries. PostgreSQL, live-provider, browser and MCP
transport verification remain open; no servers were run for this branch batch.


## Round 3: details panel, quick filters, bulk moderation, saved replies, shortcuts — 2026-10-21

**Details panel.** `server/details.ts` (`readInboxContactDetails`, MCP `get_inbox_contact_details`) reads stored data only: the person (platform id on this channel), first seen, messages/comments written, related posts (posts they commented on), workflow state and a sentiment trend of their classified comments (`details.ts` `sentimentTrend`; fewer than two classified comments is `unknown`, unclassified comments stay visible as gaps, never neutral). Without a platform id only the open item is described and the panel says so. Reviews carry no identity. "Labels" are the workflow labels the team sees (open/resolved, hidden, unread, assignee): the data model has no user-defined Inbox labels. `ui/ContactDetails.tsx` is a collapsible side panel (right column from 1280px, above the history below that).

**Quick filters.** `quick` (`unread`, `unanswered`, `negative`, `mentions`) on `readInboxList` / `list_inbox` / URL `quick=a,b`; all chosen must hold. A filter a kind cannot answer matches nothing there (comments have no unread count; messages and reviews have no stored sentiment). Unanswered mirrors the needs-reply rule; mentions look for the Root marker (`inbox.mentionPrefix`) plus the channel name. Toggles live in the sidebar filter panel; each active one is a removable chip in the content header.

**Bulk moderation.** `server/bulk.ts` (`bulkInboxAction`, MCP `bulk_inbox_action`, UI server action `ui/bulk-action.ts`) runs resolve/reopen/hide/unhide/delete through the existing per-item services, sequentially, with one result per item and the Root cap `inbox.bulkMaxItems`. One exact confirmation covers the request (`BULK <ACTION> <n> INBOX ITEMS`); deletion also sends each comment's own `DELETE COMMENT <id>`. Resolve/reopen run at once with an Undo toast; hide/unhide/delete reach the platform and ask first in a ConfirmDialog (hide gets Undo afterwards, delete never does). Failed items stay selected. An unfinished deletion counts as not done.

**Saved replies.** Service, REST (`/api/inbox/productivity`) and MCP tools already existed. Added: Root count limit `inbox.savedReplyMaxCount` enforced in the create transaction under a per-workspace advisory lock; the list response now returns `total`, `maxCount` and name/body limits; `ui/SavedRepliesManager.tsx` is a drawer (usage, search, create, edit, confirmed delete, empty/read-only/full states).

**Shortcuts.** `InboxShortcuts` adds `x` (select focused row), `/` (search) and `?` (guide dialog with `ShortcutHint` keycaps); Escape clears a selection. Every key has a visible control.

**Root keys:** `inbox.savedReplyMaxCount`, `inbox.relatedPostsLimit`, `inbox.sentimentTrendLimit`, `inbox.mentionPrefix`, `inbox.bulkMaxItems`. No migration.

Evidence: `tests/inbox-round3.test.ts` (quick-filter SQL, bulk service, trend, details), `tests/inbox-round3-ui.test.ts` (jsdom: bulk bar, saved replies drawer, shortcuts, details, screen), and the saved-reply limit cases in `tests/inbox-productivity.test.ts`. Mocked persistence only: no PostgreSQL, browser, live-provider or MCP-transport run. Open: REST routes for bulk and contact details (see lane report), phone-width and four-theme visual check of the new controls.

## Root customer copy (2026-10-21)

`inbox.customerCopy` is the strict bilingual catalog for Inbox headings, filters, lists, reviews, reply/action dialogs, bulk feedback, details, saved replies, productivity, shortcuts, moderation and shared service errors. `server/customer-copy.ts` reads it with `runtimeConfig` through a React request cache. Screens serialize only the text data into `InboxCopyProvider`; server-rendered contact details and shortcut hints receive it explicitly. Typed function interfaces retain argument handling; their editable templates include zero, singular and plural variants. Sync summaries use editable translated fragments and preserve existing count grammar. Shared services read the same catalog for UI, REST and MCP errors; wire language defaults to English and error codes/confirmations remain unchanged.

Scope caveat: `orderInboxCommentBatch` is a synchronous helper called from provider-owned files outside this lane. It accepts an optional error string, but those callers still use the bilingual catalog's English default until they pass `await inboxServiceText('historyUnsafe')`. The parser's direct synchronous compatibility callers similarly default to the catalog; Inbox read services pass current Root cursor error copy. Provider-owned errors and shared shell/form component copy are outside Inbox ownership. No browser, database, live-provider or production verification was performed. Root registry schema-version and shared architecture/handoff documentation updates belong to the integrator.

Automated evidence for this batch: targeted Inbox Vitest checks passed 230 unique tests across 24 files (combined run 220/23, then the new service-template case plus nine digest producer cases; final affected-control recheck 52/5). The catalog test checks both languages, strict missing/unknown-field rejection, Root overrides, and default template parity including exhaustive sync count combinations. `npx tsc --noEmit -p .` passed with zero errors; `git diff --check` passed. Existing isolated service/page tests explicitly mock the new request catalog with declared defaults. These counts exclude full-suite, browser and live-provider validation.

## Inbox quality lane — 2026-10-21

This batch changes `/inbox` only. Source and synthetic automated evidence are
separate from PostgreSQL, real browser, Next/RSC transport, provider and production
verification. No app server, deployment, push or production operation was run.

### Changes and ownership

- `ui/InboxList.tsx`, `ui/InboxListRows.tsx`, `ui/list-action.ts`,
  `ui/InboxScreen.tsx`, `query.ts`: progressive activity loading appends older
  cursor pages through the existing `readInboxList` service. Server-rendered row
  slots retain the existing avatars, channel badges, unread counts, action grants
  and locale/workspace-formatted times. No provider rules move into shared code.
  Each continuation derives its actor and channel ceiling from the current
  session; the shared service rechecks tenant, membership, entitlements and
  resource scope. Cursor validation/order are unchanged. There is no new write,
  confirmation, audit policy, REST operation or MCP operation.
- `ui/inbox.module.css`: one bounded list viewport below the bulk controls fixes
  the former implicit third grid row. The history/composer keep their own space.
  The list also scrolls in a bounded phone surface. Long lists use
  `content-visibility` with an intrinsic row estimate to reduce offscreen painting.
- `ui/InboxList.tsx`: in-flight deduplication, duplicate-row suppression, focused
  keyboard paging controls, live count feedback, retained rows after failure,
  explicit manual retry and a real continuation link. Auto-loading stops after
  a failed request; the Root page cap bounds accumulated rows. Sidebar cursor
  controls remain available. Appended pages are not separately URL-persisted;
  opening a row links to its containing cursor page. History keeps explicit
  Earlier/Newer/Latest paging rather than automatic history loading.
- `ui/InboxSelection.tsx`: selected rows are intersected with currently visible
  rows and their latest permission metadata; removed selections cannot revive
  when navigating back. The list revision includes actor, channel ceiling,
  authorized channel choices, filters, initial cursor, item data, grants and
  display policy, discarding appended rows and pending reads after changes.
- `ui/ThreadTools.tsx`: thread/kind-keyed internal state prevents a reply draft,
  assignment/note form state or pending replacement dialog carrying into a
  different conversation. Same-thread refreshes preserve the draft.
- `ui/ThreadScroll.tsx`, `ui/InboxScreen.tsx`: history opens on the newest entry;
  a refresh follows the end only while the reader is there. Reading older
  entries preserves scroll position. History counts no longer reset the scroller.
- `server/threads.ts`, `ui/InboxScreen.tsx`, `ui/InboxListRows.tsx`: list/history
  and displayed sync times use the selected English/French locale while retaining
  the workspace timezone and absolute ISO timestamps.
- `config.ts`, `ui/copy.ts`: registered Root controls and bilingual progressive
  loading/retry/continuation copy; the existing strict `inbox.customerCopy`
  catalog collects these strings. `CONFIG_SCHEMA_VERSION` is unchanged.

New registered Root keys (in `INBOX_MODULE_CONFIG`, already aggregated):

| Key | Default / validation | Consumer |
| --- | --- | --- |
| `inbox.progressivePageLimit` | 10; integer 1–100 | Initial screen → `InboxList`, including initial page. 1 retains explicit paging only. |
| `inbox.listPreviewMaxCharacters` | 180; integer 1–10,000 | Initial and continued server row rendering. Full text stays in the authorized thread. |

Changed/added test files: `inbox-state-isolation.test.ts`,
`inbox-progressive-list.test.ts`, `inbox-progressive-action.test.ts`,
`inbox-browsing-page.test.ts`, `inbox-thread-scroll.test.ts`,
`inbox-threads.test.ts`, `inbox-nested-replies.test.ts`,
`inbox-round2-ui.test.ts`, `inbox-round3-ui.test.ts`, and the manual file-based
`inbox-visual-check.cjs` fixture. Existing screen tests now mock runtime settings
and contact-details reads rather than accidentally attempting a real database.

### Design rules applied to the changed screen

| Screen | Applied skills and visible result |
| --- | --- |
| `/inbox` activity list | Taste/app-screen rules preserve the established module color, avatars, badges and two-pane work surface. Web Interface Guidelines supply a named keyboard-focusable scroll region, real button/link alternatives, focus rings, busy/live feedback, bounded overflow and safe long-list painting. Composition Patterns keep server row slots separate from client loading/selection state without new boolean modes. React Best Practices overlap independent grant/config reads, memoize selectable rows and deduplicate requests. Users can scroll through older activity while bulk controls remain accessible. |
| `/inbox` history/composer | Taste rules preserve the existing message bubbles and composer hierarchy. Web Interface Guidelines keep the labelled keyboard scroller and locale-correct dates. Composition Patterns isolate draft/productivity state by explicit thread identity. React Best Practices use refs for transient scroll position and a layout effect for initial/follow-end scrolling, avoiding scroll-driven rerenders. Readers keep their place during refreshes and cannot carry a draft into another thread. |

Scoped taste lint (`--app`, seven changed UI/CSS files) has **0 FAIL, 1 WARN**:
the pre-existing list-pane shadow. A preliminary `--help` invocation was treated
by that script as a whole-repository scan; its unrelated legacy findings are not
a scoped Inbox result. No global design changes were made.

### Evidence and limits

Regression cases were observed failing before the state-isolation, follow-end,
French-time and authorized-channel-invalidation fixes, then passing. Synthetic
fixtures exercise 80 alternating comments/Messenger conversations across ten
Facebook Page identities; separate reply-tree checks cover ten discussions with
60 nested replies each, including missing-parent history windows. These are
mocked read-entry/presentation and pure-tree tests; they do not prove database
SQL order/performance or live-provider completeness. Existing Inbox tests cover
service roles/channel scope, reply windows, writes, deletion recovery, moderation,
assignment, notes, saved replies, filters, metadata and sync query behavior.

`tests/inbox-visual-check.cjs` bundles the actual list/history components and
server row renderer into a file-based synthetic fixture, with explicit router/
action stubs and no server/database/provider calls. Its attempted Chromium run
was blocked before rendering by macOS sandbox process registration:
`bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`.
No screenshot, phone/theme, keyboard-browser or actual Next server-action
transport pass is claimed. Run the fixture and the real route on an authorized
synthetic preview environment before calling this visually or release verified.

### Remaining gaps and exact integrator edits outside this lane

1. `src/app/api/inbox/route.ts`: add `'quick'` to the GET query allowlist beside
   `'limit'`. `inboxListInput` already translates the comma-separated string and
   `readInboxList` already validates/applies it. Currently REST refuses a filter
   supported by UI/MCP. Keep duplicate-argument validation and service authority.
2. `docs/MCP_PARITY.md`: amend the existing `list_inbox` → `GET /api/inbox` row
   (do not create a duplicate operation) to name `readInboxList` and the UI's
   `loadMoreInboxRows` continuation. Record the quick-filter allowlist gap until
   item 1 is integrated. New UI continuation is a read of the existing capability.
3. `src/lib/config/registry.ts`: integrator owns the schema-version bump for the
   two new keys and additions to `inbox.customerCopy`; this worker leaves it intact.
4. `docs/ARCHITECTURE.md`, `docs/DELIVERY_PLAN.md`, `docs/AGENT_HANDOFF.md`,
   `DESIGN.md`, `UX-CONTRACT.md`: record bounded progressive loading, state/scroll
   fixes, new Root settings and the explicit browser/transport/database limits.
5. Comment liking is absent from Inbox service/UI/MCP advertised operations;
   Facebook currently stores `likeCount` but exposes no neutral like action here.
   It needs an authorized provider-owned implementation/capability plus one
   confirmed/audited shared service across UI/REST/MCP. Do not add a provider
   branch or inert customer button. This lane makes no live-moderation claim.
6. Sync freshness remains the newest stored refresh among selected channels,
   not proof that all ten channels are fresh. No per-channel complete freshness
   or exhaustive provider-history claim is made. Productivity's existing
   write-then-refresh error handling and raw-error display still need review;
   this batch isolates its thread state but does not rewrite its receipts.

Git's linked worktree metadata is outside the writable roots and read-only.
Verified source remains uncommitted for integration. Existing untracked
`node_modules` links were not modified. No migrations or data-control rows added.

Final validation from `rebuild/`:

- `npx tsc --noEmit -p .`: **PASS**, exit 0, zero errors.
- `npx vitest run --no-cache tests/inbox-*.test.ts tests/parity-guard.test.ts tests/config-validation.test.ts`:
  **418 passed, 8 skipped; 48 files passed, 5 skipped**. The eight skipped
  integration cases need a dedicated preview PostgreSQL environment; none was set.
- `npx vitest run --no-cache --exclude '**/facebook-diagnostic-transport.test.ts'`:
  **7,014 passed, 245 skipped, 5 failed; 618 files passed, 49 skipped, 1 failed**.
  All five failures are `tests/facebook-native-http.test.ts`, whose loopback
  listener is refused by this sandbox (`listen EPERM ... ::1`). The five cases
  cover signed GET/POST/DELETE, binary uploads, oversized response refusal,
  stalled-body cancellation and configured response timeout. No other failures
  were reported. The suite is not claimed green.
- Scoped taste lint: **0 failures, 1 existing shadow warning**. Chromium visual
  fixture: **BLOCKED before render**, as described above.
- `git diff --check`: **PASS**. No source outside the Inbox module or tests changed.
