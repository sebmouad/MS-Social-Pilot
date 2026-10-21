# Release gates runbook

Status: **cutover recorded; full release gates remain incomplete.** Updated
2026-10-21 against local HEAD `6fb0e57f`. The owner-recorded cutover on
2026-10-20 22:09 CEST put the rebuild at `https://social.newsgeet.com`, with
legacy web/worker disabled. Releases use `rebuild/scripts/prod-deploy.sh`;
legacy `socialpilot-deploy` is guarded. See the dated results below and
[CUTOVER.md](CUTOVER.md). This documentation pass made no production calls.

Sections A–C retain the original 2026-10-20 pre-cutover plan and assumptions as
historical procedures, not current host state or instructions to replay cutover.
The results log records backup, migration, health, sign-in, provider reads and
recipe planning outcomes; it does not establish every contract gate passed.
Mail/live delivery, complete Facebook write/MCP verification and cleanup, current
browser/authorization coverage, exact-release recovery and a post-cutover rollback
drill remain evidence gaps. Revalidate deployed SHA, migration state and ownership
before a later release; historical migration counts/ports are not current policy.
The binding [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) is unchanged.

Legend: **[OWNER]** needs the owner (credentials, host, approval, a decision).
**[AGENT]** can be done by a coding session once its inputs exist. **[GATE]** a
pass/fail checkpoint; record evidence, never contents of tokens or customer rows.

Order: A (live Facebook) and B (migration/rollback rehearsal) are independent and
can run in parallel; C (cutover) needs both to pass, plus gates 1-4 of the contract
(parity inventory, functional, authorization, browser), which are tracked elsewhere.

## Original pre-cutover assumptions (historical; superseded where results differ)

- Rebuild listens on 3200; legacy on 3100 behind OpenLiteSpeed. No rebuild systemd
  units or proxy switch are checked in. `scripts/deploy/rebuild-deploy.sh` and
  `rebuild-rollback.sh` are guards that exit 78 and change nothing.
- Legacy deploy (`remote-swap.sh`): backup via `/usr/local/sbin/ms-social-pilot-backup`,
  `prisma migrate deploy`, swap `/srv/ms-social-pilot` <-> `.prev`, restart units
  `social-pilot` and `social-pilot-worker`, health on 3100. Rebuild worker is
  `npm run worker` (`rebuild/scripts/worker.ts`), lease-based per job
  (`sync.workerLeaseMinutes`), owner prefix `REBUILD_WORKER_PREFIX`.
- Browser matrix: 328/328 on the dev server with synthetic data (WAVE1_VERIFICATION.md).
  Not production build, not Root routes, not live provider data.
- Migration pin drift: `rebuild/scripts/cutover-rehearsal.sh` pins **29** files, while
  CUTOVER.md prose still says 17. These exist in `prisma/migrations` but are **not
  pinned**: `20261030120000_rebuild_workspace_watermark`,
  `20261030130000_rebuild_comment_sentiment`, `20261030130000_rebuild_person_mcp_keys`,
  `20261030140000_rebuild_facebook_native_schedule_changes`. Several are marked
  unapplied/unrehearsed in their batch notes (some may live only on other branches).
  The legacy-numbered files (`20261019090000_saved_views` ... `20261022100000_changelog`)
  are not in the rebuild allowlist; confirm they are already applied in production's
  `_prisma_migrations`. **B0 below resolves this before any rehearsal.**

---

## A. Live Facebook test gate

Goal: replace mocked-Graph evidence with cleaned, outcome-verified live evidence for
every capability the rebuild advertises. Native formats stay default-off
(`facebook.native.publishingEnabled=false`) until their own live rows pass.

### A0. What the owner must provide  **[OWNER]**

1. **Meta app** the rebuild will use (not necessarily the legacy one): App ID, app
   secret, and its mode. Record which permissions are granted *and approved for live
   mode* versus dev-mode-only (publishing, Page read engagement/insights, messaging,
   `ads_read`, and `ads_management` only if Ads writes are in scope). App Review
   status gates what can be tested with non-role users. The Meta Social Technologies
   connector (`devtools_app`, `devtools_app_review`, `devtools_api_usage`) can read
   this once the owner authorizes it; an agent cannot authorize it.
2. **A dedicated test Page that is not Cuisine Pleine d'Envie** (the held-canary Page,
   see A9) and holds no customer audience. The tester must hold a role that grants
   publish, moderate and insights. Provide Page ID and exact name. A throwaway
   Instagram-free Page is preferred; do not reuse any Page with real followers.
3. **A test ad account** (or explicit decision to skip Ads writes) with a hard low
   spend limit, and a decision: paused-only creation (recommended) vs. any
   delivery. No active spend without the owner's per-run approval.
4. **Connection through the rebuild's own flow**: the owner signs in to a staging
   rebuild (loopback or isolated host, synthetic or sanitized database), runs the
   connection OAuth, and selects only the test Page / ad account in the discovery
   modal. Tokens are stored encrypted by the app; nothing is pasted into chat or
   files. Root provider settings (endpoint/version, app ID/secret, scopes, OAuth
   redirect) are set in Root, not env, per the configuration contract.
5. **A second Facebook identity** (test user or tester role) able to comment/message
   the test Page, to create real inbound comments and a conversation for Inbox.
