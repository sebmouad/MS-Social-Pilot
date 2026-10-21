# Media rename — round 9

Database-backed image/video assets now support confirmed renaming through
`server/library.ts:renameAsset`, the MediaLibrary dialog/server action, and the
installed `rename_media_asset` MCP tool. The service validates the current Root
name/identifier limits, requires all-channel write access, repeats authorization
under the workspace operation/transaction lock, scopes every query to the current
workspace, preserves attachment/storage identity, and audits changed asset IDs.
An identical name is an idempotent success. No filesystem operation is needed.
The UI preserves input on failure and accepts only the matching ID/name receipt.
English/French labels use `media.copy`; errors use `media.messages`. New labels
fall back to shipped catalog entries for an older saved catalog. Root's existing
`media.assetNameMaxCharacters` also supplies the dialog's name bound.

## Integrator action outside this lane

The module exports a tested thin HTTP handler, but this worktree's app route is
outside ownership. Add exactly this re-export to
`src/app/api/media-library/[id]/route.ts`:

```ts
export { renameMediaHttp as PATCH } from '@/modules/media/server/http';
```

Until that is integrated, REST rename is **not exposed**. The customer UI works
through the module-owned authenticated server action, independent of that route.
Do not describe three-surface rename parity as complete.

Only `source: library` rows can be renamed. Uploaded/imported stored image files
with no media metadata row are deliberately excluded. Supporting their names
requires a consistent metadata/storage design, usage accounting and deletion
changes; no file is renamed or duplicated by this batch. Video thumbnails/raw
legacy-file compatibility and broad library browser checks remain separate gaps.

Checks use fake database ports and jsdom, not PostgreSQL rollback/concurrency,
real browser themes/viewports or provider/production outcomes. No schema-version
change, migration, commit, server, deployment or push is part of this worker.

Final local verification: `npx tsc --noEmit -p .` exited 0. Targeted Vitest
(`--cache=false`, because linked node_modules cache is outside writable scope):
94/94 tests passed across media-library-service, media-library-module,
media-rename-entrypoints, feeds-service, feeds-mcp, feeds-polling and
legacy-round9-ui. `git diff --check` passed. No full suite or build was run.
