# First-comment delivery and recovery

Status: implemented and verified locally; **not full Publishing, Facebook or cutover readiness**. Updated 2026-10-16.

## Separate remote operations

The neutral adapter contract separates `publish` from optional `publishFirstComment`. Publishing returns the post receipt without dispatching a comment. The shared lifecycle commits the remote post ID, delivery status and domain audit before starting a comment. If that transaction fails, the delivery remains `processing` and no comment is dispatched. This does not recover a remote post whose receipt never committed; that requires the still-missing publication journal/reconciliation workflow.

`modules/publishing/server/first-comment.ts` owns comment attempts and explicit human reconciliation. Public operations use the same current-authorization, post/destination locks and cancellation boundary as Publishing. Contributors can manage only their own posts; current feature and channel restrictions still apply. Selected connections must be enabled, usable and credential-ready before comment dispatch. Unsupported adapter first-comment operations are rejected for drafts/imports, and a stored post cannot silently publish its requested comment through an unsupported adapter.

The rebuild maps the existing nullable legacy `post_targets.firstCommentId`, `firstCommentAt` and `firstCommentError` columns. This batch adds no table or column and executes no DDL. The cutover verifier now explicitly requires those mappings. Local catalog metadata and real PostgreSQL reads/writes confirm the columns; production-shaped migration and complete cutover rehearsal remain separate gates.

## State and retry rules

| Display state | Stored evidence | Allowed continuation |
| --- | --- | --- |
| Not requested | No saved first-comment text | None |
| Awaiting publication | No confirmed published destination | Publish through the normal lifecycle |
| Not sent / ready | Published remote post, no comment ID or attempt claim, and no uncertain legacy error | One explicit send |
| Recorded as sent | Comment ID persisted | No repeat dispatch |
| Needs review | Attempt timestamp without comment ID, or an unknown legacy error | Explicit external platform check and audited outcome recording |

An atomic conditional update commits the attempt timestamp and start audit before dispatch. A timeout, malformed response, unrecognized error, cancellation or failed comment-receipt transaction does not release that claim. The app cannot infer absence from a lost response. Successful comment ID persistence and its domain audit are atomic.

Only the adapter may classify a provider rejection. Facebook recognizes its own explicit invalid-request/authentication/permission error codes on non-transient 4xx responses. Generic errors, uncoded/unknown responses, 429, 5xx, transient hints and malformed success receipts remain uncertain. Codes are isolated protocol rules in `facebook/protocol.ts`; they are not customer-facing business logic. The official Meta error-handling page returned 429 during this batch, so current provider-spec/live verification is not claimed. Classification tests exercise the conservative boundary.

A definite rejection commits a private product marker and clears the attempt claim, allowing a later explicit send. No automatic first-comment retry worker is introduced. Old raw legacy errors are treated as needing review even if legacy code released their timestamp; they are never assumed safe to resend. UI data replaces raw error details with safe markers, and MCP returns normalized state/receipt metadata only.

`recordFirstCommentOutcome` records a human's external check. It never calls or claims to verify the provider. Exact confirmation identifies the destination and SENT or NOT SENT. SENT requires the externally checked comment ID; NOT SENT resets the claim but sends nothing. The UI warns that an earlier request may still complete later. The atomic audit labels verification as `external_human_attestation`. This is an authorized manual override, not a guarantee of remote absence or immunity to delayed effects.

## Configuration and interfaces

Registry **41** adds the Facebook-owned, active, validated `meta.firstCommentScopes` setting, defaulting to `pages_manage_engagement`. OAuth requests include it; adapter readiness requires the configured policy and recorded grants. Missing policy/grants fail closed. The shared service knows no Graph scopes. Root can manage this under the Facebook module. Existing Publishing transaction/deadline/identifier bounds govern these operations; secret storage is unchanged.

Posts previews/actions display per-destination comment delivery. Send and manual-record dialogs require an explicit acknowledgement, retain their form and focused error after service/transport failures, prevent duplicate pending submissions and close after a matching successful receipt. The new dialogs dispatch their action state explicitly inside a React transition to prevent automatic native form resets after error receipts. A server refresh must not remount an open recovery form. A reopened dialog starts fresh; cancelling an uncertain send retains the latest review state. Success focuses the remaining delivery group when the old action button disappears. Root-managed copy/catalog completion remains open.

MCP tools `send_first_comment` and `record_first_comment_outcome` share these services, permissions, scope, exact confirmations and domain audit. They are in the service-owned guard bypass set, avoiding nested workspace locks. `list_posts` exposes safe comment state, attempted time and recorded comment ID. Existing MCP read/write key restrictions and private Root isolation remain enforced. These additions do not establish complete MCP parity for the whole rebuild.

## Evidence and limits

- Seven new real PostgreSQL integration cases use independent observers and fault injection to verify receipt ordering, ambiguous no-repeat, explicit rejection/retry, failed post/comment receipt writes, invalid remote identifiers and exact audited manual outcome recording. Provider and access dependencies are controlled; actual database locking and writes are real.
- Local browser tests use disposable `seed-comment-review` examples. Actual phone server rejection exposed native radio/checkbox reset; the corrected flow retained outcome, acknowledgement, ID and error focus. A successful synthetic outcome persisted the expected ID with one matching attestation audit; a second example verified final success focus. Fixtures and target rows were removed; deliberate synthetic attestation audits remain.
- Actual localhost MCP probes verify read-only/current-grant refusal, exact confirmation, sanitized reads, atomic manual recording, already-confirmed no-repeat, and manual absence without dispatch. Temporary actors/keys/sessions/content/domain audits are cleaned; the effective Root MCP role policy is restored, retaining its configuration-change audits.

See PREVIEW_QA.md for final suite/build results and visual-check scope. Delayed comments and their scheduling, full remote post/deletion journaling, automatic provider verification, first-comment link resolution/discovery, complete legacy features, provider formats/grants, real Facebook writes and production cutover remain required. No production traffic or worker was changed.


## Batch94 continuation
Delay authoring, neutral automatic continuation, fresh owner/author checks and
cancellation-independent bounded receipt persistence are now locally verified.
See [FIRST_COMMENT_SCHEDULING.md](FIRST_COMMENT_SCHEDULING.md) for current behavior,
migration22, exact evidence and remaining native/live/release limitations.
Earlier checkpoint gaps in this file are historical unless repeated there.