6. **Webhook decision** (if Inbox is to be tested through webhooks rather than
   polling): a public HTTPS callback for staging. Otherwise test polling only and
   record webhooks as untested.
7. **Written ack** that identifiable test content may be posted on that Page and
   deleted afterwards (already authorized in AGENTS.md; restate Page ID per run).
8. A named **pre-check**: Chrome access to the owner's authenticated Facebook for
   visual cleanup confirmation (the canary note says it was disabled). Without it,
   visual confirmation is marked pending, not passed.

### A1. Preflight  **[AGENT]**

- Run `npm run typecheck` and the full suite from `rebuild/` with local PostgreSQL.
- Root diagnostics: Facebook API connectivity, native policy snapshot, media probe.
  A connectivity pass does not prove any operation.
- Capture connection state: token expiry, granted scopes, selected resources only.
  Confirm the held-canary Page is **not selected** in this workspace.
- Mark all test records with a run label, e.g. `MSP-LIVE-<yyyymmdd>-<n>`, in captions,
  post titles, ad object names and comment text. Keep a run ledger (IDs and states
  only) outside Git, mode 0600, one directory per run, written before each remote
  write (follow the pattern in `scripts/verify-facebook-live-media.mjs`).

### A2. Capability matrix

Each row: drive it through the **rebuild's** UI/API (and MCP where noted), then verify
on Facebook independently (Graph read with the Page token, plus the owner's browser
if available), then clean up. A row passes only with both app state and Facebook state
agreeing. "Uncertain" never counts as pass and is never retried blindly.

| # | Capability | Test content | Outcome verification | Cleanup |
| --- | --- | --- | --- | --- |
| 1 | Connect + discovery + selection | Test Page only | Selected list equals expectation; unselected resources absent from product screens/MCP | Disconnect in A8 |
| 2 | Publish text post (feed) | Run-labelled caption | Stored remote ID; Graph read shows published, exact message; per-destination status `published` | Delete via app with "delete remote too"; Graph read afterwards is *not* proof alone (Graph 100/subcode 33 is unknown), so confirm explicit delete receipt in app plus visual check |
| 3 | Publish image post, link post | Generated PNG fixture (from the canary tool; no customer media) | Same as 2, plus attachment present | Same |
| 4 | Provider-held schedule vs. app-queue schedule | Post scheduled a few minutes ahead | Status moves scheduled -> published at the time; worker is sole publisher (C1) | Same; cancel one scheduled copy before it fires and verify it never publishes |
| 5 | Status read / submitted reconciliation | A post kept `submitted` (video) | Reconciliation only marks published on positive exact-identity read | Same |
| 6 | First comment, immediate and delayed | Run-labelled comment | Comment appears under the exact post ID; receipt stored; rejected case retried only via the confirmed retry action | Delete comment, then post |
| 7 | Remote delete (explicit checkbox) + partial/uncertain handling | A published post | Explicit `success: true`; app shows per-destination result; post not in Page feed | n/a (is the cleanup) |
| 8 | Native formats (one at a time, switch on only for the run): Video, Reel, Photo Story, Video Story | Short generated clips (the fixture used for the media inspector: 16x16 1 s MP4 is too small for Reel limits; generate a vertical clip within the Root limits) | Walk the nine-item list at the end of FACEBOOK_NATIVE_FORMATS.md Batch99: scopes, resumable phases, `publishing_phase`, Stories edge visibility/expiry, schedule limits, cancel/reschedule bodies, media limits, throttle codes, comment/delete shapes per format. Record Root-accepted native proof per submission; status never promoted by observation alone | Delete where the format allows it; **Stories cannot be remotely deleted by the app and expire**: record the expiry time as the cleanup evidence, and verify visually |
| 9 | Inbox: sync comments and messages, reply, hide/delete, resolve/reopen, moderation rule run | Comments/messages from the second identity | Reply visible on Facebook; hidden state matches; messaging reply window enforced; action history rows | Delete test comments; leave no open conversations |
| 10 | Analytics read | Page-level and post-level metrics for the test Page | Compare stored series with the same metrics read directly; coverage/freshness fields correct; missing = unknown not zero; a brand-new Page may return little, so also run the check against an older owner-approved Page that is **read-only** (analytics reads only, never publish) | None (read only) |
| 11 | Ads read | Ad account listing, campaigns/ad sets/ads, insights | Counts and spend equal Ads Manager for the test account; currency handled | None |
| 12 | Ads write (only if owner approves) | One paused campaign + ad set (+ ad if creative flow in scope), spend cap minimal, run-labelled names | Objects exist, `PAUSED`, exact budget; confirmation text appears for the spend-changing action | Delete or archive objects; verify deleted; confirm zero spend |
| 13 | Token renewal / expiry | Use Root connection refresh on the test connection | Renewed/not_renewable/failed outcome matches Graph debug_token | n/a |
| 14 | Disconnect, retain vs delete data choice | The test connection | Choice shown with real consequences; app does not claim remote revocation unless Meta revoked it; related data matches the choice | Reconnect if later rows need it |
| 15 | MCP parity for rows 2, 6, 7, 9, 10, 11 | Restricted resource-scoped key limited to the test Page | Same results as UI; key cannot see other resources; write needs confirmation; audit row written | Revoke the key |

