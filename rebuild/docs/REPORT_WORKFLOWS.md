# Analytics report workflows — batch82

Status: verified local batch82. This is not whole-app completion or production
release approval. Production remains legacy.

## Ownership and interfaces

`src/modules/analytics/reports/` owns authorization, templates, schedules, UTC /
workspace-timezone periods, report rendering, durable claims, recipient intent,
run history, shared HTTP/MCP rules and workflow bounds. The shared Analytics
reader owns metric normalization and platform dispatch; report code contains no
provider-specific metric interpretation. The host assembly is
`src/modules/analytics/server/report-workflows.ts`; the preexisting
`src/modules/analytics/server/reports.ts` remains the independent Analytics CSV exporter.

The manifest installs `/analytics/reports` and a distinct `analyticsReports`
worker job. UI, `/api/analytics/report-workflows/*`, and authenticated MCP call
the same services. Direct preparation, schedule writes and history HTTP calls
assemble the host ports on cold requests; visiting the screen is unnecessary.
Streamed JSON writes enforce Root's `analytics.reports.requestMaxBytes`.

Templates are workspace-wide. Selected-resource MCP keys cannot list or manage
them, while sessions and all-resource keys retain independently granted feature
access even when membership restricts their channels. Schedules, run history
and generation intersect current grants, key channel ceilings, current selected
same-workspace connections and enabled/entitled providers. Explicit empty scope
means none. Read-only access cannot mutate or read recipient details. Key-origin
changes retain the key identity in the shared audit records.

## Preparation, retry and delivery

Manual preparation always creates a download, never email. A confirmed request
accepts either a saved schedule's last complete workspace-local period, or one
selected channel with optional template and explicit inclusive UTC dates. Dates
use Analytics' Root range limits. Direct manual preparation works without SMTP
or enabled background delivery.

The UUID request identity is workspace + person + request ID and is bound to a
normalized payload hash. Reusing it recovers the same completed artifact while
current authorization, resource selection, connection, result bounds and expiry
still allow it. Different payloads conflict; in-progress, failed and expired
runs never silently regenerate. Unknown UI responses preserve that identity for
retry. Expired artifacts clear both output and expiry together, preserving run
history and its audit. Retention skips workspaces with active data erasure.

Scheduled email needs Root delivery enablement, enabled jobs, configured mail,
the schedule author's current write authority, and a qualifying active workspace
owner whose same plan grants both Reports and the selected channel's platform.
Authority and the current recipient list are rechecked at recipient boundaries.
A durable claim and lease fence every run change. An intent precedes each mail
call; an ambiguous SMTP result remains uncertain and is never blindly resent.
SMTP itself provides no idempotency guarantee. A completed manual run means
Prepared; scheduled delivery outcomes are reported separately.

## Root and customer experience

Root registry74 declares report list/output/request/transaction/lease/retention
bounds, choices and labels, polling schedule, send time and delivery enablement.
The private Analytics module groups these controls. An unsupported section
cannot be enabled merely by changing its label.

Reports reuse the two-sidebar shell, shared themed buttons/dialogs, validation,
notices and native table semantics. Actions and paging stay in the contextual
sidebar. Stored unavailable channel/template choices remain intelligible in
edit forms. Failed requests keep input, confirmation context and retry identity.
CSV receipts verify exact UTF-8 bytes before offering a download; printable HTML
is downloaded rather than inserted as trusted application markup. Manual date
labels explicitly say UTC; run timestamps show workspace timezone.

## Evidence and open requirements

Final isolated evidence:2865 passing tests/331 files, zero skips, production
build and serial TypeScript. Nine actual guarded PostgreSQL cases include
claim/audit constraints and three live writer/maintenance-versus-erasure races. Database regressions
reproduced and corrected paired artifact-expiry CHECK failure (23514) and
cross-workspace purge refusal (55000). Actual tests cover stale/expired/terminal
claim fencing, atomic audit rollback/completion, FK detachment/erasure, active
purge write denial and a verified live writer-versus-erasure race with no
resurrection or stray audit. Fixture cleanup assertions passed.

Both additive migrations passed backup/restore before local application; all17
reviewed files passed the schema-only cutover rehearsal. See CUTOVER.md for the
precise limits. Actual HTTP/MCP/browser/SMTP probes and independent reviews are recorded below.
The final corrections passed their post-change checks; publication must verify
the exact main commit against origin/main.

