# Post duplication

Implemented 2026-10-17. This closes one Publishing capability, not complete
Publishing, Facebook or legacy parity. It sends no provider request.

## Ownership and behavior

`modules/publishing/server/duplicate.ts` owns `duplicatePost`. The Posts UI,
`POST /api/publishing/duplicate` and workspace MCP `duplicate_post` call this
same service. It uses the existing Publishing workspace/post/destination guard,
refreshes current write authorization and applies whole-post read visibility.
Every attached destination must be selected, entitled and in the caller's
current scope. Scoped members can copy only their own unconnected drafts;
contributors can copy only their own posts. Managers may copy other visible
posts. Installation ownership grants no customer authorization exception.

One copy contains the source text, first comment, link, all media references
and selected destinations. Current authoring limits, attachment rules, local
image ownership and destination capabilities are revalidated. The new author is
the caller. It is an unscheduled draft with fresh pending destination rows.
Remote publication/comment IDs, URLs, timestamps, errors, comments, approvals,
operation journals and delivery history are never copied. Original records and
remote content remain unchanged. Active/uncertain legacy publication states and
unresolved operation evidence refuse new copies through the existing guard.

## Request and retry contract

All three interfaces send exactly:

```json
{
  "postId": "source-post-id",
  "requestId": "5a985a8a-8234-494c-a2f7-a269ea50d111",
  "confirmation": "DUPLICATE POST source-post-id"
}
```

The canonical lowercase UUID is the new post ID and persistent request identity.
The service atomically creates the post and a content-free domain audit with
ID `duplicate:<requestId>` and action `publishing.post_duplicated`. The audit
binds workspace, actor, source and copied ID. A retry first rechecks current
source authorization, then returns the existing matching receipt. It never
overwrites later changes to the copy. Collisions or a deleted copy fail closed.
Database uniqueness prevents the same UUID creating multiple posts. No schema
migration is introduced; registry 46 and existing consumed Publishing limits
and feature permissions remain authoritative.

The receipt is `{sourcePostId, postId, draftCreated: true, replayed}`. HTTP returns
201 for a new copy and 200 for replay, always with no-store. Cache revalidation
cannot turn a committed receipt into failure. MCP requires the same exact
confirmation, checks write permission and avoids nesting another workspace lock.
Secondary MCP audit failure preserves the domain receipt with an audit warning.

The UI prevents concurrent row mutations and validates the receipt before
opening the Drafts table and focusing its result notice. An unknown response
preserves the same request ID and offers Check Drafts in another tab. After
confirmed success, a later deliberate copy receives a new request ID. Reloading
or leaving the component loses its in-memory request ID; inspect Drafts before
starting a new attempt after an unknown response. Durable cross-browser intent
storage and undo are not part of this batch.

## Verification boundaries

Unit tests cover current scope, contributor ownership, strict input, receipt
bindings, safe errors, secondary audit failure, UI pending/focus/retry and fresh
intent after success. Isolated PostgreSQL tests verify clean copying, replay,
transaction rollback on audit failure and source scope denial. The guarded
`scripts/verify-post-duplication.ts` exercises actual localhost HTTP/MCP with
disposable synthetic identities; its cleanup also restores any temporary local
MCP role policy exactly. Browser evidence belongs in PREVIEW_QA.md.

This does not implement bulk duplication/actions, saved views, full media
editing, provider scheduling/formats, automatic remote reconciliation or a
production migration. Remote Facebook evidence and cutover gates remain open.
