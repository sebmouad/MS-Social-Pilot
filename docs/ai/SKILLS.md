# Skills for agents working on MS Social Pilot

## Project skills (in this repo, `.claude/skills/`)

| Skill | Use it when |
|---|---|
| `frontend-design` | Any UI: new screen, component, redesign, responsive or empty-state work |
| `ux-copy-house` | Writing buttons, errors, empty states, confirmations in EN + FR |
| `run-tests` | Before and after every change |
| `deploy-production` | Shipping to social.newsgeet.com, or rolling back |
| `live-facebook-test` | Verifying on real Facebook with the sandbox Page (owner's OK) |
| `db-migration` | Changing `prisma/schema.prisma` |
| `add-network-connector` | Adding YouTube, TikTok, Google Business Profile, … |
| `meta-api-integration` | API setup, authentication, permissions, examples for Graph calls |
| `debug-access-token` | Expired tokens, missing scopes, "reconnect required" |
| `app-review-prep` | Readiness for Meta App Review; preparing a submission |
| `app-health-check` | Meta app settings, security, compliance + production health |
| `api-health` | Rate limits, usage, deprecation warnings, version bumps |
| `webhook-setup` | Configuring and testing Meta webhooks |
| `debug-webhooks` | Webhook delivery failures |
| `compliance-check` | Policy violations, required actions, privacy/data deletion |
| `search-meta-docs` | Finding authoritative Meta developer documentation |

## Tools these skills rely on
- **Meta DevTools MCP** (`devtools_app_list`, `devtools_app`, `devtools_app_review`,
  `devtools_api_usage`, `devtools_api_changelog`, `devtools_compliance`,
  `devtools_webhook_list/manage/test`, `devtools_discovery`) — app 699780715171676.
- **Claude in Chrome** — the owner's real Chrome, signed in to the app and to
  Facebook: the place to verify everything with real data.
- SSH to the server (`docs/ai/RELEASE.md`).

## General-purpose skills worth loading (from the agent's plugin catalogue)
- `design:design-critique`, `design:ux-copy`, `design:accessibility-review`,
  `design:design-system` — structured UI reviews and copy.
- `dataviz` — before building any chart, stat tile or dashboard.
- `webapp-testing` — Playwright scripting for local checks.
- `code-review` / `simplify` — before committing large changes.
- `security-review` — before touching auth, tokens, share links or the public API.
- `claude-api` — before changing `src/lib/ai.ts` (model ids, SDK usage).
