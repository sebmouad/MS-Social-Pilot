# Per-destination publishing formats

Batch85 implementation, not complete native-provider support.

## Ownership and intent

Each platform declares opaque IDs and safe labels/capabilities. Shared Publishing
validates the selected ID against that destination's current catalog; it never
branches on a provider or format name. New destinations persist their own module
format in `post_targets.formatId`, including an explicit module default when the
user has only one choice. A global post default no longer decides new channels'
formats. Different modules may use different defaults on the same post.

Existing NULL target values retain the legacy `posts.format` fallback. Editing
preserves stored choices; a newly added destination uses its own module default.
Explicit invalid, empty, stale or unselected keys are rejected before persistence.
Disabled/removed choices are retained visibly as unavailable until deliberately
replaced. No old Reel or Story is silently converted to feed content.

Create, edit, queue/schedule/reschedule, duplication, recycling, worker publication
and MCP use these services. CSV accepts the existing three columns or an optional
fourth `destinationFormats` JSON object keyed by selected destination IDs. Every
row resolves and validates all formats before any import writes. Templates are
content-only and do not reset a composer's destination choices.

Publishing CSV export includes `format_id` in each destination object. Workspace
export inherits the stored target fields and version JSON; erasure removes them
with their parent records, without a new detached data table. New version
snapshots store the exact target-to-format map and include it in deduplication.
Old empty-map snapshots restore their historical global format for their recorded
targets, revalidated against current capabilities. They must not silently retain
a newer format merely because the old choice is now unavailable.

## UI and recovery

The dedicated composer and inline editor use one shared `DestinationFormats`
control in the contextual sidebar. Single-format destinations show a label;
multiple choices use the canonical native select. Only selected destinations are
serialized. Unknown saved choices remain explicit and invalid until changed.
Media compatibility follows the chosen descriptor. The unused alternate quick-
create component was retired; the dedicated composer remains canonical.

`usePreserveFormState` intercepts native resets at the form in capture phase.
Browser testing found React action resets clearing associated sidebar checkboxes
while controlled preview/format state remained selected. The native listener
keeps submitted controls and state aligned after failure. The form navigates on
success, so cancelling native resets does not impede successful completion.

## Migration and limits

`20261019020000_rebuild_destination_formats` adds nullable `post_targets.formatId`
and object JSONB `post_versions.destinationFormats`. Existing rows and old global
fields are retained. SQL checksum:
`30325cdda1951cde93fab77a12bc349caa4422861fe133f68320ac3b979af6c6`.

The reviewed rehearsal set now contains18 migrations. Local synthetic backup was
restored with exact table counts before applying this additive migration; counts
also matched afterward. Production has not been migrated or cut over. The backup
is private; do not commit its contents or environment files.

## Remaining provider work

Facebook still advertises feed only. Native video/Reel/Story engines need signed
transport, tenant-bound durable phase receipts, granular status/first-comment/
remote-delete routing, Root controls and verified provider contracts/live cleanup.
No new native format is enabled by this storage/UI batch. Full production-shaped
migration, media, authorization and service/proxy rollback remain release gates.

## Current verification

The isolated reviewed candidate passes 2,953 tests in 342 files with no skips, type checking and a production build. Real local HTTP/MCP checks prove format persistence, explicit updates, invalid-format rejection before save, current grant enforcement, cross-workspace/read-key denial and exact fixture/settings cleanup. The eighteen-file schema-only rehearsal passed. Browser failure recovery retains actual sidebar checkboxes and intent; retry redirect navigation remains an open check until the complete desktop/phone theme matrix passes. Static premium audit still reports preexisting application findings; this is not a whole-app accessibility clearance.
