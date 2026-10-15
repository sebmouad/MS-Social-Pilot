# Existing data compatibility

The fresh app reads selected records from the existing PostgreSQL database. Its
Prisma schema in `prisma/schema.prisma` maps only the existing tables needed for
identity, workspace membership, destinations, posts, connected social accounts,
advertising account metadata, and the minimum user/session columns required to
reuse existing sign-in state.

This schema is a client view, not a database migration. Do not run `prisma db
push`, `prisma migrate`, or any schema migration from the rebuild app against
the production database. The rebuild now writes compatible sessions, two-step
credentials, draft posts, selected destinations, and Root configuration.
Every read and write must validate workspace membership and feature access.

The mapped column and enum names follow `app/prisma/schema.prisma`. The schema
omits legacy fields and tables the new app does not need, including some
workspace settings and external provider credentials. Session token hashes
are read for authentication; the rebuild also creates and revokes sessions.
Social access tokens are not selected by customer read views. A small set of
legacy app settings backs the typed Root configuration registry. Additional
models must be checked against the production schema and migration plan before
use.

## Workspace export and erasure coverage

The rebuild's workspace data export and purge cover its mapped schema, tables
with a direct foreign key to `workspaces`, and the known indirect tables mapped
from the parent app's current Prisma schema. The export serializes direct legacy
tables by `workspaceId`, recursively redacts credential-like fields, and
includes mapped indirect records for posts, inbox conversations, Page/ad
insights, Instagram account insights and media, and the legacy feature tables
listed below. Instagram account exports include their mapped scalar profile
fields. Memberships are exported as a limited identity summary; purge state and
instance-wide authentication/audit records are retained or excluded. The
export reports `complete: false` because instance-wide records and any tables
outside the reviewed schema are not represented.

The known indirect workspace tables reviewed from `app/prisma/schema.prisma`
are `bio_links`, `external_posts`, `feed_items`, `instagram_media`,
`link_clicks`, `member_page_access`, `metric_availability`,
`notification_mutes`, `page_group_targets`, `page_reviews`, `page_videos`,
`post_field_values`, `post_labels`, `post_notes`, `post_versions`, and
`review_decisions`, plus mapped post targets/comments, Page insights, inbox
conversations/messages, ad insights, and Instagram insights. Each indirect
table is counted and exported with workspace ownership resolved through its
parent row. Purge deletes these children with workspace-scoped predicates
before deleting their parents; feed-item references are nulled on workspace
posts before feed items are removed. This explicit map must be rechecked when
the parent schema changes; newly added indirect relations are not discovered
automatically.

Deletion preview counts the mapped indirect records and every direct workspace
table found through PostgreSQL foreign keys. The database phase deletes mapped
indirect children with workspace-scoped joins before deleting direct tables;
this does not rely on legacy `ON DELETE CASCADE` settings. It leaves memberships
and the purge job in place, preserving the caller's authority and retry state.
The filesystem phase removes only the workspace's media directory and its
export directory beneath the configured storage root, including unindexed
files. The export and deletion services have unit coverage with mocked database
clients; they have not been run against production data or a full production
schema. The explicit indirect-table list is verified against the checked-in
parent schema, not a live catalog. Recheck the discovered table graph and
storage layout against an isolated schema copy before cutover.
