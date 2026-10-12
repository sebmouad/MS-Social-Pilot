# MS Social Pilot — instructions for AI agents

You are working on **MS Social Pilot**, a self-hosted social media scheduler and
analytics tool for agencies running many Facebook Pages (plus Instagram, Bluesky,
Mastodon, LinkedIn, Threads, X, Pinterest). Production: https://social.newsgeet.com.

**Read first:** [docs/ai/README.md](docs/ai/README.md) — objective, architecture,
conventions, commands. Then the file for your task:

| Task | Read |
|---|---|
| What exists, screen by screen | [docs/ai/FEATURES.md](docs/ai/FEATURES.md) |
| **What to build next (start here)** | [docs/ai/NEXT_PHASES.md](docs/ai/NEXT_PHASES.md), then [docs/ai/ROADMAP.md](docs/ai/ROADMAP.md) |
| Any UI work | [docs/ai/DESIGN.md](docs/ai/DESIGN.md) + [docs/inspiration/simplified/PATTERNS.md](docs/inspiration/simplified/PATTERNS.md) |
| Tests, before and after every change | [docs/ai/TESTING.md](docs/ai/TESTING.md) |
| Facebook / Instagram / Graph API work | [docs/ai/META_API_NOTES.md](docs/ai/META_API_NOTES.md) |
| Shipping (server, scripts, rollback) | [docs/ai/RELEASE.md](docs/ai/RELEASE.md) |
| Where things stand, decisions, Meta review, gaps | [docs/ai/STATUS.md](docs/ai/STATUS.md) |
| Root, roles, privileges (owner will audit) | [docs/ai/PERMISSIONS.md](docs/ai/PERMISSIONS.md) |
| Which skill for which task | [docs/ai/SKILLS.md](docs/ai/SKILLS.md) |

Project skills live in [.claude/skills/](.claude/skills/) — load the one that
matches the task (frontend design, profile selection, analytics, Meta API, app review, live Facebook tests,
translations, migrations, new network connector, release). Reviewed third-party
skills sit next to them (UI review, React performance, composition, Playwright,
secure code); SKILLS.md says when to use each and where this repo's rules win.

## Rules that are not negotiable

1. **Commit straight to `main`.** No pull requests. Ask before deleting a branch
   that is not merged.
2. **Every UI string in both `messages/en.json` and `messages/fr.json`**, same
   placeholders; anything that counts uses ICU plurals.
3. **Navigation is on the left** (`src/components/AppShell.tsx`): icon rail +
   area sidebar + a top bar for utilities only (NEXT_PHASES D2). Never add a top tab bar for a module. Facebook look: blue `#1877f2`, white cards on
   `#f0f2f5`, rounded pills.
4. **Never `window.confirm`** — use `useConfirm()` from
   `src/components/ConfirmProvider.tsx`.
5. **Test in a real browser with real data.** Unit + Playwright suites first; then
   verify on production in the user's Chrome. Publishing, deleting or messaging on
   real Facebook Pages needs the user's explicit OK for each action (the agreed
   test Page is *DIY Page 3*; switch it on for the test and off afterwards, and
   delete test posts).
6. **Deploy when tests pass**: `scripts/deploy/deploy.sh` (see RELEASE.md). It
   checks `/api/health` and the three WordPress sites on the same server.
7. **Never type passwords, tokens or secrets into web pages**, never create
   accounts for the user, and never read production database contents.
8. **The first registered user is root** (`isInstanceOwner`): only root sets up
   the app, in its **own separate section** (`/root/*`, planned — today
   Configuration is at `/settings/config`). Workspace owners/admins are not root. Don't
   widen or change role privileges without the owner's audit (PERMISSIONS.md).
9. **Generic product, sold as a service.** Nothing niche- or country-specific in
   code, copy, examples, defaults or docs: country, language, holidays, time zone,
   categories and templates are defined by each user (audience per Page, NEXT_PHASES
   H0). Use neutral examples ("Client A", "Product launch"), never the owner's
   Pages or sites.
10. **AI model lists are never written in code**: they are fetched from each
    provider's API (NEXT_PHASES 0.2).
11. Client components must not import server modules (anything that reaches
   `@/lib/prisma`). Shared constants go in plain modules (`src/lib/palette.ts`,
   `src/lib/network-rules.ts`, `src/lib/report-sections.ts`).
