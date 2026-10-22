# Desktop navigation audit — 2026-10-22

Desktop-first organization pass. Source: module manifests (`src/modules/*/manifest.ts`
via `src/lib/product.ts`), `AppShell` area tabs, section tabs (`LibraryHeader`,
`SECTION_TABS`, `InboxChrome`), in-page links, and the command palette
(`listNavigationCommands`, which lists manifest pages with `navigation !== false` only).

Click depth: 1 = sidebar area / primary action, 2 = area tab, 3 = section tab or
in-page tab/menu/dialog link, 4+ = deeper. ∞ = reachable only by typing the URL.

## Click-depth table

| Sidebar area | Tab (depth 2) | Depth 3+ | Depth | Verdict |
|---|---|---|---|---|
| Create (primary action) | /create composer | — | 1 | OK |
| Home | Overview /home | — | 2 | OK |
| Content | Posts /content | Post detail /content/post/[id] (row click) | 3 | OK |
| Content | Calendar /content/calendar | Key dates, Seasons, Holidays & trends, Calendar subscriptions (header "More calendars" menu) | 3 | OK (menu in header) |
| Content | Queue /content/queue | — | 2 | OK |
| Content | Approvals /content/approvals | — | 2 | OK |
| Content | Library /content/library | Templates, Labels, Fields (section tabs) | 3 | OK |
| Content | Library /content/library | **Feeds /content/library/feeds (section tab)** | 3 | **BURIED — owner exhibit; promote** |
| Content | Writing agents /content/agents | — | 2 | OK |
| Content | — | **AI studio /content/ai-studio: no manifest page, no in-app link** | ∞ | **ORPHAN — promote** |
| Inbox | Conversations /inbox + Rules /inbox/rules (in-page tabs) | — | 2 | OK (Rules not in palette; acceptable, same screen) |
| Insights | Overview /insights | Goals, Pins (cards link to /insights/goals, /insights/pins) | 3 | OK (not in palette; acceptable, linked sub-pages) |
| Insights | Overview /insights | **Chart notes /insights/notes: no in-app link** (marks render on charts) | ∞ | **ORPHAN — link from Overview** |
| Insights | Explore, Audience, Compare, Reports | — | 2 | OK (Reports holds templates + schedules + history on one page) |
| Insights | Posts /insights/posts | **Caption tests /insights/tests: no in-app link** (`tabRoutes` keeps Posts tab current) | ∞ | **ORPHAN — promote to tab** |
| Ads | Accounts, Campaigns, Manage, Analysis, Compare | — | 2 | OK |
| Tasks (optional) | Tasks /tasks | — | 2 | OK |
| Agency (optional) | Workspaces /agency, Clients /agency/clients | — | 2 | OK |
| Settings | Workspace /settings/workspace | — | 2 | OK |
| Settings | Channels /settings/channels | Groups (section tab) | 3 | OK |
| Settings | Team /settings/team | — | 2 | OK |
| Settings | Sharing /settings/sharing | Link in bio (section tab); public portals /share, /s, /bio managed here | 3 | OK |
| Settings | Integrations /settings/integrations | API keys, Webhooks (section tabs) | 3 | OK |
| Settings | Account /settings/account | Profile, Security, Appearance, Notifications (section tabs) | 3 | OK |
| Settings | Account > Notifications | Chat channels /settings/account/notifications/chat-channels (in-page link) | 4 | OK (one link past its parent) |
| Settings | Data and privacy, History | — | 2 | OK |

## navigation:false pages

