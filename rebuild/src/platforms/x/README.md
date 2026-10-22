# X staged protocol module

This module is **not a usable customer integration**. Every manifest capability is
unsupported, even when Root enables the module. The parent registry may expose
its settings for operator preparation; no server host is installed.

Implemented and fixture-tested: confidential OAuth 2.0 authorization-code exchange
with S256 PKCE; authenticated-user discovery; single text/image post submission;
post status with author matching; explicit deletion receipts; single-use refresh
rotation with an awaited credential-persistence callback. Runtime construction
loads Root policy and encrypted application credentials. `startConfiguredXOAuth`
uses the shared trusted `requestOrigin(request)` resolver and the configured
callback path. It does not create a connection or authenticate an actor.

Requests have a Root timeout, reject redirects, redact provider errors and never
retry writes. Failed/malformed write receipts are uncertain. The host must retain
an unresolved publication claim and must not automatically submit it again. No
provider idempotency is assumed; `operationId` does not create idempotency.

Protocol literals (OAuth grant names, S256, field names, decimal X identifiers,
media category and `/2` resource paths) are provider invariants. Deployment values,
endpoints, scopes, credentials, media/text limits, timeout, expiry threshold,
callback path and English/French errors are declared in `config.ts`.

## Required integration outside this module

- Install an X-owned host through `src/server/platforms/index.ts`, following its
  neutral host interface. Settings and manifest are registered as staged in
  `src/platforms/index.ts`.
- Shared connection service must authorize owner/member/viewer and workspace
  boundaries; bind state/verifier to actor, workspace, expiry and trusted callback
  origin; consume state once. Store access/refresh credentials encrypted.
- Serialize refresh per connection (lease/CAS), atomically persist rotated tokens
  **before** publishing, and recheck selection/access at the operation boundary.
  An unsuccessful storage write must stop subsequent provider operations.
- UI, REST and MCP must invoke the same authorized/audited service, with exact
  confirmations for writes. Complete parity documentation and role/tenant tests
  before changing capability declarations. No customer surfaces were added here.
- Shared media resolution must supply bounded ephemeral image bytes; no remote
  URL is fetched by this adapter. Implement weighted X text/URL validation,
  image alternative-text delivery, chunked video and remote processing journals
  before advertising these options. Current behavior deliberately rejects video,
  alternative text and native scheduling, rather than silently dropping them.
- Legacy public-metrics statistics still need a module collector and shared
  analytics persistence/semantics wiring. No analytics capability is advertised.
- Live X permissions, access tier, refresh, publish/status/delete and cleanup have
  not been verified. Fixture results are not provider or production evidence.

Root keys: `platforms.x.enabled`, `platforms.x.includedByDefault`,
`platforms.x.planFeatures`, `x.policy`, `x.clientId`, `x.clientSecret`.
The shared schema version must be advanced by the integrator, not this module.

Protocol reference: [X official upload sample](https://github.com/xdevplatform/samples/blob/main/python/media/media_upload_v2.py).
