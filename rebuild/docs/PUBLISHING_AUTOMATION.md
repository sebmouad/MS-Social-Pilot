# Publishing automation — batch 72

Status: integrated local implementation; production remains legacy. This does
not establish complete Publishing, Facebook, legacy parity or release readiness.

## Ownership and execution

Publishing declares `publishingRecycle` and `publishingMix` jobs in its manifest.
The existing leased worker dispatches them through server/publishing/automation.ts.
Root owns their cron schedules and priority through the normal module controls.
Customer pages, HTTP and workspace MCP independently initialize the installed
collaboration ports; visiting a page first is never required.

The collaboration executors own candidate selection, cadence, weekly mix and
transactional claims. Required lifecycle callbacks own post creation/scheduling.
Missing callbacks refuse before reads. The host preserves the original author's
current membership, write permission, feature access and channel scope. Automatic
owner qualification supplements that authority: one current active owner must
qualify for the actual provider and feature. A job never fabricates an owner actor.
System-generated history and domain audits use a null actor rather than claiming
the original author clicked a button.

Each transition runs within the workspace erasure/suspension guard and the same
transaction as its claim. Post, publishing-target and selected-resource locks
serialize it with editing, publishing, disconnection and selection changes.
Provider grants, credential health, installed capability, media, content and
first-comment compatibility are checked again before persistence. Scheduling
performs no provider IO. The existing delivery worker remains the sole publisher.
A failed callback or claim rolls back the copy/schedule, history and audit together.

## Approval, copies and stopping

Content mix schedules approved drafts, or drafts whose current author and
workspace policy permit publishing without review. Pending/rejected work is not
silently approved. Saving rules does not enable scheduling: an all-channel owner
or admin must explicitly review the separate workspace opt-in. That policy uses
the legacy `workspaces.mixAutoFill` column; no migration belongs to this batch.
Its direct transaction locks the workspace for update, rather than deadlocking
against an outer shared workspace lock.

Repeating creates a separate post with pending destinations, its original author,
labels, initial history and an origin link. Remote IDs and delivery outcomes are
never copied. Changed wording in an approval workspace is held pending approval,
even if an editor configured it. Identical approved content retains that approval;
other copies follow the current role/policy. Current Root interval, repeat and
wording limits apply to both effective saved settings and worker reads. An
exhausted limit stops without creating an extra copy or incrementing the count.
A final successful copy increments both created and finished statistics.

Stopping because destinations were disabled requires current source authority and
provider/owner qualification. The host rechecks enabled destinations after taking
selection locks, so a concurrent re-enable does not disable the cadence. A source
whose resource/provider records have all been removed is left untouched when no
provider qualification can be established; its owner can disable the retained rule.
A mixed source with an unavailable destination is refused in full; the job never
silently changes its destination set.

## Fair bounded scans and Root controls

Registry 65 installs Publishing-owned `publishing.automation.recycleSchedule`,
`mixSchedule`, `recycleCursor` and `mixCursor`. Existing collaboration limits are
active consumers. Unscoped jobs use bounded ID-keyset scans, wrap at the end and
advance beyond skipped/failed candidates. Persistent cursor changes compare the
observed value and audit without including post/workspace identifiers in the audit
detail. A concurrent different Root cursor edit is not overwritten. Root can clear
a cursor to reset it. Explicit workspace-scoped diagnostic/probe runs validate the
workspace ID and leave global cursors untouched. Fairness/CAS behavior has focused
mocked regression coverage; actual global multi-worker rotation is not yet proven.

## Customer experience and MCP

Channel/group selection and the workspace scheduling checkbox live in the existing
contextual sidebar/drawer. Rule drafts survive scope changes. Numeric targets have
field-linked errors instead of silent clamping; saves preserve failed review dialogs
and block duplicate submissions. Reviews describe the consequence without asking
customers to transcribe opaque IDs. Ready-draft counts mean approval-ready
candidates, not a guarantee of provider delivery. Full-post destination/author
visibility applies to counts, including HTTP actors whose scope is resolved later.

HTTP and authenticated workspace MCP call the same services. The new
`set_content_mix_autofill` tool requires queue write access, all-channel owner/admin
standing and an exact ENABLE/DISABLE CONTENT MIX confirmation. Read-only keys
cannot enable it. Existing get/save mix and get/set recycle tools are now offered
only alongside their installed worker handlers. Workspace credentials cannot grant
Root access or change installation schedules.

The shared drawer now defers Escape/Tab to an open native modal. Chrome verified
the 390px review dialog (352px wide), Tab staying in the modal, first Escape
closing only the review, second Escape closing the drawer and focus returning to
Menu & filters. Desktop sidebar/review and Grove/Nightfall phone rendering were
inspected. The Nightfall inspection changed only the document theme temporarily
and restored Grove; it is not a new theme-persistence test. UI approval was
cancelled, so browser testing did not enable the seeded workspace's automation.

## Verification

The guarded scripts/verify-publishing-automation.ts uses only explicit matching
loopback `_preview` PostgreSQL and localhost:3200. It persists a private recovery
ledger before writes, creates two disposable tenants, encrypted synthetic credentials,
labels, rules, timetable, sessions and scoped MCP keys. A temporary synthetic app
secret satisfies the adapter's proof-readiness policy; it cannot authenticate any
real provider operation. The exact prior secret setting is captured encrypted and
restored without printing it.

Actual HTTP/MCP/PostgreSQL execution passed: rule save, opt-in/off, confirmation and
read-only refusals, scheduling exactly once, retained history/labels, truthful system
audit, changed-wording approval hold, cadence replay, revocation immutability,
disabled-destination stop and zero publication attempts/remote IDs. Both created
drafts and the generated repeat, related records and eleven captured Root settings
were removed/restored exactly. The script removed its ledger only after cleanup.
The final isolated staged snapshot passed 2,186 tests / 280 files, production
build and subsequent serial typecheck. No production data, schema or provider write
was changed.

## Remaining work

Native formats and delayed first comments are refused until their complete
lifecycles exist. Cadence uses elapsed 24-hour days, not a new local-clock DST rule.
Mix dry markers and audit are recorded; mail/in-app dry notification delivery is not
wired. Large workspace read bounds/performance, global fair-scan PostgreSQL and
lease-loss/restart tests, full theme/keyboard/offline/stale/input/route-leave states,
real Facebook delivery and remaining legacy features still need work. Production
migration, exact rollback rehearsal and cutover remain gated. Existing
socialpilot-deploy still targets legacy.
