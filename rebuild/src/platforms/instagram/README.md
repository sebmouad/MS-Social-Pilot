# Instagram adapter — staged, not customer activated

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

## Integration work outside this worker's owned paths

`src/platforms/index.ts` registers settings and exports the staged manifest, but
intentionally does not insert it in PLATFORM_MODULES. The shared host is a required
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
