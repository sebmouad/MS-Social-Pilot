# Home figures: spend review (2026-10-21)

Home UI, `GET /api/home/overview` and `get_home_overview` share
`readHomeOverview` and its authorized product reads. No provider branches,
endpoints, Root keys or schema-version edits were added in this lane.

## Spend findings and behavior

The Ads reader already filters Home to account-level daily rows with inclusive
UTC dates (exclusive next-midnight database bound) and selected authorized
accounts. Provider decimal strings in `fields` are retained metadata, not extra
spend. The Facebook collector converts strings to persisted Float major units.
Valid persisted numeric rows did not reproduce concatenation, a 100x conversion
or account-plus-campaign double counting. The exact reported production
discrepancy remains unverified; no production/provider access was made.

Home aggregation now explicitly parses decimal strings numerically, normalizes
day/currency keys and rejects invalid/nonfinite amounts and unknown currency.
Unknown currencies cannot safely be added together. Different currencies stay
separate, with no conversion. Pagination must finish within `home.adsMaxPages`
or the card remains unavailable.

The service adds requested `start`/`end`, and per-currency `firstDay`, `lastDay`
and `recordedDays`. These are observed result days, not proof of complete account
coverage or successful sync. Missing days never imply zero. EN/FR screens show
currency codes, requested UTC dates, observed day count and latest stored day,
plus an account-coverage caveat. Incomplete periods have no sparkline.

## Every card reviewed

| Card | Calculation and findings |
| --- | --- |
| Audience | Analytics latest-per-channel total; overlap warning retained. Copy now identifies the most recent count date, rather than implying all channels share that freshness. Mixed metric keys suppress trends. |
| Views / engagements | Sum finite known values; change compares only channels known in both periods with positive previous total. Fixed nonfinite values being counted as covered/comparable. Current window now starts at the same UTC first-day midnight as Ads/Analytics; today remains partial. Previous window is the preceding configured number of UTC days. KPI hints show covered/selected channels. |
| Top channels | Finite current engagements sorted descending and Root-bounded; nonfinite engagements are now excluded consistently with totals. Copy now says displayed channels rather than falsely calling the top-list length all reporting channels. |
| Interaction mix | Root-selected additive measure keys only. Now discloses channel truncation on this card too. Metric semantics belong to adapters. |
| Best times | Deduplicate within channel, reject unmeasured/negative scores, divide by channel median, average channels equally; workspace weekday/hour. Existing tests cover arithmetic; no numeric fix identified. |
| Upcoming | Authorized Publishing scheduled-match total, independent of bounded preview length. Destination states determine held location. No arithmetic fix identified. |
| Inbox | Authorized Inbox open-match total, independent of page length; known zero stays zero. No arithmetic fix identified. |

## Evidence and integration work

`home-ads-production-shape.test.ts` exercises the real Ads query builder, reader,
date parser, pagination and normalizer against fake database ports. Fixtures use
the owner's account-id shape, provider spend strings, latest day October 16,
out-of-period rows, unselected accounts and account/campaign/ad-set/ad levels.
Expected USD total: 31 major units. A second fixture separates USD and EUR.
Pure/service tests reproduce string concatenation at the aggregation boundary,
invalid amounts, nonfinite coverage, period mismatch and stale-data metadata.
EN/FR server-render tests verify the disclosures. This is synthetic service,
query-shape and render evidence, not PostgreSQL/browser/provider evidence.

Outside owned paths, the integrator should:

- Update `docs/ARCHITECTURE.md`, `docs/AGENT_HANDOFF.md`,
  `docs/DELIVERY_PLAN.md` and `UX-CONTRACT.md` with these changes and limits.
- Reconcile the exact production discrepancy with an authorized separate
  account/day read and provider receipts; keep customer records out of Git.
- Review `platforms/facebook/jobs.ts`: invalid/missing provider spend still
  becomes zero (`finite(row.spend) ?? 0`). Home cannot detect that loss later.
  Rejection/provenance changes belong to the platform owner.
- Assess historical currency: daily rows project today's account currency,
  rather than storing per-insight currency. A guarantee needs platform/schema
  work and a migration, outside this lane.
- Review Analytics/platform audience trend coverage and heterogeneous
  views/engagement meanings. Current aggregates cannot prove equal daily coverage.
- Review saved `home.uiCopy` overrides. Existing stored default text can mask
  updated wording. `adSpendNote` now uses `from`, `to`, `recorded`, `n`, `latest`;
  `period`, `audienceAsOf` and `channelsNote` defaults also changed. Preserve
  intentional translations while updating old defaults. No new Root keys.

No server, whole-suite run, deployment, push, production access or commit was
performed. Changes remain in the worktree for integration.
