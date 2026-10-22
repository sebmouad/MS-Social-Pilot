# Session handover (2026-10-22, after design v2 B9)

Everything needed to continue is in Git. Start a new session in a fresh clone of
`sebmouad/MS-Social-Pilot` and read, in order: `AGENTS.md`, `CLAUDE.md`,
`rebuild/docs/ARCHITECTURE_CONTRACT.md`, `ARCHITECTURE.md`, `GOAL.md`,
`DELIVERY_PLAN.md`, `AGENT_HANDOFF.md`, then this file.

## State at handover

| Area | State |
| --- | --- |
| Repository | Only `rebuild/` plus agent files. `main` is `2fde8abd` (design v2 B9), pushed and verified on `origin/main`. Working tree clean. |
| Production | https://social.newsgeet.com still runs `bf84cb8f` (B9 **not** deployed — deploy blocked, see below). When unblocked, deploy with `bash rebuild/scripts/prod-deploy.sh` (host from `rebuild/docs/OPERATIONS.md`, key `~/.ssh/SebMouadSSH`). |
| Server | Legacy units, `/srv/ms-social-pilot{,.prev}`, legacy deploy guard and 5 unmapped tables removed after backup `/var/backups/legacy-cleanup-20261022110559` (also `/var/backups/legacy-removal-202610221216`, verified restore). Media root `/var/lib/ms-social-pilot/media`. |
| Legacy parity | Sweep `LEGACY_SWEEP_2026-10-21.md`: 0 missing. Dropped by owner: Facebook Groups, old API tokens, Facebook colored text backgrounds. Nine non-Facebook connectors installed, off by default, no live-provider evidence. |
| Design v2 | B1–B9 merged. B9 (`2fde8abd`): SidebarDock/ModeToggle/Page-tools adapter deleted, 8 `scripts/verify-*` selectors rewritten, data-deletion sentences in Root `public.content` (EN/FR), atomic Root token refresh, Inbox reply-box saved-replies menu + bulk Assign (UI/REST/MCP, confirmation, audit). Schema **136**. |
| Tests | Typecheck 0 errors; full suite 724 files / 11,726 tests pass, 5 fail (known sandbox-only `facebook-native-http` loopback `listen EPERM ::1`; rerun where sockets are permitted); `npx next build` passes. Full suite: `npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts" --testTimeout 30000` from `rebuild/`. |

## Deploy blocked (exact reason)

`bash rebuild/scripts/prod-deploy.sh` was **not** run to completion. In this
session the sandbox blocks it twice over, proven by independent probes:

- `ssh` cannot start: even `ssh -G` (no network) fails with `No user exists
  for uid 501` (exit 255); the sandbox hides user-name resolution, which
  OpenSSH requires.
- Raw TCP to `213.246.45.75:22` fails with `EPERM`.

`require_escalated` is unavailable because approval prompts are disabled
(`--approval-mode never`). Nothing on the server was touched: no backup, no
build, no migration, no swap. To ship B9, run this from a normal terminal
(not this sandboxed session), after `git pull`:

```sh
bash rebuild/scripts/prod-deploy.sh
```

Then verify the B9 screens live in the owner's Chrome with real data, and
update the Production row above with the new SHA.

## Known open items

- B9 follow-ups: full v2 browser matrix on the rewritten selectors; assign
  dialog + saved-replies menu at desktop/phone widths in EN/FR with
  keyboard; live-provider token renewal run; `DESIGN.md` Layout section
  still describes the pre-v2 two-sidebar shell.
- Saved `home.shellCopy` catalogs carrying `pageTools` keys read as the
  shipped default until re-saved in Root (strict-schema read + default).
- Owner action: repoint Meta dashboard deauthorize/data-deletion URLs to
  `/api/platforms/facebook/deauthorize` and `/data-deletion`.
- Live-provider, MCP-client and release gates in
  `ARCHITECTURE_CONTRACT.md` §10 remain open.

## Working method (owner rules)

See `memory/` (copied auto-memory) and `workspace/` (outer workspace CLAUDE.md/AGENTS.md). Summary: nothing hardcoded (Root settings only); UI/REST/MCP parity; EN/FR; modular platform modules; commit+push to `main`; don't ask, report in tables; never publish credentials; spend worker accounts (3 Codex: `~/.codex`, `~/.codex-account2`, `~/.codex-account3`; Claude: `~/.claude-account2`, `~/.claude-sebhaoui`; Muse) before the main account.

## Worker queue

`workers/` holds the queue runners (`runner*.sh`), merge helpers (`res.py`, `union.py`), the common brief and every lane brief used (`lane-briefs/`). Runners poll `queue/todo/*.md`, create a worktree at `/private/tmp/msp-q-<lane>`, run the worker, and append to `queue/finished.log`. Merge: diff the worktree with pathspecs excluding `node_modules`, `*.log`, `*.patch`; `git apply --3way` on main; typecheck, full suite, `next build`; commit; push; deploy. Paths inside the scripts point at the old session scratchpad; set `S` to a new folder.

`archive/` keeps the outer workspace's old audits, docs and the 2026-10-20 WIP backup for reference only.
