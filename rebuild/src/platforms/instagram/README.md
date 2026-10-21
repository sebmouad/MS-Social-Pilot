# Instagram adapter and host — installed, disabled by default

Binding target: `../../../docs/ARCHITECTURE_CONTRACT.md`. This source batch is
fixture evidence only. It makes no claim about live Graph permissions, remote
outcomes, interface parity, deployed behavior or legacy parity completion.

Owned implementation:

- `config.ts`: typed Root policy, defaults, bilingual format/error/metric copy,
  required grants, Graph endpoint/version, read/poll bounds and caption/carousel
  limits. `runtime.ts` reads it with `runtimeConfig` and the signing secret with
  `runtimeSecret`. No schema-version edit is included.
- `discovery.ts`: `configuredInstagramDiscovery` uses the signed transport to
  discover Business/Creator accounts linked to the selected Pages supplied by the
  authorized connection service. It never enumerates or selects Pages itself.
  Returned Page credentials are server-only. The earlier legacy-compatible
  `createInstagramDiscovery` entry is retained for its existing callers/tests;
  new integration must use the configured signed entry.
- `publishing.ts`: explicit image, mixed carousel and Reel formats; image is the
  default. All containers, including every child, must reach FINISHED before
  publishing. Container PUBLISHED is an uncertain outcome, never permission to
  repeat media_publish. Polling and Graph requests are bounded; writes are never
  retried. A confirmed media receipt is retained if a permalink read fails; no
  permalink is invented from a numeric media id. Provider-held schedules,
  arbitrary links, alt text and binary uploads are refused before dispatch.
- `inbox.ts`: owned-media comment/reply discovery, first comments, comment replies,
  hide/unhide and comment deletion. Missing recorded comment grants fail closed.
  Bounded/truncated reads fail explicitly instead of returning apparently complete
  history. Direct messages and reviews are absent.
- `insights.ts`: isolated per-metric account/media requests, raw response retention,
  explicit failed metric names, current follower profile snapshots and neutral
  AnalyticsMetricInput / AnalyticsAudienceEntry normalization. Day flow series can
  sum; reach, lifetime and range totals use latest-per-channel semantics. Category
  snapshots retain provider dimension names. Missing values are not zero. Metric
  availability depends on account, Graph version and grants; configure the Root
  policy accordingly. This is not a persistence/backfill worker.
- `transport.ts`: appsecret_proof, bearer credentials, origin-contained cursor
  pagination, sanitized EN/FR failures, bounded requests and abort propagation.
  Protocol field/edge names, format ids, Graph status/error codes and conversion
  from dates to Unix seconds are adapter-local protocol invariants.

Instagram media deletion is not declared: this lane could not establish the
supported deletion contract for Facebook Login. Comment deletion is separate and
implemented. Do not infer media-deletion permission from instagram_content_publish
or instagram_manage_comments. First comments/inbox need instagram_manage_comments
in addition to the previously requested basic/publishing/insights grants.

## Original staged-adapter integration checklist (historical)

The original adapter-only batch registered settings and exported a staged manifest
without inserting it in PLATFORM_MODULES. The host follow-up below supersedes this
source status; the original integration checklist is retained for traceability. The shared host is a required
record keyed by installed platform ids; inserting a manifest without that host
would fail TypeScript and the Root platform-status reader. No fake host is supplied.

1. Implement an authorized, audited connection/selection service path that supplies
   only selected Pages and their credentials; persist linked professional targets
   under provider `instagram`, encrypt Page credentials, record grants/expiry and
   handle deselection/disconnection. Avoid giving all discovered channels access.
   Current historical Instagram selection uses target type `instagram`, whereas
   this staged adapter declares `professional`; reconcile at the module boundary.
2. Implement `instagram/host.ts` assembly only after those service ports exist,
   with shared connection start/callback behavior and module-owned Inbox/Analytics
   storage/sync hooks. Register it in `src/server/platforms/index.ts`, then install
   `instagramModule` in PLATFORM_MODULES. Shared code must dispatch neutrally, not
   branch on provider or interpret IG metrics/scopes. Do not import Facebook-owned
   workflows into shared code to achieve this.
