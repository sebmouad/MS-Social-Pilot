WordPress caption character repair
=================================

`db.ts` previously returned caption meta verbatim (only trimming the ends).
There was no HTML entity decoding in the WordPress caption path. Recipe text
also collapsed every JavaScript whitespace character, losing U+00A0/U+202F.
`text.ts` now decodes the complete HTML5 named reference catalog and decimal/hex
numeric references once, preserving nonbreaking spaces. `recipe.ts` retains
those spaces during text normalization. Unknown references remain text; escaped
literal references are not recursively decoded. HTML decoding is not sanitization.
No source in the inspected WordPress path converts a literal nonbreaking space
to `0`; that exact production transformation remains unproven. Check original
WordPress meta if it already contains zeroes. This lane made no live reads.

Safe maintenance entry point
----------------------------

Call `repairPlannedRecipeCaption` from `caption-repair.ts` in the existing
configured rebuild Node runtime, as a workspace-wide owner/admin with both
Feeds and Publishing write access. Use the rebuild's module alias resolution
and existing configuration initialization. This is a service export, not a new
CLI, customer screen, REST route or MCP tool. Do not log returned caption text.

```ts
const actor = { userId: operatorUserId, workspaceId };
const preview = await repairPlannedRecipeCaption(actor, { postId });
// Review preview.before/preview.after privately, preserving code points.
// Only after that review, use exactly the returned receipt and confirmation:
if ('previewId' in preview && preview.previewId) {
  const result = await repairPlannedRecipeCaption(actor, {
    postId, dryRun: false,
    previewId: preview.previewId, confirmation: preview.confirmation,
  });
}
```

The two calls are separate operator steps. Merely passing `dryRun: false`
cannot bypass review: apply must find the same actor/workspace's audit receipt
for the exact caption hashes and local/source version timestamps. Dry-run
writes an audit receipt but never post content. Apply writes content and its
audit in the same transaction. Audit details contain IDs and SHA-256 hashes,
not captions, credentials or WordPress connection strings.

Each call re-reads the exact WordPress caption by ledger recipe identity,
independent of skip-shared/age/candidate scanning. Missing/ambiguous meta is
refused. A change is eligible only if the current caption exactly equals the
original encoded source, or the decoded source with only U+00A0/U+202F positions
replaced by `0` (including partial damage). Meaningful zeroes are preserved. Other changes return `source_mismatch`
for manual review; already-correct captions return `unchanged`. If WordPress
itself already contains `0`, this function cannot infer the lost characters.

The service takes Publishing's post/destination operation locks and workspace
purge boundary, rechecks authority inside the write transaction, and locks the
recipe source/ledger and destination row. Only a future `planned` ledger linked
to a future `scheduled` post with exactly one pending, never-attempted local
destination is eligible. Published, due, claimed, remotely held, journaled,
independently overridden and ambiguous records are refused. A destination
override mirroring the post caption is repaired atomically too. No scheduling,
media, comments, remote copies or published content is changed. The service
explicitly reads legacy physical claim/override columns omitted from the rebuild
Prisma projection; verify the target schema before running maintenance.

Scope and integration
---------------------

No new Root keys; existing WordPress connection/query settings and Publishing
limits/transaction settings are consumed. No schema-version edit. One explicit
post per call avoids adding an unconfigured batch size. Publication and real
database rollback/locking remain unverified by these mocked tests. Integrator
must run a private dry-run against the intended database, review proposals,
then apply and verify stored outcomes. No production repair was performed here.

Outside this lane's ownership, update `docs/ARCHITECTURE.md`, `docs/FEEDS.md`
and `docs/AGENT_HANDOFF.md` with the normalization change and actual maintenance
evidence. If exposing maintenance as a product operation, add thin UI/REST/MCP
entry points calling this same service, with bilingual configurable labels;
none are registered or advertised by this lane. The independent RSS decoder in
`src/modules/feeds/feeds.ts` still has an incomplete named catalog and maps
`&nbsp;` to an ordinary space; it is outside the owned WordPress subtree.