Rows 8 and 12 are the highest risk. Do not enable native formats or Ads writes for
customers on the basis of the rest of the matrix.

### A3. Held-canary constraints (must be preserved)

From FACEBOOK_LIVE_MEDIA_CANARY.md and AGENTS.md:

- The Cuisine Pleine d'Envie Page has an unresolved `held_photo_cleanup`: two generated
  photos whose DELETE returned Graph 400/100/subcode 33 (unconfirmed, no explicit
  receipt). Ledger and hashed Page lock live on the legacy host at
  `/root/socialpilot-rebuild-canary-ledgers/…` (run `2453cc2b-…`); probe files in
  `/tmp/socialpilot-media55-*`. **Do not** delete the ledger or lock, run a new canary on
  that Page, blindly retry the photo DELETEs, or treat "unreadable" as "deleted".
- The live matrix above must therefore use a different Page (A0.2), and the rebuild
  workspace used for it must not have that Page selected. Do not point the new
  tooling at the legacy host's credential bridge.
- **Resolution path [OWNER]**: the owner visually inspects the Page's photos/albums in
  an authenticated browser (Activity log / Photos). Outcomes: (a) both photos absent
  -> record an attested resolution through the Root media-resolution action
  (migration `…rebuild_facebook_media_resolution` ledger, exact IDs, attestor
  recorded) and only then release the lock; (b) present -> owner deletes them in
  Facebook UI or approves one new, explicitly scoped cleanup intent via the existing
  guarded path; (c) cannot tell -> leave held. Resolution is not a precondition for
  the live matrix, but it is a precondition for declaring photo cleanup reliable and
  for any production Root cleanup policy being enabled.

### A4. Gate A pass criteria  **[GATE]**

- Every advertised capability row passes with both app and Facebook evidence, or is
  explicitly left unadvertised (hidden from customers) and listed as a gap.
- Zero run-labelled objects remain (posts, comments, photos/videos, ad objects),
  verified by Graph listing *and* visual check; Stories recorded by expiry.
- No `uncertain`/`held` row left unexplained; any left is listed with its ledger.
- No token, secret or customer record in logs, reports or Git. Evidence summary goes
  into this plan's results section or LEGACY_CAPABILITY_PARITY.md as counts and IDs
  redacted to run label.

---

## B. Production-shaped migration and rollback rehearsal

### B0. Reconcile the migration set  **[AGENT]**

1. List `prisma/migrations` directories and diff against the 29 pinned in
   `rebuild/scripts/cutover-rehearsal.sh` and the `_prisma_migrations` contents of the
   sanitized dump (below). Decide for each unpinned rebuild migration listed under
   "Pin drift" whether it ships in this release; if yes, backup/scratch-restore it,
   pin its SHA-256 in the script and its test, add mapped-column checks, and update
   the CUTOVER.md prose (17 -> actual).
2. Confirm which legacy-numbered migrations production already has. The rehearsal
   refuses migration history already present for rebuild objects; legacy files are
   applied by the legacy deploy, so the rebuild allowlist must start from "everything
   the legacy production release has".
3. Confirm every rebuild migration is additive and legacy-rollback compatible (the
   legacy app must still run against the migrated schema). Flag any CHECK-constraint
   widening that legacy writes could violate, and the submitted-receipt note in
   CUTOVER.md ("do not narrow allowed states on rollback").

### B1. Inputs  **[OWNER]**

1. **Sanitized dump** of production: `pg_dump -Fc` taken read-only on the production
   host (or from the nightly `ms-social-pilot-backup` output, `db-*.dump`), then
   sanitized off-host by the owner's process (strip or scramble credentials, tokens,
   password hashes, passkeys, emails/names, message and comment bodies as policy
   requires; keep row counts, relationships, enums, JSON shapes and legacy edge cases
   such as null expiries and legacy post formats). Sanitization is an owner
   attestation: the script only checks `CUTOVER_DUMP_SANITIZED=YES`.
   It must be **pre-migration** (legacy schema only; no rebuild tables).
2. **Restored media tree** matching that dump (uploaded images/videos, library files,
   `<workspace>/images/<uuid>` files), on a local path, sanitized if media is
   sensitive. State the production media root path and ownership.
3. **Legacy environment values** needed by `import-legacy-config.ts`: `APP_URL`,
   `SECURITY_TWO_STEP`, `LOGIN_ATTEMPTS`, `LOGIN_WINDOW_MINUTES` and Meta credentials
   (provided to the host process, never pasted). Production legacy release hash and
   confirmation that the previous release directory remains.
4. A **loopback PostgreSQL 16** with admin URL ending in `/postgres` (local machine or
   isolated staging host) and `psql`, `pg_restore`, `pg_dump` installed.

### B2. Schema rehearsal  **[AGENT after B1]**

```sh
cd rebuild
export CUTOVER_STAGING_DUMP=/abs/path/sanitized-prod.dump
export CUTOVER_ADMIN_URL=postgresql://postgres:***@127.0.0.1:5432/postgres
export CUTOVER_DUMP_SANITIZED=YES            # only after the owner's sanitization review
export CUTOVER_APPROVED_MIGRATION_SET="$(sed -n "s/^approved_migrations='\(.*\)'$/\1/p" scripts/cutover-rehearsal.sh)"
bash scripts/cutover-rehearsal.sh
```

