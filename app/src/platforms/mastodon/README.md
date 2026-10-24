# Mastodon installed connector

Installed source supports OAuth authorization, discovery, text/link and inspected local image/video publishing, ownership-checked remote status/deletion. Root keeps the connector off by default. Inbox, analytics and ads remain unsupported.

Root registers `mastodon.instanceUrl`, `mastodon.clientId`, `mastodon.clientSecret`, `mastodon.maxResponseBytes`, `mastodon.connectionPolicy` and the existing `mastodon.policy`. Register the OAuth app on the configured server and enter its credentials in Root. The first installed workflow uses one Root-selected server; it does not offer arbitrary customer server discovery. Existing connected credentials retain their original server in their encrypted payload, so changing Root's server cannot send old tokens to a new server.

The provider transport resolves once, rejects non-public addresses including IPv6 mapped encodings, pins its TLS connection to the validated answer, refuses redirects, bounds JSON bytes and applies the configured timeout. Multipart upload uses inspected local bytes only. Mastodon issues non-expiring tokens: no refresh grant is invented. Disconnect removes local credentials through the shared Settings retain/delete choice; remote revocation is not claimed.

The neutral connection host derives callback origin from `app.publicOrigin`, binds single-use state to the actor/workspace and owns encrypted persistence, audit and discovered unselected destinations. Shared Settings supplies discovery selection and disconnect across UI, REST and MCP. Publishing descriptors expose the same service-backed capabilities to shared authoring.

Synthetic evidence: `mastodon-platform.test.ts` and `oauth-three-install.test.ts`. Live gates remain: server app registration, authorized OAuth callback, token persistence, checkbox selection, publish/status/delete with cleanup, retain/delete behavior, role and tenant checks at real HTTP/MCP boundaries, browser and production migration. No live-provider or production claim is made.

The callback path is the installed protocol route `/api/connections/mastodon/callback`; the policy schema refuses alternate paths because no alternate route is shipped. Host credential checks require every configured scope. Mastodon records returned OAuth scopes; an omitted scope means the requested grant under OAuth 2 semantics.
