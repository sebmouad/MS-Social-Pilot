# Deeper authenticated app audit — shared logic and feature consistency

Date: 13 October 2026. Product: https://social.newsgeet.com

## Evidence and limits

This extends the first authenticated Chrome audit. In the second pass, the following rendered screens were inspected in the user's Chrome: Connections, Workspace Settings, Queue, Compose, Posts, Reports, Inbox, Comments, Tasks, Team and Media Library. Combined with the first pass, coverage includes Dashboard, Analytics and Calendar. Ads navigation was attempted, but its content was not reliably captured, so Ads is not counted as inspected.

The session used real workspace data, English, Warm theme and the current owner account. Inspection included visible controls, accessibility state, the Queue-to-Compose transition, template-dialog opening/closing, and report cancellation/reopening. No post, invitation, task, report schedule, uploaded file, message or configuration was created or saved. No item was deleted. A temporary report title was entered, cancelled, verified on reopening, then cleared and cancelled again. Apply was never clicked.

Browser capture sometimes returned stale page content while the address/title had already changed. Routes were checked again and some empty forms/screens were reloaded to verify the final state. Such capture lag is not treated as a proven application performance defect. Keyboard modal containment was inconclusive; the earlier source-backed focus concerns remain unverified live. No screenshots were exported to files.

Source tracing uses the existing audit clone at commit `6cc5528325b55c108a55539e431b51589e97a914`. Production version parity remains unknown. Source findings must be checked against current code before fixing; they are not claims of observed production side effects. Current repository instructions/docs may have moved since this baseline.

Priority: P1 = plausible lost work, unintended publication timing or misleading client delivery/export. P2 = significant usability, clarity or consistency issue. Feature improvements are explicitly distinguished from proven bugs.

## Findings verified or observed in Chrome

### D01 — P1: Free queue-slot action loses its scheduling intent

**Evidence:** Queue displays a free slot on 14 October at 09:00 with “Write a post and add it to the queue”. Its link is `/compose?to=<channel>`. Compose selects the channel but has Schedule selected, Queue unselected and a default 13 October 23:31 time. A full reload of the same composer URL confirms Schedule mode. No content was submitted.

**Source anchor:** QueueClient.tsx:404–405; Composer.tsx initializes timing to schedule at :179.

**Impact:** The natural continuation of a queue task can schedule a post at a different time/mode. All free-slot links have the same intent-free URL, despite representing different slots.

**Fix:** Define the intended operation. If these are “next queue slot” actions, pass an explicit queue intent and name it accordingly. If a particular slot is selectable, carry the validated slot/date/time and re-check availability server-side. Preserve channel scope. Do not promise a reserved slot before the server resolves it.

**Regression:** Click two different free-slot cards and verify the chosen contract. Queue intent survives reload/back navigation. A slot that became occupied yields truthful recovery guidance. Contributor approval still applies.

### D02 — P2: Report Cancel retains unsaved branding edits

**Evidence:** Customise → enter a temporary Cover title → Cancel → Customise again. The temporary title remains. The live report itself did not change. The temporary value was cleared without applying.

**Source anchor:** ReportBuilder.tsx state initialized from props; close at :47–50 only closes and clears error.

**Impact:** Cancel reads as discarding changes, but a later Apply can persist an earlier cancelled edit. The same risk exists for section selections.

**Fix:** Reset the modal's editable draft from the latest committed report/branding state on open or cancel. If preserving a draft is intentional, name the operation Close and make pending edits visible; do not label it Cancel.

**Regression:** Edit title and sections, cancel, reopen: committed values restored. Apply, reopen: saved values present. A failed Apply preserves the current edit and exposes the error. Refresh of server props cannot leave stale branding.

### D03 — P2: Report customization advertises unavailable demographics

**Evidence:** The Audience option says “Followers, countries, cities, age and gender.” The report itself explains that age, gender and language breakdowns are unavailable from Meta and therefore not shown.

**Fix:** Derive feature descriptions/options from the same network capability model as the report. Use accurate section copy and retain an explanation for unavailable metrics when needed.

