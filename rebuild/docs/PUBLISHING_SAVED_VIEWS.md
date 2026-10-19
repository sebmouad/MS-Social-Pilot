# Publishing saved views

Status: implemented source with unit tests; no browser, PostgreSQL or live evidence yet.

Legacy parity: `src/app/api/saved-views` and `src/components/SavedViews.tsx` let a person save
named Posts/Calendar filter combinations. The rebuild reuses the existing `saved_views` table
(legacy migration `20261019090000_saved_views`); no new migration.

- Pure rules and en/fr copy: `src/modules/publishing/saved-views.ts`. Only whitelisted,
  single-valued filters are stored (Posts: `view`, `status`, `channel`, `q`; Calendar: `view`,
  `status`, `channel`). Dates and paging are not saved. Max 60-character names, 50 views per
  person per screen (module-owned bounds).
- Service: `src/modules/publishing/server/saved-views.ts`. Every read/write is bound to the
  acting user and workspace; current Posts/Calendar read authorization is rechecked. Creation
  counts under a per-person advisory lock. Deletion needs `DELETE SAVED VIEW <id>`.
  A stored channel never grants access: the page re-applies channel scope on open.
- Surfaces: sidebar `src/modules/publishing/ui/SavedViews.tsx` (Posts and Calendar only),
  HTTP `GET/POST /api/publishing/saved-views`, `DELETE /api/publishing/saved-views/<id>`
  (same-origin), MCP `list_saved_views`, `create_saved_view`, `delete_saved_view`
  (classified workspace-wide, so selected-resource keys cannot use them).
- Tests: `tests/publishing-saved-views.test.ts`.

Open: actual PostgreSQL test against `saved_views`, browser theme/phone checks, Root-managed
bounds (currently module constants), and the rebuild has no locale switch yet, so French copy
is selected from the document/browser language.
