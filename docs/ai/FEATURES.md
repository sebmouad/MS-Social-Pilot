# Feature inventory (screen by screen)

App shell (like Simplified): a narrow **icon rail** on the far left with the
main areas — **Home** · **Publish** (Calendar, Queue, Content mix, Templates, Posts, Approvals, Website
auto-share, Trending; also the composer) · **Inbox** · **Analytics** (Pages, Reports, Caption tests, Link clicks) ·
**Ads** · **Workspace** (Connections, Client links, Settings), Root at the
bottom for root. Beside it the **sidebar** with the area's pages, the client
switcher and "New post". A slim **top bar** holds utilities only: fold the
sidebar (remembered), breadcrumb, workspace settings, account menu (your
account, sign out). Phone: one drawer with every page, grouped.

## Home — `/dashboard`
Getting-started checklist (connect, first post, queue, team, client link, Claude;
dismissible), setup banner, token-expiry and failure warnings, Pages hub (per
Page: followers, next/last post, quick Write/Inbox/Comments/Insights).
"Goals this month" card (H12): monthly targets per Page (new followers, views,
engagement, posts published) with progress bars and pace (reached / on track /
behind / no data yet), read from stored insights; admins set them with "Set goals".

## Publishing
- **Compose** `/compose` (`Composer.tsx`): Post / Reel / Story; multi-Page and
  multi-network targets with search and groups; text with saved snippets, emoji,
  character/#/@ counters; per-network limit warnings; first comment + delay;
  link with Open Graph card; "Use page details" reads the linked page's
  schema.org JSON-LD (product, event, recipe, job, course, how-to, place,
  article) and fills the text from a template (key facts, price and offer,
  countdown, steps), copying its pictures into the media library; photos/video with alt text (AI can suggest it for a photo, H5); labels; Schedule /
  Queue / Now (Now waits the workspace's undo-send delay with an Undo that
  turns it back into a draft); who holds it (this app or Facebook-native); approval submit for
  contributors; spam-risk guard (same link or near-identical text on 3+ Pages of
  one network within the workspace gap, Settings → General) warns and offers
  one post per Page N minutes apart, optionally reworded per Page by AI;
  engagement outlook for the first Page (H6: likely above / around / below
  the Page's usual, with the reasons: format, length, time, day; never a number);
  AI: generate, improve, hashtags, translate for each Page's audience language
  (one editable version per language, right-to-left where needed, saved as one
  post per language) (needs an AI key); Facebook-like
  preview (phone frame for Stories/Reels). Prefill from `?title=&text=&url=` (phone
  share target), `?to=<targetId>`, `?at=<local time>`.
- **Calendar** `/calendar`: Month / Week / Page feed views, drafts toggle,
  key days from the selected Pages' audiences (calendars, public holidays,
  the team's own dates; click → compose with a first line), labels filter, Pages column
  with show/hide/solo + ⋮ Page menu, "Plan with AI" (week of drafts).
- **Key dates & seasons** `/calendar/dates`: the next 90 days of key days,
  custom dates (once or yearly, per Page), seasonal modes (pause, move times,
  fewer, more) that the queue applies. Admins edit; everyone reads.
- **Trending** `/calendar/trends` (H7): today's Google Trends searches for
  each country the selected Pages' audiences name, with traffic and a news
  link; kept to the workspace's subjects (admins set words; empty shows
  all); "Make a post" opens Compose with the topic.
- **Queue** `/queue`: weekly slots (workspace or per Page), suggested times from
  results, add-all-suggested, shuffle, clear (back to drafts). With Settings ›
  "Best times per Page" set to add, a weekly job adds each Page's best new
  times as its own (two a week, 14 at most) and the screen lists what it added.
- **Templates** `/templates`: saved post structures by category (text with
  `{blanks}`, hashtags, first comment, label); picked from Compose ›
  Templates, which asks for each blank. Editors and up manage them.
- **Version history** (Compose › History, editing a post): every save keeps
  a version (text, first comment, link, media, Pages, labels, time, who; 50
  per post). Lists what each save changed, compares a version's text with the
  form word by word, and loads one back; saving it is a normal save.
- **Internal notes** (Compose › Notes when editing, Approvals card › Notes;
  a count on calendar chips): a team-only thread on each post, never
  published. `@` suggests members who may see the post's Pages; those
  mentioned are emailed (Settings › Notifications, on by default).