**Regression:** Meta Audience configuration advertises only rendered capabilities; other networks retain their actual supported fields. Both languages match.

### D04 — P2: Audience metric names disagree with their definitions

**Evidence:** Reports has “New likes” and “Lost likes”, but their help defines people who started/stopped following. The adjacent chart calls these “Followers gained and lost”. Analytics describes net/gained/lost followers. The same data is named differently inside one report.

**Source anchor:** messages/en.json newLikes/lostLikes versus their help strings at the audited baseline.

**Fix:** Use a shared metric dictionary including stable metric identity, source, display name, definition, unit and aggregation. Separate page likes from follows; preserve historical metric identities rather than relabeling all old data as current follows.

**Regression:** Summary, Audience, details, report and export headers name the same metric consistently. Missing/retired values remain unavailable rather than fabricated zeroes.

### D05 — P2: Email readiness differs across features

**Evidence:** Team explicitly says email is not configured and invitations must be shared manually. Reports offers Email report; its component has no email-readiness input in the reviewed source. Scheduled email was not created or sent in this audit.

**Fix:** Use a shared server-derived delivery-readiness view model. Distinguish enabled, unavailable, failed and skipped delivery. Team can still create a manually shareable invitation, but the button should say Create invitation link in this mode. Reporting should offer downloads and explain why email is unavailable.

**Regression:** Email-off state is coherent across Team, Reports, notifications and recovery. Do not expose SMTP credentials or require ordinary editors to configure providers. See D19 for the source-backed delivery-outcome issue.

### D06 — P2: AI configuration copy exposes internals while the enable control remains on

**Evidence:** Workspace Settings says no ANTHROPIC_API_KEY is set and composer tools are hidden, while Enable AI writing help is checked and editable. Default tone, brand voice and other AI fields remain available.

**Interpretation:** Saving preferences before provider setup can be valid; the defect is unclear distinction between preference and availability, plus technical copy in a workspace workflow.

**Fix:** Show “Writing help is unavailable until the service administrator connects a provider”, separately from saved workspace preference. Apply provider-neutral readiness logic to captions, translations, images, negative-comment analysis and report recap; do not assume all features support the same providers/models.

**Regression:** Workspace enable state does not falsely imply the feature is usable. Configured providers with unsupported capabilities have specific explanations. Technical setup remains in root.

### D07 — P2: Bulk scheduling uses a different destination-selection feature

**Evidence:** Compose has a searchable destination picker with identity/readiness context. Settings → Bulk schedule from CSV lists eleven standalone checkboxes without search, grouping or the same row information.

**Fix:** Reuse TargetPicker's selection/readiness behavior, with appropriate CSV-specific supported networks and permissions. Keep draft destinations separate from the global analytics/calendar view selection. Preserve selected items during search.

**Regression:** Many channels, long names, disabled channels, group selection, role scope and French blockers behave like Compose. Unsupported network/content combinations remain unavailable.

### D08 — P2: Connection identities are difficult to distinguish

**Evidence:** Two connected Facebook identities have the same display name and separate channel collections. Ad accounts also include duplicate names, including repeated identity/currency combinations. Last-sync time differentiates some rows but does not identify ownership.

**Fix:** Provide a stable human-readable discriminator and meaningful grouping, such as business/profile context or a short account identifier. Keep token/scope diagnostics in root. Do not deduplicate solely by display name or disconnect either record without domain verification.

**Regression:** Two legitimate identities with the same name remain independently recognizable; reconnect/disconnect target the intended record. Test long names and missing metadata.

### D09 — P2: Media Library acts as inventory rather than a reusable asset workflow

**Evidence:** The populated library shows storage usage, a thumbnail/file name and Delete. The inspected Composer exposes upload/drop only. The reviewed source has no library-selection control in Composer.

**Classification:** Feature-completeness improvement, not a demonstrated failure of an existing reuse promise.

