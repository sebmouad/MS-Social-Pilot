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
| Analytics | Selected-channel audience and stored metrics unified (`c39bdf1`); follower comparison needs a nearby `page_follows` snapshot (`33f09f6`). The Summary reach trend uses Page insights with gaps for missing days. | Seed Page, Instagram and other-network insights into browser tests; check populated Summary, Posts, Audience and Compare in both languages. Audit year comparisons and partial metric coverage on live data. |
| Ads | Read-only account results, one currency at a time, and every stored numeric latest-day campaign/ad-set/ad metric exposed (`47ff278`). Populated Ads Chromium test passes. | Management actions (create/edit/pause/boost) are absent by design; `ads_management` is not requested. Add them only after provider permission and explicit spend controls are available. Audit action attribution, sync coverage and large-account table performance with real accounts. |
| Publishing | Scheduled times no longer borrow the host's DST change (`47ff278`); all 1,861 tests passed after this fix. | Live Page checks from `PLAN.md`: publish, first comment, schedule, cancel, delete, place tag, mention and text background. Verify each remote outcome and cleanup on the agreed test Page. Browser tests need populated multi-network and failure/retry journeys. |
| Root | Root routing, role and settings tests pass; `/root` renders in Chromium. | Finish owner privilege audit from `PERMISSIONS.md`; test every role and cross-workspace action with populated data. Verify operator/legal settings, off-site backup setup, recovery drills and production health surfaces. Do not widen privileges solely to make a screen work. |
| Shared UX | Confirmation has no browser prompt fallback (`33f09f6`); Dashboard token warnings follow selected channel access (`466520d`). | Audit selection and permission scope on every remaining screen and shortcut. Complete desktop/phone, EN/FR, keyboard, empty/populated, pending/error/offline checks from `INTERNAL_STANDARDISATION.md`. |

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
