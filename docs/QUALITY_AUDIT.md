# Release-quality audit tracker

This is the working handoff for the goal of making Analytics, Ads, Publishing,
Root and shared behavior consistent and reliable. It records verified code and
remaining work; a healthy deployment is not proof that every live provider flow
works. Update each row with evidence as it is completed.

## Release gate for every module

1. Server reads and writes enforce workspace, role and selected-channel scope.
   Empty, missing, stale and zero data have distinct meanings. Totals follow
   `aggregate.ts`; unique reach and mixed currencies are never false sums.
2. Exercise populated and empty screens in English and French, desktop and
   phone, keyboard and touch. Confirmations, pending states, errors and offline
   uncertainty use shared components and explain the next action.
3. Run focused unit/integration tests, typecheck, production build and relevant
   Playwright journeys. Check production in the owner's Chrome with real data
   when it is available. Deploy by pinned commit; verify health and worker.
4. Document any metric the provider refuses or no longer serves. Never turn a
   missing reading into zero or imply that a read-only connector can manage ads.

## Current evidence

| Area | Verified work | Remaining release check |
| --- | --- | --- |
| Analytics | Selected-channel audience and stored metrics unified (`c39bdf1`); follower comparison needs a nearby `page_follows` snapshot (`33f09f6`). The Summary reach trend uses Page insights with gaps for missing days. Other-network posts page past 500. Facebook posts made outside the app now page across the entire selected date window in Posts and CSV; integration and Chromium checks cross the former 500-row cap. Unread figures show as missing. | Seed Page, Instagram and other-network insights into browser tests; check populated Summary, Posts, Audience and Compare in both languages. Audit year comparisons and partial metric coverage on live data. Profile the post explorer on very large ranges. |
| Ads | Read-only account results, one currency at a time, and every stored numeric latest-day campaign/ad-set/ad metric exposed (`47ff278`). Populated Ads Chromium test passes. Account discovery rejects incomplete paging; insight reads split crowded date ranges and fail if even one day exceeds the cap. | Management actions (create/edit/pause/boost) are absent by design; `ads_management` is not requested. Add them only after provider permission and explicit spend controls are available. Audit action attribution, sync coverage and large-account table performance with real accounts. |
| Publishing | Scheduled times no longer borrow the host's DST change (`47ff278`). A Facebook-native post whose delivery remains unconfirmed after reconciliation is explicitly shown as uncertain and cannot be silently retried, edited, cancelled, or sent again with Post now; confirmed failures on other destinations remain retryable. Post deletion distinguishes local records from remote copies; remote deletion is implemented for Facebook Pages, Pinterest, YouTube, Bluesky, Mastodon and X, with per-target confirmation and retryable partial failure. Bulk CSV accepts a first comment. | Live Page checks from `PLAN.md`: publish, first comment, schedule, cancel, delete, place tag, mention and text background. Verify each remote outcome and cleanup on the agreed test Page. Browser tests need populated multi-network and failure/retry journeys. Older YouTube connections must reconnect for the delete scope. Instagram, LinkedIn, Threads, TikTok and Telegram still need remote deletion support or clear platform-specific limitations. |
| Root | Root routing, role and settings tests pass; `/root` renders in Chromium. Owner demotion, member removal and account deletion share a per-workspace transaction lock across Root and Team, so simultaneous changes cannot each remove the last owner. Team writes also re-read the caller's current role under that lock; a Root visit verifies current instance authority. Concurrent, stale-role and Root-visit integration tests cover these paths. | Finish owner privilege audit from `PERMISSIONS.md`; test every role and cross-workspace action with populated data. Verify operator/legal settings, off-site backup setup, recovery drills and production health surfaces. Do not widen privileges solely to make a screen work. |
| Shared UX | Confirmation has no browser prompt fallback (`33f09f6`); Dashboard token warnings follow selected channel access (`466520d`). Settings uses the Workspace sidebar, permissions sit in Team, active/revoked client links can be purged, and oversized segmented pills use compact tabs. Ads account, period, breakdown, export and report/analytics period selectors sit in the area sidebar. New connections are discovered unselected; Connections shows grouped source tables and opt-in checkboxes, and disconnect prompts to retain or delete related data. | Audit selection and permission scope on every remaining screen and shortcut. Complete desktop/phone, EN/FR, keyboard, empty/populated, pending/error/offline checks from `INTERNAL_STANDARDISATION.md`. |

## Immediate order

1. Add populated Analytics browser fixtures and assertions for selected-channel
   totals, metric explorer, comparisons and missing coverage.
2. Audit Ads sync completeness and action fields against actual stored rows;
   keep management controls out until permission and spending safeguards exist.
3. Walk Root's owner audit and Publishing's live test Page actions, recording
   actual outcomes and blockers in `PLAN.md`.

## Current production limit

The latest code was deployed with passing health and worker checks. Production
Chrome visual verification is still outstanding because the Mac was locked
during the inspection attempt. The local browser walks use isolated test data.
