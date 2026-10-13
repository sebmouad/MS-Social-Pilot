# Status and session record (as of 2026-10-11)

Everything decided or learned in the build sessions (9–11 Oct 2026), so a new
session can continue without the old one.

## The owner's standing instructions

- **Final goal (2026-10-11): root is an isolated module overseeing everything;
  the app must be ready for production and for sale.** Root sees and can
  change all (clients, workspaces, memberships, modules per client and per
  user, teams); clients see only what root configured, activated and
  authorised. Beta: clients are invited by root to create their own workspace,
  or by a workspace admin to join one. Each workspace is isolated.

- "Always push to main"; "deploy it when tests pass".
- "Final goal is to implement all features that our competitors have, and make
  elegant design and visuals and perfect UX." Inspiration: Simplified
  (app.simplified.com) — research in `docs/inspiration/simplified/`
  (README = structure and styles, AUDIT = screen-by-screen audit, COMPARISON =
  feature table P1/P2/P3 with what exists vs. what was missing; 50 screenshots).
  Borrow structure and features; keep the Facebook look.
- "For design always use sidebar."
- "All tests must be in real browsers with real data."
- Minimum impact on the WordPress sites hosted on the same server.
- Replies in a terse style were requested earlier ("caveman") — optional.
- "Don't test on every step, test after big changes" (2026-10-11): small edits
  get `tsc` + the affected test files; the full unit + Playwright suites run
  once per finished feature, before commit/deploy. The browser suite runs only
  after every ~25% of the plan (it takes ~20 min).
- Security limits the owner set: never type passwords/secrets into web pages,
  never sign in to production with the owner's credentials, never create accounts
  or set passwords for them, ask before deleting unmerged branches, explicit OK
  for each public action (publishing, deleting on Facebook, sending email),
  nothing may be created or changed in Simplified (read-only research), don't
  read production database contents.

## What was built (all deployed)

Phases P1 → P2 → P3 of `docs/inspiration/simplified/COMPARISON.md`, then other
networks, sidebar, live-test fixes. Highlights, newest first:

| Commit (approx.) | What |
|---|---|
| 335137f, d852c7a, d689e13, fc1e52c | Inbox stream with shared done state, notifications matrix (per Page × event mutes, hourly new-inbox email), AI recap on scheduled reports, step-by-step MCP setup |
| a0d77d1 | Design-review UX: plain metric names, "Technical details" fold, Inbox explains Meta wait, Instagram tab hidden until on, searchable Page picker, Pull buttons report results, "Removed" badge |
| f7014f5 | Delete a published post from Facebook (`PostTarget.removedAt`) |
| 8b0c353 | Live-test fixes: reactions edge (all reaction types), no Hide on Page's own comments, no dead link on cancelled posts, confirm dialog wording |
| 4e4ccb9 | In-app `ConfirmProvider` replaces every `window.confirm` |
| 7f05346 | Bluesky, Mastodon, LinkedIn, Threads, X, Pinterest connectors |
| 9363d5d | Left sidebar navigation (`AppShell`) |
| 3bec5ec, 8a2cf30 | Client portal links, ⋮ Page menu, awareness-day ideas |
| 8067aa8, 84ef909 | API keys, REST v1, MCP server, AI week planner & hashtags, per-Page voice & UTM, Slack/Telegram, PWA, getting-started checklist, roles guide, posts CSV |
| 225c644 … 257ce04 | P2: Reels/Stories, snippets, emoji, week & feed calendar views, awareness days, queue shuffle/clear, approvals board, client links, reports PDF/templates/email, compare with a year earlier, world map, ⓘ definitions, compare by group |
| 23d7453, d148df3 | Demographics fix (`page_follows_country/city` need `period=day`), withdrawn breakdowns explained |
| 24607ae | P1: Page groups, labels, per-member Page access, per-Page queue slots, first-comment delay, split publish button, KPI explorer, report builder |

Full list: `git log --oneline`. Feature inventory: [FEATURES.md](FEATURES.md).

## Meta (Facebook) app

- App **MS-Social-Pilot**, ID **699780715171676**, business portfolio
  2565325306940157, business verification passed. The Meta DevTools MCP tools
  (`devtools_app`, `devtools_app_review`, …) are connected for this app with
  read + manage.
- **App Review step 1: PENDING** — submission 1483029746846765, submitted
  2026-10-10, 8 permissions — the Pages/insights/business/ads ones described in
  `docs/meta-review/step1-submission.md` (that file also has Inbox and Instagram
  sections; the owner moved those to step 2). Check the exact list with the
  DevTools MCP: `devtools_app_review status|privileges` for app 699780715171676. Screencasts are attached to
  the GitHub release `meta-review-screencasts-2026-10-10` (not in git):
  `submitted-*.mp4` are the files uploaded to Meta, `full-*.mp4` the original
  recordings. Download: `gh release download meta-review-screencasts-2026-10-10 -R sebmouad/MS-Social-Pilot -p 'submitted-*'`.
  Note: the step-1 reviewer instructions say "plug icon, top right" and
  "Schedule → Compose"; since the sidebar these are "Connections" and "New post"
  in the left sidebar.
- **Step 2 (Inbox + Instagram): ready, not submitted** — Meta accepts one
  submission at a time. Package: `docs/meta-review/step2-inbox-instagram.md`
  (pages_messaging, pages_manage_metadata, instagram_basic,
  instagram_manage_insights, instagram_content_publish). Do it after step 1 is
  decided; the owner records and submits.
