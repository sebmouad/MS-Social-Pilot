# UI = REST = MCP parity: Publishing and Inbox

Status: **source-level matrix, mocked-service tests only** (no PostgreSQL, browser or live-provider run). Written 2026-10-20.
Rule: each customer action reaches one shared service; REST and MCP are thin entries that ask for the same exact confirmation string
and the service re-checks tenant, role, feature, channel scope and audit. "—" means the action does not exist on that surface
because it is not an action there (a pure screen), not a gap. **GAP** marks a missing surface.

Confirmation strings are identical on REST (`confirmation` in the JSON body) and MCP (`confirmation` argument).
Session-authenticated REST also requires a same-origin `Origin` header.

## Publishing

| Customer action (UI) | Shared service | REST | MCP tool | Confirmation |
| --- | --- | --- | --- | --- |
| Compose: save draft | `createPost` | `POST /api/publishing/posts` | `create_post` | `CREATE POST` |
| Compose: schedule (app or platform-held) | `createPost` (`scheduledAt`, `scheduleMode`) | `POST /api/publishing/posts` | `create_post` | `CREATE POST` |
| Compose: add to queue (optional `scheduleMode` / `destinationScheduleModes`) | `queuePostRequest` | `POST /api/publishing/queue`; key: `POST /api/v1/posts/{id}/queue` | `queue_post` | `QUEUE POST <id>` |
| Quick local draft (create/edit/delete) | `createLocalDraft` … | — (use posts routes) | `create_draft` `update_draft` `delete_draft` | `CREATE DRAFT` / `UPDATE DRAFT <id>` / `DELETE DRAFT <id>` |
| Edit unpublished post | `updatePost` | `PATCH /api/publishing/posts/{id}` | `update_post` | `UPDATE POST <id>` |
| Schedule an existing draft | `schedulePost` | `POST /api/publishing/posts/{id}/schedule` | `schedule_post` | `SCHEDULE POST <id> <iso>` |
| Reschedule (Queue, Calendar drag) | `reschedulePostToInstant` | `POST /api/publishing/posts/{id}/reschedule` | `reschedule_post` (new) | `RESCHEDULE POST <id> <iso>` |
| Cancel schedule → draft | `cancelScheduledPost` | `POST /api/publishing/posts/{id}/cancel-schedule` | `cancel_scheduled_post` | `CANCEL SCHEDULE <id>` |
| Publish now / retry failed destinations | `publishPost` | `POST /api/publishing/posts/{id}/publish` (`retryOnly`) | `publish_post` | `PUBLISH POST <id>` |
| Refresh status from the platform | `syncPostStatus` | `POST /api/publishing/posts/{id}/sync` | `sync_post_status` | `SYNC POST STATUS <id>` |
| Submit for approval | `submitPostForApproval` | `POST /api/publishing/posts/{id}/submit` | `submit_post_for_approval` | `SUBMIT POST <id>` |
| Approve / reject | `reviewPost` | `POST /api/publishing/posts/{id}/review` | `review_post` | `APPROVE POST <id>` / `REJECT POST <id>` |
| Delete (local, or also on the platform) | `deletePost` | `DELETE /api/publishing/posts/{id}` | `delete_post` | `DELETE POST <id> LOCAL\|REMOTE` |
| Deletion status | `getPostDeletion` | `GET /api/publishing/posts/{id}/deletion` | `get_post_deletion_status` | read |
| Finish local removal after remote deletion | `finishPostDeletion` | `POST …/{id}/deletion` `{intent:'finish'}` | `finish_post_deletion` | `FINISH POST DELETION <id>` |
| Record a platform deletion verified outside the app | `recordPostDeletionOutcome` | `POST …/{id}/deletion` `{intent:'record'}` | `record_post_deletion_outcome` | `RECORD POST DELETION <op> DELETED\|NOT DELETED` |
| Duplicate | `duplicatePost` | `POST /api/publishing/duplicate` | `duplicate_post` | `DUPLICATE POST <id>` |
| CSV import | `importPostsCsv` | `POST /api/publishing/posts/import` | `import_posts` (new) | `IMPORT POSTS` |
| List / filter / search posts | `readPublishingPostList` / page | `GET /api/publishing/posts` | `list_posts` | read |
| CSV export | `exportPublishingPosts` | `GET /api/publishing/posts/export` | `export_posts` | read |
| Bulk actions | `runBulkPostAction` | `POST /api/publishing/posts/bulk` | `bulk_post_action` | `<ACTION> <n> POSTS` |
| First comment: send | `sendFirstComment` | `POST /api/publishing/first-comments/send` | `send_first_comment` | `SEND FIRST COMMENT <target>` |
| First comment: retry after rejection | `retryFirstComment` | `POST /api/publishing/first-comments/retry` | `retry_first_comment` | `RETRY FIRST COMMENT <target>` |
| First comment: record verified outcome | `recordFirstCommentOutcome` | `POST /api/publishing/first-comments/record` | `record_first_comment_outcome` | `RECORD FIRST COMMENT <target> SENT\|NOT SENT` |
| Publication recovery (status/record/finish/adopt) | `publication.ts` | `GET/POST /api/publishing/recovery` | `get_publication_status` `record_publication_outcome` `finish_publication_projection` `adopt_legacy_publication` | per tool |
| Labels CRUD | `labels.ts` | `/api/publishing/labels`, `/{id}` | `list/create/update/delete_post_label` | per tool |
| Assign labels to a post | collaboration | `/api/publishing/assignments` | `get_post_labels` `list_post_label_choices` `assign_post_labels` | per tool |
| Templates CRUD | `templates.ts` | `/api/publishing/templates`, `/{id}` | `list/create/update/delete_post_template` | per tool |
| Saved views | `saved-views.ts` | `/api/publishing/saved-views`, `/{id}` | `list/create/delete_saved_view` | per tool |
| Custom fields + per-post values | collaboration | `/api/publishing/custom-fields…` | `list/create/update/delete_custom_field` `get/set_post_field_values` | per tool |
| Post notes | collaboration | `/api/publishing/notes`, `/{id}` | `list_post_notes` `add_post_note` `delete_post_note` | per tool |
| Version history / restore | collaboration | `/api/publishing/versions` | `list_post_versions` `restore_post_version` | per tool |
| Queue times | collaboration | `/api/publishing/queue-slots` | `list_queue_times` `replace_queue_times` | per tool |
| Content mix | collaboration | `/api/publishing/content-mix` | `get/save_content_mix` `set_content_mix_autofill` | per tool |
| Recycle | collaboration | `/api/publishing/recycle` | `get/set_post_recycle` | per tool |
| Best times | `getBestTimeSuggestions` | `/api/publishing/best-times` | `get_best_times` | read |
| Workspace images (upload/list/delete) | `media/storage` | `/api/media`, `/api/media/{id}` | `upload/list/get/delete_workspace_image` | per tool |
| Media library | media module | `/api/media-library` | `list_media_library` `import_media_from_url` `delete_media_asset` | per tool |
| RSS feeds | feeds module | `/api/feeds…` | `*_content_feed` | per tool |
| Calendar, Queue, Approvals screens | read services above | `GET …/posts?status=…` | `list_posts` | — |

