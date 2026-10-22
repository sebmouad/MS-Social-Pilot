# Legacy data migration audit

Updated 2026-10-21 against source HEAD `a597dcb6`. Prerequisite for deleting the
legacy app or any legacy table. This is a source and catalog audit: **no database
was queried by the author**, so every count, orphan and constraint result below is
still to be produced by running the audit on a restored production copy.

## What "migrated" means here

The rebuild does not copy rows. It runs against the same PostgreSQL database as the
legacy app and reads or writes the legacy tables in place, through its Prisma client
view (`prisma/schema.prisma`, 29 models) and raw SQL in module `server/` code
([DATA_COMPATIBILITY.md](DATA_COMPATIBILITY.md)). The root `prisma/schema.prisma`
holds **94 models**. For each, the table below states one of:

| Disposition | Meaning | Count |
| --- | --- | --- |
| `in_place` | Rebuild reads/writes the table. Data is kept, nothing to copy. | 70 |
| `export_purge_only` | Rebuild counts, exports and erases it; no product reader. | 2 |
| `needed_unbuilt` | Customer data the rebuild has no feature for yet. Keep; do not drop. | 15 |
| `obsolete_candidate` | Operational history with no reader or writer. Owner decision, export first. | 4 |
| `obsolete_replaced` | Superseded by a rebuild table. Retire only after backup and verification. | 3 |

The single source of truth is `scripts/legacy-data-manifest.ts`.
`tests/legacy-data-manifest.test.ts` fails when a model is added to, removed from or
renamed in the root schema, or when a `workspaceId` column changes, without the
manifest being updated. Evidence for each `in_place` row is a rebuild source
reference (Prisma model, or a `FROM`/`JOIN`/`INTO`/`UPDATE` statement in module code,
found by search at this HEAD). It shows the code path exists, not that production
rows pass through it.

## Tables

### In place, read and written by the rebuild (87)

Prisma view (24): `users`, `sessions`, `workspaces`, `memberships`, `passkeys`,
`recovery_codes`, `mcp_api_keys`, `app_settings`, `workspace_data_purges`,
`social_accounts`, `targets`, `instagram_accounts`, `instagram_media`,
`instagram_insights`, `ad_accounts`, `ad_insights`, `posts`, `post_targets`,
`conversations`, `conversation_messages`, `post_comments`, `page_insights`,
`saved_views`, `report_runs`.

Raw SQL (60): `email_tokens` and `invitations` and `trusted_devices` (Settings),
`plans` (entitlements), `page_groups`, `page_group_targets`, `member_page_access`,
`post_versions`, `post_notes`, `post_labels`, `labels`, `custom_fields`,
`post_field_values`, `queue_slots`, `content_mix_rules`, `post_templates`, `media`,
`short_links`, `link_clicks`, `review_decisions`, `external_posts`, `feed_sources`,
`feed_items`, `bio_pages`, `bio_links`, `share_links`, `tasks`, `page_reviews`,
`inbox_notes`, `saved_replies`, `moderation_rules`, `moderation_actions`,
`page_goals`, `report_templates`, `report_schedules`, `notification_settings`,
`notification_mutes`, `email_logs`, `activity_logs`, `webhook_endpoints`,
`webhook_deliveries`, `root_activities`, `worker_heartbeats`, `ai_agents`,
`ai_generations`, `ai_videos` (AI), `calendar_feeds`, `caption_tests`,
`chart_notes`, `chat_channels`, `client_invitations`, `key_dates`,
`seasonal_modes`, `public_holidays`, `holiday_years`, `trending_topics`
(calendar extras, chat, agency), `worker_job_runs` (jobs runtime),
`graph_usage` (platforms/facebook), `uptime_days`, `changelog_entries` (Root).
The last seventeen moved here in lane 47 when their rebuild readers were
verified; they were previously `needed_unbuilt` or `obsolete_candidate`.

Read-only for Root (3): `backup_runs`, `system_alerts`, `error_events`. The rebuild
has no writer, so new rows stop appearing after cutover; that is a capability gap,
not a data loss.

Caveats worth acting on:

- `media`: rows point to files under `storage.mediaRoot`. Row counts do not prove
  files exist; use `verify-legacy-migration.ts` with the restored media root.
- `trusted_devices`: source only deletes rows on security changes; no reader found.
- `email_logs`, `error_events`, `system_alerts`, `backup_runs`: old rows are history.
- `app_settings`: legacy-only keys are kept; typed keys are Root settings
  (the one-time importer is retired).

### Export and purge only (2)

`metric_availability`, `page_videos`: referenced only by `server/data-control`. No
product screen reads them. Keep until an owner decides the data has no value.

### Needed, feature unbuilt (0): all resolved in lane 47

Thirteen tables moved to `in_place` when their rebuild readers were verified
(calendar extras, caption tests, chat deliveries, agency, AI router, Root
changelog): `ai_agents`, `ai_generations`, `ai_videos`, `calendar_feeds`,
`caption_tests`, `chart_notes`, `chat_channels`, `client_invitations`,
`key_dates`, `seasonal_modes`, `public_holidays`, `holiday_years`,
`trending_topics`. Two tables were dropped (see below): `api_tokens`,
`snippets`.

### Obsolete candidates (0): all resolved in lane 47

All four now have rebuild readers and moved to `in_place`: `worker_job_runs`
(jobs runtime appends), `graph_usage` (platforms/facebook counters),
`uptime_days` (operator monitoring), `changelog_entries` (Root changelog).

### Dropped by the lane-47 server cleanup (5)

Determined by comparing the 127 production tables against the rebuild
`schema.prisma` mappings and verifying zero rebuild source references. All
drops run inside one transaction after a fresh `pg_dump`; row counts are
printed before dropping. Production audit counts (2026-10-22) are shown.

| Table | Replacement / note | Rows |
| --- | --- | --- |
| `workspace_exports` | Old rows replaced by the async ZIP service (`rebuild_workspace_exports`) | 1 |
| `OAuthClient` | Not migrated; legacy OAuth clients must re-register (`mcp_oauth_clients`) | 0 |
| `OAuthCode` | Replaced by `mcp_oauth_codes`; export/erase hooks removed first | 0 |
| `api_tokens` | Legacy REST tokens, never honoured by the rebuild; zero rows, zero references | 0 |
| `snippets` | Superseded by `post_templates`; zero rows, zero references | 0 |

The single `workspace_exports` row is an old export record; its files (if any)
are removed through the storage cleanup, not by dropping the table alone.
`OAuthCode` was dropped together with `OAuthClient` in one `DROP TABLE`
statement because of the `OAuthCode.clientId` foreign key; no other inbound
foreign key points at a dropped table, and no `rebuild_*` table references one.

### Tables outside the legacy schema

Rebuild-owned tables (`rebuild_*`, `mcp_oauth_*`, `person_mcp_keys`, `task_comments`,
`wordpress_recipe_*`, `ads_objects`, `_prisma_migrations`) are created by additive
migrations and are not legacy data; ownership is in
[`../src/server/data-control/README.md`](../src/server/data-control/README.md). Any
other table is reported as **unclassified** and fails the audit until classified.

## Verification SQL

All statements are read-only and run inside `BEGIN READ ONLY … ROLLBACK`. Print the
full set, one block per table, with `npx tsx scripts/legacy-data-audit.ts --sql`.

Row count (every table in the manifest):

```sql
SELECT count(*)::text AS n FROM public."<table>";
```

Workspace orphans (only tables with a `workspaceId` column;
`email_logs.workspaceId` is nullable):

```sql
SELECT count(*)::text AS n
FROM public."<table>" x
LEFT JOIN public.workspaces w ON w.id = x."workspaceId"
WHERE x."workspaceId" IS NOT NULL AND w.id IS NULL;
```

Unclassified and missing tables:

```sql
SELECT tablename AS table_name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;
```

The script compares this list with the manifest and the rebuild-owned name patterns.

Unvalidated constraints (any row is a failure):

```sql
SELECT conrelid::regclass::text AS table_name, conname
FROM pg_constraint WHERE NOT convalidated ORDER BY 1, 2;
```