(Use the set the script itself defines, updated per B0.) Pass: output ends
`CUTOVER_REHEARSAL_OK`; every pinned checksum verified; mapped columns and enum labels
verified; public-table counts equal between source scratch and independently
backed-up/restored scratch; scratch databases dropped. This repeats the schema-only
result with real rows, which is new evidence.

### B3. Data migration verification  **[AGENT]**

Create a long-lived copy (database name ending `_rehearsal`, loopback only), then:

```sh
cd rebuild
# 1. baseline from the pre-migration copy
DATABASE_URL=postgresql://…/prodshape_rehearsal \
  TSX_TSCONFIG_PATH=tsconfig.json node --import tsx scripts/verify-legacy-migration.ts --snapshot \
  > $SCRATCH/legacy-source-counts.json
# 2. apply the approved migrations to that copy in allowlist order (psql -v ON_ERROR_STOP=1 -1 -f each),
#    then rehearse configuration import (dry run first, then --apply)
DATABASE_URL=… TSX_TSCONFIG_PATH=tsconfig.json node --import tsx scripts/import-legacy-config.ts
DATABASE_URL=… TSX_TSCONFIG_PATH=tsconfig.json node --import tsx scripts/import-legacy-config.ts --apply
# 3. verify against baseline and restored media
DATABASE_URL=… APP_URL=… SECURITY_TWO_STEP=… LOGIN_ATTEMPTS=… LOGIN_WINDOW_MINUTES=… \
  TSX_TSCONFIG_PATH=tsconfig.json node --import tsx scripts/verify-legacy-migration.ts \
  --baseline $SCRATCH/legacy-source-counts.json --media-root /abs/restored-media \
  > $SCRATCH/legacy-migration-report.json
```

Pass: exit 0 and `ok: true`; no missing tables or changed counts; the only count
deltas are documented additions (migration history, config-import audit/config rows)
listed in a separately reviewed expected-delta manifest (never re-snapshot the target
to hide drift); all `posts.media_reference_present` and other media checks pass with
the real media root (the synthetic run's single failure was an intentionally empty
root); orphans, workspace-boundary, destination, membership and MCP scope checks pass;
imported settings present and secrets are encrypted envelopes. Then **[AGENT]** start
the rebuild app (production build, port 3200, loopback) on that copy and run
`scripts/deploy/rebuild-verify-staging.sh` plus an authenticated walk-through: sign in
with a migrated owner (including 2FA/passkey behaviour where enrolled), open each
route, check per-role and cross-workspace denial against migrated memberships, upload
and preview a migrated image, schedule and cancel a post (no provider), export and
erase on a **scratch copy of the copy**. Re-run the browser matrix
(`scripts/verify-browser-matrix.ts`) against this production build including Root.
Not proven by B3: bytes/checksums of media, provider token validity (needs A).

### B4. Volume check  **[AGENT]**

```sh
cd rebuild
DATABASE_URL=postgresql://…/volume_rehearsal VOLUME_PROBE_SCALE=1 npx tsx scripts/volume-probe.ts
```

Needs a `_rehearsal` loopback DB; it seeds synthetic rows inside one transaction and
rolls back, with 120 s statement timeout. Pass: completes with no timeout and every
captured heavy query (audit, posts, targets, conversations, insights tables) within
the thresholds the probe reports; also run at `VOLUME_PROBE_SCALE=3` to see headroom.
**[OWNER]** may supply real production table cardinalities so scale matches reality
(production had ~9.9k Page insight rows and 2 workspaces on 2026-10-15, so 1x is
heavily conservative).

### B5. Backup and restore for the exact release  **[OWNER host + AGENT script review]**

On the production host, in a maintenance-safe window and without changing services:

1. Run `/usr/local/sbin/ms-social-pilot-backup`; record artifact name, size, SHA-256,
   timestamp. Restore into a temporary database with
   `pg_restore --exit-on-error`; compare per-table counts with live; drop it.
   (Previously done only for `db-20261015-0415.dump`; repeat for the cutover backup,
   taken immediately before cutover, in C2.)
2. Back up the **media root** and the env/config files (without displaying them);
   restore into a scratch path and compare file counts and a sample of checksums.
3. Record: legacy release hash, location of `/srv/ms-social-pilot` and `.prev`,
   current systemd unit definitions, OpenLiteSpeed vhost/proxy config path and the
   reload command. Provide these to the repo as reviewed files (see C3).

### B6. Rollback drill  **[OWNER host, AGENT writes scripts]**

Rehearse on staging first (a second host or the same host on alternate ports with a
cloned proxy vhost), then once on production *without* switching real traffic.

1. **Service/proxy**: with the rebuild running on 3200 and the proxy pointing at it,
   switch the proxy back to 3100, reload OpenLiteSpeed, restart `social-pilot` and
   `social-pilot-worker` (legacy), verify `127.0.0.1:3100/api/health` and the public
   health endpoint, sign-in, and that the legacy worker is the only scheduler.
   Pass: public health 200 within the agreed seconds; no request errors beyond the
   switch window; rebuild units stopped so only one worker runs.