**Fix:** Define a shared workspace asset picker with preview, selection, accessibility/alt-text metadata, usage references and authorized reuse. Keep deletion separate and protected when a post depends on the file. Do not copy uploaded bytes or mint public URLs solely to share internal selection state.

**Regression:** Existing assets can be reused without reupload where supported; only authorized workspace assets appear. Reusing/editing metadata cannot damage a different scheduled post. Media-dependent network requirements remain enforced.

### D10 — P2: Empty Posts state describes an unexplained filter failure

**Evidence:** Posts is on All status for one selected channel, shows No posts and “No posts match these filters.” Analytics for that channel has external Facebook posts, while Comments explicitly covers posts sent through this app.

**Fix:** Use an explicit content-source contract in headings/empty states. Distinguish no app-created posts, an empty filtered result and incomplete synchronization. Offer one achievable action or scope reset. Do not broaden post-management scope merely to hide the empty state.

**Regression:** A channel with external posts only gets accurate copy in Posts, Analytics and Comments. Changing a search/status uses an appropriate filtered empty state.

### D11 — P2: Publishing features are buried inside general Settings

**Evidence:** Workspace Settings contains general workspace preferences, link tagging, AI settings, a migrated-queue placeholder and bulk CSV scheduling. The queue placeholder instructs “Schedule → Queue”, while the live rail is Publish and the contextual heading is Publishing. A second Settings navigation repeats Team/Client links available in the Workspace sidebar.

**Fix:** Establish one ownership/entry-point map: settings configure capabilities; publishing screens perform publishing work. Put CSV scheduling in the publishing workflow, replace the stale naming and remove permanent migration notices once routes are discoverable. Retain compatibility links where required.

**Regression:** Each capability has a clear primary home; shortcuts use the same labels and preserve context. Existing URLs still resolve or redirect meaningfully.

### D12 — P2: Inbox empty state implies completion without establishing coverage

**Evidence:** Unified Inbox says every comment and message on the channels is marked done. Dedicated Comments says it covers posts published from here and has captured no comments. The inspected channel has externally published posts with comments in Analytics.

**Interpretation:** The live data does not establish whether any stored items were resolved; no claim is made that messages/comments were lost. The completion wording exceeds what an empty result alone proves.

**Fix:** Distinguish empty captured set, resolved captured set, restricted source coverage, unavailable permission and stale sync. State the source scope and last successful sync. Share the readiness/source model with Comments and analytics.

**Regression:** Empty database, all captured items resolved, external-only comments, missing permission, stale sync and active filters produce different truthful states. No fake “all done” claim for unobserved external content.

## Source-backed findings requiring current-version verification

### D13 — P1: CSV export does not preserve the selected report channels

**Observed UI support:** The inspected single-channel report's Download CSV URL contains from/to/format only.

**Source:** ReportControls.tsx builds that URL without target/selection. src/app/api/reports/route.ts applies only auth.pageScope to buildReport; it does not resolve the report's selected channel subset. An all-pages owner therefore exports all authorized workspace channels rather than the selected report subset in this baseline.

**Boundary:** This is a scope/accuracy defect within authorized data, not proof of unauthorized cross-workspace access. No CSV was downloaded in the live audit.

**Fix:** Pass an explicit validated ReportContext to display, CSV, PDF, templates and email scheduling. Intersect requested targets with authorization server-side and preserve period/source semantics. Clearly define format-specific section support; do not imply every format includes the same content if it does not.

**Regression:** With two allowed channels and a report selecting one, exported rows include exactly one. With a restricted member, forged selection cannot add unauthorized channels. Explicit report scope wins over stale remembered view selection.

### D14 — P1: Task workflow loses unfinished rows after partial failure

**Source:** TasksClient.tsx:61–79 creates tasks sequentially, stops on failure, then clears steps unconditionally. It silently slices input to 30 lines and each title to 200 characters.

**Fix:** Validate before writing; show length/row limits rather than silently truncating. Report completed/failed/unattempted rows and retain failed/unattempted content. A retry must not recreate successful tasks.

