# Labels and Analytics Explorer local probe

Status: **prepared, not executed**. This script is intended for the disposable local preview only. Provider-free unit tests are separate evidence; the probe will exercise live local HTTP, PostgreSQL and MCP paths with synthetic fixtures after the parent confirms configuration changes are quiescent.

## Guardrails

`scripts/verify-labels-explorer.ts` requires `REBUILD_PREVIEW_DATABASE_URL` to exactly match `DATABASE_URL`, a loopback PostgreSQL URL whose database name ends in `_preview`, non-production mode, and exactly `http://localhost:3200`. It checks the preview endpoint and all required legacy tables before writing any fixture rows. It does not start or contact a provider, visit a browser, send email, publish content, or alter customer records.

The probe creates uniquely named synthetic users, two disposable workspaces, sessions, one scoped MCP key, stored Facebook Page insight rows, posts, labels and related template/content-mix rows. Root feature and MCP settings are snapshotted with their full stored row, changed through the Root API, restored exactly in `finally`, and verified. Only Root audit rows created by this run are removed. Workspace fixtures are deleted and checked for residue. Probe output contains stage-level outcomes only; errors, credentials and record contents are withheld.

## Coverage

- Labels API create, list counts, rename, foreign-workspace list/delete denial, and delete receipt against the legacy cascade/`SET NULL` effects for `post_labels`, `post_templates.labelId`, and `content_mix_rules.labelId`.
- Stored Analytics Explorer observations through HTTP and MCP, with channel selection and a cross-workspace resource denial.
- Labels and Explorer HTTP/MCP denial while each installation feature switch is off.
- Workspace-local label audit entries and preservation of the foreign tenant's label.
- Exact Root setting restoration and synthetic fixture cleanup verification.

## Run when authorized by the parent

Use the existing local environment only after any concurrent probe/configuration run has finished:

```sh
node --env-file=/private/tmp/socialpilot-rebuild-preview.env --import tsx --input-type=module -e 'process.env.REBUILD_PREVIEW_DATABASE_URL = process.env.DATABASE_URL; process.env.REBUILD_PREVIEW_ORIGIN = "http://localhost:3200"; await import("./scripts/verify-labels-explorer.ts");'
```

Passing this guarded synthetic probe is local API/database/MCP evidence. It does not replace focused provider-free tests or browser verification and is not production evidence.

Executed successfully on 2026-10-17. The real local HTTP, MCP and PostgreSQL
checks passed, including feature denial and exact settings/fixture restoration.
No provider calls or customer records were involved.