2. **Data**: perform some writes on the rebuild side (draft, comment, setting change),
   then roll back to legacy and confirm legacy still starts and reads/writes against the
   migrated (additive) schema; list rebuild-side writes since cutover from audit rows to
   decide preservation. Restoring the database from backup is *not* part of the default
   rollback; rehearse it only on a scratch copy and record how long it takes and what
   is lost.
3. **Submitted receipts**: confirm the rollback runbook states not to narrow allowed
   publication states while submitted receipts exist.
4. Record timings for each step; the sum is the rollback RTO that the go/no-go uses.

### Gate B pass criteria  **[GATE]**

B2, B3, B4 pass; B5 artifacts verified; B6 completes with recorded timings and legacy
healthy afterwards; evidence written (counts, hashes, timings, no row contents).

---

## C. Cutover

Preconditions: contract gates 1-4 signed off (parity inventory, functional,
authorization, browser including a production build and Root), Gate A passed for
every capability being enabled, Gate B passed. Owner approval is required to start;
nothing here is run by an agent unattended.

### C1. Single-publisher strategy  **[OWNER decision, AGENT implements]**

Rule: exactly one process family may publish or sync at any time.

- Default plan: **replace, not coexist.** At cutover stop `social-pilot-worker` (legacy)
  and start the rebuild worker (`npm run worker`, its own unit). Do not run both:
  the legacy worker does not take the rebuild's job leases and the rebuild's publication
  claims (partial unique index on active attempts per post-target) do not protect
  against the legacy publisher.
- Before the switch, **drain**: no posts with a due time in the cutover window; legacy
  queue rows `publishing`/in-flight finished or reconciled; list posts scheduled in the
  next 24 h and verify the rebuild's queue reads them (status mapping of legacy
  `scheduled`/`publishing`/`failed`), with a test that a legacy-scheduled post publishes
  exactly once from the rebuild worker on staging (provider mocked or A-gate Page).
- The legacy unit is `disable`d (not just stopped) so a reboot cannot revive it;
  rollback re-enables it only after the rebuild worker is stopped (B6 order).
- Add a startup guard in the rebuild worker/units: refuse to start while the legacy
  worker unit is active (systemd `Conflicts=social-pilot-worker.service` in the new unit).
- Verify after switch: one worker process, lease rows owned by one owner prefix, no
  publication attempt with two owners, run history shows each scheduled job once.

### C2. Cutover sequence  **[OWNER approves each step; AGENT prepares scripts]**

1. Freeze: announce window; confirm no deploys in flight; record legacy hash.
2. Backup: `ms-social-pilot-backup`; verify artifact + restore check (B5.1); back up
   media and env. Stop here if any check fails.
3. Stage the immutable release with `scripts/deploy/rebuild-stage.sh` (build, root
   lockfile, Prisma client, `rebuild/` build) to a new directory, tagged with the git SHA.
4. Apply **only** the approved additive migrations (the B2-verified set, in order, one
   transaction each) and run `import-legacy-config.ts --apply`. Run
   `verify-legacy-migration.ts` with the cutover baseline; stop on failure. Legacy stays
   serving through this because the changes are additive.
5. Start rebuild web on 3200 under its reviewed systemd unit; health check; Root
   diagnostics (database, config, mail, Facebook connectivity).
6. Smoke on 3200 directly (loopback): sign-in with 2FA, one read per module, one
   draft write and delete. No provider writes yet.
7. Stop legacy worker, start rebuild worker (C1). Switch the OpenLiteSpeed upstream from
   3100 to 3200, graceful reload.
8. Validate public: `/api/health`, sign-in, a representative read/write per module,
   the worker's first scheduled run, one real scheduled post to the owner's test Page
   (run-labelled, then deleted), an incoming Facebook webhook/poll if configured.
9. Observe window (owner-defined, e.g. 24-48 h): watch worker run history, failed
   publications, error rate, health, disk/db. Keep legacy directory, units and the
   backup untouched.
10. Close: owner signs off; only then schedule cleanup of legacy artifacts.

### C3. `socialpilot-deploy` rewiring  **[AGENT after Gate B, OWNER approval]**

At plan-writing time, `socialpilot-deploy` (installed from `scripts/deploy/server-deploy.sh`) and
`deploy.sh` deploy the legacy package; the `rebuild-deploy.sh` and `rebuild-rollback.sh`
guards exit 78. Rewiring work, done only after the host files exist and are reviewed:

- Check in reviewed `deploy/` artifacts: rebuild web and worker systemd units
  (`Conflicts=` legacy worker, env file path, user `socialpilot`, restart policy),
  OpenLiteSpeed proxy config for 3200 and the reload command, backup hook, media path.
- Replace the guard in `rebuild-deploy.sh` with: lock (`/run/socialpilot-deploy.lock`
  pattern from `server-deploy.sh`), backup + verify, stage by SHA, additive migrate,
  start on 3200, health, proxy switch, post-switch health with automatic revert to
  legacy on failure. Replace `rebuild-rollback.sh` with the C4 procedure.
- Only then change the installed `/usr/local/sbin/socialpilot-deploy` target to rebuild,
  keeping `--status` and a clearly named `--legacy` path until the observation window
  ends. A deploy of a legacy ref must be impossible to confuse with a rebuild deploy.
