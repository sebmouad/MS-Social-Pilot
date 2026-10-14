# Features, screen by screen

What the app does today, by area. Routes are under `src/app`. Every screen in
the signed-in app follows the shared channel selection in the sidebar (one
channel, several, a group, or a network filter) and the member's Page access.

## Shell

- Icon rail on the left with the areas (Home, Publish, Inbox, Analytics, Ads,
  Workspace); beside it the area's sidebar with grouped links, the client
  switcher, "New post", the channel column (search, groups, network filter,
  show / hide / solo, Page menu) and screen tools such as saved views and date
  range. A slim top bar holds utilities only: fold the sidebar, breadcrumb,
  account menu (account, Root for root, sign out).
- Command palette (Ctrl K) over every link the person may open.
- Phone: the sidebar becomes one drawer; "New post" stays one tap away.
- Themes: Facebook (default), Warm, Dark (Settings › Account). Right-to-left
  layout for right-to-left interface languages.
- PWA: manifest, icons, offline page, share target, shortcuts.

## Home: `/dashboard`

Getting-started checklist (connect, first post, queue, team, client link,
assistant; dismissible), setup card for root, token and failure warnings, Pages
hub (per Page: followers, next and last post, quick links), monthly goals per
Page (new followers, views, engagement, posts published) with progress and pace.
Token warnings follow the selected channels and the member's Page access.
`/welcome` walks a new workspace through name, time zone and audience, then
connecting Pages.

## Publish

- **Composer** `/compose`: Post, Reel or Story; many Pages and networks at once,
  with text per channel when wanted; snippets, emoji, counters; per-network
  limit warnings (`src/lib/network-rules.ts`); first comment with delay; link
  card; "Use page details" fills the text from the linked page's schema.org
  data and copies its pictures; photos and video with alt text (AI suggestion);
  place tag and `@[page-id]` mentions; coloured text backgrounds for short
  text-only posts; labels and custom fields; post templates with blanks;
  Schedule, Queue or Now (Now waits the undo-send delay); held by this app or
  natively by Facebook; approval for contributors; spam-risk guard (same link
  or near-identical text on many Pages) offering a staggered spread;
  engagement outlook (above / around / below the Page's usual, with reasons,
  never a number); caption A/B tests; AI write, improve, hashtags and
  translation per audience language; version history; internal notes with
  @mentions; Facebook-like preview. Prefill from `?title=&text=&url=`, `?to=`
  and `?at=`.
- **Calendar** `/calendar`: month, week and Page-feed views; drag to
  reschedule; drafts toggle; key days from the audiences' calendars; label
  filter; saved views; "Plan with AI" (a week of drafts); private ICS feed per
  member (Subscribe).
- **Key dates and seasons** `/calendar/dates`: the next 90 days of key days,
  the team's own dates (once or yearly, per Page), seasonal modes (pause, move
  times, fewer or more posts) that the queue applies.
- **Trends** `/calendar/trends`: today's Google Trends searches for the
  countries the audiences name, filtered to the workspace's subjects; "Make a
  post" opens the composer.
- **Queue** `/queue`: weekly slots per workspace or Page, suggested times from
  results, shuffle, clear; optional weekly job adding each Page's best new
  times. **Content mix** `/queue/mix`: posts per label per week per Page or
  group, planned against target, optional automatic filling from drafts.
- **CSV import** `/compose/import`: shared channel picker, CSV template, per-row scheduling results; available from Publish and linked from Settings. Author permissions and selected Page scope apply.
- **Posts** `/posts`: status tabs, search, filters, saved views, bulk actions,
  CSV export; per post: edit, duplicate, publish now, retry, retry first
  comment, cancel (removes Facebook-held copies), delete from Facebook.
- **Approvals** `/approvals`: list and board (draft, waiting, ready, sent back),
  client feedback counts; optional client step after the team's approval.
- **Templates** `/templates`: post structures by category; editors manage them.
- **Design** `/design`: a basic picture editor (size, colour or photo, text,
  shapes, starting templates, saved to the media library); AI image (OpenAI),
  AI video (Gemini Veo, polled by the worker) and AI voice (OpenAI speech, MP3
  not stored) when root has set the key. Models are fetched from each provider.
- **Content sources** `/feeds`: RSS/Atom or WordPress sites become scheduled
  posts (or wait for approval), with a caption template and optional spread.

## Inbox

- **All** `/inbox`: comments and messages on the selected channels in one
  stream; open / done shared by the team (a new message reopens it);
  assignment (All / Mine / Unassigned); private notes; replies from Bluesky and
  Mastodon come in too and are answered on the network. Messenger needs Meta's
  step-2 permissions.
- **Comments** `/inbox/comments` and **Reviews** `/inbox/reviews`: reply, hide,
  delete as the Page (a Page cannot hide its own comments).
- **Saved replies** `/inbox/replies` (editor+): typed `/` in any reply box,
  `{first_name}` and `{page}` filled in.
- **Moderation rules** `/inbox/rules` (editor+): hide, alert or reply on links,
  phone numbers or keywords in new comments; capped per day; a log with undo.
- **Response time** `/inbox/response-time`: waiting, answered share, median and
  slowest first answer, per member, within business hours.
- Negative-comment alert (Settings › AI): one email a day per Page when
  negative comments reach twice the usual.

## Analytics

- **`/analytics`** with four views: **Summary** (what changed, headline figures
  against the comparison window, trend, best posts, which channel moved, when
  to post), **Posts** (every post with its results, metric explorer),
  **Audience** (world map, countries, cities, followers gained and lost) and
  **Compare** (one line per channel or group, totals row). One channel or many,
  Facebook, Instagram and other networks together; totals follow
  `src/lib/aggregate.ts` (reach is never summed across channels; rates are
  recomputed). Period presets or custom, against the previous period or a year
  earlier. Detailed views still open from links: overview of every metric
  Facebook serves (pin a metric as a tile), interactions, videos, comments,
  reviews, inbox, response time, posts made outside the app, other networks.
  Chart notes (editor+), export menu, "last read" note instead of pull buttons.
