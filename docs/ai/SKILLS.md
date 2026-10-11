# Skills for agents working on MS Social Pilot

## Project skills (in this repo, `.claude/skills/`)

| Skill | Use it when |
|---|---|
| `frontend-design` | Any UI: new screen, component, redesign, responsive or empty-state work |
| `profile-selection` | Any screen, query, export or API that lists Pages' data — obey the shared selection |
| `analytics-dashboard` | Analytics: KPI cards, multi-profile totals/compare, all Meta metrics |
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

### Third-party skills (MIT, copied verbatim from github.com/jeffallan/claude-skills @ 1be15d8)

Generic guidance; **this repo's conventions win** wherever they differ
(CLAUDE.md, TESTING.md, the project skills above).

| Skill | Use it when | Where it disagrees with this repo |
|---|---|---|
| `playwright-expert` | Writing or debugging e2e specs, flaky tests | No Page Object classes or `data-testid` here: follow `e2e/helpers.ts`, role/label selectors, `SIGNED_IN_SCREENS` |
| `secure-code-guardian` | G1 two-step sign-in, G4 sessions, share links, public API, anything auth or input | Its Express/helmet/JWT examples don't apply: Next.js route handlers via `route()`, zod at the boundary, existing session code |

From github.com/vercel-labs/agent-skills @ 063bee9 (MIT; picked from Snyk's
"top Claude skills for UI/UX engineers"):

| Skill | Use it when | Where it disagrees with this repo |
|---|---|---|
| `web-design-guidelines` | Reviewing any UI change (a11y, forms, focus, typography, i18n) | Rules are a local reviewed copy (`guidelines.md`), not fetched live. Sentence case, not Title Case |
| `vercel-react-best-practices` | Writing or reviewing React/Next.js code for performance (waterfalls, RSC payloads, re-renders) | Ignore Vercel-hosting notes (Fluid Compute); no SWR in this app; its `AGENTS.md` was not copied |
| `vercel-composition-patterns` | Splitting a component that grew boolean props (Composer, PostList, pickers) | Its `AGENTS.md` was not copied; the rule files are complete |

Reviewed and left out: `monitoring-expert` (Prometheus/Grafana stack; G3
alerts are email + Telegram from the worker), `typescript-pro` (forbids enums,
which Prisma generates), `nextjs-developer` (Next 14 era, Vercel-oriented),
alirezarezvani/claude-skills marketing skills (ship Python scripts; revisit
for D2 referral programme and S7 product site); AccessLint (a plugin that
needs its own MCP server — install it as a Claude Code plugin if wanted);
UI/UX Pro Max and Bencium (large design databases / unrelated personas);
React Native skills (no mobile app); Anthropic `frontend-design` (already
available as a built-in skill; the project's `frontend-design` wins).

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
