# Session handover (2026-10-22, after design v2 B9)

Everything needed to continue is in Git. Start a new session in a fresh clone of
`sebmouad/MS-Social-Pilot` and read, in order: `AGENTS.md`, `CLAUDE.md`,
`rebuild/docs/ARCHITECTURE_CONTRACT.md`, `ARCHITECTURE.md`, `GOAL.md`,
`DELIVERY_PLAN.md`, `AGENT_HANDOFF.md`, then this file.

## State at handover

| Area | State |
| --- | --- |
| Repository | Only `rebuild/` plus agent files. `main` is `13bb7d27` (handover commit on top of design v2 B9 `2fde8abd`), pushed and verified on `origin/main`. Working tree clean. |
| Production | https://social.newsgeet.com runs `13bb7d27` (B9 deployed 2026-10-22 from a normal terminal). Future releases go through `bash rebuild/scripts/prod-deploy.sh` (host from `rebuild/docs/OPERATIONS.md`, key `~/.ssh/SebMouadSSH`). |
| Server | Legacy units, `/srv/ms-social-pilot{,.prev}`, legacy deploy guard and 5 unmapped tables removed after backup `/var/backups/legacy-cleanup-20261022110559` (also `/var/backups/legacy-removal-202610221216`, verified restore). Media root `/var/lib/ms-social-pilot/media`. |
| Legacy parity | Sweep `LEGACY_SWEEP_2026-10-21.md`: 0 missing. Dropped by owner: Facebook Groups, old API tokens, Facebook colored text backgrounds. Nine non-Facebook connectors installed, off by default, no live-provider evidence. |
| Design v2 | B1–B9 merged. B9 (`2fde8abd`): SidebarDock/ModeToggle/Page-tools adapter deleted, 8 `scripts/verify-*` selectors rewritten, data-deletion sentences in Root `public.content` (EN/FR), atomic Root token refresh, Inbox reply-box saved-replies menu + bulk Assign (UI/REST/MCP, confirmation, audit). Schema **136**. |
| Tests | Typecheck 0 errors; full suite 724 files / 11,726 tests pass, 5 fail (known sandbox-only `facebook-native-http` loopback `listen EPERM ::1`; rerun where sockets are permitted); `npx next build` passes. Full suite: `npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts" --testTimeout 30000` from `rebuild/`. |

## B9 deployed (2026-10-22)

Production now runs `13bb7d27`. The deploy ran from a normal terminal (the
earlier sandboxed session could not ship: `ssh` failed with `No user exists
for uid 501` and raw TCP to the host failed with `EPERM`, with
`require_escalated` unavailable under `--approval-mode never`).

Still to do after the deploy: verify the B9 screens live in the owner's
Chrome with real data (assign dialog + saved-replies menu at desktop/phone
widths in EN/FR with keyboard; live-provider token renewal run).

## Known open items

- B9 follow-ups: run the v2 area matrix live (`BROWSER_MATRIX_SCOPE=v2`,
  536 cells; scope committed and unit-tested, live run sandbox-blocked —
  see below); assign dialog + saved-replies menu at desktop/phone widths
  in EN/FR with keyboard; live-provider token renewal run. Done this
  session: `DESIGN.md` Layout rewritten for the v2 shell; saved
  `home.shellCopy` catalogs with `pageTools` keys now load their
  remaining entries (`resolveShellCopy`, tested).
- Owner action: repoint Meta dashboard deauthorize/data-deletion URLs to
  `/api/platforms/facebook/deauthorize` and `/data-deletion`.
- Live-provider, MCP-client and release gates in
  `ARCHITECTURE_CONTRACT.md` §10 remain open.

## Session 2026-10-22 (no deploy)

Changed: `DESIGN.md` (Layout + Clean-default fix), `src/modules/shell/
{copy.ts,server/chrome.ts}` + `tests/shell-v2.test.ts` (catalog
tolerance), `scripts/verify-browser-matrix.ts` +
`tests/browser-matrix.test.ts` + `docs/BROWSER_MATRIX.md` (v2 scope),
this file + `docs/ARCHITECTURE.md` (records).

Ran from `rebuild/`: `npm run typecheck` (0 errors); full suite `npx
vitest run --exclude "**/facebook-diagnostic-transport.test.ts"
--testTimeout 30000` (724 files / 11,736 tests pass, 49 skipped, 5
known sandbox `listen EPERM ::1` loopback failures); `npx next build`
(passes); v2 scope tsx smoke run (67 routes / 536 cells inventoried,
fails fast without credentials).

Live v2 matrix blocked here: sandbox denies TCP bind/connect
(`EPERM`), Docker, passwd lookup, SysV shm and escalation (probes in
`ARCHITECTURE.md`). From a normal terminal with the PREVIEW.md seeded
database and a loopback server on 3200, run:

```sh
BROWSER_MATRIX_SCOPE=v2 BASE_URL=http://127.0.0.1:3200 \
BROWSER_MATRIX_REPORT=/tmp/msp-v2-matrix.json \
node --import tsx scripts/verify-browser-matrix.ts
```

with `QA_EMAIL`/`QA_PASSWORD` (instance-owner QA) exported. Fix every
finding, then re-run narrowed scopes with `MATRIX_ONLY=<prefix>`.

## Working method (owner rules)

See `memory/` (copied auto-memory) and `workspace/` (outer workspace CLAUDE.md/AGENTS.md). Summary: nothing hardcoded (Root settings only); UI/REST/MCP parity; EN/FR; modular platform modules; commit+push to `main`; don't ask, report in tables; never publish credentials; spend worker accounts (3 Codex: `~/.codex`, `~/.codex-account2`, `~/.codex-account3`; Claude: `~/.claude-account2`, `~/.claude-sebhaoui`; Muse) before the main account.

## Worker queue

`workers/` holds the queue runners (`runner*.sh`), merge helpers (`res.py`, `union.py`), the common brief and every lane brief used (`lane-briefs/`). Runners poll `queue/todo/*.md`, create a worktree at `/private/tmp/msp-q-<lane>`, run the worker, and append to `queue/finished.log`. Merge: diff the worktree with pathspecs excluding `node_modules`, `*.log`, `*.patch`; `git apply --3way` on main; typecheck, full suite, `next build`; commit; push; deploy. Paths inside the scripts point at the old session scratchpad; set `S` to a new folder.

`archive/` keeps the outer workspace's old audits, docs and the 2026-10-20 WIP backup for reference only.
