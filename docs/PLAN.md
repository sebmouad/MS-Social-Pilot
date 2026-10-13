# Plan: what is still open

Only open items. Everything else in [FEATURES.md](FEATURES.md) is built. When an
item is done, remove it here and describe it in the matching doc. Each item:
build, unit and browser tests, deploy, check live with real data.

## Blocked on the owner or a third party

1. **Deploy** the latest commits once the suites pass (`npm run deploy`), then
   check the changed screens on production.
2. **Live test on the test Page** (owner's OK for each action): publish, first
   comment, schedule, cancel, delete; coloured text background
   (`text_format_preset_id`, undocumented); place tag and `@[page-id]` mention.
3. **AI keys**: Gemini and OpenAI keys in Root › Settings › AI, then try AI
   video (Veo), AI image and AI voice against the live providers.
4. **Developer apps** for LinkedIn, Threads, X and Pinterest (credentials in
   Root › Platforms), then first live posts. First live Bluesky and Mastodon
   posts once an account is connected.
5. **Meta App Review step 2** (Inbox and Instagram) after step 1 is decided,
   then Live mode, switches on, reconnect (META_API_NOTES.md).
6. **Google Business Profile** connector: needs Google to approve API access.
7. **Subtitles** for videos: needs speech-to-text on the audio track (ffmpeg on
   the server) and a decision between an SRT upload and burned-in captions.
8. **Plans and payments**: plans and limits exist (Root › Plans); still to do
   are a payment provider (the app never stores card data), invoices, plan
   changes, dunning, a usage page and the trial period. Ask the owner for
   prices first.
9. **Visibility levels for client spaces** (who in a workspace sees which
   space): needs the owner's privileges audit before building (PERMISSIONS.md).
10. **Native mobile app**: today the app is a PWA.

## Known gaps

- **Followers, previous period**: the Summary estimates the count before the
  window as today's count minus the window's net follows (`summaryFigures` in
  `src/lib/analytics-summary.ts`) rather than reading a stored total for that
  date, so it drifts when follows data is missing.
- **Summary trend chart** is built from the selection's posts (`dailySeries` in `src/lib/page-analysis.ts`: results by publish
  day), not from Page-level daily insights, so days without
  posts show nothing even when the Page had views.
- **E2E test data** has no channels with stored insights on the analytics
  screens, so the browser walk checks the Summary, Posts, Audience and Compare
  views mostly in their empty states.
- **Calendar and Posts navigation in a production build** (`E2E_PROD=1`): in
  the sandbox, client navigation from the calendar's month links and some
  status filters stalled with no error once the page payload grew (about 79 KB).
  Those links now load the page the ordinary way; check on the live site and,
  if it reproduces, shrink the calendar's day-cell markup.
- No ESLint configuration.

## Not built yet (verified in the code, 2026-10-13)

- Analytics for Threads (`threads_manage_insights`), LinkedIn
  (`r_member_social`, restricted), Pinterest and TikTok: each connector lacks
  `stats` and needs a scope the app does not request. Bluesky, Mastodon, X and
  YouTube counters work.
- Video for Bluesky, X (chunked upload), Pinterest and LinkedIn.
- Competitor tracking and searching places or Pages by name: need Meta's Page
  Public Content Access.
- Promote (boost) a post: needs `ads_management` after review and the owner's
  OK for any spend; always show the amount before confirming.
- White-label custom domain per customer for the portal and share links.
- A "connect own Pages" switch for clients (PERMISSIONS.md).
- Off-site backups: scripts are in `scripts/server/`, not installed on the
  server yet (the owner creates the storage and keeps the private key).
