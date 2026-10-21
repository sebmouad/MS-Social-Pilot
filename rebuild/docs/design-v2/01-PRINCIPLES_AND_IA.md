# 01. Principles and information architecture

## 1. Why v2

Observed on local synthetic data at `99c4155` (screenshots of 1440 px and 390 px):

| Problem | Evidence |
|---|---|
| Too many places | 45 customer pages and 8 modules in the rail. Sidebars have 10 links in Publishing, 11 in Settings and 9 in Analytics. "Ads reporting" and "Compare" exist in both Analytics and Ads. |
| Too much chrome | A 84 px rail plus a 252 px context sidebar sit before content. The sidebar repeats the app name, workspace, New post and filters on every page. |
| Split attention in the composer | You pick channels in the sidebar, yet step 1 says "choose channels in the sidebar". Save/Schedule sit in the sidebar, far from the text. Five numbered sections. |
| Caveats before numbers | Analytics is 2,800 px tall and Ads is 3,600 px. Every card repeats "Stored calendar dates (UTC)", "Latest 1 of 1 stored dates shown…" and "Missing values are unknown, not zero". |
| Internal words reach customers | "stored", "UTC", "resource", "platform hold", "local enabled state", "provenance", internal IDs, 8 "Allowed" permission lines per connection. |
| Weak phone layout | Each post card is about 300 px tall with uppercase labels, so 2 posts fit per screen. |
| Inconsistent controls | 3 dropdown styles, 5 filter behaviours and 6 channel parameter names (`channel`, `channelId`, `target`, `targets`, `targetIds`, `channels`). See the design audit. |

## 2. Research basis (2026)

| Source | Pattern adopted |
|---|---|
| Buffer redesign (March 2026, "calmer, clearer") | One sidebar holding the work areas **and** the channel list. Selecting a channel takes you to that channel in the current area. The menu is shorter when there is less to manage. |
| Vercel dashboard (Feb 2026) | One resizable, hideable sidebar. The same tabs appear at every level. The most common tasks come first. Projects act as filters (one-click scope switch). Phones get a floating bottom bar. |
| GitHub Primer navigation | The sidebar is for navigation. Filters sit behind a Filter button in the content header, opening a menu (a bottom sheet on narrow screens). Menus stay under ~15 items. Tabs sit directly above the content they change. |
| Meta Business Suite composer | One panel: platforms, then media and caption, with a live preview beside it. Publish / Schedule / Finish later are together at the bottom. |
| Sprout Social reports | A short performance summary up front. Hovering a metric shows its definition and availability, with a "Learn more" link. |
| Later | Calendar-first planning. Queue slots are visible on the calendar. Drag media onto a day. |

Links are in [README](README.md) and the session report; they were current on 2026-10-21.

## 3. Principles (apply to every screen)

1. **One job per screen, first thing first.** The top of each screen answers its main question: what is scheduled, who is waiting, how did we do.
2. **Few places, many tabs.** Four work areas. Sub-features are tabs or panels, not menu pages.
3. **Channels are the scope.** The channel list in the sidebar filters every channel-aware page. The same choice appears everywhere.
4. **Numbers first, caveats one click away.** Every number has an ⓘ that explains coverage, period, missing data and source. Never hide a caveat; never lead with it.
5. **Customer words only.** No provider jargon, internal IDs, storage terms or setup instructions on customer screens. Root keeps technical detail.
6. **Actions where the eyes are.** The primary action is in the page header or a sticky action bar next to the work. It is never only in the sidebar.
7. **Progressive disclosure.** Advanced options (per-channel format, who sends, custom fields) sit under "Advanced" or "Customize per channel".
8. **Same control, same behaviour.** One dropdown, one filter model, one table, one dialog, one feedback system (03).
9. **Fast for repeat users.** Keyboard shortcuts, remembered scope and filters, and a command menu (⌘K) later.
10. **Honest states.** Loading, empty, error, partial and permission states are designed, not defaulted (03, 04).

## 4. Areas and navigation model

```
Sidebar (desktop ≥1024 px, 248 px; collapses to 64 px icon rail)
├─ Workspace switcher        (only if >1 workspace; Agency adds "All workspaces")
├─ [+ Create]                (primary; opens /create)
├─ Home
├─ Plan                      (posts, calendar, queue, approvals, library)
├─ Inbox            (badge)  (conversations, comments, reviews, rules)
├─ Results                   (overview, explore, audience, posts, ads, reports)
├─ Tasks                     (only if the workspace uses tasks)
├─ Agency                    (only if the user has more than one client workspace)
├─ CHANNELS
│   ├─ All channels          (default scope)
│   ├─ ● Channel A           (avatar, name, status dot; click = scope)
│   ├─ ● Channel B
│   └─ Manage channels       (→ /settings/channels)
└─ Footer: Settings · Help · user menu (theme, language, account, Root if owner, sign out)
```

The rules:

- **Area order** is fixed: Home, Plan, Inbox, Results, then optional areas. It never depends on entitlements, except that an area the user cannot use is absent.
- **Tabs** inside an area are URL routes (`/plan/calendar`). They use the shared `Tabs` with links (Primer UnderlineNav). Never mix link tabs and panel tabs.
- **Settings** uses an in-content section list on desktop (GitHub settings pattern) and a list page on phones. This replaces the context sidebar for Settings only.
- **Root** uses the same shell with its own areas: Overview, People, Modules, Operations, Activity. It has no channel list. A visible "Root" badge stays in the header.
- **Phone (<760 px):** a bottom bar with Home, Plan, **Create** (centre, raised), Inbox and Results. The top bar shows the scope chip ("All channels ▾"), which opens a bottom sheet with the channel list. Avatar menu holds Settings, Tasks, Agency, theme, language and sign out.
- **Tablet (760–1023 px):** the sidebar is collapsed to the 64 px icon rail by default and expands as an overlay.

