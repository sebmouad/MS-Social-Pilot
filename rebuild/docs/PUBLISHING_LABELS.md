# Publishing labels

Workspace labels group posts for filtering and planning. This slice uses the existing legacy tables; it adds no schema migration.

## Stored relationships and delete effects

- `labels` is unique on `(workspaceId, name)` and its `workspaceId` cascades with workspace removal.
- `post_labels` has `ON DELETE CASCADE` from both post and label. Deleting a label removes only its association rows; posts remain. Usage counts join through `posts` and count only records owned by the label's workspace. Mutations fail closed if legacy data contains a cross-workspace post-label link, because deleting that label would otherwise cascade into another workspace's rows.
- `post_templates.labelId` is nullable and uses `ON DELETE SET NULL`; templates and their content remain.
- `content_mix_rules.labelId` uses `ON DELETE CASCADE`; affected rules are removed.

Rename and delete review show these workspace-local consequences. Channel-restricted users see hidden counts and cannot perform changes that affect every channel. Labels use the independent `publishing/labels` installation switch while their entitlement/role policy maps to the existing publishing posts permission.

## Bounds and validation

`LABEL_CONFIG` owns six Root settings with typed module defaults. Service code validates every current value against the same module-owned bounds before using it; corrupt or out-of-range Root values fail closed. The safe parser ceilings are the Root maximums (120 name characters and 500 search characters), then current settings apply dynamically. The UI receives those active bounds from the server for input limits. Pagination, mutation schemas, HTTP query/body shape, and MCP inputs reject unknown or unsafe values. Label names are trimmed, controls rejected, and uniqueness is checked case-insensitively within the workspace, with database uniqueness races mapped to a conflict.

Colours are a finite presentation vocabulary stored as text in the legacy table. Existing label colours are not rewritten by this feature.

## Mutations and recovery

Create, rename, and delete use a workspace advisory lock and one transaction; actor membership and permissions are checked again inside it. SQL is parameterized and workspace scoped. Every row-changing statement and audit insert must report exactly one affected row. Audit failure aborts the transaction. Exact confirmations are `CREATE LABEL <name>`, `UPDATE LABEL <id>`, and `DELETE LABEL <id>`.

The UI validates the full server receipt before updating its local list, preserves drafts on failure, prevents duplicate requests, and tells the user to refresh and inspect current state if a result cannot be confirmed. It does not assume a failed response means the transaction rolled back.

## Surfaces

- UI: `/publishing/labels` with paginated search, usage table, and reviewed create/edit/delete dialogs.
- API: `GET/POST /api/publishing/labels`, `PUT/DELETE /api/publishing/labels/[id]` (same-origin writes, strict query/body shape, no-store responses).
- MCP module: `list_post_labels`, `create_post_label`, `update_post_label`, `delete_post_label` from `labels-mcp.ts`; central host registration is handled by the integration owner.
- Root settings: `LABEL_CONFIG` (`publishing.label*`, six active keys).

Assigning labels in the post composer and bulk assignment are separate integration work; this feature only manages the shared label vocabulary.