**Regression:** Fail the third of five creates; retain rows 3–5 with correct statuses, preserve already-created rows, and retry only unresolved rows. Validate 31 lines and a 201-character title explicitly. Do not run this against production task data.

### D15 — P2: Single task creation has no in-flight submission guard

**Source:** TasksClient.tsx add/call lacks a pending guard; its Add control depends on title content, not request state.

**Fix:** Use the shared mutation lifecycle to disable duplicate submission per operation and retain input until confirmed creation. Do not use automatic write retries.

**Regression:** Double click/Enter under a delayed request creates one task; transport/validation failure restores retryability with the input intact.

### D16 — P1: Switching Inbox conversations discards reply drafts

**Source:** InboxPanel.tsx:111–116 sets selected thread and immediately clears text on every thread click, including reselecting the current thread. No conversation-scoped draft recovery is present in this baseline.

**Fix:** Preserve unsent replies per conversation, scoped to current user/workspace. Reselecting the same thread is a no-op. If closing/leaving cannot preserve a draft, offer an explicit discard choice. Recheck the platform reply window before sending.

**Regression:** Type in thread A → open B → return A: original draft survives. Clicking A again does not erase it. Different users/workspaces cannot recover each other's drafts. Closed reply windows retain text but do not offer an invalid send.

### D17 — P2: Media deletion transport failure has no useful feedback

**Source:** MediaLibrary.tsx remove uses try/finally without catch; HTTP failure has copy, a rejected fetch does not. Its error container lacks the shared announcement pattern.

**Fix:** Shared mutation/error feedback for HTTP and transport failures, preserving the row and resetting busy. Keep the in-use guard, confirmation and server enforcement. If a response is lost, reconcile state before retrying destructive actions.

**Regression:** Network rejection produces visible/announced feedback and retryability. In-use and restricted-role cases do not offer unusable actions. Test locally, not by deleting the production file.

### D18 — P2: Report-schedule removal ignores the result

**Source:** ReportSchedules.tsx remove catches fetch failure to null, ignores non-success status, then refreshes without a reported outcome.

**Fix:** Use a resource-scoped pending guard; distinguish confirmed removal, refusal and transport uncertainty. Keep the schedule visible until authoritative success and report how to recover.

**Regression:** 403/500/offline responses display a failure and leave the schedule; successful removal reports success. Double click does not duplicate attempts.

### D19 — P1: Skipped report email is treated as delivery success

**Source:** src/lib/email/send.ts documents a skipped outcome when no provider is configured. src/lib/report-schedules.ts:188–211 considers only failed outcomes bad; otherwise it emits report.ready and advances lastRunAt/nextRunAt with no lastError. Thus skipped deliveries can look successful in this baseline.

**Fix:** Separate report generation status from email delivery status. A generated report can be ready while delivery is unavailable, skipped, partial or failed. Do not mark skipped recipients as sent or emit a delivery-success event. Keep event semantics/backward compatibility explicit and avoid automatic duplicate sends.

**Regression:** All skipped, one failed/one sent, all sent and provider disabled between schedule creation/run each yield truthful recipient/outcome accounting. Tests stub delivery; no real email is sent.

## Shared ownership/remediation map

| Shared concern | Existing owner to extend | Findings | Migration rule |
|---|---|---|---|
| Composer entry intent | compose page + Composer + link builders | D01 | All queue/calendar/template entry points explicitly carry allowed intent and context. |
| Draft/form lifecycle | Composer/ReportBuilder/InboxPanel; small shared behavior where equivalent | D02, D14, D16; earlier L01 | Separate committed baseline, editable draft, cancellation, successful save, partial outcomes. Sensitive/security forms remain excluded from persistence. |
| Report context | reports/date-range/page-filter/ReportControls | D13 | One validated selection/period/source contract passed to every representation. |
| Capability/readiness | existing settings/email/provider/network capability modules | D03, D05, D06, D12, D19 | Server computes safe user-facing readiness; UI and worker agree, with domain-specific consequences. |
| Metric identity | existing metrics/analytics/report definitions | D04; L04/L05/L09 | Shared definition/label/unit/source/confidence; preserve retired historical series. |
| Mutation outcomes | existing API error contract + browser-safe transport helper | D14, D15, D17, D18, D19 | Pending/error/partial/uncertain states are explicit; no blind write retry. |
| Target/asset selection | TargetPicker, PagesSidebar, media domain | D07–D09 | Share selection behavior but distinguish view scope from publishing choices and storage permissions. |
| Screen ownership/empty state | navigation model, ScreenHeader, EmptyState | D10–D12 | One primary home and accurate source/readiness-specific explanation. |