## 5. Channel scope (new shared behaviour)

| Rule | Detail |
|---|---|
| Parameter | One URL parameter on every channel-aware page: `channel=<id>[,<id>…]`. Absent means all selected channels. Ad accounts use `account=<id>[,…]` on Results › Ads only. |
| Persistence | Last scope is remembered per user and workspace in a cookie (`sp_scope_<workspaceId>`) and restored when the URL has none. The URL always wins. |
| Authority | Display filter only. Services still apply the member's current authorization and selection. Unknown, unselected or unauthorized IDs are dropped, with a one-line notice: "1 channel is no longer available and was removed from the view." |
| Pages that obey it | Home, Plan (all tabs), Inbox, Results (all tabs except Ads, which uses `account`), Tasks (linked posts), exports, reports (pre-filled). |
| Pages that ignore it | Settings, Root, Create (Create pre-selects the scoped channels as destinations but lets you change them). |
| Sidebar UI | Single click = only this channel. ⌘/Ctrl-click or the checkbox on hover = add/remove for multi-select. "All channels" resets. The status dot shows connection health (ok / reconnect needed). |
| Migration | Replace `channelId`, `target`, `targets`, `targetIds` and `channels` query names in customer routes with `channel`. Keep old names readable for one release by mapping them at parse time. |

## 6. Route map (old → new)

Every current capability keeps a home. Old routes redirect with HTTP 308, keeping the query string, mapped through the parameter migration above.

| Old route(s) | New route | Notes |
|---|---|---|
| `/home` | `/home` | Rebuilt summary (04) |
| `/publishing/compose` | `/create` | Full screen; `?date=&time=` kept; `?post=<id>` edits a draft |
| `/publishing/posts` | `/plan` (tab **Posts**) | Table default; Feed/Cards as a view switch |
| `/publishing/calendar` | `/plan/calendar` | Month/Week; agenda on phone; queue slots shown |
| `/publishing/queue` | `/plan/queue` | Queue times + next slots |
| `/publishing/approvals` | `/plan/approvals` | Badge with count when >0 |
| `/publishing/media` | `/plan/library` (section **Media**) | Library tab groups content assets |
| `/publishing/templates` | `/plan/library/templates` | |
| `/publishing/labels` | `/plan/library/labels` | |
| `/publishing/collaboration` ("Organize") | `/plan/library/fields` | Custom fields and notes |
| `/publishing/collaboration/post/[postId]` | `/plan/post/[postId]` | Post detail page (also opened as a side panel from lists) |
| `/publishing/feeds` | `/plan/library/feeds` | Content feeds and the recipe source |
| `/inbox` | `/inbox` | Three panes |
| `/inbox/moderation` | `/inbox/rules` | Tab |
| `/analytics` | `/results` | Overview tab |
| `/analytics/explorer` | `/results/explore` | |
| `/analytics/demographics` | `/results/audience` | |
| `/analytics/posts` | `/results/posts` | |
| `/analytics/compare`, `/ads/compare` | `/results/compare` | One compare tool; channels or ad accounts |
| `/analytics/ads`, `/ads`, `/ads/campaigns`, `/ads/objects` | `/results/ads`, `/results/ads/campaigns`, `/results/ads/manage` | Ads reporting and management in one tab group |
| `/analytics/goals`, `/analytics/pins` | `/results` (Overview cards) + `/results/goals` | Pinned metrics appear on Overview |
| `/analytics/reports`, `/reports` | `/results/reports` | |
| `/tasks` | `/tasks` | Optional area |
| `/agency`, `/agency/clients` | `/agency`, `/agency/clients` | Optional area |
| `/settings/workspace` | `/settings/workspace` | Split into cards (04) |
| `/settings/connections`, `/settings/profiles` | `/settings/channels` | Connections + channel groups/labels |
| `/settings/team` | `/settings/team` | |
| `/settings/sharing`, `/settings/bio` | `/settings/sharing` (tabs Client links, Link in bio) | |
| `/settings/mcp`, `/settings/webhooks` | `/settings/integrations` (tabs AI assistants (MCP), API keys, Webhooks) | |
| `/settings/account`, `/settings/appearance`, `/settings/notifications` | `/settings/account` (tabs Profile, Security, Appearance, Notifications) | |
| `/settings/data` | `/settings/data` | |
| `/root/*` | `/root/*` | Same routes; new shell grouping only |
| Public: `/sign-in`, `/sign-up`, `/join`, `/two-step*`, `/verify-email`, `/password-recovery`, `/share/[token]/view`, `/bio/[slug]/view`, `/oauth/authorize` | unchanged | Auth shell restyle only |

Result: 45 customer pages become 6 areas (4 core + 2 optional) with tabs and 1 Settings area. The number of URLs stays similar, but the number of **places to learn** drops from about 45 to 6.

## 7. Where module ownership lives

Manifests stay the source of routes (contract §2). v2 adds two optional manifest fields:

- `area: 'home' | 'plan' | 'inbox' | 'results' | 'tasks' | 'agency' | 'settings'`: which area a page belongs to.
- `tab: { label, order }`: its tab position inside the area.

The shell builds the sidebar and tabs from these declarations. No central list is hand-edited (contract decision 2026-10-19). A module that contributes to an area does so through its own manifest. For example, Ads declares pages in `results` and Feeds in `plan`.