- Update CUTOVER.md and ARCHITECTURE.md in the same change (AGENTS.md rule).

### C4. Rollback procedure (production)  **[OWNER on call]**

Triggers: failed health after the switch, publish failures/duplicates, data integrity
errors, or owner call. Steps (as rehearsed in B6): (1) stop the rebuild worker;
(2) switch the proxy upstream to 3100 and reload; (3) re-enable and start legacy
worker and web; (4) verify public health and sign-in; (5) diff rebuild-side writes
since cutover and decide preservation; (6) database restore only by separate decision.

### C5. Go / no-go checklist  **[OWNER decides]**

Original pre-cutover acceptance checklist: all were required for go. Cutover
occurred as recorded below; that event does not retrospectively prove these
checks passed. Continue tracking unresolved contract gates on the actual release.
The chosen deployment path is now `rebuild/scripts/prod-deploy.sh`, with legacy
command guarded; the C3 rewiring proposal is historical.

1. Parity inventory complete and reviewed; no inert controls, no advertised-but-unverified
   capability (native formats and Ads writes off unless Gate A rows passed).
2. Authorization suite covers anonymous, roles, resource scope, cross-workspace, API
   keys, Root boundary across UI/API/MCP; passing on the release SHA.
3. Browser matrix passes on the **production build** including Root, with failure-state
   and keyboard checks; full suite, typecheck, build clean on the release SHA, run
   against real PostgreSQL with zero skips.
4. Gate A: live matrix passed and cleaned for every enabled capability; held-canary
   Page unchanged or resolved per A3; no live run left uncertain.
5. Gate B: migration/data/media/config verification `ok`; volume probe passed; backup
   restorable; rollback drill timed and green.
6. Single publisher mechanism implemented and tested (C1); legacy worker disable plan
   agreed.
7. Host files (units, proxy config, reload, media path, env) reviewed and checked in;
   deploy script rewritten per C3 but not yet repointed.
8. Exact release SHA pushed to `origin/main` and verified; backup taken minutes before;
   owner on call for the observation window; communication to users sent if needed.
9. Rollback RTO acceptable to the owner and the abort criteria for the first hours
   written down.

## Owner action list (condensed)

1. Provide/authorize: Meta app credentials in Root, test Page (not the canary Page),
   test ad account and spend policy, second Facebook identity, optional webhook URL.
2. Decide the canary resolution path (A3) and allow authenticated-browser inspection.
3. Provide sanitized pre-migration production dump, restored media, legacy env values,
   legacy release hash and host details (units, proxy, reload, media path).
4. Run or approve the production-host steps in B5, B6 and C2; choose the observation
   window; approve single-publisher replacement (C1); approve `socialpilot-deploy`
   rewiring (C3); make the final go/no-go call (C5).

## Results log

Empty. Record date, SHA, gate, pass/fail, evidence location and open issues here as
each gate is actually run; never claim a gate from this plan alone.

## Results log — 2026-10-20

- **Backup (B5, part):** `/var/backups/socialpilot-precutover-20261020-164633` on the
  production host: `social_pilot.dump`, `media.tgz` (240 MB), `release.tgz` (370 MB),
  `app.env`, `SHA256SUMS`. Not yet restore-tested on a separate host.
- **Production-copy migration rehearsal (B2–B3): PASS.** `rebuild/scripts/prod-rehearsal.sh`
  restored a fresh `pg_dump` of live `social_pilot` into scratch `social_pilot_rehearsal`
  on the server (row counts matched live), then applied every repository migration not
  yet recorded in `_prisma_migrations`: 91 already present, **34 applied, 0 failed**,
  116 tables after. Live services stayed active throughout; live data untouched.
- **Finding fixed during rehearsal:** name order is not dependency order. The rebuild
  migrations must follow the reviewed order in `cutover-rehearsal.sh`, after production's
  missing legacy migrations; four newer rebuild migrations (watermark, comment sentiment,
  person MCP keys, native schedule changes) run last and still need pinning there.
- Not yet run: migration verifier and volume probe against the scratch copy, rollback
  drill (B6), live Facebook gate (A), cutover (C).
- **Staging and rollback drill (B6): PASS** with `rebuild/scripts/prod-stage-drill.sh` at
  `c802becc`: the rebuild was built on the production host, started as transient unit
  `social-pilot-rebuild-drill` on 127.0.0.1:3110 against the scratch rehearsal database,
  answered `/sign-in` 200 and its public API, then was stopped and removed. Legacy
  `social-pilot` and `social-pilot-worker` stayed active with unchanged start times
  (never restarted); the public site kept answering. The first drill found a production
  `next build` type failure (`src/app/root/config/page.tsx`), fixed in `c802becc`.

## Production cutover — 2026-10-20 22:09 CEST

