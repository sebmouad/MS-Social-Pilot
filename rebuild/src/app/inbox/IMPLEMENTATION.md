# Inbox

The Inbox stores channel conversations plus comments attached to locally stored published posts. Today Facebook Pages are the only channel type; names, badges and capabilities on screen come from the platform registry (`src/platforms`, `src/server/inbox/providers.ts`), so the screen does not name a platform itself.

## Screen

Two panes. The left list merges all stored conversations and top-level comments of the authorized selected channels, newest first, through one bounded keyset query. Root controls page sizes; Older/Newer/Latest links in the contextual sidebar reach the remaining items. Each row shows author, time in the workspace time zone, a preview, the channel badge and text-plus-shape tags: Message or Comment, `N unread` (conversations; the count comes from the platform), **Needs reply** and Resolved or Hidden. The right pane shows the selected thread (`?thread=message:<id>` or `?thread=comment:<id>`): the newest stored history with Earlier/Newer/Latest continuation, without the former 300-entry truncation, who wrote each entry and, for replies sent from this app, which teammate sent it. For a comment it also quotes the post it is under. On phones the list and the thread are separate screens with a back link.

Filters live in the sidebar and URL: channel, type (messages/comments), status (open/resolved/all), hidden comments, literal message/person search and page size. List and history positions are separate URL cursors; paging preserves the selected thread even outside the current list page. Filter changes reset positions. Invalid or changed positions have Latest recovery. Counts explicitly describe stored activity, not complete provider history. Empty states distinguish no channel, nothing synced yet, no open items, and no match for the filters.

**Needs reply** means: open, and for a conversation the newest stored message is not from the channel; for a comment, visible and nobody on the channel side (this app or the channel's own account) has replied under it (`src/server/inbox/threads.ts`). It reflects only what is stored.

**Last synced** is the newest of the stored refresh times for the visible channels and the latest `inbox.synced` audit entry for the workspace. Replies, resolve and hide no longer touch it. **Sync now** refreshes the selected channel or every visible channel and reports the outcome: channels checked, conversations, messages and comments, and how many channels could not be read (for example a connection that needs reconnecting). One unreadable channel no longer blocks the others; the request fails only when no channel could be read. Provider reads for a channel finish before its local transaction, so a read failure writes nothing for that channel.

## Reply rule

The shared view asks the selected platform host for reply eligibility and plain-language metadata. For Facebook message threads, the reply box states "Replies are possible until <time> (workspace zone)" with the window length, "The reply window closed <time>", or that there is no message from the person to reply to. The Facebook module owns the Messenger window and its Root configuration read (`inbox.messengerReplyWindowHours`, at most 24 hours); the mutation checks it again before contacting the platform. Facebook comment replies have no window and are public under the comment. Other modules supply their own rules through the same contract. The box shows a character count against the 2,000 limit and is disabled, with the reason, when a reply is not possible.

UI and MCP Inbox reads use the same channel predicate: selected, in the current workspace, within the member's channel grant, backed by a non-revoked connection in that workspace, and provided by an enabled Inbox-capable module. Expired credentials retain accessible stored history; write operations still require a usable connection.

## Actions and checks

Reply, resolve/reopen, hide/unhide and delete go through `/api/inbox/actions` and the functions in `src/server/inbox/actions.ts`. Local resolve/reopen now dispatches to the platform-neutral `modules/inbox/server/workflow.ts`; it rechecks current write/channel grants but does not require usable remote credentials. Its scoped state change and domain audit are atomic. The obsolete Facebook local-resolution implementation and host hook were removed. All actions enforce active membership, Inbox entitlement/feature permission, selected channel scope and ownership. Remote actions additionally require current token validity and configured provider grants. `meta.inboxReadScopes` gates reads and `meta.inboxWriteScopes` gates replies, moderation and deletion. Existing connections must reconnect and grant any missing configured scopes.

- Replies are sent to the platform first, then stored with the acting user and audited.
- Resolve/reopen is local workflow state, including when credentials have expired and stored history remains available. UI, HTTP and MCP use one shared service with a single service-owned workspace operation lock; transports do not nest that lock. MCP additionally passes its current channel scope for intersection.
- Hide/unhide is sent to the platform; the local state changes only after provider success.
- Delete (comments only, offered when the adapter supports it) asks for confirmation that names the consequence: the comment and any replies under it are removed from the platform and from the inbox, and this cannot be undone. The platform call comes first; the local rows (the comment and replies stored under it) are removed only after it succeeds. Audit entry `inbox.comment_deleted`.
- Controls appear only for members who can write to the channel; others see a plain statement that replying is unavailable.

Audit details contain workspace and object identifiers but no message content or credentials. A provider failure is shown as a generic customer-safe error and never as a confirmed action.

## Known gaps

Visitor replies nested under a comment are not synced (the sync reads top-level comments), so only replies sent here appear under a comment. Assignment, notes, saved replies and an MCP delete tool do not exist. Delete and the other operations have only mocked provider tests; no live platform calls were made.

Run the isolated checks from `app/rebuild` with `npm test` and `npm run typecheck`. Mocked provider tests do not send live messages or moderation operations.

## Shared read services — 2026-10-16

`src/modules/inbox/server/read.ts` owns list and thread authorization, filtering and bounded persistence reads. UI, HTTP `GET /api/inbox`, HTTP `GET /api/inbox/threads/[key]`, MCP `list_inbox` and `get_inbox_thread` use these services. Every call reloads active identity, membership/feature grants, selected usable Inbox channels and workspace state; bearer resource scope is intersected with current grants. The page shell explicitly permits this scoped read path for non-admin members. Expired credentials retain stored history; revoked/unselected channels do not.

Stable `(time, kind, id)` cursors bind normalized filters, workspace, current channel set and thread identity where relevant. They carry no authority and are validated again after current authorization. SQL values are bound and literal search escapes wildcard characters. Histories load newest entries chronologically; original comments remain visible on every reply page. Reply-window eligibility uses the latest stored inbound message independently of the shown history window. Local reply/workflow timestamps do not claim provider synchronization.

Registry version 36 supplies `inbox.listPageSize`, `inbox.threadPageSize`, `inbox.searchMaxCharacters` and `inbox.cursorMaxCharacters`; MCP result bounds can reduce page sizes further. The old duplicate overview/list read paths have been removed. `msp://inbox` returns a configured first page; use returned cursors with tools to continue. No DDL or provider writes were introduced.

Evidence and limitations are recorded in `docs/PREVIEW_QA.md`. Stored browsing is paginated; nested visitor-reply sync, assignment/notes/saved replies, durable remote-write reconciliation and MCP comment deletion remain unfinished.

## Failure and receipt handling

HTTP returns typed safe codes/messages and no-store on every response; unexpected provider/database text is masked even if it contains a formerly whitelisted phrase. A non-sync write succeeds only with an explicit `{ok:true}` receipt. The UI validates successful responses and sync counts/timestamps before claiming completion. Malformed/false receipts or lost responses preserve reply text/delete dialog and direct the user to inspect current Inbox/platform state before repeating. These changes do not implement durable remote deletion reconciliation. See `docs/INBOX_WRITE_RECOVERY.md` for its required journal, concurrency, tombstone, lifecycle and cutover work.
