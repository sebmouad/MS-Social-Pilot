# Ordered media authoring

2026-10-17. Shared Publishing creation/editing now uses one ordered attachment
editor. This is an incremental rebuild batch, not complete Publishing, Facebook
or production readiness.

## Shared ownership

`modules/publishing/components/PostAttachments.tsx` owns attachment drafts,
stable local item identities, multi-file selection, per-image descriptions,
ordering, removal, validation, upload state and trusted unsaved previews. Both
the dedicated composer and post editing reuse it. Multi-image posts are no
longer excluded from editing. Every stored item initializes the editor; a save
submits the complete ordered list rather than replacing it with its first image.

Local image selection is atomic at the remaining Root item ceiling and keeps
picker order. Uploads run sequentially through the existing bounded, authorized
media API. Each confirmed workspace reference replaces only its matching File;
a later failure retains failed Files/order/descriptions and retries reuse earlier
confirmed references. Upload failures focus the first visible failed row.
Separate editor instances have distinct field/error IDs. Pending controls do
not drop the hidden serialized list from the submitted form.

The preview keeps the same order, using effect-owned object URLs for selected
Files. A trusted React authoring slot is distinct from persisted PostPreview
validation; saved URLs still require the existing safe HTTPS/media checks. No
blob URL, client item ID or File bytes are saved in a post. Removal detaches an
item; it does not delete a reusable image-library file or remote publication.
Unused local uploads retain the existing Root-managed cleanup policy.

## Provider-neutral compatibility and configuration

`PublishingMediaSupport` describes kinds, count ceilings, mixed-kind/link
combinations and description support. Null counts rely on the shared Root cap;
they are not claims of unlimited provider support. Facebook declares images,
one remote video, no image/video mix, no link/media mix, and image descriptions.
Its engine repeats its format checks before transport. Provider rules stay
inside that module; shared authoring no longer assumes every provider has
Facebook's combination restrictions.

Shared services validate safe shape, URLs, image references and Root count/alt
bounds, then check each selected adapter before create/edit, duplication,
schedule/reschedule and publication intent. Media with no declared support fails
closed. Unconnected drafts can retain valid combinations within shared limits;
selecting a destination later requires its compatibility. The UI consumes the
same current-safe metadata. Allowed upload MIME types are the Root/destination
intersection; bytes use the smallest applicable bound. Unsupported add choices
are omitted, existing items remain reviewable, and count exhaustion has a clear
explanation. Credentials never enter metadata or client code.

No setting was added. Existing `publishing.maxRemoteMediaPerPost` continues to
bound all image/video attachments, including workspace image references; its
Root label/description now accurately say so. Registry remains version 48.
Existing byte/MIME/description bounds remain consumed; no provider image-count
limit was invented without verification.

## UI, service and MCP boundary

Server actions parse a complete `mediaJson` array and preserve it after recoverable
failure. Strict `parsePublishingMedia` admits only `{kind,url,altText?}`; it rejects
unknown kinds/fields, client IDs and bytes. Existing scalar form fallback remains
only for callers that omit the list; mixing both shapes is refused. Existing
message/first-comment and destination authorization services remain authoritative.

MCP `create_post`/`update_post` accept the same ordered `media` array with image
descriptions. Explicit `[]` removes attachments. Scalar image/video URL fields
are accepted only when the array is absent; ambiguous shapes are rejected before
mutation. Exact write confirmations, current resource scope, feature permission
and shared service auditing are unchanged. `list_pages` and `msp://targets` expose
safe format/upload metadata only when the destination is currently ready.
CSV remains the explicit message/firstComment/channels format without media columns.

## Verification and remaining scope

See PREVIEW_QA.md for actual test/build, HTTP/MCP, browser and cleanup evidence.
`scripts/verify-ordered-media.ts` refuses production/non-loopback/non-preview
databases and non-local preview origins, and requires the synthetic provider
endpoint. It uploads disposable example images, tests ordered persistence,
foreign references, Root caps, read-only keys and revoked scope, then verifies
fixture removal and exact restoration of temporary configuration.

The follow-up in CAPTIONLESS_POSTS.md permits image/video/link-only posts without
a caption. Local video uploads, resumable uploads, Reels/Stories/native scheduling, durable intermediate
Facebook photo receipts/cleanup and complete format/MCP/legacy coverage remain
required work. No live multi-photo canary was run because intermediate remote
upload recovery is unfinished. Browser reload loses unsaved Files; upload cancel,
per-file byte progress, navigation warning/session recovery and full accessibility/
theme/browser coverage are not established by this batch. Migration, rollback
and production cutover gates remain open.
