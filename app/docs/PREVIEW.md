# Local Synthetic Browser Preview

`scripts/seed-preview.ts` creates a repeatable synthetic customer workspace for local browser testing. It uses the generated Prisma client directly with fake encrypted credentials and `.invalid` provider hostnames so preview operations never contact external networks.

## Database Preparation

Use a dedicated loopback PostgreSQL database ending in `_preview` or `_test`. Start a local container with `scripts/dev/test-db.sh` and initialize the schema with `scripts/dev/qa-db.sh` from `app/`:

```sh
cd app
QA_DB_REBUILD_CONFIRM=REBUILD_LOCAL_QA scripts/dev/qa-db.sh 'postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_rebuild_preview'
```

## Seeding the Preview Workspace

Run from `app/`:

```sh
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/social_pilot_rebuild_preview' \
NODE_ENV='development' \
ENCRYPTION_KEY='REPLACE_WITH_LOCAL_ONLY_BASE64_32_BYTE_KEY' \
PREVIEW_SEED_CONFIRM='SEED_LOCAL_REBUILD_PREVIEW' \
PREVIEW_QA_EMAIL='preview-qa@example.test' \
PREVIEW_QA_PASSWORD='a-local-only-password-longer-than-12' \
npx tsx scripts/seed-preview.ts
```

## Starting the Local Preview Server

From `app/`:

```sh
node --env-file=/absolute/path/to/private-preview.env ./node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3200
```

Open `http://localhost:3200` and sign in with `PREVIEW_QA_EMAIL` / `PREVIEW_QA_PASSWORD`.