## Platform-held ("on Facebook") scheduling

Where a scheduled post waits is the author's choice **per destination**, offered only when a selected destination's own module
declares it can hold a post (`scheduling.native` plus `nativeLeadSeconds` on its publishing format). A post-level `scheduleMode`
is the default for destinations without their own entry; the Root default fills in when neither is given.

| Surface | How the choice is made |
| --- | --- |
| UI composer | "Where to hold the schedule" radio group (In the app / On the platform) as the default, shown only for such destinations, with the module's allowed lead window and a note naming destinations that stay with the app. When several destinations are selected and at least one can be held, a "Choose for each destination" list (Same as above / In the app / On the platform) overrides it per destination. English and French. Applies to Schedule and Add to queue. |
| REST (session) | `scheduleMode` and `destinationScheduleModes: { <destinationId>: 'application' \| 'remote' }` on `POST /api/publishing/posts` (with `scheduledAt`), `…/{id}/schedule` and `POST /api/publishing/queue` |
| REST v1 (scoped API key) | The same fields on `POST /api/v1/posts` and `POST /api/v1/posts/{id}/{schedule\|reschedule\|cancel-schedule\|queue}` (below) |
| MCP | `scheduleMode` and `destinationScheduleModes` on `create_post` (with `scheduledAt`), `schedule_post` and `queue_post` |
| Result | `scheduleMode` (platform-held as soon as any destination is), `destinationScheduleModes` (the stored choice per destination) and `remoteHold: { held, deferred, reasons[] }` (reasons: `unsupported`, `too_soon`, `too_far`, `invalid`). A destination that chose the application is never counted as deferred. |