| Page | Route | Deserves a tab? |
|---|---|---|
| publishing/feeds | /content/library/feeds | **Yes — promoted to Content tab at /content/feeds** |
| publishing/collaboration, labels, templates | /content/library/* | No — Library section tabs are the right home |
| analytics/goals, analytics/pins | /insights/goals, /insights/pins | No — linked from Overview cards; personal sub-pages |
| settings/bio, webhooks, notifications, appearance | /settings/* | No — Settings section tabs are the right home |
| inbox/rules | /inbox/rules | No manifest entry; in-page tab beside Conversations is the right home |

Note: `navigation:false` pages are also absent from the command palette (palette =
navigable manifest pages). That is accepted for section tabs and linked sub-pages;
every promoted page below is navigable and therefore palette-reachable.

## Dead / empty controls (touched screens)

No dead buttons found in Feeds, Caption tests, or AI studio: every button has a
handler and disabled states carry their reason in context. Empty-state gaps fixed:

- AI studio "Check" tab with no channels showed a bare message; it now links to
  Manage channels (/settings/channels).
- Feeds empty list already sits under the Add button; caption-tests empty state sits
  beside its start form — both keep their one next action.

## Channel scope on reorganized screens

- Feeds (/content/feeds): `requireViewer({ channelScoped: true })`, target reads use
  `pageScope` — obeys and is scoped by the sidebar channel list. Unchanged.
- Caption tests (/insights/tests): `requireViewer({ channelScoped: true })` — obeys
  the app-wide selection. Unchanged.
- Chart notes (/insights/notes): workspace-level annotations drawn on charts; no
  channel filter is meaningful. Linked from Overview, unchanged semantics.
- AI studio (/content/ai-studio): workspace utility; the Check tab picks channels
  per run. Obeys selection where it applies. Unchanged.

## Reorganization decided (implemented same batch)

1. Feeds → own Content-area tab at **/content/feeds** (EN "Content feeds", FR "Flux
   de contenu"); 308 redirect from /content/library/feeds; removed from Library
   section tabs; pagination links updated.
2. AI studio → own Content-area tab at /content/ai-studio (new `publishing/ai-studio`
   feature; EN "AI studio", FR "Studio IA").
3. Caption tests → own Insights tab at /insights/tests (new `analytics/tests`
   feature, tabOrder between Posts and Compare; EN "Caption tests", FR "Tests de
   légendes"); `tabRoutes` on Posts removed.
4. Chart notes → linked from the Insights Overview header (Root-managed
   calendar-extras label, existing pattern).
5. Content tabs become Posts · Calendar · Queue · Approvals · Library · Feeds ·
   AI studio · Writing agents (8 tabs; the 8th folds into the shell "More" menu per
   `maxVisibleTabs: 7`). Insights tabs become Overview · Explore · Audience ·
   Posts · Caption tests · Compare · Reports (7 tabs, no overflow).

## Mobile pass — 2026-10-22 (phones ≤760px, DOM/CSS evidence, no browser run)

Phone reach of the reorganization above. Desktop organization unchanged; no new
IA decisions.

- BottomBar reaches every reorganized area: on /content/feeds and
  /content/ai-studio the Content item is current, on /insights/tests the
  Insights item is current; order stays Home · Content · Inbox · Create ·
  Insights · Ads with the raised central Create (`tests/ux-reorg-mobile.test.ts`).
- The 8 Content tabs ride the scrolling tab strip; the 8th (Writing agents)
  folds into the More menu whose trigger is 44px and whose item navigates
  (pinned by the same test). The current tab always stays visible and is
  scrolled into view by `AppShell`.
- No promoted screen uses a side panel: Feeds uses the shared `Dialog`
  (fullscreen ≤640px per `responsive.css`), AI studio and caption tests use the
  shared confirmation; Posts side preview is already fullscreen on phones
  (`shell.css` `.ui-side-panel`). Nothing to convert.
- Feeds table keeps bounded local scroll (`tableWrap` overflow-x auto +
  overscroll containment, 46rem table); new ≤760px block in
  `feeds.module.css` gives text controls 16px text (no iOS zoom) and 44px
  targets to inputs, option rows and pagination links (pagination also wraps).
- AI studio and caption tests already collapse at 720px (single-column
  preview, full-row figures, 40px channel rows); verified by CSS assertions,
  no change.
- Known phone-safe variant accepted, not implemented: French BottomBar labels
  ("Statistiques", "Publicités") can ellipsize below ~380px. Glyph + full
  accessible name keep them unambiguous; DESIGN.md forbids shrinking labels
  to fit, so shorter copy is an owner copy decision, left open.
- Open: real-browser phone verification at 360/390px (tab strip, More menu,
  feeds table scroll, dialogs) was not run in this lane.
