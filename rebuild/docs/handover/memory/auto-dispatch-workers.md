---
name: auto-dispatch-workers
description: Always automatically dispatch work to the 3 Codex + 2 Claude worker accounts without asking; keep them busy
metadata:
  node_type: memory
  type: feedback
  originSessionId: d16b3cd0-991c-4f7e-adce-456d9a84beea
  modified: 2026-10-20T22:00:08.188Z
---

Always use the worker accounts automatically for MS Social Pilot: Codex (`CODEX_HOME=~/.codex`, `~/.codex-account2`, `~/.codex-account3`) and Claude (`CLAUDE_CONFIG_DIR=~/.claude-account2`, `~/.claude-sebhaoui`). Do not ask before dispatching; when a worker finishes, review/merge and immediately give it the next lane.

**Why:** User (2026-10-21): "always automatically use codex and claude accounts" — wants maximum parallel speed and to spare the main sebmouad account ([[worker-account-budget]]).

**How to apply:** One git worktree per lane in /private/tmp/msp-<lane> (symlink app/node_modules and rebuild/node_modules, run prisma generate), shared brief preamble + lane brief with explicit OWNED paths (no two workers on the same files), Claude via `claude -p --model sonnet --permission-mode acceptEdits` with stdin prompt run as a background Bash task (detached nohup launches die), Codex via `codex exec -s workspace-write`. Integrator commits for them (sandbox can't write git metadata), bumps CONFIG_SCHEMA_VERSION, merges, deploys with rebuild/scripts/prod-deploy.sh, verifies in Chrome. Show the account/lane table in status updates.