3. Ensure UI, REST and MCP use the same existing Publishing, Inbox, Analytics and
   Connections services. Those services retain tenant/selection/access checks,
   confirmations, audit, publication claims and uncertain-outcome recovery. The
   adapter is a provider port, not an authorization boundary or an alternate API.
4. Add durable container/attempt reconciliation before enabling production writes;
   there is no provider idempotency guarantee or safe automatic resend after a
   lost publish response. Supply anonymously fetchable signed HTTPS media URLs
   through the neutral shared media pipeline; this adapter refuses local bytes.
5. Integrator bumps CONFIG_SCHEMA_VERSION for the five new keys and updates
   ARCHITECTURE.md, GOAL.md, DELIVERY_PLAN.md and AGENT_HANDOFF.md. Prove shared
   UI/API/MCP permission/confirmation parity and selected-resource isolation;
   obtain missing grants, run live provider tests with verified cleanup and
   browser tests before activation. Keep the switch off until these gates pass.

New Root keys: `platforms.instagram.enabled`,
`platforms.instagram.includedByDefault`, `platforms.instagram.planFeatures`,
`instagram.policy`, `instagram.appSecret`. The three installation/access keys are
honestly marked configured pending host installation; policy/secret have active
runtime consumers. Existing Facebook settings and CONFIG_SCHEMA_VERSION are unchanged.

## Host installation follow-up — 2026-10-21

This section supersedes the staged-host statements above for source only.
Instagram is now in `PLATFORM_MODULES` and `PLATFORM_HOSTS`. The installation
switch still defaults to **false**. Do not enable production writes until the
remaining integration and live-verification gates below pass.

Implemented installation steps:

1. `connection.ts` enters through the existing confirmed Settings connection-start
   service (browser, session REST and session MCP). It discovers only enabled,
   selected Pages in the authorized workspace, rechecks manager/access/source
   binding after discovery, encrypts credentials and persists separate provider
   `instagram` sources, targets and account rows. New destinations are unselected.
   Existing matching historical destinations are normalized without taking another
   source's destination. Legacy storage kind `instagram` maps to adapter kind
   `professional` inside this module. `selection.ts` keeps account selection aligned
   through the existing shared selection service. Existing disconnect handles the
   new sources/accounts. There is no callback mutation or alternate OAuth service.
2. `host.ts` assembles provider-owned connection, Publishing, Inbox, stored Analytics
   and Analytics worker hooks. Shared registration performs no provider branching.
   `source-binding.ts` revalidates the selected linked Page, workspace, source,
   grants, expiry, revocation and exact current credential before provider use and
   sync persistence. Parent deselection/disconnect/token rotation makes the clone
   unusable. Physical legacy `social_accounts.meta` holds the source binding via
   tenant-scoped SQL because the rebuild compatibility Prisma model omits `meta`.
3. Existing product services retain actor permissions, credential ceilings, tenant
   checks, confirmations, claims and audit. Inbox supports comments on app-published
   destinations, replies, hide/unhide and durable shared deletion. Analytics reads
   stored metrics/audience with raw provenance and missing values preserved; bounded
   reads refuse truncation. The background account/profile collector uses current
   qualified workspace owners, checks stale bindings before/after persistence and
   performs provider reads outside persistence locks. No fake human worker actor.
4. Production adapter construction injects `container-journal.ts`: every child,
   parent container and media_publish intent commits before remote dispatch, with
   each returned identity saved immediately. The shared publication attempt remains
   the resend fence. A second attempt cannot bypass an old publish intent by generic
   absence attestation. Confirmed child receipts survive source revocation.
   `container-recovery.ts` supplies exact final-receipt matching, unknown-dispatch
   refusal, cleanup fencing and bounded private evidence for the shared recovery
   registry. **That registry integration is outside this lane and still required.**
   A PUBLISHED container or failed lookup never authorizes a resend. Unknown lost
   publish responses remain held; this batch does not infer a final media identity.