### Key-authenticated REST v1

Handled by `modules/publishing/server/api-actions.ts` through `handleKey` (the same scoped `mcp_` keys, rate limits and workspace
guard as the other v1 routes). The key needs the Publishing posts **write** grant; its channel ceiling becomes the actor scope, and
the shared services re-check tenant, role, feature and scope.

| Route | Service | Confirmation (same strings as the app and MCP) |
| --- | --- | --- |
| `POST /api/v1/posts` | `createPost` | none (unchanged v1 contract) |
| `POST /api/v1/posts/{id}/schedule` | `schedulePost` | `SCHEDULE POST <id> <scheduledAt>` |
| `POST /api/v1/posts/{id}/reschedule` | `reschedulePostToInstant` | `RESCHEDULE POST <id> <scheduledAt>` |
| `POST /api/v1/posts/{id}/cancel-schedule` | `cancelScheduledPost` | `CANCEL SCHEDULE <id>` |
| `POST /api/v1/posts/{id}/queue` | `queuePostRequest` | `QUEUE POST <id>` |

Each write also records the key-level audit receipt (`rest.<action>`). `scheduledAt` is an ISO date-time with offset.

Behaviour (one implementation, `modules/publishing/server/lifecycle.ts` + `schedule-modes.ts` + `remote-hold.ts`):

- The choice is stored per destination in `post_targets."scheduleMode"` (migration `20261031100000_rebuild_destination_schedule_mode`:
  nullable text, constrained to `application`/`remote`; `NULL` on existing rows follows the post-level value). Every scheduled
  destination gets an explicit value. The legacy `posts."publishMode"` column records `native` when any destination is platform-held
  (it triggers the hand-off) and `worker` otherwise. Cancel returns the post to `worker` and clears the destination values.
- On schedule (and again on approval), each destination that chose the platform **and** whose module accepts the time is sent
  immediately as a provider-held post; the target becomes `scheduled_remote` with its remote id and `nativeScheduledFor`. Destinations
  that chose the application stay `pending` for the app worker without being reported as refused; those that chose the platform but
  cannot be held (unsupported, too soon, too far) also stay `pending` and are listed in `remoteHold`. The post stays `scheduled`
  while any destination is waiting. The first comment waits until the platform reports the post live.
- **Queue** (`queue_post`, composer "Add to queue"): after the queue time is saved under the workspace lock, destinations that
  chose the platform (or follow a platform-held Root default) are handed over right away; the result carries `scheduleMode` and `remoteHold`.
- **Content mix and recycle** (system schedulers): a post they schedule follows the Root default per destination
  (`publishing.remoteScheduling.offered` + `defaultMode`); a recycled copy repeats the original post's own per-destination
  choices. The saving transaction cannot call a platform, so `handOffRemoteSchedules` (`server/remote-handoff.ts`) runs straight
  after each mix/recycle run: it takes up to `publishing.remoteScheduling.handOffBatch` scheduled posts that still have platform-chosen
  `pending` destinations and hands them over as the author with the author's current access. It is idempotent; destinations the platform
  cannot hold yet are retried on the next run, and the app worker publishes them at their time if they never become holdable.
- Reschedule moves each held copy on the platform first (the module validates its own lead window) and only then updates local
  records; a time the platform cannot hold is refused with nothing changed.
- Cancel removes each held copy from the platform only while the platform still reports it scheduled (a live post is never deleted),
  then releases the destination with a fresh row. Editing content = cancel, edit, schedule again (as in the legacy app).
