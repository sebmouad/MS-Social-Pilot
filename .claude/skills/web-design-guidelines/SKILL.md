---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

Adapted from vercel-labs/agent-skills `web-design-guidelines` (MIT). The
original fetches the rules from GitHub on every run; here they are a reviewed
copy in `guidelines.md` (vercel-labs/web-interface-guidelines, MIT, copied
2026-10-11), so a change upstream cannot change what this skill tells an agent
without someone reviewing it first.

## How It Works

1. Read `guidelines.md` next to this file
2. Read the specified files (or ask which files to review)
3. Check against all rules in the guidelines
4. Output findings in the terse `file:line` format the guidelines describe

## MS Social Pilot overrides

The project's own rules win where they differ (CLAUDE.md, docs/ai/DESIGN.md,
the `ux-copy-house` skill):
- Headings and buttons use sentence case, not Title Case.
- Every string lives in `messages/en.json` and `messages/fr.json`.
- Confirmations use `useConfirm()`, never `window.confirm`.