- **Commit:** `5f1e52d7a39062c2b29df9974ec2b1f38546269b`, run by owner via `rebuild/scripts/prod-cutover.sh`.
- **Fresh backup:** `/var/backups/socialpilot-cutover-20261020-220930` (dump sha256 `d80b51ae…cd9f7a`).
- **Build:** OK. Legacy worker stopped first (single publisher). 34 migrations applied to live `social_pilot`.
- **Health:** local `/sign-in` 200, API probe OK, public `/sign-in` 200 → `CUTOVER COMPLETE`.
- **Services:** `social-pilot-rebuild` + `social-pilot-rebuild-worker` active/enabled; legacy `social-pilot` + worker inactive/disabled. Legacy release kept at `/srv/ms-social-pilot` for rollback.
- **Post-check (orchestrator, public):** `/sign-in`, `/home`, `/api/auth/register` all 200.
- **Open:** owner sign-in check; Root `storage.mediaRoot` + mail settings; live Facebook test gate (needs owner test Page); post-cutover rollback drill; pin 4 newer migrations in `cutover-rehearsal.sh`; drop scratch `social_pilot_rehearsal`; rewire `socialpilot-deploy` to the rebuild.

### Post-cutover fix — 2026-10-20 22:20 CEST

- **Symptom:** owner password and passkey sign-in failed. Logs: `permission denied for table workspace_data_purges` / `rebuild_sync_runs` (42501).
- **Cause:** cutover applied migrations as `postgres`; 24 new tables and 9 functions were owned by `postgres`, not the app role `social_pilot`.
- **Fix:** `rebuild/scripts/prod-fix-ownership.sh` (commit `0dac4dc1`) transferred them; now `social_pilot=116` tables, 0 postgres-owned functions. `prod-cutover.sh` now does this step itself. Services restarted; worker jobs run with 0 permission errors.
- **Root settings (audited, as owner):** `auth.passkeyOrigin=https://social.newsgeet.com` (was empty, so passkey accounts were sent to enrollment); `storage.mediaRoot=/var/lib/ms-social-pilot/media` (legacy `MEDIA_DIR`).
- **Open:** owner sign-in confirmation; mail settings; live Facebook test gate; post-cutover rollback drill; drop scratch DB; rewire `socialpilot-deploy`.
- **Cleanup (22:40):** scratch DB `social_pilot_rehearsal` dropped; rehearsal/cutover temp files and drill folder removed.
- **Legacy deploy guarded:** `/usr/local/sbin/socialpilot-deploy` now refuses (exit 2) while `social-pilot-rebuild` is enabled, except `--status` or `SOCIALPILOT_LEGACY_OVERRIDE=yes` (a deliberate legacy rollback). Original kept as `socialpilot-deploy.legacy-20261020`. A dedicated rebuild release command is still to be written.
- **Owner sign-in:** no app errors since the fix; the form rejects the password. The owner runs `rebuild/scripts/prod-owner-reset-link.sh` (link shown only in their terminal) until mail is configured.

### Post-cutover fixes — 2026-10-20 23:00–23:30 CEST

- **Same-origin refusal (all writes, sign-in, reset):** behind LiteSpeed, `next start -H 127.0.0.1` reports `request.url` as `http://localhost:3100`. 65 origin checks now use `requestOrigin()`, backed by the new Root setting `app.publicOrigin` (+ `app.publicOriginRefreshSeconds`, registry 90), loaded at startup via `instrumentation.ts` and kept on a process global (Next bundles routes separately). Set to the live origin through the audited Root path. Owner sign-in confirmed in Chrome.
- **Facebook settings not imported:** every Graph call failed ("Facebook app secret required for signed Graph requests"); inbox sync failed 10/10 and, with retries, held DB transactions/locks ~311 s per run, slowing pages. `scripts/import-legacy-config.ts --apply` imported 6 legacy settings (appId, appSecret, graphVersion, oauthScopes, requestTimeoutMs, oauthRedirectUri) with audit. Inbox sync: 10/10 OK in 11 s.
- **Failure visibility:** inbox sync now logs a redacted reason per failed channel; Root `logging.errorDetailMaxCharacters` (registry 91).
- **Performance after fixes (owner session, Chrome):** /home 0.63 s, /ads 0.56 s, /settings/account 0.27 s, /inbox 0.31 s, /analytics 0.63 s (were 1–7.5 s). Slow-query log at 100 ms during these loads recorded nothing; setting reverted.
- **Release command:** `rebuild/scripts/prod-deploy.sh` (backup, build, migrations + ownership, swap, health checks incl. same-origin probe, automatic swap-back). Legacy `socialpilot-deploy` refuses while the rebuild is live.
- **Open:** mail settings; live Facebook write tests (needs a test Page); post-cutover rollback drill; inbox sync still holds one transaction across provider calls (refactor to fetch-then-write); worker does not stop within systemd's timeout on restart.

### AI providers and Chrome sweep — 2026-10-21 00:00 CEST

- **AI providers** (commit `d644a83e`, registry 93): AI module ships Anthropic, OpenAI and Gemini adapters; `ai.provider` selects one, each with its own Root key/model/endpoint. Legacy `ai.openaiKey`, `ai.geminiKey`, `ai.model` (→ `ai.openaiModel`, legacy provider was openai) and `ai.rateLimitPerHour` imported via `import-legacy-config.ts --apply` (audited). `ai.model` reset to the Claude default (legacy single-model value had landed on the Anthropic key). `ai.enabled=true`; both workspaces opted in.
- **Live provider tests:** OpenAI `gpt-6-luna` PASS (2.1 s); Gemini `gemini-3.6-flash` PASS (3.2 s); Anthropic key valid but its account returns "credit balance is too low" — owner billing action. Composer AI assist verified in owner Chrome (suggestion generated, discarded, nothing saved).
- **Chrome sweep:** 58 signed-in pages at 1440 px: all 200, no overflow, no client errors. 16 signed-out pages at 390 px: no overflow/crashes; protected pages show sign-in. Findings: `/analytics/demographics` heading in French in an English UI; `/home` h1 is the workspace initials; invalid `/share/*` and `/bio/*` render 404 with HTTP 200 + noindex (root loading boundary streams first; low priority).

