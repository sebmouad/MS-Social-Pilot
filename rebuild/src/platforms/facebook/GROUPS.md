# Facebook Groups compatibility boundary

This is **private provider transport and fixture evidence**, not customer Group
support. No Group selection, UI/REST/MCP publishing capability or live-provider
success is claimed. `facebookModule.channelKinds`, the installed adapter and
normal OAuth remain Page-only. No setting here restores a retired Meta API.

The legacy implementation in root `src/lib/facebook/oauth.ts` treats permission
or invalid-request discovery errors as an empty collection and incorrectly
describes the April 2024 change as a restriction to app-installed Groups. Meta's
[v19 notice](https://developers.facebook.com/docs/graph-api/changelog/version19.0/)
describes removal across versions on April 22, 2024. This lane attempted to read
that official page and its linked January 23 announcement, but Meta returned HTTP
429; there is no fresh authenticated/provider availability verification. Existing
module policy already records Groups as removed. Do not pin an older version,
request retired scopes in normal OAuth, or advertise Group support from fixtures.

`configuredFacebookGroupOperations` reads typed Root policies from the Facebook
config list, registered by `module.ts`:

- `meta.groupDiscoveryScopes`
- `meta.groupPublishScopes`
- `meta.groupReadScopes`

These are configured private dependencies, not enabled product operations. All
endpoints, versions, pagination, timeouts, signing and binary photo validation
reuse existing Root-managed Facebook configuration and transport. The selected
single-photo/feed implementation is an implementation boundary: multi-photo,
video, Reels, Stories, comments, deletion and provider-held scheduling are not
implemented for Groups. There is no Group enablement switch.

`groups.ts` accepts neutral `PlatformCredential`, `PlatformTarget`,
`PublishRequest`, `PublishResult` and `RemoteStatusRequest` types. Discovery emits
`kind: 'group'` targets only after a successful signed response, and distinguishes
a successful empty collection from missing recorded grants or provider denial.
Strict bounded pagination refuses incomplete or unsafe listings. Authentication,
throttling, transient and network failures are not disguised as empty results.

Every private write requires configured publishing grants and a fresh positive
discovery of the exact selected Group using the connected **user token**. Feed
and link posts use `/{group}/feed`. Single photos use `/{group}/photos` with
`message`, retaining `post_id` when returned. Binary uploads reuse signature,
MIME, byte and filename validation. Page tokens are not discovered or substituted.
Positive discovery is provider access evidence, not workspace authorization.

A creation receipt maps to `submitted`, allowing for moderation or incomplete
publication. Status maps to `published` only when the response id matches the
requested id, `is_published` is explicitly true, and a composite id prefix or
explicit recipient establishes the exact Group. Contradictory recipients override
the prefix. Missing fields, an unpublished response, denied readback or uncertain
ownership yield `unknown`, never scheduled, absent or deleted. Transport failures
remain failures; callers must retain the shared uncertain-outcome policy and must
not blindly retry a create.

## Required integration outside this lane

Before exposing any Group capability, the integrator must first establish current
provider support with actual grants and outcome/cleanup evidence. If Meta denies
access, keep Groups unavailable in every surface.

1. Extend neutral `src/platforms/types.ts`/platform host metadata with per-target-kind
   format, credential, scheduling, comment/delete and availability declarations.
   Currently adapter-level Page descriptors would offer Group-incompatible choices.
   Shared product code must consume metadata, not branch on `group` or Facebook.
2. Settings' shared connection service must project safe availability/recovery copy,
   check usable kind and current grants before selection, and retain exact service
   confirmation, tenant locks and audit for UI/REST/MCP. Register bilingual
   customer copy and channel labels in owning Root catalogs. Current selection
   checks connection/entitlement, but not per-kind adapter eligibility.
3. Wire Group discovery/persistence into the common connection workflow only after
   that boundary exists. Persist new targets disabled, encrypt the user token,
   preserve cross-account binding and lock rules, and never set `canPublish` from
   an old recorded scope alone. `TargetType.group` already exists; this batch adds
   no table or migration.
4. Publishing's shared service must select target-specific descriptors and grants,
   dispatch to this provider port under existing tenant/role/resource/confirmation/
   audit rules, and reconcile submitted Group receipts through the Group reader.
   Keep unsupported operations absent. Add owner/member/viewer and cross-workspace
   UI/REST/MCP denial/success coverage there; the private transport is not an auth
   service and is not independently exposed through a new route/tool.
5. Update `ARCHITECTURE.md`, `DELIVERY_PLAN.md`, `AGENT_HANDOFF.md` and the Groups
   portions of `LEGACY_CAPABILITY_PARITY.md`; the integrator owns the schema-version
   bump for the three keys. This worker leaves `CONFIG_SCHEMA_VERSION` untouched.

Tests: `facebook-groups.test.ts` covers transport fixtures, scope/target refusals,
denied discovery/readback, strict pagination, Group photo fields, conservative
receipts/status and unsupported intent. `facebook-groups-runtime.test.ts` covers
registered policies and non-default Root values. There is no database, browser,
actual MCP client, provider or production evidence for this slice. No customer
screen changed, so there is no visual change to report.

## Worker verification (2026-10-21)

- `npx tsc --noEmit -p .`: exit 0, zero errors.
- Focused eight-file Vitest run with `--no-cache`: 132/132 passed, including
  both Group files (30 tests), Page engine/held-scheduling/readiness/status,
  `config-validation.test.ts` and `parity-guard.test.ts`.
- Final whole suite, `npx vitest run --exclude
  "**/facebook-diagnostic-transport.test.ts" --no-cache`: 613 files passed,
  49 skipped, two failed; 7,011 tests passed, 245 skipped, six failed.
  Five failures in `facebook-native-http.test.ts` cannot bind the sandbox's
  loopback socket (`listen EPERM ::1`). `root-config-form.test.ts`'s exhaustive
  owner-aware settings search exceeds the default five-second timeout; all
  11 tests pass in an isolated rerun with `--testTimeout=30000` (the exhaustive
  search took 5.88 seconds). No timeout or HTTP-test source was changed.
- The first full run also had `first-comment-retry-ui.test.ts` timeout and two
  `post-composer-ui.test.ts` best-time-fetch assertion failures. Those files
  passed the focused rerun and the final whole run without source changes.
- `git diff --check`: passed. No servers, deployment, production calls or push.
  Git worktree metadata is outside this worker's writable roots; all nine changed
  or added files remain uncommitted for integration. Pre-existing node_modules
  symlinks are untouched. The batch is not an all-green release candidate.
