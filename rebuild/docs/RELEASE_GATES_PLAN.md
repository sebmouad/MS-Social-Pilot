# Release gates runbook

Status: **plan, nothing in it has been run.** Written 2026-10-20 on branch
`claude/release-plan` from the current tree. It orders the remaining release gates
of [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) section 10 (gates 5-8, plus
the data half of gate 6). It does not change the contract, [CUTOVER.md](CUTOVER.md)
or the goal, and it authorizes nothing by itself. Production stays on the legacy
app; `socialpilot-deploy` still deploys legacy.

Legend: **[OWNER]** needs the owner (credentials, host, approval, a decision).
**[AGENT]** can be done by a coding session once its inputs exist. **[GATE]** a
pass/fail checkpoint; record evidence, never contents of tokens or customer rows.

Order: A (live Facebook) and B (migration/rollback rehearsal) are independent and
can run in parallel; C (cutover) needs both to pass, plus gates 1-4 of the contract
(parity inventory, functional, authorization, browser), which are tracked elsewhere.

## Facts this plan relies on (revalidate before acting)

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

Today `socialpilot-deploy` (installed from `scripts/deploy/server-deploy.sh`) and
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

All must be yes; any no is no-go.

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
