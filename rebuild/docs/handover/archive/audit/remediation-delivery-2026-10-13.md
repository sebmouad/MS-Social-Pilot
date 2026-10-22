# MS Social Pilot remediation delivery

Release: `fffeef3a42720a35bb759b13a0f473e60c0cbbdd` ([GitHub commit](https://github.com/sebmouad/MS-Social-Pilot/commit/fffeef3a42720a35bb759b13a0f473e60c0cbbdd)). Implementation checkout: `/Users/mouad/Documents/ChatGPT/MS Social Pilot/app`. Includes initial remediation `ff6b53c`, CSV heading correction `dd784bb`, and root extension. Deployment verification follows below. Authenticated Chrome semantic verification completed; raster capture remains unreliable.

## Implemented audit fixes

| Audit area | Delivered behavior |
| --- | --- |
| Composer lifecycle | Full post-specific reset after creation, including partial publishing results. Per-destination overrides, text-only choices, custom fields, location/background, staggering, caption tests and translations cannot leak into the next post. Duplicate submits are locked; uncertain saves direct users to check existing posts before retrying. |
| Unsaved work | Dirty detection covers hidden per-destination/custom options. Internal links, workspace changes, sign-out, command navigation and Chrome history traversal use shared leave protection. Session recovery is user/workspace/post scoped, survives repeated reloads, and restores translated captions and permitted destination assignments. Successful edited-post saves clear stale recovery and update their committed baseline. |
| Preview | Destination selection previews effective override text and media exclusions. Translation/test modes follow their publishing semantics. Non-Facebook content uses an explicitly approximate destination preview instead of Facebook actions. |
| Validation | API field errors remain individually available and linked to controls; scheduling and comment/place field names map to actual input IDs. Destination selection has a labeled focus target. |
| Shell and accessibility | Sidebar portals follow recreated dock elements. Shared dialog/drawer focus containment, inert background, body-scroll locking, focus restoration and desktop drawer closure. Main-content skip link; keyboard radio groups with one tab stop, arrows, Home/End and RTL. |
| Responsive actions | Composer actions stay at the phone viewport bottom. Calendar creation is keyboard/touch reachable; month-cell and root connection detail overflow fixed. Responsive tool disclosures reopen on desktop. |
| Calendar feedback | Transport failure during drag rescheduling now produces visible failure feedback and releases pending state. |
| Onboarding/auth | Getting-started steps respect role and module access. Closed registration no longer offers a dead create-account path; valid invitations retain their flow. Missing password-reset email offers administrator/inviter recovery guidance. |
| Visual/navigation consistency | Native scheduling and review states have distinct consistent colors; onboarding progress uses theme tokens. Settings uses a compact phone selector. Metric help supports explicit keyboard/touch dismissal without nested controls. |
| Feature ownership | Shared CSV importer moved to Publish at `/compose/import`; Settings links to it. Authorized destination scope and shared TargetPicker apply. Dedicated `/inbox/messages` repairs old conversation links and adds an explicit Messages entry. Empty historical Groups sections/notices removed from ordinary connection flows. |
| Honest analytics | Source-aware gained/lost audience labels distinguish current followers from historical likes; absent values remain unavailable and mixed sources do not create a misleading net. Summary detail has intentional disclosure. Dashboard/empty-state copy distinguishes app-created/captured data from all external activity. |
| Connections/selectors | Stable connection/account references disambiguate duplicate names. Reconnect errors use readable guidance. CSV uses searchable destination selection; query pagination resets with changed search. |
| Report drafts/export | Cancel/reopen restores committed report choices. Workspace/Page context resets drafts. CSV preserves applied sidebar destination scope and API authorization intersection. |
| Report delivery | Email readiness is server-backed; unavailable schedules cannot be created. Schedule removal checks response/errors. Skipped/partial delivery records sent/skipped/failed counts and cannot emit all-sent success. Last attempt is labeled truthfully. |
| Tasks | Pending locks suppress repeated creation. Limits are validated rather than silently truncated. Created/failed/unattempted/uncertain workflow outcomes remain explicit; retry excludes known created and uncertain rows. Editing remaining steps excludes uncertain creates. Early typed/autofilled text survives hydration. |
| Inbox/media | Conversation drafts survive reselection and switching within authorized scope; expired reply windows are checked. Media deletion failures are announced and uncertain deletion is reconciled before retry. Shared authenticated MediaPicker reuses library assets in composer. |

## Shared implementation owners

See `app/docs/INTERNAL_STANDARDISATION.md` for the reusable ownership table and review matrix. Added browser request, navigation guard, effective composer content, segmented radio, task workflow and audience metric identity modules; shared modal focus, media picker and CSV upload components. EN/FR catalog parity, placeholders and count plurals are verified.

## Verification evidence

- Clean `npm ci` and `npm run typecheck` passed.
- Final full non-timeout suite: **1,852 tests passed in 187 files**, no unhandled errors (`TZ=UTC`, isolated PostgreSQL on port 55432).
- HTTP timeout suite: **4 tests passed under Node 22 LTS**. Node 24 had emitted an Undici abort-stream error despite passing assertions; this was verified separately, not suppressed.
- Broad desktop/accessibility/mobile walk: 192 passed initially; seven failures were investigated, fixed, and passed in focused reruns. Root regressions additionally cover repeated draft reloads, internal leave protection, modal focus/opener restoration, segmented keyboard controls, drawer resizing and CSV feature ownership.
- Final root extension browser gate: **6 passed** including setup; **49 settings/root API tests passed**, including the added API rollback regression. Shared composer/root browser gate earlier passed **10 tests**. Task browser gate: **5 passed** including setup. Inbox/media recovery and the three failing phone layouts passed their focused rerun.
- Independent review identified and resolved task uncertainty retry, translation recovery, stale edited-post recovery, workspace/history leave protection, drawer resize and repeated-reload recovery defects.
- `git diff --check` passed; committed checkout is clean.

## Practical limits and continuation rules

Provider readiness fixes do not invent SMTP, AI or social-network credentials. Password recovery has no configured support address, so copy names the administrator/inviter. Non-Facebook previews show effective content rather than a pixel-exact native renderer. Session recovery depends on browser storage; unavailable storage is disclosed before leaving. Browsers without Navigation API use recovery for Back/Forward rather than a native history interception.

Shared request handling is adopted in audited task/inbox/media flows. This release does not claim that every unrelated legacy fetch or feature has been rewritten. Future migrations must preserve pending state, validation detail, authorization and uncertainty semantics and pass the shared review matrix. Existing API policy and server scoping remain authoritative.

## Production result

- `BUILD_OK`, `BACKUP_OK`, `DEPLOY_OK fffeef3` confirmed.
- Live release `fffeef3`; previous `dd784bb` retained for rollback.
- App and worker active; health reports both `ok`. All four deployment URLs return HTTP 200.
- 91 migrations; none pending.
- Latest server backup: `/var/backups/ms-social-pilot/db-20261014-0151.dump` (763K, server timestamp).
- Deployed root Email screen verified in authenticated Chrome: one Email heading and the new main-content skip link. Chrome left on Dashboard.

## Authenticated Chrome verification

- CSV screen loads under Publish with scoped shared destination picker. Duplicate heading was found live and corrected in `dd784bb`, with a browser regression.
- Composer media modal opens, contains keyboard focus, closes with Escape, and returns focus to its opener.
- Dedicated Messages screen loads and states honestly when no conversations have been captured.
- Analytics summary detail is collapsed deliberately. Filters remain reachable during sidebar collapse/expansion; Inbox dock restoration also verified.
- Connections disambiguate duplicate account references; obsolete empty Groups sections are absent.
- Root overview, status, General, Email, Platforms and Connections inspected read-only. App/database/worker healthy; twelve Meta channels listed. Root section findings and fixes: [root audit](root-audit-2026-10-13.md).

## Remaining owner setup and coverage limits

Operator name Anasso Traveaux and country Morocco were saved in production Root → General on 14 October 2026; account name Mouad Sebhaoui was saved and verified in Root. Contact email sebmouad@gmail.com and governing-law wording "the law of Morocco" were saved on 14 October 2026. Root overview now shows no missing legal-details notice. Off-site backup has no recorded successful run; local deployment backups succeeded. Configure the selected external backup destination and verify restoration. Registry-generated root setting metadata still uses English labels/descriptions/hints; new interaction messages have EN/FR parity. No production credentials or legal details were invented.

Native Chrome semantic observations completed after unlock. Raster screenshot capture remained unreliable; exhaustive pixel-level production review is not claimed. Production destructive/publishing workflows were tested with isolated local data and stubbed providers rather than real recipients.