Wave 2 (2026-10-19) adds Response time and Top posts sections, selectable by
default in Root's enabled sections. Response time reads stored conversation
messages (a reply is app-sent or from the channel's own identity), capped at
20,000 messages with a partial flag. It reports calendar time and, when the
workspace sets business hours, a second median that counts only time inside them
(see Business-hours response time below). Top posts asks the
channel's platform module through the optional `PlatformAnalyticsHost.postPerformance`
hook (stored data only, no provider call); a module without it yields an empty,
labelled section. Evidence: unit tests only, no PostgreSQL or browser run.
Wave 2 also adds Goals (`modules/analytics/goals`): monthly per-channel targets
stored in the legacy `page_goals` table, with the legacy meanings (new followers =
follows − unfollows, views, Page engagement, posts published), judged in the
workspace time zone. Posts published is counted from stored publications for any
channel; the other metrics come from the channel module's optional neutral
`goalMeasures` hook (Facebook reads stored daily Page insights, newest Meta metric
name per day). Only metrics a channel can measure are offered. `/analytics/goals`
(en/fr), `GET/POST /api/analytics/goals`, MCP `get_analytics_goals` /
`set_analytics_goals` (confirmation `SET ANALYTICS GOALS <channelId>`, owners,
admins and editors) and a Goals report section for the month holding the report
period's last day. Unit tests with mocked data only.

Destinations: the legacy per-destination table (posts, impressions, reach, reactions,
comments, shares, lifetime link clicks) is now a section, for the report's one channel.
Post counts and short-link clicks are neutral stored data; the measures come from the
channel module's optional `PlatformAnalyticsHost.destinationMeasures` hook (Facebook sums
stored `post_targets.insights`). A measure no post stored is Not available, with "stored for
N of M posts" when partial, never zero. Lifetime link clicks count only posts that went
solely to this channel in the period; legacy split a shared short link's clicks across
destinations, which cannot be done honestly for a single-channel report, so shared posts
are counted and disclosed instead. Export formats: legacy offered only JSON (report API),
CSV and the browser-printed page, so JSON is added next to CSV and printable HTML. It is
the same rows as records (empty cell = null), produced by the same generator, cut at the
same row and byte bounds (a cut or oversize result stays valid JSON and sets
`truncated`), stored with the prepared run (older retained runs lack it and the UI hides
the button) and returned as `json` by the run route and `generate_report`. No XLSX/PDF:
legacy had neither and no dependency is present. Default `maxStoredArtifactBytes` rose
from 2.2 MB to 3.3 MB to hold the third rendering. Unit tests only.

AI recap (`aiRecap`): legacy stored only a per-schedule `aiRecap` flag, so the rebuild adds `aiRecap` as a report
section id. Generation feeds `summarize` (AI module) a bounded text of the figures other chosen sections already
computed (never post, message or recipient text), under the run's actor: the manual caller, or the schedule owner for
scheduled runs (`summarize` authorizes from the database, so it works in the worker; a revoked owner already stops the run at
the schedule boundary). AI off, unconfigured, workspace-disabled or no write access to Reports: the section is listed under
"not included". Hourly-limit conflict, provider failure, empty answer or timeout: the report still succeeds and the section
says the recap is unavailable for this run. Output is labelled AI-generated in HTML, text, CSV (`ai_recap` row) and JSON, and
therefore in scheduled email. Customers are offered the section (policy choices, template create/update, MCP) only while AI
assist is available to them; a stored template keeps it. One recap request counts toward the workspace hourly AI limit per
generation. Unit tests with the provider mocked.

Remaining legacy report coverage: stored choices are preserved and generated output names
unsupported sections honestly. This batch is not full report parity. Complete
Facebook live coverage, the held photo cleanup, full Root configuration coverage,
remaining legacy integrations and production-shaped data/media/service rollback
remain part of the active rebuild goal.

## Additional verified workflow evidence

The final isolated candidate passed 2865 tests in331 files with zero skips, production
build and serial TypeScript after UI refresh/status fixes. The actual guarded
HTTP/MCP/PostgreSQL/Chromium probe passed cold manual preparation without mail,
exact confirmations, payload-bound same-ID replay/conflict, read-only/selected/
empty key ceilings and resources, current invalidation/deselection/orphan refusal,
streamed request bounds, template CRUD, retained schedule edit/delete, desktop
1440px and phone390px, Grove/Nightfall, focused date validation, preserved input
and interrupted-request retry. Prepared artifacts persist while server data
refreshes; confirmation/result copy remains visible.

The actual workspace ZIP included report run artifacts/history and retained
schedule/template fixtures; the actual erasure API removed all three datasets.
The probe removed its unique user/workspace/keys/audits/private ZIP/media and
restored the exact prior Root setting rows. This is local synthetic evidence;
no customer records, remote provider or production service was changed.

