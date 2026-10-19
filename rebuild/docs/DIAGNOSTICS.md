# Private Root diagnostics

Diagnostics belong to the same module organization as settings:

- Shared controls → Operations: database read, registered shared configuration, in-memory encryption, media-directory permissions and replacement-worker health.
- Product modules → chosen module: owned configuration and background work declared by its manifest.
- Platform modules → Facebook: owned configuration, connection setup, authenticated identity, current requested grants, Page discovery and ad-account discovery for one selected connection.

Open the contextual sidebar to choose a recent connection and run checks. On phones this is the existing Menu & filters drawer; submission closes it and focuses result feedback. Root can test an installed platform before exposing it to customers. This does not enable or add customer resources. Connections outside the bounded recent picker can be tested by exact ID through HTTP/MCP.

Each result has Pass, Fail or Skipped status, safe code/message and duration. Recent runs expand to their recorded checks. An unconfirmed completion remains visible; keep a returned receipt if its completion audit failed. Inspect current state/history before repeating an unconfirmed request. Changing the selected connection does not erase earlier results or bypass the scope-wide cooldown.

## Controls and authorization

Registry version 35 owns diagnostic availability, cooldown, total suite deadline, incomplete-run recovery, database probe/audit timeout and history limits. It also controls replacement heartbeat freshness, recent job limits and the operational display timezone. See [ROOT_RUNTIME_CONFIG.md](ROOT_RUNTIME_CONFIG.md). Date presentation uses an explicit IANA timezone; API timestamps remain ISO UTC.

Only active installation owners with fully verified sessions can use the UI, HTTP or installation MCP. Workspace roles and workspace API keys cannot acquire this access. Services recheck current authority; runs also check authority while recording the start. HTTP writes require same origin. MCP and the shared service require exact `RUN DIAGNOSTICS <scope>` confirmation.

A PostgreSQL advisory transaction lock serializes starts per installed scope. A start audit must commit before any checks. Cooldown spans owners, transports and connection IDs. Each start stores its recovery age, at least its original suite deadline plus two database timeouts; shortening current settings cannot shorten that protection. Expired incomplete runs can be retried. No arbitrary URLs, scripts or executable arguments are accepted. Publishing also owns a fixed availability check for its trusted, Root-configured video metadata probe; see [MEDIA_INSPECTION.md](MEDIA_INSPECTION.md).

The total deadline covers preparation and check execution. Facebook transports combine the suite signal with their ordinary request timeout and reject redirects; later checks are skipped after a deadline. Database probes and audit transactions have their own statement/transaction limits. Ordinary configuration/history reads retain existing driver behavior, and not every database read promise is actively cancellable. This is not a process-kill or an external job runner.

## Interfaces

- `GET /api/root/diagnostics?scope=shared`
- `POST /api/root/diagnostics` with `{scope, connectionId?, confirmation}`
- `GET /api/root/operations?moduleId=inbox` (module optional)
- MCP tools `get_root_diagnostics`, `run_root_diagnostics`, `get_root_operations`
- MCP resources `msp://root/diagnostics`, `msp://root/operations`

Scopes come from installed manifests: `shared`, `product:<id>`, `platform:<id>`. All entry points share services and use no-store responses. Stored provider errors, worker summaries, tokens, connection credentials and worker hostnames are excluded from returned diagnostics/telemetry. Audit intent/results are stored in existing `root_activities`; this batch adds no application DDL.

## Limits of evidence

Database read success does not prove every schema or permission. Media checks verify directory permissions, not uploaded file integrity, capacity or remote storage. Encryption checks verify an in-memory round trip; module configuration checks separately validate decryptability of saved secrets. Diagnostics themselves require database-backed authentication/configuration/audits, so a database outage may prevent the diagnostic surface from loading.

Facebook setup presence does not prove remote app approval or callback registration. Identity/grant/discovery checks do not prove every selected channel/ad account or publishing, media, inbox, analytics and spend-changing operation. Discovery counts are the returned bounded set, not a promise that every possible resource was fetched. No resources are added, content published, messages sent or ads changed by these checks.

Worker reads use `rebuild_sync_runs` and heartbeat identities in the persisted `rebuild-` namespace. They never attribute a legacy worker or shared provider job to a specific platform. Missing tables/store failures are unavailable; missing heartbeat and missing run coverage are different states. Job labels and schedule ownership come from product manifests. Root’s `jobs.order` preserves the prior dispatch priority by default and lets operators reorder installed jobs without editing source.

The local preview uses fake encrypted credentials and `.invalid` endpoints. Its remote-read failures are expected, and no successful live-provider claim follows from fixture tests. Complete operation diagnostics, live-provider evidence, scheduled diagnostic jobs, production-volume query/index review, broader Root operator controls and production cutover remain unfinished.
