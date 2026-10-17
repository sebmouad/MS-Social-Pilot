# Posts without captions

2026-10-17. Batch 51 removes the shared text requirement for posts whose content
is an image, remote video, or link. This is a verified local rebuild increment;
production still runs the legacy application.

## Domain and ownership

`server/publishing/lifecycle.ts` owns `validatePostContent`. Call it after
`validatePostAttachments`: trim text, enforce the existing Root character ceiling,
and require text, a validated link, or at least one validated attachment.
A first comment is separate delivery content and cannot make an empty post valid.
Creation, edit and duplication persist the empty string instead of invented text.
Schedule/reschedule reread stored text and attachments before changing state;
publication repeats the rule before provider intent. The text-only CSV import
and local draft helpers keep their existing required-text contract.

Current authorization, selected-resource scope, ready module capabilities,
Root media/description limits and local-file ownership are unchanged. Invalid
URLs, incompatible combinations, foreign images, read-only keys and revoked
channel grants still fail. No schema, key, operational setting or provider rule
was added. Facebook already accepts these formats without captions and omits
`caption`, `description`, or `message` on the corresponding transport request;
that wire behavior remains owned and tested inside its adapter boundary.

## Customer UX and MCP

Dedicated composer and local edit describe text as optional with a link/media.
Selected local Files count toward content before upload, while blank URL rows
and a first comment alone do not. Existing ordered upload/recovery validation
runs before saving; a failed upload cannot silently create an empty post.
Missing captions are omitted in the social preview. The Posts table and Calendar
share safe neutral content summaries such as "Post with 2 images" and "Post with
link". Unsafe/malformed saved references are not counted as usable content.
No layout, palette, theme or sidebar design was replaced.

MCP `create_post` and `update_post` keep the explicit `message` string field:
use `""` for no caption. Missing/non-string values are rejected. The shared service
validates complete content and current authority; MCP does not introduce a second
business-rule implementation. Whole-content replacement can remove a caption or
attachments but cannot leave an empty/first-comment-only post. Existing exact
write confirmations and audit behavior remain.

## Evidence and limits

PREVIEW_QA.md records actual checks. The guarded ordered-media HTTP/MCP probe
now also exercises captionless create/edit, saved link/video content and rejection
of empty updates without changing the existing post. Disposable content is removed
through authorized local deletion and final cleanup verifies fixture absence and
exact restoration of temporary settings.

Provider transport tests use fixtures, not real Graph writes. This batch does
not prove real image/video/link publication, complete media recovery, native
formats, full UI/API/MCP parity or production release gates. Browser save/edit,
phone/theme/keyboard checks remain pending while workspace credits are refilled;
no approval bypass was attempted. Existing unsaved File/reload limitations remain.
