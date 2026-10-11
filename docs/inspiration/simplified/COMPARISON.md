# Simplified vs MS Social Pilot — full feature table

10 October 2026. Simplified explored end to end (every menu, tab, dialog and
setting reachable on the trial; nothing created or changed). MS Social Pilot
column checked against the code on `main` **on 10 Oct — most P1–P3 rows were
built since; current state is `docs/ai/FEATURES.md`.** The rest of the app was
crawled on 11 Oct: `CRAWL-2026-10-11.md`.

Legend: ✅ have · 🟡 partial · ❌ missing · ⛔ not worth adding.
Priority for "to add": **P1** next · **P2** soon · **P3** later.

## 1. Accounts & workspace

| Simplified | MS Social Pilot today | Status | To add | Prio |
|---|---|---|---|---|
| Connect Facebook Pages (many profiles) | Facebook Login for Business, many profiles & Pages | ✅ | — | |
| Instagram, LinkedIn, TikTok, X, YouTube, Pinterest… | Facebook + Instagram (IG off until review); groups off (Meta API gone) | 🟡 | Other networks only if needed | P3 |
| Accounts column: 👁 show/hide per account, search, "1/3" | Page picker / filters per screen | 🟡 | Persistent accounts sidebar with show/hide + search on Calendar, Queue, Posts | P1 |
| Account ⋮ menu: settings, reconnect, new post, shuffle queue, clear queue, clear drafts, delete | Connections screen: reconnect, enable/disable, remove | 🟡 | Same ⋮ menu everywhere a Page appears; shuffle/clear queue; clear drafts | P2 |
| Account groups ("New account group") | — | ❌ | Page groups (e.g. "Clients A", "Food Pages") usable as filter and as post target | P1 |
| Custom account image | Page photo from Facebook | ⛔ | — | |
| "Refresh account data" | Sync buttons per screen | ✅ | — | |
| Workspace & teamspaces | Workspaces with switcher | ✅ | — | |
| Seats per module, buy seats | — | ⛔ | — | |
| Roles Admin / Member / Creator / Approver | owner / admin / editor / contributor | ✅ | Rename/describe roles in UI like theirs (one line each) | P3 |
| Per-member, per-account access and role | Workspace-wide role only | ❌ | **Choose which Pages each member sees/manages** | P1 |
| Invite member, invitations tab | Team: invite, pending invitations | ✅ | — | |
| Setup checklist (2/5, minutes left) | Setup wizard | 🟡 | Persistent "Getting started 3/5" card on dashboard | P3 |
| AI assistants & MCP connection, public API | — | ❌ | API tokens + MCP for Claude | P3 |
| Custom domain, custom fields | — | ⛔ | — | |
| Mobile apps iOS/Android, Chrome extension | Responsive web (phone tested) | 🟡 | PWA install + "share to MS Social Pilot" extension | P3 |

## 2. Publishing — views

| Simplified | MS Social Pilot today | Status | To add | Prio |
|---|---|---|---|---|
| Calendar month view | Calendar month (Facebook style) | ✅ | — | |
| Calendar week / day views ("Mois ▾") | Month only | ❌ | Week view with time rows; day view | P2 |
| Drafts overlay toggle on calendar | Drafts in Posts only | ❌ | "Show drafts" toggle | P2 |
| Awareness days on calendar (World Coffee Day…) | — | ❌ | Holiday/awareness-day chips (FR/MA + international), click → compose | P2 |
| Day hover actions (idea 💡, new post ⊕) | Click day → compose | 🟡 | Hover ⊕ and "idea" (AI suggestion) | P3 |
| Today button, current time + timezone in header | Month nav, workspace timezone | 🟡 | Today button + clock/timezone chip | P3 |
| List view: Upcoming / Past | Posts timeline + Queue | ✅ | — | |
| Feed preview ("Flux entrant") per account | — | ❌ | Page feed preview: upcoming posts rendered as the Page's timeline | P2 |
| Grid view | — | ⛔ | (Instagram-grid; only if IG on) | P3 |
| Search posts, filters, export posts | Posts search/filter; CSV export in analytics | 🟡 | Export scheduled posts (CSV) from Posts/Calendar | P3 |
| Archives (archived / past posts) | Posts history | ✅ | — | |

## 3. Composer