### Production log — 2026-10-21

- **Facebook post history:** live sync fixed twice — history failures no longer roll back Page insights (`adddb664`), and Graph `since/until` are whole unix seconds (`782a0590`). Live run: insights persisted (280–310 observations), history returned posts; per-post metrics `post_impressions*`, `post_engaged_users`, `post_clicks`, `post_video_views*` refused as deprecated → replaced by current metrics in the Facebook data lane. History cursors moved to `rebuild_facebook_sync_cursors` (migration applied with backup).
- **Deploy script bug:** generated ownership statements lacked terminators, so multi-table releases left new tables owned by `postgres` (permission denied). Fixed in `prod-deploy.sh`/`prod-cutover.sh`; ownership applied; 0 non-app-owned tables.
- **WordPress recipe automation:** read-only MariaDB account `msp_wp_reader` (SELECT on `newsgeet.wp_posts`/`wp_postmeta` only; writes and other tables denied, verified) stored as Root secret `feeds.wordpress.databaseUrl`. Mapping: FB image `_msrwa_facebook_generated` → attachment `_wp_attached_file` → WebP downloaded and converted to JPEG (verified 1024×1280, 330 KB); caption `_msrwa_facebook_caption`; first comment = canonical recipe `_msrwa_recipe` via template with link; skips `fb_shared_at`. The WP plugin MS-FB-Posts does not post to Facebook (verified), so no double posting. Source "Recettes newsgeet" on all 10 Pages, slots 07:00/11:00/15:00/17:00 Europe/Paris, 2-day horizon: planner run created 80 scheduled posts (0 failed, 0 unfilled). Eligible pool ≈2,900 recipes (~70 days at 40/day with 365-day per-Page cooldown) plus new site recipes.
- **Full suite:** 5,112 passed / 241 skipped. 51/51 pages healthy in production.

### Integrated reliability and parity follow-up — 2026-10-21 (source/unit)

Local commits `f5c21c96` and `e0584777` add Inbox bulk REST and confirmed Settings
services, plus worker signal/drain handling and Facebook Inbox fetch-then-write.
Provider Inbox reads now occur outside the workspace transaction/resource lock;
write-time access/binding checks and suppression guards remain. Worker shutdown
stops claims, drains within Root `sync.workerShutdownGraceMs`, then aborts and
releases abandoned leases using `sync.workerDrainPollMs`. These supersede the
source defects noted in the 23:00–23:30 entry, which remains a dated observation.
No fresh production restart timing, systemd timeout compatibility or database
contention measurement is established here. Settings callers still need wiring
follow-ups listed in [MCP_PARITY.md](MCP_PARITY.md).

Copy catalogs merged through `38ab34f4` (registry 105); `fb42b056` adds validated
registry-default fallback for schema-checked catalogs/display policies. Registry
106 includes shutdown grace. These are source changes, not proof that all current
commits are deployed or every customer string is translated. The recipe log above
records 80 scheduled posts, not 80 confirmed Facebook publications or comments.
- **First live recipe publications (07:00 Paris):** all 10 Pages published between 07:00:10 and 07:01:57 with Facebook post IDs; all 10 canonical-recipe first comments posted (comment IDs, no errors). Verified in the owner's browser on Cuisine Pleine d'Envie: FB image + caption, comment with ingredients, 12 numbered steps and the article link with preview card. Planner keeps a rolling horizon (10 published, 80 upcoming after the run).
- **Post insights (live, Graph v26.0):** valid — post_media_view, post_total_media_view_unique, post_reactions_by_type_total, post_clicks, post_clicks_by_type; invalid — post_impressions, post_impressions_unique, post_engaged_users. Collector bugs fixed (`63207a7c`, `954e80cb`): insights page by time windows, not cursors. Live probe after deploy: failures [], post_media_view 3, unique 3, reactions by type {like: 1}. Open: the reactions summary edge reported 0 where insights report 1 (possible lag).

### 2026-10-21 post-cutover rollback drill

`rebuild/scripts/prod-rollback-drill.sh` restored `/var/backups/socialpilot-deploy-20261021-154321/social_pilot.dump` into scratch DB `social_pilot_drill` and started legacy (`/srv/ms-social-pilot`) and the installed rebuild on spare ports against it. Result: **ROLLBACK DRILL PASS** (restore 2s, legacy HTTP/DB 3s, rebuild HTTP/DB 2s, total 7s). Scratch DB/role removed; live rebuild web/worker stayed active, legacy stayed inactive. Proves a restorable backup and a startable rollback artifact, not a full proxy cutback.

### 2026-10-21 first full recipe day

All four Europe/Paris slots (07:00, 11:00, 15:00, 17:00) published 10/10 posts with 10/10 first comments and no errors (40/40). 70 further plans pending on the rolling horizon.
