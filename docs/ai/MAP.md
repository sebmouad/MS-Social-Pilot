# Feature map

One page: every area of the app, what is built (✅), what is planned (⬜) and
where the idea came from. Update it when a feature ships. Detail lives in
FEATURES.md (what exists) and NEXT_PHASES.md (specs).

| Area | Built | Next (source) |
|---|---|---|
| **Publish** | Composer (multi-channel, media, link preview, first comment, labels, AI assist, spam guard, engagement outlook, A/B captions, version history, notes, undo send); Calendar (month/week/feed, drag, drafts toggle, labels, saved views); Queue + Content mix tab; Posts list (filters, CSV, saved views); Templates; Feeds and website auto-share; Key dates + Trends; bulk CSV | ✅ Text per channel in the composer (Simplified, Publora) · ✅ per-channel text-only (no pictures) · ⬜ Save as group switch (Simplified) · ✅ "Approved by X on date" line (Planable) · ✅ team-then-client approval step · ✅ Campaigns: results by label (Loomly) |
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
| Custom fields on posts | M | ✅ Settings › Custom fields, composer inputs, shown on the post list |
| Design editor (basic) | L | ✅ size, colour or photo, text layers, save to library; ⬜ shapes, templates |
| AI image / video / voice (root-activated provider, models fetched) | M | ✅ images in Design (OpenAI key from Root, newest image model fetched); ✅ video in Design (Gemini key from Root, newest Veo model fetched, polled by the worker into the media library; Veo makes its own sound). OpenAI's Sora API was shut down on 24 Sep 2026, so it is not used. ✅ voice in Design (OpenAI key from Root, newest speech model fetched, MP3 to play or download: Facebook posts cannot carry audio alone, so it is not kept in the library). Not yet tried against the live provider (needs a Gemini key in Root) |
| AI agent with schedules | M | ✅ `/settings/agents`, drafts only |
| Tasks and workflows | L | ✅ board (to do, doing, done, assignee, due date); ⬜ workflows |
| Location tags and @mentions | M | ✅ place (a Facebook place Page's id) in the composer, sent as `place` on feed and multi-photo posts; `@[page-id]` typed in the text is mentioned by Facebook as Graph documents (checked 2026-10-13). ⬜ searching places and Pages by name: that needs Meta's Page Public Content Access review |
| Coloured text backgrounds | S | ✅ four presets in the composer (owner approved the unofficial `text_format_preset_id`, 2026-10-13); text-only, ≤130 characters, sent on feed posts. Undocumented by Meta: ids can change, and it has **not been tried on a live Page** (needs the owner's OK for the test post) |
| Mobile app | L | PWA exists |