- **Calendar feed** (Calendar › Subscribe): a private ICS address per member
  for the sidebar's selection (Pages or group), for Google Calendar, Outlook
  or Apple Calendar. Scheduled, waiting-approval and sent posts from 30 days
  back to 180 ahead; always clamped to the Pages the member may see now; dead
  once revoked or the member leaves. Shown once (stored hashed).
- **Content mix** `/queue/mix`: per Page or group, how many posts of each
  label the coming 7 days should hold; a table of planned vs target with
  ready drafts per Page (selection-aware). Admins edit; with "Fill gaps from
  drafts automatically" an hourly job queues the oldest eligible labelled
  draft into the next free queue time (never a draft still needing approval),
  and owners/admins/editors get one email when a label runs dry.
- **Posts** `/posts`: status tabs, search, Page/label/group filters, export CSV;
  per post: edit, duplicate, publish now, retry, retry first comment, cancel
  (removes Facebook-held copies), **delete from Facebook** (published).
- **Approvals** `/approvals`: review list and Board (Draft / Waiting / Ready /
  Sent back) with client feedback counts.
- **Website auto-share** `/feeds`: each site is an RSS/Atom feed or a WordPress
  site (REST API, featured image kept for the link card); caption template with
  `{title}`, `{excerpt}`, `{link}`, `{hashtags}`; optional spread (one Page every
  N minutes, one post per Page); new articles become scheduled posts, or wait
  for approval when auto-approve is off. UTM per Page applies at publish time.

## Analytics
- **Pages** `/analytics?view=…`: All profiles (default with 2+ selected: summed
  tiles, reach "up to", top profiles), Analysis (health score, what stands out, best
  day/frequency, KPI cards with sparklines + ⓘ definitions, day-by-day chart with dated notes (H13, editors add/remove; shown in reports),
  cadence, best-time heatmap, formats/hashtags/captions, top/bottom posts),
  Compare pages (by group, line per profile with legend toggles, totals row),
  Overview (every metric Facebook serves, technical coverage folded, ★ pins a
  metric as a tile on Analysis / All profiles), By post (all selected profiles
  or one), Response time (H11: per Page, comments and messages, waiting /
  answered share / median and slowest first answer / median until done; per
  member who answered, Facebook-side answers grouped; business hours from
  Settings; also a report section), Interaction, Audience (world map, cities,
  followers gained/lost), Video, Comments (pull, reply, hide, delete), Reviews,
  Inbox (after Meta step 2), Other posts (posted outside the app), Instagram (when
  on). Date range presets + custom; compare with previous period or a year earlier.
  Export menu.
- **Caption tests** `/analytics/tests`: A/B tests started from the composer
  ("A/B test the caption", up to four captions, compare after 1, 2, 3 or 7
  days). With at least as many Pages as captions the Pages are shared out and
  all go out together; otherwise each Page gets every caption, one a day. The
  worker compares engagements per view from synced insights and names a winner
  only when every caption reached the test's minimum views (500); otherwise it
  says why. Admins can add the result to the Pages' voice for the AI.
- **Link clicks** `/analytics/links`: clicks on the app's short links per day,
  Page, article (tracking tags ignored) and post, with clicks per 1,000 views;
  follows the selection and the period. Empty state says when the shortener is off.
- **Reports** `/reports`: per Page, sections checklist, branding (logo, title,
  subtitle, footer), saved templates, Download PDF (print), CSV, scheduled email
  (weekly/monthly to any address), optional AI recap paragraph at the top of the
  email (compares with the previous period; never invents causes).
- **Ads** `/ads`: ad accounts performance (ads_read).
- **Inbox** `/inbox`: comments and messages from people on the selected Pages in
  one stream, newest first; filter by type and by open / done / all; "Mark done"
  is shared by the team and a new message from the other person reopens it;
  Reply opens the thread in Analytics. Dashboard shortcut shows the open count.
- **Saved replies** `/inbox/replies` (editor+): the workspace's reusable answers;
  in every comment and Messenger reply box, type `/` (filters by name or text,
  Enter picks the first) or use the button; `{first_name}` and `{page}` are
  filled in, then the text can be edited before sending.
- **Moderation rules** `/inbox/rules` (editor+): rules for every Facebook Page or
  chosen Pages that look for links, phone numbers or keywords in new comments
  and hide them, alert the team (email, preference "moderation alert") or reply
  as the Page (`{first_name}`, `{page}`; once per person optional). The worker
  applies them when it reads comments, once per comment, only to comments under
  48 hours old and never to the Page's own; a daily cap per rule and a stop on
  Facebook's rate-limit errors protect the app's allowance. A log lists the
  last 50 actions with "Show comment again" / "Delete reply" to undo.