- Audience totals add follower counts from every selected Facebook Page,
  Instagram account and other connected channel with a stored count. The
  screen lists each channel and reports how many supplied a value; missing
  values remain unknown. Follower growth adds only compatible Facebook follow
  metrics, excluding historical Page likes and networks without growth data.
  The period control preserves the shared channel selection. Overview exposes
  every stored Instagram account insight alongside the Facebook metric
  explorer, including numeric `total_value`, demographic breakdowns, profile
  counts and saved readings. Lifetime snapshots stay visible outside the
  selected posting range. Posts on Instagram and the other networks expose
  every stored per-post metric in a disclosure; the Videos view does the same
  for Facebook video metrics.
- Follower comparisons use a nearby stored Facebook follower snapshot at the
  comparison date. Missing or stale snapshots leave the change unavailable;
  historical Page likes are not treated as follower counts.
- The Summary's daily reach trend uses stored Page insights, including days
  without posts. Missing readings break the line instead of appearing as zero;
  multi-Page days require a reading from every selected Page.
- **Single post** `/analytics/post/[postTargetId]`.
- **Caption tests** `/analytics/tests`: A/B results, winner only past a minimum
  number of views; the result can feed the Page's AI voice.
- **Link clicks** `/analytics/links`: short-link clicks per day, Page, article
  and post, clicks per 1,000 views.
- **Campaigns** `/analytics/campaigns`: results by label.
- **Reports** `/reports`: sections checklist, branding, saved templates, PDF
  (print), CSV, scheduled emails with an optional AI recap.

## Ads: `/ads`

Ad accounts' results by level and period (needs `ads_read`). Each campaign,
ad set and ad exposes every stored numeric daily reading from its latest day,
including action dimensions, alongside additive action totals for the period.
Rates and unique reach remain daily readings instead of misleading sums.

## Workspace

- **Channels** `/connections`: grouped tables for Facebook profiles and Pages,
  Instagram profiles, ad accounts and other platforms. Newly discovered sources
  start unselected; an owner or admin chooses which channels to include with
  checkboxes. Disconnecting offers to retain related history or delete it.
  Members
  see only Connected or Needs reconnecting with Reconnect; permissions, tokens
  and raw errors are root's (Root › Platforms).
- **Team** `/settings/team`: invite by email (several at once), roles, Page
  access per member, client access switches, seat meter.
- **Tasks** `/tasks`: board (to do, doing, done) with assignee and due date;
  workflows whose steps become tasks one after another.
- **Client links** `/settings/sharing`: portal (review, calendar, results),
  review link (approve, request changes, comment, no account), calendar link;
  revocable, shown once.
- **Agency** `/agency` (workspace owners): every workspace they own side by
  side and a people × clients grid to give roles across them.
- **Settings** `/settings`: Workspace (time zone, business hours, approvals,
  UTM, shortener, undo send, AI voice, report branding, spam gap), Pages and
  groups (voice, audience, watermark, UTM, groups, labels), Link in bio
  (`/bio/<slug>` with click counts), Custom fields, AI agents (scheduled draft
  writers, never publish), API keys and Webhooks (only when root switched
  developer features on, and only root sees them), Notifications (email
  preferences, per Page × event mutes, Slack and Telegram channels), Account
  (name, language, theme, password, two-step, passkeys, signed-in browsers),
  Media library, History (admins), Export (owner: whole workspace as a ZIP),
  Permissions (root only).

## Root: `/root`

Overview; Settings (site address, AI providers with fetched models and costs,
storage, email, security, general, plans, sign-ups and invitations); Platforms
(Meta: app settings, feature switches, API usage, Facebook and Instagram
connections; one page per other network: switch, credentials, connections;
all connections with token health and problem counts); People (workspaces with
members, modules, suspend, open as owner, create, delete; users with disable,
sign out, delete; agency overview; privileges matrix; sessions); Health
(status with uptime, worker jobs, errors, alerts, backups); History (root
activity, changelog); Danger zone (transfer root).

## Public pages

`/login` (two-step, password reset), `/register` (first account, open
registration or an invitation; email confirmation), `/invite/[token]`,
`/share/[token]` (client view), `/bio/[slug]`, `/l/[slug]` (short links),
`/privacy-policy`, `/terms`, `/data-deletion` (operator details from root),
and, when root turns the product site on: `/` home, `/pricing`, `/help`,
`/changelog`, `/status`.

## Integrations

REST API `/api/v1` (pages, page analytics, posts, REST-hook webhooks for
Zapier, n8n or Make), MCP server `POST /api/mcp` with tools for queue,
templates, pages, posts (create, update, cancel, approve, request changes),
inbox (list, resolve, assign), attention and page analytics; OAuth 2.1 with
PKCE for remote assistants (`/oauth/authorize`). Outgoing signed webhooks.
Slack and Telegram alerts. All developer features are root-only and off by
default per workspace.

## Background jobs

The worker (`src/lib/scheduler/jobs.ts`) runs: publish, native reconcile, RSS,
evergreen, analytics, page insights, edges (comments, reviews, conversations,
outside posts, videos), first read, accounts, Instagram, ads, housekeeping,
token warnings, exports, holidays, alerts, reports, inbox digest, trends,
negative comments, client deadlines, empty queue, content mix, AI agents, AI
videos, caption tests, best times, webhooks.
