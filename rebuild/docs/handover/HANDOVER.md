# Session handover (2026-10-22)

Everything needed to continue is in Git. Start a new session in a fresh clone of
`sebmouad/MS-Social-Pilot` and read, in order: `AGENTS.md`, `CLAUDE.md`,
`rebuild/docs/ARCHITECTURE_CONTRACT.md`, `ARCHITECTURE.md`, `GOAL.md`,
`DELIVERY_PLAN.md`, `AGENT_HANDOFF.md`, then this file.

## State at handover

| Area | State |
| --- | --- |
| Repository | Only `rebuild/` plus agent files. Legacy app deleted (`07c2394f`). Migrations squashed into `20261103000000_baseline`. |
| Production | https://social.newsgeet.com runs `bf84cb8f` (health 200, web+worker active). Deploy: `bash rebuild/scripts/prod-deploy.sh` (host from `rebuild/docs/OPERATIONS.md`, key `~/.ssh/SebMouadSSH`). |
| Server | Legacy units, `/srv/ms-social-pilot{,.prev}`, legacy deploy guard and 5 unmapped tables removed after backup `/var/backups/legacy-cleanup-20261022110559` (also `/var/backups/legacy-removal-202610221216`, verified restore). Media root `/var/lib/ms-social-pilot/media`. |
| Legacy parity | Sweep `LEGACY_SWEEP_2026-10-21.md`: 0 missing. Dropped by owner: Facebook Groups, old API tokens, Facebook colored text backgrounds. Nine non-Facebook connectors installed, off by default, no live-provider evidence. |
| Design v2 | B1–B8 merged and deployed. **Next: B9 verification** (see `design-v2/08-BUILD_PLAN.md`): remove `SidebarDock`/Page tools adapter, update `scripts/verify-*` selectors for new Composer/Inbox/Settings/Root, real browser checks (themes, phone/desktop, keyboard, FR). |
| Tests | 11,688 pass; typecheck and `next build` pass. Full suite: `npx vitest run --exclude "**/facebook-diagnostic-transport.test.ts" --testTimeout 30000` from `rebuild/`. |

## Known open items

- B9 verification batch (above); no real-browser evidence for the v2 screens yet.
- Root manual token refresh should update destination token + expiry atomically (lane 46 note). Mastodon supports one Root-configured server.
- Inbox: no saved-replies menu inside the reply box, no bulk Assign, phone bottom-sheet not built.
- Data-deletion page copy is a code constant, not Root-managed (violates no-hardcoded rule).
- Owner action: repoint Meta dashboard deauthorize/data-deletion URLs to `/api/platforms/facebook/deauthorize` and `/data-deletion`.
- Live-provider, MCP-client and release gates in `ARCHITECTURE_CONTRACT.md` §10 remain open.

## Working method (owner rules)

See `memory/` (copied auto-memory) and `workspace/` (outer workspace CLAUDE.md/AGENTS.md). Summary: nothing hardcoded (Root settings only); UI/REST/MCP parity; EN/FR; modular platform modules; commit+push to `main`; don't ask, report in tables; never publish credentials; spend worker accounts (3 Codex: `~/.codex`, `~/.codex-account2`, `~/.codex-account3`; Claude: `~/.claude-account2`, `~/.claude-sebhaoui`; Muse) before the main account.

## Worker queue

`workers/` holds the queue runners (`runner*.sh`), merge helpers (`res.py`, `union.py`), the common brief and every lane brief used (`lane-briefs/`). Runners poll `queue/todo/*.md`, create a worktree at `/private/tmp/msp-q-<lane>`, run the worker, and append to `queue/finished.log`. Merge: diff the worktree with pathspecs excluding `node_modules`, `*.log`, `*.patch`; `git apply --3way` on main; typecheck, full suite, `next build`; commit; push; deploy. Paths inside the scripts point at the old session scratchpad; set `S` to a new folder.

`archive/` keeps the outer workspace's old audits, docs and the 2026-10-20 WIP backup for reference only.