| Simplified | MS Social Pilot today | Status | To add | Prio |
|---|---|---|---|---|
| Multi-account selection + groups | Multi-Page targets | 🟡 | Select a Page group in one click | P1 |
| Shared draft + per-network tab override | Per-target variants | ✅ | — | |
| Post / Reel / Story type | Feed post (photo, video, link, text); IG reels/carousel code ready | 🟡 | **Facebook Reels and Stories** | P2 |
| Media: upload, media library, AI images | Upload + media library | 🟡 | AI image generation | P3 |
| Coloured background text posts (Aa) | — | ❌ | Facebook text-background presets | P3 |
| Location tag | — | ❌ | Place/location search | P3 |
| @ mentions | — | ❌ | Mention Pages | P3 |
| AI assistant | AI assist (write/rewrite) | ✅ | — | |
| # hashtag suggestions (AI) | Hashtag help via AI / first comment | 🟡 | Hashtag suggester with confirm before spending | P3 |
| Snippets / saved texts | — | ❌ | Saved snippets (signatures, CTAs, hashtag sets) | P2 |
| Emoji picker | — | ❌ | Emoji picker | P3 |
| Counters (chars, #, @) | Character count | 🟡 | Hashtag and mention counters | P3 |
| **First comment** | First comment | ✅ | — | |
| First comment **delay** (days/hours/minutes) | Posted right after | ❌ | Delay selector | P1 |
| Labels / tags on posts | — | ❌ | Labels (campaign, client, theme) + filter everywhere | P1 |
| Save as group (multi-post) | — | ⛔ | — | |
| Save draft | Draft | ✅ | — | |
| Split button: Schedule ▾ / Add to queue / Publish now | Publish now / schedule / queue in form | 🟡 | One split button like theirs | P1 |
| Live Facebook preview | Post preview (Facebook style) | ✅ | — | |
| Bulk AI posts | — | ❌ | "Plan a week" AI generator → drafts | P3 |
| Bulk import CSV | Bulk CSV upload | ✅ | — | |
| Link shortening + UTM | Short links + click tracking + UTM (workspace) | ✅ | — | |
| UTM per account | Workspace-level UTM | 🟡 | UTM override per Page | P3 |
| Evergreen / recycle | Recycle (evergreen) + duplicate | ✅ | (Simplified has no equivalent) | |
| RSS feeds → posts | RSS feeds | ✅ | (Simplified has no equivalent) | |

## 4. Queue & best time

| Simplified | MS Social Pilot today | Status | To add | Prio |
|---|---|---|---|---|
| Time slots per account (or all) per weekday | Workspace queue slots (day + time) | 🟡 | **Slots per Page** | P1 |
| AI "best time to post" fills slots | Best-time heatmap in Page analysis | 🟡 | "Use best times" button that creates slots from the heatmap | P2 |
| Shuffle / clear queue | — | ❌ | Shuffle + clear per Page | P2 |

## 5. Drafts & approvals

| Simplified | MS Social Pilot today | Status | To add | Prio |
|---|---|---|---|---|
| Kanban: Draft → Pending → Ready → Rejected | Approvals list (pending/approve/reject + note) | 🟡 | Board view of the same statuses | P2 |
| Auto-schedule after approval (toggle) | Approval schedules at the set time | 🟡 | Setting toggle + "needs a date" warning | P3 |
| Client review link (no login), bundles, comments | — | ❌ | **Share link for a client to approve/reject/comment** | P2 |
| Shared read-only calendar link | — | ❌ | Public calendar link per client (choose Pages, date range, revoke) | P2 |
| Client portal (branded) | — | ❌ | Later, combine the two above | P3 |
| Slack notifications for reviews | Email notifications | 🟡 | Slack/Telegram webhook | P3 |

## 6. Analytics

| Simplified | MS Social Pilot today | Status | To add | Prio |
|---|---|---|---|---|
| Shared date range: 7/30/90 + custom | Shared range: today, yesterday, 7/30/90, all time, custom | ✅ | — | |
| Comparison period shown + editable | Previous period comparison | 🟡 | Show and edit comparison in the picker | P2 |
| KPI cards with change pill + sparkline | KPI tiles with change | 🟡 | Sparkline in each card | P1 |
| KPI cards toggle the big chart | Separate charts | ❌ | Card = series toggle (**one axis per series**) | P1 |
| Chart hover tooltip listing all series | Chart tooltips | ✅ | — | |
| Best day / best frequency tiles | Best-time heatmap | 🟡 | Two plain-language tiles at top | P1 |
| Engagement, impressions, reach, posts, reactions, post engagements | All of these + more (Metricool-style) | ✅ | — | |
| Audience growth, new fans, total followers | Follower trend | ✅ | Mark deprecated metrics clearly | |
| Countries and cities (fans / reach) + map | Audience section with countries/cities bars | 🟡 | World map + fans/reach switch | P2 |
| Post table: sortable, 10/25/50, source filter | Post analytics table | 🟡 | Filter "published via app / elsewhere"; page size | P1 |
| Post detail modal + "Open post" | Post metrics page + link | ✅ | — | |
| Overview of all accounts | Workspace overview + compare Pages | ✅ | — | |
| Account groups in analytics | — | ❌ | Analytics by Page group | P2 |
| ⓘ metric definitions | Some hints | 🟡 | ⓘ on every metric (focusable) | P2 |
| Competitor analytics (ads, posts, growth) | — | ❌ | Track public Pages + Ad Library (needs permissions) | P3 |
| Inbox (paid add-on) | Inbox (Messenger) + Comments + Reviews | ✅ | (we're ahead) | |
| Ads results | Ads read (spend, CPC, campaigns) | ✅ | (Simplified has none) | |
| Videos analytics | Videos view | ✅ | (Simplified has none) | |

## 7. Reports

| Simplified | MS Social Pilot today | Status | To add | Prio |
|---|---|---|---|---|
| Report builder: accounts, period | Reports page with range + Pages | ✅ | — | |
| Formats PDF / PNG | CSV + print (PDF through browser) | 🟡 | One-click PDF | P2 |
| Excel export | CSV export | ✅ | — | |
| Modules checklist (choose sections) | Fixed report | ❌ | Section checklist | P1 |
| Branding: cover logo, title, subtitle, footer text/logo | — | ❌ | Branding fields | P1 |
| Save as template / My templates | — | ❌ | Report templates | P2 |
| Best posts cards in report | Top posts (FeedPost grid) | ✅ | — | |
| Scheduled email of reports | — | ❌ | Weekly/monthly email to client | P2 |

## 8. Other Simplified modules (outside social)

| Simplified | Relevance for MS Social Pilot | Status | Decision |
|---|---|---|---|
| Riley AI agent (chat that creates posts, campaigns, reports) | Nice for "plan a week" | ❌ | P3 — via our AI assist |
| Agents catalogue (scheduled agents) | Low | ⛔ | — |
| Projects (designs, videos, docs) / graphic editor | Low — use Canva | ⛔ | — |
| Assets library (drag & drop, from mobile) | Media library exists | ✅ | — |
| AI Hub (product photos, video, logos, tools) | Low | ⛔ | — |
| Brand Book (voice, audience, products) | Useful for AI writing | ❌ | P3 — "Brand voice" per Page for AI assist |
| Tasks / project management | Low | ⛔ | — |
| Workflows (automation templates) | Low | ⛔ | — |
| Link in bio | Low | ⛔ | — |

## 9. Where MS Social Pilot is already ahead

Inbox + comments + reviews free, ads results, video analytics, evergreen
recycling, RSS-to-post, short links with click tracking, per-target variants,
Metricool-style analysis (heatmap, best/weakest posts), Facebook-style post
cards everywhere, Meta call budget protection, data-deletion flow.

---

## Build order proposal

**P1 (next sprint)**
1. Page groups + per-member Page access
2. Accounts sidebar with show/hide on Calendar, Queue, Posts
3. Queue slots per Page
4. Labels on posts + filters
5. First-comment delay
6. Composer split button (Schedule ▾ / Add to queue / Publish now)
7. Analytics: KPI cards with sparklines that toggle the chart (one axis each), best day / best frequency tiles, post table source filter + page size
8. Reports: section checklist + branding

**P2**
Week/day calendar, drafts toggle, awareness days, feed preview, FB Reels &
Stories, snippets, "use best times" slots, shuffle/clear queue, approvals
board, client review link, shared calendar link, comparison in picker, map,
ⓘ everywhere, PDF export, report templates, scheduled report emails,
analytics by group.

**P3**
Other networks, API/MCP, PWA/extension, AI images, backgrounds, location,
mentions, emoji, counters, bulk AI week plan, UTM per Page, Slack/Telegram,
client portal, competitor tracking, brand voice.
