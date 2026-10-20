# Root audit export and retention

Private installation-owner controls on `/root/activity` now prepare a CSV and
manage retention, export bounds and batch bounds. Disabled users are denied by
the services. Workspace administration does not grant Root access.

`GET /api/root/activity/export` accepts only `q`, `workspaceId`, `from`, `to`.
The reader's literal search and inclusive UTC calendar dates apply. Pagination
parameters are rejected. The export covers **root_activities only**, exactly the
existing reader's scope; it is not a workspace audit archive. A single ordered
query fetches limit+1, refuses oversized matches, then uses the reader's safe
metadata allowlist. Actor identity is retained just as in the reader. CSV cells
are quoted and formula prefixes neutralized. No raw detail is exported. Successful
preparation records `root.activity.exported` with a row count, never filters or
CSV contents; failure to write that audit prevents delivery. Exported means
prepared, not proof the browser saved a file. Responses are no-store.

## Settings

`ROOT_AUDIT_CONFIG` in `src/server/root/audit-config.ts` declares:

| Key | Default | Range |
| --- | --- | --- |
| root.auditExportMaxRows | 10000 | 1–100000 |
| root.auditRetentionDays | 0 (forever/off) | 0–36500 |
| root.auditRetentionBatchSize | 1000 | 1–10000 |

The Activity page supplies owner-only, validated, audited settings controls.
A local validated appSetting reader consumes these entries until the host adds
`ROOT_AUDIT_CONFIG` to its central registry and increments its schema version.
The registry is deliberately unchanged in this batch. Do not register duplicate
keys. Settings changes and retention share a transaction advisory lock so a
completed disable cannot be followed by pruning with stale configuration.

## Worker

The existing leased `purges` job runs retention before workspace purge recovery.
Retention 0 does no deletion and records one disabled-run summary. Each enabled run atomically
deletes at most one configured batch **per table** from `root_activities` and
`activity_logs`, then writes one `root.audit.retention` summary (cutoff, days,
counts). Rows strictly older than `now - days * 24 hours` qualify; the exact
boundary survives. Stable ordered selection, SKIP LOCKED and a transaction
advisory lock bound work and serialize retention calls. Audit failure rolls back
deletions. Repeated jobs drain backlog; one run is not proof of complete expiry.
No other history tables or provider records are pruned. No migrations are needed.

## Evidence and remaining work

Unit coverage exercises reader redaction, CSV quoting/formulas, filters, complete
or refused limits, owner authorization, default-off retention, batch SQL and
summary recording. The guarded PostgreSQL test uses connection-local temporary
tables, shadows actual audit tables and leaves installed audit history untouched.
It is skipped without REBUILD_PREVIEW_DATABASE_URL; no database, browser, live
MCP or production verification is claimed. Production-volume query planning,
central registry aggregation and MCP host wiring remain open. No servers or
production jobs were started.

## MCP host addition (not applied)

Import `exportRootActivity` from `../audit-export` in the legacy Root MCP file.
Add this read-only definition (the service records preparation only):

```ts
{
  name: 'export_root_activity',
  description: 'Complete redacted Root audit CSV with workspace, inclusive UTC dates and literal search filters. Oversized results are refused. Installation owner only; workspace API keys cannot use this tool.',
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string' },
      workspaceId: { type: 'string' },
      from: { type: 'string', description: 'Inclusive UTC YYYY-MM-DD' },
      to: { type: 'string', description: 'Inclusive UTC YYYY-MM-DD' },
    },
    additionalProperties: false,
  },
},
```

Inside the existing installation-owner-only execution switch:

```ts
case 'export_root_activity': return exportRootActivity(id, args);
```
