# Threads installed connector

Installed source supports OAuth connection, authenticated profile discovery and text/image/video/carousel publishing. Root keeps the connector off by default. Remote status, remote deletion, inbox, analytics and ads remain unsupported.

Root uses `threads.appId`, `threads.appSecret`, existing `threads.policy` and new `threads.connectionPolicy` (state lifetime, callback code size, renewal lead time and bilingual publication label). The neutral OAuth host derives callback origin from `app.publicOrigin`, consumes actor/workspace-bound state once, encrypts credentials, audits and persists discovery without selecting destinations. Shared Settings exposes selection and retain/delete disconnect through UI/REST/MCP services.

The code exchanges a short token for the long-lived token, checks that discovered profile identity matches the OAuth user, records token expiry and stores the access token as its refresh credential. The provider-owned renewal job refreshes that long-lived access token using the neutral locked persistence service. Disconnect removes local credentials; remote revocation is not claimed.

Publishing accepts provider-fetchable public HTTPS media; it refuses local-byte uploads, alt text and unsupported native schedules. Polling is bounded by Root policy. Lost or ambiguous publish receipts remain uncertain and cannot be resent automatically. Runtime descriptors expose EN/FR labels, media bounds and supported operations consistently to shared authoring.

Synthetic evidence: `threads-platform.test.ts` and `oauth-three-install.test.ts`. Live gates remain: app approval, OAuth callback, long-token exchange and renewal timing, persisted token rotation, discovery selection, text/media/carousel delivery and cleanup, retain/delete, browser and real HTTP/MCP role/tenant verification. No live or production claim is made.

The callback path is the installed protocol route `/api/connections/threads/callback`; the policy schema refuses alternate paths because no alternate route is shipped. Host credential checks require every configured scope. Threads does not return a scope list in this exchange; persisted scope coverage reflects the requested grant and still requires live app-permission verification.
