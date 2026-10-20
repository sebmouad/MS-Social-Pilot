# Stored-performance best times

Publishing owns `server/best-time.ts` (current authorization and stored reads)
and `server/best-time-ranking.ts` (pure weekday/hour ranking). UI, GET
`/api/publishing/best-times?targetId=…` and MCP `get_best_times` share the service.
Reads recheck current Publishing access, channel scope, selected/usable publishing
destinations and platform entitlement. Derived measures additionally require the
member's current Analytics Posts read permission and entitlement. The platform's
stored-only `postPerformance` hook supplies its neutral `rankValue`; no provider
metric names, tables or network calls enter shared code.

Like legacy `best-times`, `queue-suggestions` and `engagement-prediction`, the
service compares measured history against each destination's own median and
requires repeated observations. Unlike legacy's three-hour blocks and weekly
queue-slot insertion, this scope uses weekday/hour cells and allocation-time
preferences. Defaults: 90 days, latest 1,000 posts per channel, 10 measured posts
per channel, 3 posts per cell per channel, at least 1.15 times each channel's
median, at most 3 suggestions. Duplicate posts, missing/invalid measures or
timestamps and out-of-window posts cannot count. Zero-only or insufficient
history is unknown. Every selected destination must support the same cell;
channel-relative lifts are averaged with equal channel weight. These are
historical associations, not forecasts or evidence that timing caused results.

The composer shows en/fr loading, unknown, failure/retry and suggested-time
states. Selection changes abort and fence obsolete reads. Clicking a suggestion
fills the date/time fields; the user still submits Schedule. Next occurrences
use the workspace zone and skip nonexistent DST wall hours. Missing data is
“Not available” / “Non disponible”, never a fabricated time or zero.

The existing workspace `bestTimeMode` is rendered in operations settings:
`suggest` keeps ordinary queue allocation; `apply` prefers free suggestion slots,
then falls back to the saved timetable. Composer preview and UI/HTTP/MCP queue
writes share this allocation. The write rechecks the mode/time zone under the
existing workspace lock and uses current occupancy and approval rules. It does
not change weekly timetable rows or run a background weekly insertion job.

New Root keys, declared only in Publishing `config.ts`:
`publishing.bestTimeLookbackDays`, `publishing.bestTimeMaxPosts`,
`publishing.bestTimeMinHistory`, `publishing.bestTimeMinPostsPerSlot`,
`publishing.bestTimeMinLift`, `publishing.bestTimeMaxSuggestions`.
The existing `publishing.collab.queueLookaheadDays` bounds future occurrences.
No migration or central-registry edit. Registry version coordination remains
with the host owner as instructed for this parallel branch.

Evidence: synthetic ranking/service/HTTP/MCP/allocator and jsdom tests in
`tests/best-time*.test.ts`, plus queue/composer regressions, SQL guard and TypeScript.
No server, real database, browser, live-provider, push or deployment run belongs
to this branch batch. Those runtime/release gates remain open.

Final branch check: 485 targeted tests passed / 12 opt-in database cases skipped
(57 passing files / 3 skipped). `npx tsc --noEmit -p .` and `git diff --check`
passed. This is not full-suite or runtime/release evidence.