Existing shared surface mapping (add these rows to `docs/MCP_PARITY.md`):

| Capability | UI / REST / MCP shared entry | Instagram host |
| --- | --- | --- |
| Connection start/discovery | Connections / POST `/api/oauth/connections/[platform]/start` (compatibility `/api/connections/[platform]/start`) / `start_connection` → `startConnection` with `START CONNECTION instagram` | `instagramConnection.start` |
| Selection/disconnect | Connections / Settings connections routes / installed Settings connection tools → `changeConnectionSelections` / `changeConnectionDisconnect` | existing services plus `alignInstagramSelection`; provider `instagram` sources |
| Publishing/status/first comment | Publishing / installed publishing REST routes / installed Publishing MCP → existing Publishing services | `configuredInstagramAdapter` with durable claims/journal and status policy fingerprint |
| Comment sync/reply/moderation/delete | Inbox / installed Inbox REST routes / installed Inbox MCP → existing Inbox services | `instagramInboxHost` |
| Stored Analytics | Analytics / installed Analytics REST routes / installed Analytics MCP → shared catalog | `instagramAnalyticsHost`; `syncInstagramAnalytics` worker |

Required edits outside the owned paths:

- `src/server/platforms/publication-recovery.ts`: import
  `instagramPublicationRecovery` from `@/platforms/instagram/container-recovery`
  and register `instagram: instagramPublicationRecovery` in `RECOVERY_HOSTS`.
  Keep it installed even when the customer switch is off. This connects exact
  receipt constraints, cleanup protection and evidence to existing Root surfaces.
- Shared Publishing/media owner: implement tenant-bound, expiring signed HTTPS
  delivery of stored media through the neutral media pipeline and route, then
  resolve `media:<id>` for URL-fetching adapters. Current shared local-image
  validation correctly refuses Instagram uploads. Public external HTTPS image/video
  URLs work; this lane neither exposes private files nor pretends bytes are URLs.
- Documentation owner: update `ARCHITECTURE.md`, `GOAL.md`, `DELIVERY_PLAN.md`,
  `AGENT_HANDOFF.md`, `LEGACY_CAPABILITY_PARITY.md` and `MCP_PARITY.md` with this
  default-off source status, surface mapping, verification and remaining gates.
- Integrator owns the registry schema bump. No top-level Root keys were added;
  existing `instagram.policy` gains `connectionMaxPages`,
  `inboxReplyMaxCharacters`, `analyticsLookbackDays`, `analyticsReadMaxRows` and
  bilingual permission/recovery copy. Older policies gain validated defaults.

Remaining gaps: signed local-media delivery and recovery-host registration above;
unknown-response recovery requiring externally verified identity; Inbox background
sync; external/provider-only media comment storage; media insights/history backfill;
actual PostgreSQL concurrency, browser/EN-FR/theme checks and live Graph/UI/REST/MCP
verification with cleanup. A parent source that is removed makes future clone
operations fail closed; existing cloned connection rows remain available for local
retain/delete management. Stored historical insights without provenance stay
non-additive. No media deletion, native scheduling, direct messages or Ads are
promised. No new screen/UI source changed, so there is no new visual design claim.

Fresh local verification for this host batch (synthetic/mocked only):

- From `rebuild/`, `npx tsc --noEmit -p .`: pass, zero errors.
- Targeted Instagram, parity-guard and config-validation checks with `--no-cache`:
  12 files, 140 tests passed (including parity 22/22 and config 7/7).
- `npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts" --no-cache`:
  641 files passed, one failed, 49 skipped; 9,861 tests passed, five failed,
  2,055 skipped. All five failures are `facebook-native-http.test.ts` loopback
  listeners denied by this sandbox (`listen EPERM ::1`). The full suite is **not
  green**; rerun in an environment allowing its local test sockets.
- `git diff --check`: pass. No servers, deployment, provider/production calls,
  commits or pushes. Changes remain in this worktree for integration.
