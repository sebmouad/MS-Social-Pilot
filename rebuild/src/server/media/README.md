# Workspace image storage

The authenticated `/api/media` endpoint accepts a multipart `imageFile` upload for the current workspace. Root controls the destination through `storage.mediaRoot`; `publishing.maxImageUploadBytes` and `publishing.allowedImageMimeTypes` control the platform-neutral media-library size and MIME limits. Each publishing adapter may enforce a smaller size ceiling or fewer accepted types. Uploads are signature checked and stored under `<mediaRoot>/<workspaceId>/images/<uuid>`.

The API returns a stable workspace media reference (`media:<uuid>`) for draft post JSON, along with an authenticated preview URL (`/api/media/<uuid>`). The opaque UUID is not a filesystem path. Both upload and read resolve paths from Root's configured canonical media root and reject symlinked workspace or image directories; files are created exclusively with no-follow flags and read with no-follow flags. Authenticated `DELETE /api/media/<uuid>` removes only an image with no reference in any post in the active workspace; attached images receive `409`. Upload, delete, post writes, and cleanup share the workspace-operation lock so those reference checks cannot race active app writes. The worker reclaims only UUID image files older than Root's `storage.orphanMediaRetentionDays` setting, in batches capped by Root's `storage.orphanMediaBatchLimit` per workspace. Keep preview URLs private to the authenticated workspace.

## Usage and holders (wave 2, legacy `readMediaLibrary` parity)

`listWorkspaceImages` returns `usage` (all stored image files and bytes, plus unused
files/bytes) and, per image, `usedBy` (every referencing post) and `heldBy` (up to
five referencing posts, not-yet-published first). Holders are named only through
the caller's `holderVisibility`, which `mediaHolderVisibility` in
`modules/publishing/server/media-holders.ts` builds from Publishing's whole-post
visibility. The default `null` names no post, so MCP lists counts only until
`server/mcp/server.ts` passes the visibility. Deletion still refuses any referenced
image. Video library, imports and a quota limit (needs a `storage.mediaQuotaBytes`
registry key) remain open. Evidence: unit tests and the full suite on a scratch
synthetic PostgreSQL copy; no browser check yet.