## Additional fix tasks for the agent

### Task 28: Preserve composer entry intent

- [ ] Verify D01 on current source and add a browser regression for Queue free-slot entry.
- [ ] Define next-slot versus exact-slot semantics and implement the corresponding validated URL/initial state.
- [ ] Verify channel, timezone, mode, reload/history behavior, occupied slots and approvals.

### Task 29: Implement transactional form drafts and partial-work recovery

- [ ] Fix D02 committed-versus-editable report state, with Cancel/Apply regressions.
- [ ] Fix D14 partial task workflow accounting and D15 submission guards with stubbed writes.
- [ ] Fix D16 conversation-scoped draft preservation; integrate with earlier unsaved composer remediation.
- [ ] Confirm no cancelled/failed edits silently become later writes and no cross-scope draft recovery.

### Task 30: Share explicit report/export context

- [ ] Test D13 using two-channel fixtures and restricted member fixtures before refactoring.
- [ ] Pass explicit selection/period/source into the existing report service and export UI/API.
- [ ] Verify report, CSV, PDF, templates and email context, documenting meaningful format differences.

### Task 31: Share capability/readiness and truthful delivery outcomes

- [ ] Align Team/Reports/AI/Inbox readiness (D03/D05/D06/D12).
- [ ] Fix D19 recipient delivery accounting; separate ready/generated from sent/delivered.
- [ ] Add skipped/partial/failed/provider-change regressions and preserve established event contracts intentionally.

### Task 32: Consolidate domain labels, selectors and feature entry points

- [ ] Fix metric vocabulary D04 with paired message keys and source-specific definitions.
- [ ] Reuse authorized destination selection in CSV scheduling (D07), disambiguate connections (D08).
- [ ] Treat media reuse (D09) as a scoped feature addition using existing storage/access contracts, not merely visual cleanup.
- [ ] Correct publishing feature placement and empty-state scope (D10/D11); retain compatibility routes.

### Task 33: Migrate remaining mutation feedback and verify cross-screen parity

- [ ] Fix D17/D18 through shared HTTP/transport/pending feedback.
- [ ] Run the audit acceptance matrix across actual migrated callers, including partial and uncertain outcomes.
- [ ] Deliver exact tests/results, screenshot evidence where available and remaining unverified live paths.

## Acceptance and remaining coverage

Reuse the previous 27-task plan rather than implementing parallel abstractions. Validate each source finding against the current checkout; old line numbers are search anchors, not patch instructions. Add meaningful regression cases against production modules, use isolated data/network stubs, and run the relevant typecheck/unit/browser suites. The audit itself has not executed those suites.

Still required: EN/FR and all themes, authenticated mobile/responsive transitions, all restricted roles, actual keyboard/screen-reader modality, populated app-created posts, multi-destination effective previews, print/PDF output, Ads, and transport-failure simulations. Source-reviewed findings are not permission to send real emails, publish test posts, delete files/schedules, change roles or reconfigure providers.

### Evidence disposition

- **Behavior reproduced:** D01 queue intent, D02 report Cancel retention; earlier L01 lost composer caption and L02 missing docked tools.
- **UI observed/design gap:** D03–D12, plus earlier hierarchy/terminology findings.
- **Source-backed at audit baseline:** D13–D19; confirm current-version status before implementing.
- **Inconclusive:** Native capture lag, modal focus containment and Ads rendering; do not record them as proven product defects.