- **Negative-comment alert** (Settings › AI, H15): AI reads new comments' mood
  hourly; one email a day per Page when negative comments reach at least
  twice the Page's usual (3 or more in 24 hours).

## Workspace
- **Connections** `/connections`: Facebook profiles → Pages (enable/pause,
  remove), Pages left by a disconnected account (remove),
  token health checks, what each connection can do in plain words (Meta app settings are in Root › Configuration), Instagram and ad accounts,
  **Other networks** cards (Bluesky, Mastodon, LinkedIn, Threads, X, Pinterest).
- **Client links** `/settings/sharing`: portal (to review + calendar + results),
  review link (approve / request changes / comment, no account), calendar link
  (read-only, includes Facebook-side posts); revocable; shown once.
- **Settings**: Workspace (timezone, business hours, approvals, UTM, shortener, undo send, AI voice, report
  branding), Team (roles owner/admin/editor/contributor, per-Page access, roles
  guide), Pages & groups (per-Page voice, audience, watermark & UTM, groups, labels; audience =
  countries, languages, time zone, cultural calendars, with workspace defaults
  and suggestions from the Page's followers), API & Claude
  (keys, step-by-step MCP setup for Claude Code, Claude Desktop, Cursor and VS Code,
  REST instructions), Notifications (email prefs incl. hourly new-inbox email,
  per-Page × event mutes, Slack/Telegram channels), Account (name, language,
  look: Facebook, Warm or Dark theme, password, signed-in browsers with device, place, last seen and sign-out per row;
  email on a sign-in from a new browser; two-step), Webhooks (admins: signed
  POSTs for post scheduled/published/failed, new comment, Page disconnected,
  report sent; test, delivery log, send again), Media library, History (activity log), Export (owner: whole workspace as a ZIP, 7-day link), Configuration
  (owner: runtime settings incl. network app keys).

## Public
`/share/<token>` client view, `/privacy-policy`, `/terms`, `/data-deletion`, Terms and Privacy read the operator details root sets in Configuration › "Operator and legal pages".
`/login` (with "Forgot your password?" → `/forgot-password`, `/reset-password`), `/register` (first account / open registration; a self-service sign-up confirms its address at `/verify-email` first; a new workspace then opens on the `/welcome` steps: name, time zone, audience, then connect Pages), `/invite/<token>`.

## Root — `/root/*`
Overview, Agency overview (H14: every workspace's Pages, disconnected Pages,
scheduled, failed in 30 days, follower change, engagement, AI spend; sortable,
each row opens the workspace), Status (app, database, worker, last publish, last off-site backup,
90-day uptime bars), Configuration, Workspaces, Users, Sessions, Registration,
Privileges, Worker (jobs and Meta usage: app share, per-Page share, and
the last hour's calls per Page and per job, H16), Errors (server, worker and browser
errors grouped, scrubbed, with release; mark resolved), Alerts, Backups, Activity, Danger zone.

## Background (worker, `src/lib/scheduler/jobs.ts`)
publish (every few seconds), native reconcile, RSS, evergreen recycling,
analytics (post insights), page insights, edges (comments, reviews, inbox,
external posts, videos), Instagram, ads, housekeeping, token expiry warnings,
scheduled reports (every 10 min), outgoing webhooks (every 30 s), inbox digest email (hourly), empty-queue email (hourly), negative-comment alert (hourly, AI), trending topics (hourly, Google Trends feed).

## Integrations
REST `/api/v1/pages`, `/api/v1/pages/:id/analytics`, `/api/v1/posts` (GET with `status`, `from`, `to`, `limit`, `pages=id,id`; POST),
`/api/v1/webhooks` (REST-hook subscribe for Zapier / n8n / Make; owner/admin write key);
MCP `POST /api/mcp` (tools: list_pages, list_posts, create_post, update_post, cancel_post, approve_post, request_changes, list_inbox, resolve_inbox_item, get_attention,
get_page_analytics); API keys read or read/write, acting as their owner. PWA
(manifest, icons, offline page, share target, shortcuts). Slack incoming
webhooks, Telegram bots.

## Saved views (2026-10-13)
Calendar and Posts: in the channel column, "My views" lists the person's saved
combinations of channels, labels and filters, one click to reopen; "Save this
view" names the current one. Per person and screen (`saved_views`); the date
or page being looked at is not part of a view. `/api/saved-views`.
