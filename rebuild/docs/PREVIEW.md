# Local synthetic browser preview

`scripts/seed-preview.ts` creates a repeatable synthetic customer workspace for local browser checks. It uses the generated Prisma client directly and never loads platform registry or server data modules. Stored provider and channel credentials are encrypted, fake values. The configured Graph and OAuth endpoints use reserved `.invalid` hostnames so preview operations cannot reach a real provider.

## Database preparation

Use a fresh, dedicated database on a loopback host with a name ending in `_preview` or `_test`. Start the throwaway PostgreSQL container with `scripts/dev/test-db.sh` (Docker Desktop must be running), create the empty preview database, then apply the baseline migration. From `rebuild/`:

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:55432/postgres' -c 'CREATE DATABASE social_pilot_rebuild_preview'
psql 'postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_rebuild_preview' -v ON_ERROR_STOP=1 -f prisma/migrations/20261103000000_baseline/migration.sql
```

Apply the baseline without a wrapping transaction (no `-1`/`--single-transaction` flag): it contains `ALTER TYPE ... ADD VALUE`, which PostgreSQL forbids inside a transaction block. Run these commands only against the newly created, empty, local preview database. Do not point them at production or an existing customer database. The seeder independently refuses a database that already contains any user or workspace outside the `preview_` ID namespace.

## Seed the fixture

Set a local-only 32-byte `ENCRYPTION_KEY` (base64 encoded), QA email, and QA password. The password must contain at least 12 characters. Run from `rebuild/`:

```sh
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_rebuild_preview' \
NODE_ENV='development' \
ENCRYPTION_KEY='REPLACE_WITH_LOCAL_ONLY_BASE64_32_BYTE_KEY' \
PREVIEW_SEED_CONFIRM='SEED_LOCAL_REBUILD_PREVIEW' \
PREVIEW_QA_EMAIL='preview-qa@example.test' \
PREVIEW_QA_PASSWORD='a-local-only-password-longer-than-12' \
npx tsx scripts/seed-preview.ts
```

The script refuses `NODE_ENV=production`, non-loopback hosts, non-PostgreSQL protocols, URL query overrides for host/socket, and database names without `_preview` or `_test` suffixes. The exact confirmation variable is required. It reads only the process environment, never a `.env` file. The QA email is printed; the password and encryption key are never printed.

The fixture-local `app_settings` rows turn two-step enforcement off for this isolated QA account, enable the Ads management preview controls, and enable the Facebook module for local UI coverage. The fake Ads scopes are `ads_read` and `ads_management`; fake inbox scopes cover read and reply controls. The Graph endpoint is `https://provider-preview.invalid` and the OAuth endpoint is `https://oauth-preview.invalid`. These changes occur only in the fresh dedicated preview database. No provider credential is valid, and the seed script itself makes no provider calls.

The fixture creates an instance-owner QA user and workspace; selected, unselected, expired, and invalidated channels and ad accounts; published, scheduled, draft, approval-pending, failed, and unselected-channel posts, including a draft first comment; open Inbox conversations/messages and visible, replied, hidden comments; selected-channel audience and daily metrics with one intentionally missing audience; unknown demographic breakdown data; and account, campaign, ad-set and ad-level insights in USD and EUR, including unfamiliar action and breakdown fields. Fixture database entity IDs use the `preview_` prefix. The two optional image files use reserved UUIDs because the media API accepts UUID references. Re-run with the same QA email/password to update the fixture records.

## Optional image examples

The bundled `scripts/fixtures/` artwork is synthetic and visibly marked **not a real offer**. SVG source and generated PNGs are kept together; preparing or viewing the fixture makes no external image request. Supply `PREVIEW_MEDIA_ROOT` as an absolute path to an existing, dedicated empty directory to include the two campaign images in full seeding. The path is persisted only in the preview database's existing `storage.mediaRoot` setting.

To add these images to an already-running fixture without resetting its text, statuses, conversation actions or existing attachments:

```sh
mkdir -p /absolute/path/to/dedicated-preview-media
PREVIEW_MEDIA_ROOT=/absolute/path/to/dedicated-preview-media \
node --env-file=/absolute/path/to/private-preview.env --import tsx scripts/seed-preview.ts --media-only
```

The private environment still needs the original loopback database, encryption key, confirmation and QA identity variables. This mode requires the existing preview workspace and refuses to replace another saved storage root. It updates only empty media arrays on the four known authored fixture posts. The storage helper marks an initially empty directory, validates marker bytes on reuse, refuses symlink workspace directories and refuses to overwrite a different file at a reserved image ID. Images are served through `/api/media/<id>` with the normal authenticated workspace checks. The example files intentionally remain for visual review; independently created verification posts/images are cleaned up.

## Start and verify

Run the application with the same local database and encryption key used for seeding. Keep secrets in a private environment file outside Git; never reuse production credentials. From `rebuild/`, for example:

```sh
node --env-file=/absolute/path/to/private-preview.env ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3200
```

Open **http://localhost:3200** and sign in with `PREVIEW_QA_EMAIL` / `PREVIEW_QA_PASSWORD`. Use the `localhost` browser hostname: the current Next development server canonicalizes request origins to localhost, so mutating requests opened through 127.0.0.1 may be refused by the origin guard. Do not weaken that guard to make previews work.

The sample workspace has six posts, two audience values totaling **2,020**, two selected accounts with delivery data (**USD 300.00** and **EUR 92.40**), a selected expired account without delivery data, campaign/ad-set/ad details, and a message plus comment threads. Unknown values and unselected/invalidated resources exercise missing-data and visibility states. Account/campaign/ad-set/ad rows represent levels of the same example delivery and must not be added together. Drafts and failed destinations have no remote publication ID.

To enable the real PostgreSQL schema probes in the automated suite:

```sh
REBUILD_PREVIEW_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_rebuild_preview' npm test
npm run typecheck
```

Without this variable, database integration probes are explicitly skipped. These probes use rollback transactions and unique `preview_` IDs. Do not run `npm run build` in the same checkout while its preview is running: both write `.next`. Current verification builds an isolated temporary source copy, with dependencies linked from the existing installation, so the user preview stays available. Alternatively, stop the preview deliberately before building. Do not start a publishing worker against this fixture.

See [PREVIEW_QA.md](PREVIEW_QA.md) for observed results and remaining issues. Example-data validation is not live-provider, full MCP-parity, migration or production-cutover evidence.
