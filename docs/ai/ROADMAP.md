# Roadmap — what is left

**The ordered build plan is [NEXT_PHASES.md](NEXT_PHASES.md)** (Phase A: one
profile selection everywhere; B: multi-profile analytics with every Meta metric;
C: publishing views; D: design pass; D2: owner's picks — icon rail shell, warm
theme, Sheets, cloud media, competitor tracking, referrals). This file is the
full backlog. Phase G (18 owner-approved additions: security, WordPress
auto-share, spam guard, moderation, translation, more UI languages, ops) is in
NEXT_PHASES, then Phase H (20 more: target audience per Page, content mix,
cultural calendars, structured-data posts,
undo send, webhooks, calendar feed, goals, agency overview, …). Items the owner decided out on 2026-10-11 are listed at the end of
NEXT_PHASES Phase D2 — remove them from consideration.

Ordered by value. Check `docs/inspiration/simplified/COMPARISON.md` for the
competitor baseline. Each item: build → unit + browser tests → deploy → verify
live in the owner's Chrome.

## Blocked on the owner or Meta
1. **Meta App Review step 2** (Inbox + Instagram) once step 1 is decided —
   package in `docs/meta-review/step2-inbox-instagram.md`. Then Live mode.
2. **Email** (Gmail app password via SMTP, or Resend key — NEXT_PHASES Phase 0) → verify scheduled report emails and alerts live.
3. **AI** (Anthropic, OpenAI or Gemini key — Phase 0; workspace AI on) → verify AI writing, hashtags, Plan
   with AI live. Default model is set in Configuration → AI.
4. **Developer apps** for LinkedIn, Threads, X, Pinterest → first live posts.
5. **First live Bluesky / Mastodon posts** (owner connects an account, OKs a test).

## Product gaps vs. competitors
- Analytics for the other networks: **started 2026-10-13** — Bluesky (public
  AppView), Mastodon (the account's server), X (`tweet.read` public metrics)
  and YouTube (`youtube.readonly` statistics) post counters are read by the
  analytics job and shown under Analytics → Other networks. Still to add, each
  needing a scope the app does not ask for yet: Threads
  (`threads_manage_insights`), LinkedIn (`r_member_social`, restricted),
  TikTok (`video.list`, and the post's video id), Pinterest (pin analytics).
- Video for Bluesky, X (chunked upload), Pinterest (video pins); YouTube and
  TikTok connectors (TikTok needs an audit; unaudited apps post privately).
- AI images (needs an image-generation provider + key; add as a Configuration
  setting, generate into the media library, never publish directly).
- Unified inbox across networks: Bluesky and Mastodon replies are read into the Inbox (answered on the network for now); Facebook Messenger/Instagram DMs after Meta step 2.
- Competitor tracking (public Page benchmarks) — needs Meta Page Public Content
  Access; Ad Library search.
- Location tags and @mentions of Pages — need Meta features the app does not have.
- Facebook coloured text backgrounds — not in the Graph API.
- Bulk edit (select many posts → reschedule/label/delete).
- Drag-and-drop rescheduling on the calendar.
- Hashtag groups manager (snippets cover part of it).
- Link-in-bio page; short-link analytics dashboard.
- Approval workflow with multiple steps (client then internal).
- Data export of everything (GDPR) per workspace.

## UX polish backlog
- Connections page is long: consider tabs (Facebook / Other networks / Ads &
  Instagram) or anchor chips at the top.
- Post card header still shows the post-level status; consider per-network chips.
- Investigate the occasional lost first click after navigation (layout shift?).
- Compose: show the first comment inside the Facebook preview.
- Calendar month cells are narrow at 1280–1440 px with both sidebars open; allow
  collapsing the Pages column.
- Empty states for Video/Reviews could explain what fills them.
- Dark mode (tokens are centralised in `tailwind.config.ts`).

## Engineering
- Fix the old daylight-saving unit test.
- Lint setup (ESLint flat config) — none today.
- Graph API version bumps: `FACEBOOK_GRAPH_VERSION`; ratings need v21
  (`RATINGS_GRAPH_VERSION`, retires when Meta retires v21).
