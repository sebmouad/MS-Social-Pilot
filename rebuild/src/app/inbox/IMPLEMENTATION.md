# Facebook Inbox

The Inbox stores Page conversations and messages plus comments attached to locally stored published Page posts. Use **Sync now** to refresh the selected Page or all Pages visible to the member. Graph pagination and the number of recent published posts scanned per Page are bounded by Root's Facebook Page size and page limit; conversation sync reads the newest 20 messages returned per thread. Provider reads finish before the local sync transaction starts, so a Facebook read failure does not leave a partially updated local batch.

Server actions recheck the active workspace membership, Inbox entitlement and feature permission, Page scope, enabled Facebook Page ownership, token validity, and configured scope grants. `meta.inboxReadScopes` gates reads and `meta.inboxWriteScopes` gates replies and moderation. Both sets are included with `meta.oauthScopes` in new connection requests. Existing connections must reconnect and grant any missing configured scopes.

Replies are sent to Facebook first, then stored with the acting user and audited. Resolve/reopen is local workflow state. Comment hide/unhide is sent to Facebook and the local visibility state is updated only after provider success. The interface does not expose comment deletion. Audit details contain workspace and object identifiers but no message content or credentials.

Run the isolated checks from `app/rebuild` with `npm test` and `npm run typecheck`. Mocked provider tests do not send live messages or moderation operations.
