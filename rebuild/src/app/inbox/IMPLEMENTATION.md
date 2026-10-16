# Inbox

The Inbox stores channel conversations plus comments attached to locally stored published posts. Today Facebook Pages are the only channel type; names, badges and capabilities on screen come from the platform registry (`src/platforms`, `src/server/inbox/providers.ts`), so the screen does not name a platform itself.

## Screen

Two panes. The left list merges the newest 50 conversations and 50 top-level comments of the chosen channels, newest first. Each row shows author, time in the workspace time zone, a preview, the channel badge and text-plus-shape tags: Message or Comment, `N unread` (conversations; the count comes from the platform), **Needs reply** and Resolved or Hidden. The right pane shows the selected thread (`?thread=message:<id>` or `?thread=comment:<id>`): the full stored history (up to 300 entries), who wrote each entry and, for replies sent from this app, which teammate sent it. For a comment it also quotes the post it is under. On phones the list and the thread are separate screens with a back link.

Filters live in the sidebar and in the URL: channel, type (messages/comments), status (open/resolved/all) and whether hidden comments are listed. Empty states distinguish no channel, nothing synced yet, no open items, and no match for the filters.

**Needs reply** means: open, and for a conversation the newest stored message is not from the channel; for a comment, visible and nobody on the channel side (this app or the channel's own account) has replied under it (`src/server/inbox/threads.ts`). It reflects only what is stored.

**Last synced** is the newest of the stored refresh times for the visible channels and the latest `inbox.synced` audit entry for the workspace. Replies, resolve and hide no longer touch it. **Sync now** refreshes the selected channel or every visible channel and reports the outcome: channels checked, conversations, messages and comments, and how many channels could not be read (for example a connection that needs reconnecting). One unreadable channel no longer blocks the others; the request fails only when no channel could be read. Provider reads for a channel finish before its local transaction, so a read failure writes nothing for that channel.

## Reply rule

The shared view asks the selected platform host for reply eligibility and plain-language metadata. For Facebook message threads, the reply box states "Replies are possible until <time> (workspace zone)" with the window length, "The reply window closed <time>", or that there is no message from the person to reply to. The Facebook module owns the Messenger window and its Root configuration read (`inbox.messengerReplyWindowHours`, at most 24 hours); the mutation checks it again before contacting the platform. Facebook comment replies have no window and are public under the comment. Other modules supply their own rules through the same contract. The box shows a character count against the 2,000 limit and is disabled, with the reason, when a reply is not possible.

UI and MCP Inbox reads use the same channel predicate: selected, in the current workspace, within the member's channel grant, backed by a non-revoked connection in that workspace, and provided by an enabled Inbox-capable module. Expired credentials retain accessible stored history; write operations still require a usable connection.

## Actions and checks

Reply, resolve/reopen, hide/unhide and delete go through `/api/inbox/actions` and the functions in `src/server/inbox/actions.ts`. Each action rechecks the active workspace membership, Inbox entitlement and feature permission, channel scope, enabled channel ownership, token validity and the configured scope grants. `meta.inboxReadScopes` gates reads and `meta.inboxWriteScopes` gates replies, moderation and deletion. Existing connections must reconnect and grant any missing configured scopes.

- Replies are sent to the platform first, then stored with the acting user and audited.
- Resolve/reopen is local workflow state.
- Hide/unhide is sent to the platform; the local state changes only after provider success.
- Delete (comments only, offered when the adapter supports it) asks for confirmation that names the consequence: the comment and any replies under it are removed from the platform and from the inbox, and this cannot be undone. The platform call comes first; the local rows (the comment and replies stored under it) are removed only after it succeeds. Audit entry `inbox.comment_deleted`.
- Controls appear only for members who can write to the channel; others see a plain statement that replying is unavailable.

Audit details contain workspace and object identifiers but no message content or credentials. A provider failure is shown as a generic customer-safe error and never as a confirmed action.

## Known gaps

Visitor replies nested under a comment are not synced (the sync reads top-level comments), so only replies sent here appear under a comment. Lists show the newest 50 per type without paging. Assignment, notes, saved replies and an MCP delete tool do not exist. Delete and the other operations have only mocked provider tests; no live platform calls were made.

Run the isolated checks from `app/rebuild` with `npm test` and `npm run typecheck`. Mocked provider tests do not send live messages or moderation operations.
