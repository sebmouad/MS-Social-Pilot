# Round 11: stored-image names and still WebP import

Ownership: src/modules/media, focused tests, the media inventory status cell and
three MCP_PARITY rows. Three remaining media workflow slices reuse the existing
shared services: still-WebP imports, persistent imported-image names (including
search after refresh), and rename for stored/uploaded images without metadata.
This does not complete the media or overall legacy inventory.

The library UI submits imports to POST /api/media-library; MCP
import_media_from_url enters the same importFromUrl service. The existing UI
server action, PATCH /api/media-library/[id] and rename_media_asset enter
renameAsset. GET /api/media-library and list_media_library share readLibrary.
No route re-export is needed: the actual PATCH route already exists in this tree.
Service confirmations, current authorization, workspace lock, write-time actor
checks and transactional audit remain authoritative. Rename needs all-channel
access; audit records asset identity without customer file names.

Still WebP is converted to PNG because workspace image storage accepts
JPEG/PNG/GIF. Bytes determine format. Animated WebP is refused. Root owns the
new typed media.webpImportPolicy object: enabled, maxPixels, maxConcurrent
(per process), timeoutMs, maxOutputBytes. A timed-out native conversion retains
its permit until work settles. Converted bytes determine quota, stored metadata
and the import receipt. The image storage service also enforces its own MIME
and upload limits; enabling conversion cannot bypass them. EN/FR Root catalogs
explain conversion and refusal. CONFIG_SCHEMA_VERSION is intentionally unchanged.

Canonical stored-image names use media rows with id equal to the image UUID,
url media:<UUID>, image kind and null storageKey. These rows have workspace FK
ownership, original file size/MIME/date and no duplicate bytes. The file listing
remains authoritative for presence, usage and age. The library excludes name
rows from database quota/count totals and reads names for the bounded image
listing before applying search. Missing files do not appear merely because a
name row remains. Upsert refuses a collision with another workspace, a derived
record or a noncanonical record. Rename does not move or rewrite attachments.
Library deletion removes its metadata in the same transaction as its audit.

Evidence: rebuild TypeScript passes with zero errors. 78 focused tests across
media-library-service, media-library-module, media-library-net,
media-rename-entrypoints, media-webp-policy, media-round11-ui and parity-guard
pass with --no-cache. Tests include a real Sharp still-WebP round trip, final-byte
quota enforcement, policy/output/pixel/animation refusal, timed-out permit
retention, scoped SQL shapes, shared actual REST/MCP/action mapping, bilingual
guidance, failed rename input retention and refreshed names without remounting.
Mocks do not prove PostgreSQL execution, transaction rollback or cross-process
concurrency. jsdom does not prove browser layout, keyboard or download behavior.

Outside-owned-path integration follow-ups:

- Integrator bumps CONFIG_SCHEMA_VERSION for media.webpImportPolicy and changed
  media.copy/media.messages catalogs, and records this batch in ARCHITECTURE.md,
  DELIVERY_PLAN.md and AGENT_HANDOFF.md.
- Publishing owner should remove canonical name metadata after confirmed removal
  via DELETE /api/media/[id], delete_workspace_image and orphan cleanup. Those
  older image services bypass this module. Until integrated, metadata may outlive
  a removed file; it is hidden by the library and excluded from its quota.
- Verify export/erasure with real data, including canonical name rows and image
  files. Existing media-table ownership is reused; export completeness is not
  established here. Existing raw image listings do not expose these saved names.

No migration, server, whole suite, deploy, push, production operation or commit.
Changes remain in this worker's working tree. Existing untracked dependency links
and premium-audit.json were not changed.
