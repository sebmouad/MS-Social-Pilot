# Current workspace access for provider collectors — batch 60

## Decision and ownership

The user chose **any active workspace owner's qualifying plan/access** for
automatic synchronization on 2026-10-17. This differs from legacy's first-owner
subscriber selection in `src/lib/plans.ts`. It changes background sync only;
customer UI/API/MCP still authorize their actual current member and scoped key.
It does not introduce a workspace subscription or change billing.

`server/jobs/access.ts` checks active owner memberships in the exact workspace,
then consumes the existing entitlement resolver with
`allowInstallationInspection: false`. One owner must have both the requested
platform and at least one requested product feature. Provider access from one
owner cannot combine with product access from another. Suspended workspaces,
missing/ineligible owners, invalid policy and over-ceiling owner sets fail
closed. Existing no-plan/default-inclusion semantics are inherited from the
entitlement resolver; this is not a new promise of a paid subscription.

The shared helper has no provider-specific scope, credential, metric or transport
logic. Facebook owns its four collectors and their operation mappings:

| Collector | Required product access from the qualifying owner |
| --- | --- |
| Remote scheduled status | Publishing posts |
| Page insights | Analytics overview |
| Ad account insights | Analytics overview **or** Ads overview |
| Inbox | Inbox conversations |

Any/all owner selection and owner inspection ceilings are Root-managed Shared
settings. The default is the user's selected any-owner rule; the all-owner option
is an explicit stricter installation policy. Unknown/malformed values never
silently become the permissive default.

## Current state and resource fencing

Candidate reads carry identities rather than cached credentials. Inside the
workspace guard and selected-resource lock, each provider attempt—including a
retry—loads current workspace access, platform enablement, selected resource,
same-workspace Facebook connection, credential, expiry and required provider
grants. Engines are constructed with current Root configuration and cancellation
signals. Original job time never substitutes for current credential expiry time.
Remote identity predicates prevent a changed target/post binding from projecting
an older read onto a different publication.

After provider reads, access and binding are checked again before local
persistence and immediately before commit after the write loop. Mutations use
the resource transaction's client. Successful update
counts reflect committed batches, not writes later rolled back. Expected access
denial, stale selection and try-lock contention count as skipped; operational
configuration/database/provider failures remain failed. Partial provider metric
failures retain their existing explicit failure count alongside committed values.

`server/platforms/resource-lock.ts` defines neutral, workspace/kind/ID advisory
keys, sorted/deduplicated for multi-resource operations. Collectors, channel/ad-
account selection, disconnect retain/delete and Facebook discovery/reconnection
share this protocol. Reconnection locks existing source-bound resources before
rotating credentials. A contested collector/mutation is refused with a retry
path; it does not wait while holding a conflicting second resource lock.

Lock order is workspace guard, selected resource, then existing post/publishing
or Inbox channel locks where needed. Inbox holds its channel lock across reads
and persistence, preserving deletion tombstone ordering. All collector writes
use the locked transaction. The operation cancellation signal and transaction
deadline prevent a late read from writing through an already expired client.
Selection/disconnection cannot race the collector and resurrect deleted rows.

Root policy changes are checked at operation/retry/persistence boundaries.
They do not recall an HTTP request already sent or retroactively remove stored
history. This is not a globally linearizable policy-switch/cancellation protocol.
Other legacy/manual collectors must be reviewed independently; this batch does
not claim that every background job uses the new boundary.

## Root configuration — registry 55

| Owner | Key | Default |
| --- | --- | --- |
| Shared jobs | `jobs.workspaceOwnerPolicy` | `any_active_owner` |
| Shared jobs | `jobs.workspaceOwnerLimit` | 100 active owners, accepted 1–1,000 |
| Shared sync | `sync.resourceOperationTimeoutMs` | 60,000 |
| Shared sync | `sync.resourceOperationMaxWaitMs` | 2,000 |
| Shared sync | `sync.resourceFinalizationGraceMs` | 5,000 |
| Facebook | `meta.pageInsightReadScopes` | `read_insights`, `pages_read_engagement` |
| Facebook | `meta.pageAnalyticsLookbackDays` | 7 inclusive UTC days |
| Facebook | `meta.adsAnalyticsLookbackDays` | 30 inclusive UTC days |

The resource deadline, acquisition wait and finalization grace together must be
strictly smaller than `data.workspaceOperationTimeoutMs`; incompatible values
fail before provider IO. Root validates each saved key; this cross-key budget
constraint is enforced at the consumer, and an atomic multi-key budget editor
remains work. The provider owns lookback limits (1–366 days), Page
read grants and their OAuth scope request. These replace the collector's former
hardcoded 7/30-day windows. Configuring a scope does not grant it or prove app
review. Broader history is limited by what the real provider returns; no complete
metric/history coverage is implied by a configured window.

## Evidence and remaining scope

See PREVIEW_QA.md for actual focused/full tests, two-client PostgreSQL conflict
and timeout checks, real owner-plan SQL behavior, browser Root visibility and
cleanup evidence. These checks use synthetic records and stubbed provider reads;
they are not live Facebook collection evidence. No production setting, provider
content, migration or deployment changes. Full Facebook collection formats,
native publishing, Inbox discovery, Ads management, callback lifecycle,
remaining legacy/MCP parity and all cutover gates remain required.
