# Legacy sweep status updates, lane q-13 (2026-10-21)

The sweep file `LEGACY_SWEEP_2026-10-21.md` is not tracked in this branch, so these are the cell changes to merge into it.
Evidence kind: source plus unit tests with mocks (`tests/facebook-data-callbacks.test.ts`, route and page smoke). No PostgreSQL, browser, Meta dashboard or production run.

| Sweep row | Old status | New status |
| --- | --- | --- |
| Gap 1; route `api/facebook/data-deletion`, `deauthorize` | missing | **done at source** at `POST /api/platforms/facebook/deauthorize` and `/data-deletion`. The Meta dashboard still holds the legacy URLs and must be changed to these (owner action) |
| Page `data-deletion` (gap 2, one of seven) | missing | **done at source**: public `/data-deletion?code=` status page, EN/FR |
| Still missing from gap 2 | | `/privacy-policy`, `/terms`, `/help`, `/pricing`, `/changelog`, `/status`, `operator.*`/`site.public` keys. Meta app review still needs a privacy URL |

## Behaviour

- Platform-owned: `src/platforms/facebook/data-callbacks.ts` verifies Meta's `signed_request` (HMAC-SHA256 with Root `meta.appSecret`, constant-time compare, numeric `user_id` only).
- Neutral host: optional `PlatformHost.dataCallbacks`, `platformDataCallbacks(provider)` (not gated by the Root enable switch, so a removal request is honoured while the module is off), shared transport `src/server/platforms/data-callbacks-http.ts` (form body only, per-client rate limit from `security.apiRequestsPerMinute`, 400/401/404/429, deauthorize answers 200 on internal faults as Meta expects).
- Deauthorize: flags the person's Facebook connections invalid in every workspace and audits (`platform.deauthorized`).
- Data deletion: per connection, in one transaction, clears tokens, disables channels, cancels `pending` and `scheduled_remote` destinations locally, marks the connection invalid and audits with a confirmation code (`platform.data_deletion`). Published posts, insights and conversations are kept as the workspace's records. Remote Facebook schedules are **not** cancelled (the token is gone), and `processing` destinations are left to fail on their own.
- Status page discloses only a count and a date for a valid code.

## Gaps not closed

- Page copy is a local EN/FR constant in `src/app/data-deletion/page.tsx`, not a Root-managed catalog.
- `security.apiRequestsPerMinute` is still marked `planned` in `shared-config.ts`; the callbacks now consume it, so its `consumption` should become `active`.
- No `/api/health` (gap 6), no error/alert recorder (gap 3): not started.
