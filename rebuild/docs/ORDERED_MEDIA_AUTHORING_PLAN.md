# Ordered media authoring: batch 50

2026-10-17. Implements the approved shared Publishing core within the existing
architecture, based on `18dd464`. Production remains legacy. This batch does not
complete publishing/provider parity or cutover gates.

## Outcome and boundaries

Creation and local draft editing use one ordered attachment editor. Users can
add remote images/videos or local images, describe each image, reorder/remove
items and retain their complete list after upload/save failures. A link remains
an independent content field. Selected destination capabilities determine valid
combinations; shared code never names a provider. Existing Root media-count,
alt-text, upload-byte and MIME controls remain authoritative. No new arbitrary
operational limits or new dependencies are introduced.

Retain the two-sidebar layout, destinations/timing/actions in the contextual
sidebar, shared themed fields/buttons, accessible labels/focus and phone drawer.
The preview shows the same ordered list, including trusted temporary File
previews without relaxing validation of saved media URLs. Removal detaches an
item; it does not silently delete a reusable local library file or remote object.
Existing unused-library retention applies to abandoned uploads.

## Contracts

- Neutral `PublishingMediaSupport` describes media kinds, optional count ceilings,
  mixed-kind/link combinations and image-description support. Facebook owns its
  declaration (images, one video, no mixed-kind/link combination) and repeats
  validation before transport. Shared validation owns safe shape/HTTPS/local
  references and Root ceilings; current adapter rules are checked before saving,
  scheduling or publication intent. Unknown media support fails closed for media
  delivery without hiding stored history.
- Safe destination choices expose current media support/local-image limits,
  never credentials. UI compatibility uses that metadata, while services repeat
  validation. Unconnected drafts can retain valid media within shared limits.
- The shared attachment component owns stable client item IDs, file preview
  lifetime, upload state/errors and serialization. Only kind/URL/description are
  submitted as `mediaJson`; File bytes/client IDs never enter the saved post.
  Bounded sequential uploads reuse already confirmed references on retry.
- Server actions parse an explicit complete `mediaJson` list, preserve it in
  recoverable action values and call existing shared authoring services. Editing
  initializes all stored items and never silently truncates to the first.
- Existing CSV format stays message/firstComment/channels and has no media
  columns; direct API/MCP media arrays use the same service validation.

## Parallel ownership

1. Editor agent: new shared editor/hook/helpers/styles and focused tests. Publish
   its exact exported interface to UI agent before integration.
2. Service/platform agent: neutral platform metadata, Facebook declaration and
   validation, destination metadata, authoritative authoring/publication checks,
   action parser/value contract and focused tests. Coordinate metadata names.
3. UI integration agent: compose/edit pages and controls, preview integration and
   UI/action integration tests; consume the agreed component/server contracts.
4. Parent: review interfaces/security, update design/UX/architecture/parity/QA,
   run full PostgreSQL tests/typecheck/isolated build and representative browser
   desktop/phone/theme/failure checks. Commit/push verified main and verify SHA.

No overlapping file edits or agent commits. Read the architecture contract and
design/UX documents before implementing. Use failing behavioral tests first;
report real verification and remaining gaps, not just declarations.

## Required checks and remaining work

Tests cover order/removal/alt association, retry after partial upload, malformed
or foreign media references, forbidden bytes, payload/count limits, missing
capability metadata, provider-neutral permitted combinations, Facebook rejected
combinations before intent/transport, all-item edit preservation and unconfirmed
save context. Browser checks cover shared focus/feedback, narrow layouts,
light/dark themes, realistic sample drafts and cleanup.

Do not run a live multi-photo canary yet: Facebook intermediate temporary-photo
IDs lack durable receipts/recovery. This batch does not invent temporary-photo
expiry/deletion guarantees, implement local video/Reels/Stories/native scheduling,
claim complete format support or replace the remaining real-provider release
checks. Those are still required by the full goal.
