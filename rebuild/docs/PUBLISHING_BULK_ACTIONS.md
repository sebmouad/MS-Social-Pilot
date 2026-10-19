# Publishing bulk actions and publication retry

Status: implemented source with unit tests; no browser, PostgreSQL or live-provider evidence yet.

- Rules/copy (en+fr): `src/modules/publishing/bulk.ts`. Actions `delete`, `duplicate`,
  `reschedule`, `retry`; up to 50 unique posts; confirmation `<ACTION> <n> POSTS`.
- Service: `src/modules/publishing/server/bulk.ts`. Checks Posts write access once to refuse
  early, then runs every post through its existing single-post service, one at a time:
  `deletePost(…, false)` (local only; removing a post from a platform stays a separate
  per-post choice), `duplicatePost` (the per-post request ID is derived from the bulk
  `requestId`, so replaying a request creates no extra drafts),
  `reschedulePost` (workspace time zone), `publishPost(…, { retryOnly: true })`.
  Each per-post service re-checks role, authorship, channel scope and state. A refusal for
  the post's current state is reported as skipped; any other refusal is failed; an
  unexpected error is reported as needs review, never as done.
- Retry: `publishPost` gains a `retryOnly` option, checked inside the publication lock:
  it refuses any post that is not failed or partially failed. The shared publisher only
  claims destinations with status `failed` and no remote ID. It holds any destination
  with an unresolved attempt (started, submitted, receipt recorded). So uncertain or
  submitted results are never sent again.
- Surfaces: a Table-view checkbox column plus the `BulkPostActions` toolbar with a
  confirmation dialog (`src/modules/publishing/ui/posts/BulkPostActions.tsx`); a per-post
  "Retry failed destinations" control in `PostActions.tsx`; `POST /api/publishing/posts/bulk`
  (same-origin only); MCP `bulk_post_action` (workspace-wide class, so keys limited to
  selected channels or ad accounts cannot use it).
- Tests: `tests/publishing-bulk.test.ts`.

Open: actual PostgreSQL and browser checks; the per-post retry uses `window.confirm` rather
than the shared dialog; Feed/Cards views have no selection; async large exports; REST v1.
