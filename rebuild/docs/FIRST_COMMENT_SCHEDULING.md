# First-comment scheduling and recovery

Batch94 adds requested delays to the existing first-comment workflow. It does
not enable private native publishing formats or claim live Meta verification.

## Customer behavior

Composer, edit forms and templates accept a whole-number delay in minutes. Zero
means after confirmed destination publication. Delays are bounded by Root
`publishing.maxFirstCommentDelayMinutes` (default10,080). The same validation is
used for UI/API services and MCP; CSV accepts optional `firstCommentDelayMinutes`
and `destinationFormats` columns after message,firstComment,channels. Duplicate,
recycle, template application, version save/restore, scoped reads and exports
preserve the delay. Omitted update values preserve the existing post delay.

Each destination starts its delay at its own confirmed `publishedAt`. Submitted
uploads cannot start a comment. Provider status reconciliation can complete the
post first; the next normal posts-job pass continues due comments. Missing or
invalid publication times stay held. The worker clock cannot force a future
delivery early. Scheduling is best-effort job timing, not an exact-time SLA.

Posts show the requested schedule in workspace time. The explicit **Send now**
action explains that it overrides the saved delay and requires acknowledgment.
Uncertain attempts offer outcome recording, never another send. A definitive
provider rejection remains eligible only for a separate manual decision. An
explicit externally verified NOT SENT report releases the existing claim; it is
a human attestation, not automatic absence proof.

## Shared service and worker

`modules/publishing/server/first-comment.ts` owns authorization, format support,
claiming, dispatch, receipts and manual recovery. It reloads the current author
or manager authority and resource binding before claiming. Selected channel,
workspace, source, grants, token lifetime, provider policy, content/format and
entitlements must still match. Current scopes split on whitespace or commas.
Automatic delivery additionally requires current qualifying-owner job access
and the original author's own permissions; no owner is impersonated.

The neutral `first-comment-jobs.ts` scans selected, connected, confirmed
destinations in bounded wrapping order. `publishing.firstCommentCursor` is
Root-visible operational progress; resetting it does not release an attempt.
The existing posts schedule and `sync.maxItemsPerJob` govern the pass. The worker
script runs this pass after provider status reconciliation. Product code has no
Facebook-specific status or scope rules.

A durable `firstCommentAt` claim commits before provider dispatch. Ambiguous
responses and crashes keep it held. A resolved malformed receipt cannot be
classified as a definite rejection. Valid returned IDs are saved using a bounded
transaction independent of the cancelled operation signal, conditional on the
original destination, remote post and attempt timestamp. The caller can still
receive cancellation after a receipt commits and must reload state. If the
database cannot save the receipt, or the original claim changed, the claim stays
held; this does not guarantee a durable late fact after every database outage.
First comments never create or delete the parent post.

## Migration and evidence

The post delay column already existed; the rebuild Prisma mapping now includes
it. Additive migration22 `20261019060000_rebuild_template_comment_delay` adds
zero-default, nonnegative delay columns to templates and post versions. Older
versions lacked this information and therefore read zero after migration. SQL
SHA-256: `4c2f5699a826b8008003718084ee13eb0e4ee37e8e861ffdaf4a8a0a292bcfc5`.
Registry79 exposes delay/cursor controls under Publishing.

Fresh custom-format backup and restore matched107 prior public table counts.
Backup SHA-256: `c4d8408b89f9d2b0e03da0df6f2f504b8d8831192bd855c3368011eb9043adec`.
The complete22-migration schema-only rehearsal passed, including default-zero
and negative-value rejection. This is not a production-shaped customer/media/
service rollback rehearsal.

Final verified candidate has3,216 passing tests/364 files, no skips, actual PostgreSQL due,
claim, cancellation, uncertainty, permission/owner/grant/format and worker cases;
build/typecheck pass. Regression probes failed without the malformed-receipt
fix and without the composer configuration mapping fix. Both Claude accounts
reviewed source; missing surrounding-scope claims were checked against actual
guards, and concrete defects were corrected. The local MCP/Chromium probe passed
eight composer views across Grove/Coast/Clay/Nightfall at1440/390 widths,
configured bounds, keyboard focus, scheduled status and acknowledged Send now.
Exactly one local HTTPS-mock comment POST occurred; repeated sends made no
second request and a read-only key was denied. No real provider was contacted.
Final screenshot polish and the complete eight-view probe passed. The local
example preview received migration22 after backup/restore and rehearsal checks;
all107 prior counts and exact Root settings matched after final cleanup. Scratch
was removed, backup retained, and the preview now serves batch94 on its original
example database. A final independent review found and verified the correction
of scheduled inline first-comment owner access; its database regression passes. Production and the held photo canary remain unchanged.

## Remaining release work

Native-format host integration, native comments/deletion, cleaned live-provider
evidence, broader legacy parity, whole-app UX and production-shaped data/media/
service rollback remain required. Completing this workflow does not complete the
Facebook engine or authorize production cutover without the other release gates.
