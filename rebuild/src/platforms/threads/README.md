# Threads (staged, unavailable to customers)

The module is provider-owned and preserves legacy text/link, photo, video and
carousel container creation, bounded processing checks, token exchange/refresh,
and profile discovery. Root policy owns endpoints, scopes, polling, limits and
EN/FR feedback. Protocol field names, grant names and processing states are
adapter invariants. Requests do not follow redirects or retry. Lost write
responses are uncertain; processing exhaustion never restarts container creation.
Successful publication receipts survive later permalink lookup failure.

Alt text is unsupported: any media item supplying `altText` is rejected before
network access, so descriptions are never silently discarded.

No usable customer capability is declared. Fixture-tested adapter functions are
not a complete connection or publishing integration. No UI screen changed.
`configuredThreadsOAuth` derives the callback from `requestOrigin`; its caller
must supply previously authorized one-use user/workspace-bound state. Secrets
stay server-side. Token renewal is exposed but not scheduled or persisted.

## Integration dependencies outside this lane

- `src/platforms/index.ts` registers THREADS_CONFIG and staged module metadata.
  Do not put it in the customer installed list until the dependencies below pass.
- Module-owned OAuth state/callback and encrypted discovery persistence, selection,
  owner/admin authorization, workspace/actor binding, member/viewer/cross-tenant
  denial, exact confirmations and audit must be implemented and tested through
  one service used by Settings UI, REST and MCP.
- `src/server/platforms/index.ts` must register that completed module-owned host.
- Publishing needs durable tenant-bound creation/publish intents and receipts;
  recovery must retain uncertain requests and never automatically resend them.
  Persist refreshed credentials atomically before subsequent work. Public media
  delivery, content scope grants and selected-resource checks require host tests.
- Remote ownership/status is deliberately absent pending official API field and
  live evidence; do not infer publication from a container identifier.
- Update MCP_PARITY, LEGACY_SWEEP, architecture and handoff with honest staged
  status; legacy sweep cannot be marked done from these fixtures.
- Live OAuth, provider processing, token renewal and publish verification with
  cleanup remain release gates. No production, server, deploy or push occurred.

Root keys: platforms.threads.enabled, platforms.threads.includedByDefault,
platforms.threads.planFeatures, threads.policy, threads.appId, threads.appSecret.
CONFIG_SCHEMA_VERSION is intentionally unchanged.
