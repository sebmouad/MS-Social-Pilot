# Inbox metadata integration status

This lane adds neutral optional `InboxMetadata` observations, tenant/channel-scoped
JSONB persistence for conversations/messages/comments, and shared list/thread
reads. Sync writes happen after provider reads, inside the existing transaction.
Missing observations preserve previously stored fields; empty arrays explicitly
clear collections. Sender ids, original message/comment timestamps, remote ids
and true remote parent ids remain available for response analysis. Thread history
is paginated; a visible page is not complete response-time history.

## Required integration outside this lane's ownership

This is **not end-to-end Facebook metadata collection or release-ready work**.
`src/platforms/facebook/publishing.ts` currently discards these observations.
Extend `FacebookConversation`, `FacebookInboxMessage`, and `FacebookComment` with
`metadata?: InboxMetadata`; request/map Graph participant names/ids/pictures,
message attachments (type and URL), comment author pictures, reactions and
permalinks, and conversation labels/folder where readable. Set `metadata.threadId`
when Graph provides it. Preserve omitted/unsupported fields as unknown. A partial
reaction/attachment/participant edge must not be described as complete; paginate
within Root bounds or record that limitation. Keep all provider-specific mapping
in Facebook. Add mocked-Graph tests at that mapper boundary. Current new tests
exercise supplied normalized engine observations and shared storage/read behavior;
the existing mocked-Graph discovery suite is regression evidence only.

The additive source `20261031170000_rebuild_inbox_metadata` is squashed into
the `20261103000000_baseline` migration, which the cutover rehearsal
checksum-pins and applies (lane 47). Before shipping, verify the rehearsal
covers the new columns and
the migration application sequence, and add:

```sh
verify_migration 20261103000000_baseline 8abd5224f753f0cb845f9bd748e12e8db3cb7dbb4f1348c714e1d62231e0f8dd
```

Add nullable `inboxMetadata Json?` fields to `Conversation`,
`ConversationMessage`, and `PostComment` in `rebuild/prisma/schema.prisma` and
the canonical root schema. Current code uses parameterized SQL because neither
schema nor generated client is owned by this lane. Rehearse/apply the migration
before running the changed readers; they reference the new columns. No migration
application, PostgreSQL proof, live Graph observation, UI presentation, deployment,
or production claim is made here. Update architecture/handoff/coverage docs during
integration; those documents are outside this lane. No new Root settings.
