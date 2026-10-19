# Media library (legacy parity wave 2, session B)

Status: SOURCE and MOCKED TESTS. No real PostgreSQL run, no browser check, no live network call. Production remains legacy.

## Ownership

The library is a feature of the Publishing product module (feature id `publishing/media`, route `/publishing/media`). It lives in `src/modules/media/` and Publishing's manifest spreads `MEDIA_PAGES` and `MEDIA_ROOT_KEYS` from `modules/media/manifest.ts`, so no new module id, permission module or navigation group was added. The module follows the self-containment layout:

| File | Role |
| --- | --- |
| `manifest.ts` | navigation page and Root key ownership (spread into Publishing's manifest) |
| `config.ts` | 14 `media.*` Root keys (all `active`) |
| `library.ts` | schemas, confirmations, content sniffing, reference helpers |
| `server/library.ts` | service: `readLibrary`, `importFromUrl`, `deleteAsset` |
| `server/access.ts` | per-call re-authorization (account, membership, plan, grants, purge guard) |
| `server/store.ts` | storage port over the shared image storage plus video files |
| `server/http.ts` | thin-route helpers (same-origin, strict query, JSON errors) |
| `mcp.ts` | `MEDIA_MCP` tool group |
| `copy.ts`, `ui/` | en+fr copy, `MediaScreen` (route screen), `MediaLibrary` (client) |

`src/app/publishing/media/page.tsx` re-exports `ui/MediaScreen`. API: `GET/POST /api/media-library`, `DELETE /api/media-library/[id]`. Image bytes, raw delivery and image upload stay in the existing `/api/media` routes (the screen's "Upload image" button posts there).

Reused rather than duplicated: the SSRF guard and pinned fetch (`modules/publishing/server/media/network/*`, byte-identical to the WIP copies, so the WIP copies were dropped), image storage and errors (`modules/publishing/server/media/*`), workspace lock (`withWorkspaceOperation`).

## Capability

- List images and videos (stored image files plus legacy `media` rows), newest first, filter by kind, file-name search (literal, bounded), used/unused, paging. Quota meter (rows plus every stored image file, exact).
- Usage: per asset, posts referencing it (`posts.media` / `posts.mediaKeys`). Posts are named only to members with access to all channels; a channel-limited member sees used/unused only. Truncated scans are reported ("usage may be incomplete").
- Upload image (existing route), import image or video from a public https address (exact `IMPORT MEDIA <url>` confirmation, SSRF-guarded, bytes decide type, size/type/quota enforced under the workspace lock, audited in `activity_logs`).
- Delete: refused while any post uses the asset unless `allowInUse` with `DELETE IN-USE MEDIA <id>`; never while a using post is scheduled, publishing or awaiting approval; needs access to all channels; file removal outcome reported; rolls back on audit failure.
- MCP: `list_media_library`, `import_media_from_url`, `delete_media_asset`, resource `msp://media/library`. All three tools are classified workspace-wide, so credentials restricted to selected channels are refused for tools and the resource. Writes need the exact confirmation and add a Root MCP audit receipt.

## Root keys (registry version 82)

`media.libraryPageSize`, `workspaceQuotaBytes`, `videoMaxBytes`, `allowedVideoMimeTypes`, `importMaxBytes`, `importTimeoutMs`, `importMaxRedirects`, `importAllowHttp`, `importHostAllowlist`, `holderScanLimit`, `holderListLimit`, `searchMaxCharacters`, `transactionTimeoutMs`, `transactionMaxWaitMs`. Byte limits are capped at 2147483647 because `media.size` is a 32-bit column. Owned by Publishing in Root.

## Limitations

- Videos cannot be uploaded from the browser (import by address only); no video thumbnails, no rename, no derived-variant handling.
- At most 1000 stored image files are listed (quota totals stay exact); beyond that the list view is partial.
- Import uses the shared address-pinning transport (`defaultFetchDeps`), so DNS rebinding between check and connect is closed; tests inject the fetcher and never touch a network.
- Evidence is unit tests with mocked Prisma/SQL text routing and injected network/store. Not run: PostgreSQL, browser, MCP end to end with API keys.