- Detecting that the platform published it: the existing status reconciliation (`syncPostStatus` and the module's scheduled-post job)
  flips `scheduled_remote` → `published` on a positive provider read.
- Root (Publishing module): `publishing.remoteScheduling.offered` (default on), `publishing.remoteScheduling.defaultMode`
  (default `application`), `publishing.remoteScheduling.leadMarginSeconds` (default 60), `publishing.remoteScheduling.handOffBatch`
  (default 25, posts handed over per mix/recycle run). The platform's own min/max lead bounds are
  declared by the platform module (Facebook: owned by that module's config).

## Inbox

| Customer action (UI) | Shared service | REST | MCP tool | Confirmation |
| --- | --- | --- | --- | --- |
| List, filter, search, paginate | `readInboxList` | `GET /api/inbox` | `list_inbox` | read |
| Open a thread / history | `readInboxThread` | `GET /api/inbox/threads/{key}` | `get_inbox_thread` | read |
| Sync now | `syncInbox` | `POST /api/inbox/actions` `{action:'sync'}` | `sync_inbox` (new) | `SYNC INBOX [<channel>]` |
| Reply (message, comment, review) | `replyToInbox` | `POST /api/inbox/actions` `{action:'reply'}` | `reply_to_inbox` | `REPLY <kind> <id>` |
| Resolve / reopen | `setInboxResolved` | `…{action:'resolve'}` | `set_inbox_resolved` | `RESOLVE\|REOPEN <kind> <id>` |
| Hide / unhide comment | `moderateInboxComment` | `…{action:'moderate'}` | `moderate_inbox_comment` | `HIDE\|UNHIDE COMMENT <id>` |
| Delete comment (remote + local) | `deleteInboxComment` | `…{action:'delete'}` | `delete_inbox_comment` | `DELETE COMMENT <id>` |
| Deletion status | `getInboxDeletion` | `GET /api/inbox/deletions` | `get_inbox_deletion` | read |
| Finish deletion cleanup | `finishInboxDeletion` | `…{action:'finish_delete'}` | `finish_inbox_deletion` | `FINISH DELETION <op>` |
| Moderation rules, log, run, undo | `moderation.ts` | `GET/POST /api/inbox/moderation` | `get_inbox_moderation` `create/update/delete_inbox_moderation_rule` `run_inbox_moderation_rules` `undo_inbox_moderation_action` | per tool |
| Assign, private notes, saved replies, productivity | `productivity.ts` | `GET/POST /api/inbox/productivity` | `get_inbox_productivity` `assign_inbox_item` `*_inbox_private_note` `*_inbox_saved_reply` `list_inbox_saved_replies` | per tool |

## Remaining gaps (not closed here)

- The new `post_targets."scheduleMode"` migration is pinned in `scripts/cutover-rehearsal.sh` but has **not been applied** to any
  database and the full rehearsal was not run; PostgreSQL, browser and live-Graph checks of per-destination holding are still open.
- Mix/recycle hand-off is a pass after each run, not a dedicated job: posts whose platform-chosen destinations can never be held
  (module without native scheduling) are re-examined every run until their time (bounded by `handOffBatch`, oldest first), and a
  hand-over only happens when a mix/recycle run occurs. A dedicated worker job in `src/server/jobs` would remove that coupling.
- Rescheduling does not re-offer the platform hold to a destination that was `too_soon` at schedule time (it stays with the app).
- `POST /api/v1/posts` keeps its original no-confirmation contract; the integrations module's `REST_POST_CREATE_SCHEMA` (not owned by
  Publishing) does not itself list the new fields, they are added on top in `api-actions.ts`. `restCreatePost` in
  `modules/integrations/server/rest.ts` is no longer used by the route and could be removed by that module's owner.
- Video attachments: whether Facebook can hold a scheduled video with verified read-back is decided by that module, not here.
- Nothing here was exercised against PostgreSQL, a browser, or the live Graph API. `rebuild_publication_attempts` keeps the receipt
  as an ordinary `provider_receipt`; a destination released by cancel is recreated with a new id, so the old journal row stays as history.
- Single-post `GET` and Saved-view update are not exposed on any surface (UI also has none).
