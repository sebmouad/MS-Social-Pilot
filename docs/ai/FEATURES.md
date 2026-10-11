# Feature inventory (screen by screen)

Sidebar groups: **Home** · **Publishing** (Calendar, Queue, Posts, Approvals,
RSS feeds) · **Analytics** (Pages, Reports, Ads) · **Workspace** (Connections,
Client links, Settings). "New post" button at the top. Workspace (client)
switcher at the top. Collapses to icons; drawer on phones.

## Home — `/dashboard`
Getting-started checklist (connect, first post, queue, team, client link, Claude;
dismissible), setup banner, token-expiry and failure warnings, Pages hub (per
Page: followers, next/last post, quick Write/Inbox/Comments/Insights).

## Publishing
- **Compose** `/compose` (`Composer.tsx`): Post / Reel / Story; multi-Page and
  multi-network targets with search and groups; text with saved snippets, emoji,
  character/#/@ counters; per-network limit warnings; first comment + delay;
  link with Open Graph card; photos/video with alt text; labels; Schedule /
  Queue / Now; who holds it (this app or Facebook-native); approval submit for
  contributors; AI: generate, improve, hashtags (needs Anthropic key); Facebook-like
  preview (phone frame for Stories/Reels). Prefill from `?title=&text=&url=` (phone
  share target), `?to=<targetId>`, `?at=<local time>`.
- **Calendar** `/calendar`: Month / Week / Page feed views, drafts toggle,
  awareness days (click → compose with a first line), labels filter, Pages column
  with show/hide/solo + ⋮ Page menu, "Plan with AI" (week of drafts).
- **Queue** `/queue`: weekly slots (workspace or per Page), suggested times from
  results, add-all-suggested, shuffle, clear (back to drafts).
- **Posts** `/posts`: status tabs, search, Page/label/group filters, export CSV;
  per post: edit, duplicate, publish now, retry, retry first comment, cancel
  (removes Facebook-held copies), **delete from Facebook** (published).
- **Approvals** `/approvals`: review list and Board (Draft / Waiting / Ready /
  Sent back) with client feedback counts.
- **RSS feeds** `/feeds`: auto-posting from feeds.

## Analytics
- **Pages** `/analytics?view=…`: Analysis (health score, what stands out, best
  day/frequency, KPI cards with sparklines + ⓘ definitions, day-by-day chart,
  cadence, best-time heatmap, formats/hashtags/captions, top/bottom posts),
  Compare pages (by group, totals row), Overview (every metric Facebook serves,
  technical coverage folded), By post, Interaction, Audience (world map, cities,
  followers gained/lost), Video, Comments (pull, reply, hide, delete), Reviews,
  Inbox (after Meta step 2), Other posts (posted outside the app), Instagram (when
  on). Date range presets + custom; compare with previous period or a year earlier.
  Export menu.
- **Reports** `/reports`: per Page, sections checklist, branding (logo, title,
  subtitle, footer), saved templates, Download PDF (print), CSV, scheduled email
  (weekly/monthly to any address).
- **Ads** `/ads`: ad accounts performance (ads_read).

## Workspace
- **Connections** `/connections`: Facebook profiles → Pages (enable/pause),
  token health checks, Meta app settings helper, Instagram and ad accounts,
  **Other networks** cards (Bluesky, Mastodon, LinkedIn, Threads, X, Pinterest).
- **Client links** `/settings/sharing`: portal (to review + calendar + results),
  review link (approve / request changes / comment, no account), calendar link
  (read-only, includes Facebook-side posts); revocable; shown once.
- **Settings**: Workspace (timezone, approvals, UTM, shortener, AI voice, report
  branding), Team (roles owner/admin/editor/contributor, per-Page access, roles
  guide), Pages & groups (per-Page voice & UTM, groups, labels), API & Claude
  (keys, MCP + REST instructions), Notifications (email prefs, Slack/Telegram
  channels), Account, Media library, History (activity log), Configuration
  (owner: runtime settings incl. network app keys).

## Public
`/share/<token>` client view, `/privacy-policy`, `/terms`, `/data-deletion`,
`/login`, `/register` (first account / open registration), `/invite/<token>`.

## Background (worker, `src/lib/scheduler/jobs.ts`)
publish (every few seconds), native reconcile, RSS, evergreen recycling,
analytics (post insights), page insights, edges (comments, reviews, inbox,
external posts, videos), Instagram, ads, housekeeping, token expiry warnings,
scheduled reports (every 10 min).

## Integrations
REST `/api/v1/pages`, `/api/v1/pages/:id/analytics`, `/api/v1/posts` (GET/POST);
MCP `POST /api/mcp` (tools: list_pages, list_posts, create_post,
get_page_analytics); API keys read or read/write, acting as their owner. PWA
(manifest, icons, offline page, share target, shortcuts). Slack incoming
webhooks, Telegram bots.
