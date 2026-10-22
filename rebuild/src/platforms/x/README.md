# X installed connector

Installed source supports confidential OAuth 2 authorization-code exchange with S256 PKCE, authenticated-user discovery, text/image publishing, author-matched remote status and remote deletion. Root keeps the connector off by default. Inbox, analytics and ads remain unsupported.

Root credentials are `x.clientId` and `x.clientSecret`. `x.policy` owns API/authorization/public URLs, scopes, image/text limits and request timeout. `x.connectionPolicy` owns state lifetime, callback code size, renewal lead time and bilingual publication label. Callback origin comes from `app.publicOrigin` through the neutral OAuth host, never forwarded headers. The shared host binds the verifier to actor/workspace and consumes state once. Actual token-granted scopes, expiry and rotating refresh token are persisted encrypted.

The provider-owned renewal job uses the shared authorized, selected-resource, serialized refresh service and stores rotated credentials before further writes. Shared Settings supplies discover/select and retain/delete disconnect through common UI/REST/MCP services. Disconnect is local; remote grant revocation is not claimed. Text validation is conservative codepoint counting; weighted URL shortening is not implemented. Uploaded images require inspected local bytes; alt text and videos are refused.

Publishing failures after a possible write remain uncertain; no automatic duplicate submission is allowed. Protocol fields/grants/S256 and resource paths are provider invariants. Deployment limits and credentials are Root settings.

Synthetic evidence: `x-platform.test.ts` and `oauth-three-install.test.ts`. Live gates remain: application permissions/paid-tier access, OAuth callback, token rotation persistence, discovery selection, image/text publication, remote status/delete and cleanup, retain/delete, browser and real HTTP/MCP role/tenant verification. This is source integration, not live or production verification.

The callback path is the installed protocol route `/api/connections/x/callback`; the policy schema refuses alternate paths because no alternate route is shipped. Host credential checks require every configured scope. X records the token response scope list; missing grants prevent use.