An independent schema-only disposable database and loopback SMTP capture also
exercised the real host/mail/Reports engine: accepted delivery and email log,
repeat job without resend, SMTP disconnect after DATA retained as uncertain with
no resend, and author revocation during the first message preventing the second
recipient. Three `.invalid` messages were captured locally; scratch data/dump
were removed. Claude account2 review identified sequential batch-claim lease starvation and
terminal pending-recipient presentation. The corrected engine claims/processes
one due schedule at a time with a fresh lease, within Root's attempt bound, and
normalizes pending recipients before terminal outcomes. The real SMTP verifier
passed again after those changes. Actual PostgreSQL reproduced retention
lock inversion (40P01); retention and stale maintenance now select candidates
without row locks, lock workspaces in stable order, recheck erasure and only then
lock/update runs. Both maintenance races passed without deadlock, resurrection,
maintenance failure or stray audit. Global oldest-first candidate priority is
preserved. Maintenance failures are counted in the worker result rather than
hidden. The full suite, build, serial typecheck and actual API/MCP/browser/data
probe passed after the final corrections.

The frontend skill's whole-tree strict static audit reported34 findings, mostly
existing form-validation declarations plus a shared Button false positive and
unrelated unfinished screens. No finding was in the Reports route. This is not
a whole-app accessibility pass; do not hide that remaining system audit behind
this batch's runtime checks. Current source/docs preserve the approved identity,
two sidebars and shared primitives. Vercel's official Web Interface Guidelines
and React Best Practices informed the scoped review; no third-party skill code
was installed into the application.

## Synthetic examples

`scripts/seed-reports-preview.ts` is insert-only and requires
`PREVIEW_SEED_CONFIRM=SEED_LOCAL_REPORTS`, a non-production loopback `_preview`
database, and the exact existing synthetic owner/workspace identities. It keeps
user edits, refuses fixture identity collisions and adds two example templates,
a future-only schedule to an `.invalid` address, and one report prepared through
the real service. It performs no provider or email call. Bootstrap the private
local environment first; credentials are not part of this repository. This
persistent example dataset is separate from disposable verification fixtures.

The guarded example seed was executed twice successfully after verification.
Two example layouts, one future schedule and one Prepared history item remain
intentionally in the synthetic preview; rerunning preserved those identities.
This is separate from the probes, whose disposable fixtures were removed.

## Business-hours response time

Ported from legacy `src/lib/response-time.ts`. The workspace operations setting
(open weekdays 0 Sunday to 6 Saturday, start hour inclusive, end hour exclusive,
1-24; no day selected means not set) is read from `workspaces` with the workspace
time zone. A wait's business time is the overlap of [first visitor message, first
channel reply) with each open day's [start, end) window on the workspace clock;
closed weekdays and nights count zero. Windows are converted to real instants, so
daylight-saving days are exact (a window holding the spring gap is an hour shorter,
one holding the autumn repeat an hour longer; an edge inside the gap moves to the
first real instant after it; a closing edge in the repeated hour uses its last
occurrence, an opening edge the first). Legacy resolved those edge cases with
`date-fns-tz` defaults; ordinary hours are identical. A wait is walked over at most
400 calendar days. Hours that are set but unusable (end not after start, out of
range, unknown zone) are treated as not set, never replaced by invented hours.

Pure arithmetic: `modules/analytics/reports/generation/business-hours.ts`; summary:
`response-time.ts`. Outputs always label both figures: CSV rows
`median_first_response_minutes` (calendar time) and
`median_first_response_business_minutes` (coverage `not set` and an empty value when
no hours are set), the same rows in JSON, and the HTML/text line "Business hours
(Mon-Fri 09:00-18:00 (zone)): ... Calendar time: ...", or a plain statement that
business hours are not set. The AI recap facts mention both. The section also lists a
per-member breakdown (`sentById` resolved to the member's name, never email; answered
count and median first response in calendar time, at most 25 members, a sender no
longer in the workspace shown as "Former member", replies not sent through the app
as "Outside the app") and a resolve time: median from a conversation's first visitor
message in the period to its `resolvedAt`, with resolved and not-resolved counts
(unresolved, or resolved before that message, is counted, never zero; "Not available"
without data). CSV rows `member_first_response_minutes`, `median_resolve_minutes`,
`unresolved_conversations`, plus HTML/text lines, all within the existing bounds.
The Inbox screens are owned by another session and gain no figure here. Evidence: unit tests
(`tests/business-hours.test.ts`, `tests/report-response-time.test.ts`) with mocked
database only; no PostgreSQL or browser run.
