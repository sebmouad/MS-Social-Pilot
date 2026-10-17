# Core workflows local probe

`scripts/verify-core-workflows.ts` runs synthetic-only HTTP, PostgreSQL and
workspace MCP checks against the dedicated localhost preview. Both
`REBUILD_PREVIEW_DATABASE_URL` and `REBUILD_PREVIEW_ORIGIN` must be explicit.
The database must exactly match `DATABASE_URL`, use loopback PostgreSQL and have
an `_preview` database name; the canonical origin must be `http://localhost:3200`.
`NODE_ENV` must not be production. These guards run before any fixture writes.

From `rebuild/`, run it with the local preview environment file without printing that file or any loaded environment values:

```sh
node --env-file=/private/tmp/socialpilot-rebuild-preview.env --import tsx --input-type=module -e 'process.env.REBUILD_PREVIEW_DATABASE_URL = process.env.DATABASE_URL; process.env.REBUILD_PREVIEW_ORIGIN = "http://localhost:3200"; await import("./scripts/verify-core-workflows.ts");'
```

It briefly enables the required Root feature and platform settings through the local Root API, creates uniquely named throwaway users, two workspaces, workspace-scoped API keys, synthetic local channels/conversations, and labels, then exercises:

- Workspace time zone and approval policy updates through HTTP and MCP, including exact-confirmation and read-only-key denials. Synthetic pending draft and scheduled posts verify disabling approval releases them to `draft`/`scheduled`, clears pending approval state, preserves review metadata, and writes exact release counts to the audit.
- Template create/read/update/delete through HTTP and MCP, with workspace labels, cross-workspace reads/updates, read-only write denial, and failed foreign-label transaction rollback.
- Inbox assignment, private notes and saved replies through HTTP and MCP, with active and foreign assignee checks, tenant isolation, private-note audit redaction, and read-only write denial.
- Stored record and audit checks, followed by deletion of all fixture workspaces/users/keys/audits and exact restoration of every Root setting row captured before the probe.

The probe makes no mail or provider requests and creates no published content. It verifies local HTTP/MCP/database integration only; it is not browser evidence, live provider evidence, production evidence, or a concurrency/load test. If any cleanup or setting-restoration assertion fails, stop and inspect the disposable `_preview` database before running the probe again.

Executed successfully on 2026-10-17 with actual local HTTP/Root/MCP/PostgreSQL
checks and exact fixture/settings cleanup. The run found and drove fixes for
Prisma void advisory-lock results and enum-typed approval release statements.
This is synthetic local integration proof, not production or provider proof.