Inbound foreign keys into a table, reported for every table that is not `in_place`
(a drop must not cascade into live data):

```sql
SELECT conrelid::regclass::text AS from_table, conname
FROM pg_constraint
WHERE contype = 'f' AND confrelid = 'public."<table>"'::regclass ORDER BY 1, 2;
```

Foreign keys held by rebuild-owned tables, to confirm none depends on a table slated
for retirement:

```sql
SELECT c.conrelid::regclass::text AS from_table, c.confrelid::regclass::text AS to_table, c.conname
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.conrelid::regclass::text ~ '^(rebuild_|mcp_oauth_|person_mcp_keys|task_comments|wordpress_recipe_|ads_objects)'
ORDER BY 1, 2;
```

## Running the audit

```
cd rebuild
LEGACY_AUDIT_DATABASE_URL='postgresql://…/<name>_rehearsal' npx tsx scripts/legacy-data-audit.ts
```

- Refuses anything but a loopback `_preview` or `_rehearsal` database, reusing
  `guardedUrl` from `verify-legacy-migration.ts`. Run it on a restored copy of the
  pre-cutover backup, not on production.
- One server-enforced `READ ONLY` transaction, 60 s statement timeout. Output is
  JSON of counts and table names only, never row content. Exit code 1 on failure.
- Per table: `rows`, `workspaceOrphans`, `gate` (`keep`, `decision_required`,
  `retire_after_backup`) and `inboundForeignKeys`. Report-level: `unclassifiedTables`,
  `missingTables` (informational on a fresh database), `invalidConstraints`,
  `rebuildForeignKeys`, `failures`.
- Complements `verify-legacy-migration.ts`, which proves counts against a baseline
  and checks media files, enums and required columns. This audit adds
  classification, orphan, dependency and deletion-gate evidence.

## Gates before deleting legacy (satisfied by lane 47)

1. Backup taken and restored to a scratch database before the cleanup script
   runs; the drops print their row counts first. Pre-removal backup:
   `/var/backups/legacy-removal-202610221216`, restore verified.
2. Every `needed_unbuilt` table with rows was kept by moving it to `in_place`
   (readers verified); the two empty ones were dropped.
3. `api_tokens`: zero rows; legacy REST tokens were never honoured by the
   rebuild. Owner accepted the break by approving the legacy removal.
4. `obsolete_candidate` tables: all four now have rebuild readers; none dropped.
5. `obsolete_replaced` tables: the `OAuthCode` account-deletion hook and the
   export/erase hooks were removed before the drop; `workspace_exports` files
   (if any) go through the storage cleanup, not the table drop.
6. No `rebuild_*` foreign key points at a dropped table (verified from the
   migration sources; the only inbound FK is `OAuthCode` → `OAuthClient`,
   dropped together).
7. The drops run in `scripts/server-legacy-cleanup.sh`, one transaction after a
   fresh dump — not as a migration — so production and fresh installs keep the
   same additive history. Deleting the legacy **application** code did not
   require dropping any table the rebuild reads: the rebuild reads them in place.

## Not established here

- Orphan results and constraint state on production (row counts were read;
  see below).
- That the rebuild's raw SQL paths work against production-shaped rows beyond
  existing synthetic tests.
- `LEGACY_SWEEP_2026-10-21.md` is the source for the unbuilt-feature list; its
  `needed_unbuilt` and `obsolete` judgments were re-checked against rebuild source
  references only.

## Production row counts (2026-10-22, read-only)

Zero rows: `ai_agents`, `ai_generations`, `ai_videos`, `api_tokens`, `calendar_feeds`,
`caption_tests`, `chart_notes`, `chat_channels`, `client_invitations`, `snippets`,
`key_dates`, `seasonal_modes`, `changelog_entries`, `page_videos`, `OAuthClient`, `OAuthCode`.
With rows: `trending_topics` 30, `public_holidays` 66, `holiday_years` 6,
`metric_availability` 1456, `worker_job_runs` 39, `uptime_days` 18, `graph_usage` 1,
`workspace_exports` 1. The planning reference rows (trends, holidays) are read
in place by calendar extras (verified in lane 47).