- After approval: switch the app to **Live**; turn on Inbox and Instagram under
  Settings → Configuration → Features; each workspace reconnects Facebook once.
- Reviewer test account in the app: `meta-review@newsgeet.com` (Admin). Password
  is typed by the owner into Meta's form — never stored here. Suggest the owner
  rotates it after review.
- A tester invitation was sent to "Mouad Sebhaoui" (Pending): accept it signed in
  as that account at Facebook → Settings → Apps and websites, or in
  developers.facebook.com notifications.
- Graph Explorer cannot be used against this app (it enforces `appsecret_proof`).
- Privacy policy https://social.newsgeet.com/privacy-policy/, terms /terms,
  data deletion /data-deletion (English only).

## Production configuration gaps (owner action needed)

| Missing | Effect | Where |
|---|---|---|
| Resend API key | No emails at all (alerts, invitations, scheduled reports) | Settings → Configuration → Email |
| Anthropic API key (or AI off for the workspace) | AI writing, hashtags and "Plan with AI" hidden | Configuration → AI, and workspace settings |
| LinkedIn / Threads / X / Pinterest developer apps | Those networks show "needs a developer app" | Configuration → Other social networks; redirect `https://social.newsgeet.com/api/networks/<network>/callback` |
| Meta step 2 | Inbox and Instagram off | see above |

Bluesky (app password) and Mastodon (any server) work without setup; no live
post has been made to them yet — needs the owner to connect an account.

## Real data facts (useful for checks)

*The owner's own accounts, used only as live-test data — not product
assumptions. The product stays generic (README.md).*

- Facebook profiles connected: two "Mouad Sebhaoui" users; 12 Pages
  (Cuisine Pleine d'Envie ~3.6k followers, Cuisine Qui Réunit, For Lady's ~6.3k,
  La Cuisine Décontractée/Ensoleillée/Tranquille, Les Recettes Complices, Nos
  Recettes Généreuses, Recettes Sans Complication/Routine/Soucis, **DIY Page 3**
  = test sandbox, normally paused). Several ad accounts ("Recettes 1…9", "Top
  Recettes" active).
- Followers are mostly France, then Belgium and Canada.
- Meta no longer serves age/gender or language breakdowns for Pages
  (`(#100) The value must be a valid insights metric`).

## Open items / next steps

0. **Next session starts with [NEXT_PHASES.md](NEXT_PHASES.md) Phase 0** (Gmail
   SMTP email; Anthropic + OpenAI + Gemini with auto-fetched models and costs),
   **then G1–G3 (2-step sign-in, off-site backups, alerts), then Phase A**.
   Phase 0 is built (SMTP email; three AI providers; prices, costs and monthly
   budget); it waits on the owner entering the Gmail app password and AI keys.
   The app will be **sold as a service**: keep everything generic (CLAUDE.md
   rule 9) and see Phase S (legal pages still name Morocco — S1/S2) — the
   owner asked (2026-10-11) for one shared profile selection (single / multiple /
   group, show or hide) that planned, posted and analytics all obey; analytics
   across all selected profiles with every Meta metric; and a better design.
   Nothing of Phase A–D is built yet. Skills: `profile-selection`,
   `analytics-dashboard`, `frontend-design`.
1. Meta: wait for step 1; then step 2; then Live.
2. Owner configures Resend + Anthropic keys; then test emailed reports and AI
   planner live (needs owner OK to send an email).
3. First live posts to Bluesky/Mastodon once the owner connects them.
4. Remaining roadmap: [ROADMAP.md](ROADMAP.md).
5. Known minor UX: first click right after navigation occasionally lost in
   automation (possibly layout shift on Connections as "Connection check" loads)
   — investigate; analytics "Reactions by type" comes from Facebook insights and
   can differ slightly from the reactions total.

## Known issue (2026-10-13): calendar navigation in a production build, in the test sandbox

Running the browser walk against a production build (`E2E_PROD=1`, see
`playwright.config.ts`) shows two tests failing on the Calendar only:
`compose.spec.ts` "the calendar opens a post for editing, and starts a new one…"
(Next month link) and `selection.spec.ts` "the calendar filters by status…".
After the click the server answers the page request (200, whole body read in
about 60 ms) but the client router never commits the navigation: no
`pushState`, no console error, URL unchanged.

What was established:
- It passes on the development server, and at commits up to `6ec9a1a`; it
  starts at `1f0e47c` (Calendar controls moved into the channel column).
- It depends on the size of the page, not on one component: removing the feed
  button, the saved views or the label filter each makes it pass, and adding
  12 KB of hidden text to a passing build makes it fail again. The page's
  navigation payload is about 79 KB.
- Not compression (`compress: false` changes nothing), not link prefetching,
  not `loading.tsx`, not a missing chunk, not the sandbox proxy.
- Other screens navigate fine in the same build.

Not resolved. Check it in a real browser on the live site after a deploy
(Calendar › Next month, and a status filter). If it reproduces there, shrinking
the day-cell markup in `calendar/page.tsx` (about 1.6 KB per day) is the first
thing to try.

Update (2026-10-13): the Posts screen showed the same stall on its status tabs in
a production build (`posts.spec.ts` "every status a post can sit in has a tab…"),
so `posts/page.tsx` also uses plain links. Full production-build browser run on
the latest code: 411 passed, that one failure, now fixed. One other Posts test
("a contributor sends a draft for review from the list") fails intermittently
in the same mode, passing on most runs.
