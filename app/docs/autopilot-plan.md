# Recipe Autopilot — approved plan (2026-11-16)

Approved by the owner on the proposals page. All 15 proposals approved, with these settings.

| # | Proposal | Settings | Phase |
|---|----------|----------|-------|
| 1 | Best times per channel, learned | apply automatically and notify; min gap 60 min; window 06:00–23:00; learn from last 14 days | 1 |
| 2 | Self-healing | replace failed posts; pause a broken Page and notify; warn when recipes last < 7 days | 1 |
| 3 | AI viral score | weight strong (best score first); best recipes go to each Page's best hours; show score in the plan | 2 |
| 4 | Viral radar | trigger 3× usual reach; spread to the 5 most similar Pages; plan automatically; no paid boost | 2 |
| 5 | A different AI caption per Page | AI picks a voice per Page; end with a question; lively emojis | 3 |
| 6 | First comment that earns saves | rotate the call to action; post 2 min after | 3 |
| 7 | Approve tomorrow in one tap | board ready 20:00; if not reviewed, publish as planned; notify | 4 |
| 8 | Let a hot post breathe | hot at 3× usual reach; wait at most 1 h | 2 |
| 9 | Seasons, holidays, weekday moods | holidays, seasonal produce, weekday vs weekend, weather; start 2 weeks before | 2 |
| 10 | Variety guard | same kind at most twice in a row; AI balances the daily mix | 2 |
| 11 | Bring back all-time winners | cooldown 60 days; up to 20% of posts | 2 |
| 12 | Learn which hooks work | 20% of posts used for tests | 3 |
| 13 | Autopilot cockpit | — | 4 |
| 14 | Weekly report | Monday morning; in the app and by email | 4 |
| 15 | AI reply drafts on recipe comments | friendly tone; never sent without a click | 4 |

Rules for every phase: nothing already scheduled is moved or doubled; every automatic change is logged and visible; each feature can be switched off.

## Status (2026-11-16)

All 15 proposals are live. Where to find them:

- **Settings:** Content › Feeds › recipe settings › « Pilote automatique » (every switch, and the activity log).
- **Cockpit, tomorrow's plan, weekly report:** Content › Autopilot (`/content/autopilot`), also linked from the Feeds page, the notifications and the command palette.
- **Reply drafts:** Inbox, in the reply box of a comment on a recipe post.

| # | Proposal | Where it runs |
|---|----------|---------------|
| 1 | Best times | `server/wordpress-autopilot.ts` (`learnBestTimes`), learned times in `autopilot.learnedTimes` |
| 2 | Self-healing | `runRecipePlanning` (replacement of failed posts, channel holds), `wordpress-pool.ts` (warning days) |
| 3 | Viral score | `wordpress/score.ts`, `server/wordpress-scoring.ts` (AI ratings in `recipe_ratings`, weather, history), `server/wordpress-pick.ts` |
| 4, 8 | Viral radar, breathing room | `server/wordpress-radar.ts` |
| 5, 6, 12 | Captions per channel, first-comment call to action, hook tests | `wordpress/caption.ts`, planner (style stored per slot) |
| 7, 13, 14 | Tomorrow's plan, cockpit, weekly report | `server/wordpress-cockpit.ts`, `ui/AutopilotScreen.tsx`, notifications `autopilot_board` / `autopilot_report` |
| 9, 10, 11 | Moments, variety, past winners | `wordpress/score.ts`, `server/wordpress-pick.ts`, `readCandidates` |
| 15 | Reply drafts | `server/wordpress-replies.ts`, `post_comments.aiDraft`, Inbox `ThreadTools` |

Safety rules kept: planned posts never move or double when times change; every automatic change is logged; each feature has its own switch; AI failures fall back to the recipe's own text; nothing is sent to a commenter without a member pressing Send; saved settings are validated field by field, so one bad value never resets the rest.
