---
name: worker-account-budget
description: Which Claude/Codex accounts to spend first for MS Social Pilot workers; protect the sebmouad Claude account
metadata:
  node_type: memory
  type: feedback
  originSessionId: d16b3cd0-991c-4f7e-adce-456d9a84beea
  modified: 2026-10-20T00:34:06.375Z
---

User (2026-10-20): do not consume the last ~10% of the sebmouad@gmail.com Claude account (the desktop session's account, also in ~/.claude-account2) until the other accounts are used up. Spend helper accounts first, then assemble.

**Why:** that account is nearly exhausted, and the user wants their other quotas used before it.
**How to apply:** dispatch headless Claude workers with CLAUDE_CONFIG_DIR=~/.claude-sebhaoui (sebhaoui.m@gmail.com). Use Codex via the default ~/.codex (sebhaoui.m); ~/.codex-account2 (elouardianass4) and ~/.codex-account3 (sebmouad) had no credits on 2026-10-20. Keep this session to short dispatch/merge/verify steps. Codex binary: /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex. Claude CLI: ~/.local/bin/claude. Briefs go in the scratchpad and are passed on stdin (claude -p) because --allowedTools swallows a positional prompt. Worker worktrees need a node_modules symlink to app/node_modules and `npx prisma generate`.

User preference (2026-10-20): in every status update, list ALL Codex and Claude accounts with their credit state and current task (table).
