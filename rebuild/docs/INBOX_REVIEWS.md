# Inbox reviews

Status: implemented locally; unit tests with mocked Graph transport and mocked
database only. No PostgreSQL, browser or live-provider run. Facebook-only scope.

## Shape

- **Neutral capability.** `PlatformInboxHost.reviews?` (`src/server/platforms/host.ts`)
  has `sync(actor, targetId?)` and an optional `reply(actor, { id, text })`. A module
  that does not read reviews omits it and the Inbox shows nothing for it. The adapter
  analogue is `PlatformAdapter.listReviews?` returning neutral `InboxReview`
  (rating 1 to 5 or null, recommendation `positive | negative | null`).
- **Shared Inbox.** `kind: 'review'` is a list filter (`type=review`), a thread key
  (`review:<id>`), a resolve/reopen target and a reply target, through
  `src/modules/inbox/server/{read,workflow,actions}.ts`, the HTTP route
  `/api/inbox/actions` and the `list_inbox`, `get_inbox_thread`, `reply_to_inbox` and
  `set_inbox_resolved` MCP tools. Same authorization, channel scope and audit as
  comments. Reviews are not hideable or deletable here.
- **Facebook module.** `src/platforms/facebook/reviews.ts` (mapping, version rule),
  `reviews-store.ts` (upsert into `page_reviews`), `listReviews` on the engine and
  adapter, `syncFacebookReviews` in `inbox.ts`. Facebook declares `reviews.sync` only:
  Meta exposes no reply endpoint for ratings, so reply is absent and the screen says to
  answer on the platform.
- **Provider version.** Meta removed `/{page-id}/ratings` after v21.0, so it is read
  through an engine pinned to v21.0 until 2027-01-21 (legacy parity), then not read at
  all (sync stores nothing and reports zero; stored reviews stay readable).

## Data

Existing `page_reviews` table (legacy). Additive migration
`20261030100000_rebuild_review_resolution` adds nullable `resolvedAt`. The rebuild
Prisma client does not map this table, so every access is raw SQL; the root
`prisma/schema.prisma` declares the new column. **The shared list query reads
`page_reviews."resolvedAt"`, so the migration must be applied before this code runs**
(and pinned in `scripts/cutover-rehearsal.sh`; not done here).

Sync never overwrites `resolvedAt`. Missing rating or recommendation is stored and
shown as "No rating available", never as zero.

## Not done

- Review replies (no Facebook endpoint); `needsReply` is always false for reviews.
- Automatic worker sync: reviews sync with the manual/shared Sync now only. The
  Facebook inbox job (`jobs.ts`) is unchanged.
- Notes and saved replies on reviews; moderation rules do not apply to reviews.
- Export/erasure already cover `page_reviews` (data-control); `resolvedAt` is included
  by the table-level copy but was not separately verified.
- French is in `modules/inbox/reviews-copy.ts`; the Inbox screen has no per-user
  locale yet, so it renders English like the rest of the screen.
