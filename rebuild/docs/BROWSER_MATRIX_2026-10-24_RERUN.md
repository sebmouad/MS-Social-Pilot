# Browser matrix rerun — 2026-10-24 (v2 scope, fresh QA schema)

Rerun of the v2 design-area matrix on preview `:3200` after the QA database
rebuild (`scripts/dev/qa-db.sh`: fresh migrate 6/6 + reseed) and batches
12–16. Sign-in via `http://localhost:3200` (127.0.0.1 fails the origin
check).

## Runs

| Run | Scope | Cells | Cell findings | Verdict |
| --- | --- | --- | --- | --- |
| v2 full | all routes | 544/544 | 208 | FAIL (environmental) |
| v2b | /content, /insights, /root/lifecycle, /root/users, /settings/channels/groups | 224/224 | 30 | FAIL (environmental) |
| v2c | /content/library | 32/32 | 6 | FAIL (environmental) |
| v2d | /content/library, fresh preview | 32/32 | 0 | PASS |

## Triage

Every cell finding in v2/v2b/v2c was a preview-dev-server transport flap:
`net::ERR_CONNECTION_REFUSED` and `net::ERR_INCOMPLETE_CHUNKED_ENCODING`
on first-compile routes under matrix load, plus downstream
`ROUTE_CHECK_FAILED` / `MAIN_ACTION_UNVERIFIED` on pages that never loaded
(one 60s `page.goto` timeout on `/content`). Zero overflow findings (batch
12 holds — 0 failure screenshots), zero contrast/keyboard/a11y findings,
zero app-logic findings.

V2b cleared 8 of the 9 flapped v2 routes. `/content/library` (clean 8/8 in
v2) flapped twice more, then passed 32/32 with 0 findings after a preview
restart (v2d). Matrix effectively green: every route passed clean in at
least one stable run.

Triage note: the report's top-level `failures` field includes `fatal
MISSING_ROUTE_FAMILY` entries in scoped (`MATRIX_ONLY`) runs — always
recount from cell findings (v2c: field said 13, cells held 6; v2d: field
said 7, cells held 0).

## Wave screenshots (`docs/waves-2026-10-24/`, 1440px, vivid)

Pixel-verified: posts list Reach column + planned/published counts
(`content-posts`), inbox message content + Messages/Comments split
(`inbox`), comment content + origin-post card + Open post (`inbox-comments`,
batch 10), post detail (`post-detail`), compare layout (`compare`), pins
empty state (`pins`), queue slot row + timetable (`queue`). Captured but
not pixel-read: `ads-manage`, `insights` (both passed the matrix).
