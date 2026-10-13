# Feature map

One page: every area of the app, what is built (✅), what is planned (⬜) and
where the idea came from. Update it when a feature ships. Detail lives in
FEATURES.md (what exists) and NEXT_PHASES.md (specs).

| Area | Built | Next (source) |
|---|---|---|
| **Publish** | Composer (multi-channel, media, link preview, first comment, labels, AI assist, spam guard, engagement outlook, A/B captions, version history, notes, undo send); Calendar (month/week/feed, drag, drafts toggle, labels, saved views); Queue + Content mix tab; Posts list (filters, CSV, saved views); Templates; Feeds and website auto-share; Key dates + Trends; bulk CSV | ✅ Text per channel in the composer (Simplified, Publora) · ⬜ per-channel format and media · ⬜ Save as group switch (Simplified) · ⬜ Two-step approval chain with "approved by" line (Planable) · ⬜ Campaigns above labels (Loomly) |
| **Inbox** | Comments + messages stream, done state, assignment, private notes, saved replies, moderation rules, response time, reviews | ⬜ Private notes on threads (Agorapulse) |
| **Analytics** | Channel analysis, all-channels totals, compare, by post, audience, video, links, tests, KPI explorer, reports (PDF, schedules, templates) | ⬜ Fans / reached toggle on countries and cities (Simplified) · ⬜ Best day and best frequency cards (Simplified) · ⬜ Link clicks tile (Metricool) · ⬜ Live shareable report link (Metricool) |
| **Channels** | Facebook Pages/Groups, Instagram, Bluesky, Mastodon, LinkedIn, Threads, X, Pinterest, YouTube, TikTok; groups; plan meter | ⬜ Per-platform "Not connected / N connected" list with connect sheet (Publora) · ⬜ Google Business Profile |
| **Team & clients** | Roles (owner/admin/editor/contributor/viewer/client), per-member channel access, multi-email invites, seat meter, Agency screen, client approval links and portal | ⬜ Visibility levels for client spaces (Simplified teamspaces; needs owner audit) |
| **Assistants** | REST API, webhooks, MCP server with 15 tools, setup guides for 7 assistants | ⬜ Claude web connector (needs OAuth) |
| **Root** | Config, plans, modules, supervision, workspace create/delete, status | — |
| **Navigation / UX** | Icon rail + area sidebar, channel column with filters and tools, ScreenHeader, SubTabs, EmptyState, one table style | ✅ Command palette, Ctrl K (Planable, Sprout) · ⬜ Composer "More options" fold · ⬜ One shared select / filter-bar style |

## Order of work
1. Fans / reached toggle (small, data exists).
2. Per-network text variants (largest).
3. Command palette.
4. Two-step approval chain.
5. Campaigns, report links.

## Reopened ideas (owner, 2026-10-13: "I did not rule out")
| Idea | Size | Status |
|---|---|---|
| Brand book beyond voice (words to avoid, colours, logo) | S | ✅ voice per workspace and channel, words to avoid; ⬜ colours, logo |
| Link-in-bio page | M | ✅ Settings › Link in bio, public /bio/<slug>, click counts |
| Custom fields on posts | M | ⬜ |
| Design editor (basic) | L | ⬜ |
| AI image / video / voice (root-activated provider, models fetched) | M | ⬜ |
| AI agent with schedules | M | ⬜ |
| Tasks and workflows | L | ✅ board (to do, doing, done, assignee, due date); ⬜ workflows |
| Location tags and @mentions | M | ⬜ (Meta permission review) |
| Coloured text backgrounds | S | ⬜ |
| Mobile app | L | PWA exists |
