# Feeds ingestion, AI assist and media library (W6b)

Status: SOURCE and MOCKED TESTS ONLY. Not wired into the host, not browser-checked, no real SQL run,
no live provider or network call. Production remains legacy.

## Scope delivered

| Capability | Source | Notes |
| --- | --- | --- |
| Content feeds | `src/modules/feeds/**`, `src/app/feeds/**`, `src/app/api/feeds/**` | RSS/Atom and WordPress REST feeds. Create/update/delete with exact confirmations; "Check now" preview; draft creation (one local draft per new item, with channel rows, never scheduled or published). |
| AI assist | `src/modules/ai/**`, `src/app/api/ai/**` | Caption, improve, translate, hashtags. Provider port + Anthropic adapter. Hidden/unavailable unless Root enables it and a key and model are saved. Composer component `modules/ai/components/AiAssist.tsx` (not yet mounted). |
| Media library | `src/modules/media/**`, `src/app/media/**`, `src/app/api/media-library/**` | Image + video list with quota, holder attribution, import from a web address, guarded delete. |
| Shared outbound guard | `src/modules/media/net-guard.ts` | Used by feeds and media import: scheme/port/credential rules, host allowlist, resolved-address checks, per-hop redirect checks, deadline, streaming byte cap. |

Authorization uses existing feature ids: feeds and AI use `publishing/posts` (write needs an authoring role),
media uses `publishing/media`. Channel-scoped members see/manage only feeds whose channels are all inside
their grant, see media usage only as used/unused, and cannot delete media (deletion can affect any channel).
Every mutation runs under the workspace advisory lock, re-checks membership/permissions inside the
transaction, writes `activity_logs` atomically and rolls back (and removes stored files) when the audit fails.

## Security notes

- SSRF: private/loopback/link-local/metadata/CGNAT ranges, non-web ports, credentials in URLs, plain http (unless Root allows), and non-allowlisted hosts are refused before any request. Every redirect hop and every DNS answer is re-checked; an empty or mixed DNS answer fails closed. Tests inject the fetcher and resolver; no test touches a network.
- Known residual risk: DNS rebinding between the check and the connection cannot be closed with the default `fetch`
  transport (it cannot pin an address). `FetchRequest.resolved` is passed to the injected fetcher so a pinning transport
  can be supplied; otherwise deployment should use an egress proxy that blocks private ranges.
- Content is decided by bytes (signature sniffing), never by declared type or file name. File names are sanitised.
- AI: member text is delimited as quoted material; output is control-character-stripped, bounded, and only returned for review.
  The provider key is a Root `secret`; provider error text is never returned. Each request is claimed in the audit trail
  before the provider call (counted even on failure) for the rolling hourly workspace limit.

## Root configuration tuples (exported, NOT yet registered)

`FEEDS_CONFIG` (`modules/feeds/config.ts`), `MEDIA_CONFIG` (`modules/media/config.ts`), `AI_CONFIG` (`modules/ai/config.ts`).
All are `consumption: 'active'` with validated bounds; the services re-validate stored values at read time and fail as
"unavailable" if a value is out of range or transaction timeouts exceed `data.workspaceOperationTimeoutMs`.

## MCP definitions (exported, NOT yet wired)

- `modules/feeds/mcp.ts`: `list_content_feeds`, `create_content_feed`, `update_content_feed`, `delete_content_feed`, `check_content_feed`; sets `feedTools`, `feedWriteTools`; `executeFeedTool(actor, name, args)`.
- `modules/media/mcp.ts`: `list_media_library`, `import_media_from_url`, `delete_media_asset`; `mediaTools`, `mediaWriteTools`; `executeMediaTool`.
- `modules/ai/mcp.ts`: `get_ai_assist_status`, `ai_assist_write`; `aiTools`, `aiWriteTools`; `executeAiTool`. The AI tool should be omitted from discovery when `get_ai_assist_status` reports unavailable.

## Host wiring required (lead)

1. Register `FEEDS_CONFIG`, `MEDIA_CONFIG`, `AI_CONFIG` in `src/lib/config/registry.ts` (Root groups "Content feeds", "Media library", "AI assist").
2. Add the three MCP definition/dispatch sets to the MCP server with write confirmation handling and API-key scope checks.
3. Navigation/manifest entries: `/feeds` (Publishing), `/media` (Publishing). Mount `<AiAssist text onUse />` in the composer.
4. Optionally add dedicated `publishing/feeds` and `ai/assist` feature ids to `product.ts`, permissions and entitlements, then change `FEATURE` in `modules/feeds/server/feeds.ts` and `modules/ai/server/ai.ts`. Until then they share `publishing/posts`.
5. No schema change: uses the existing legacy tables `feed_sources`, `feed_items`, `media`, `posts`, `post_targets`, `activity_logs`. Assumes the legacy DB defaults for columns not written (e.g. `posts.timezone`, `mediaKeys`, `media`); verify against a real migrated database.

## Known gaps and limitations (not complete parity)

- No scheduler: feeds are checked on demand (UI/API/MCP). Automatic polling needs a worker hook that runs as a qualifying owner; not built. Legacy auto-schedule/approval modes, spread-minutes and publish modes are not ported; the rebuild creates drafts only.
- Feed images are not downloaded or attached to drafts.
- AI: one provider implemented (Anthropic). OpenAI/Gemini, image/video/voice generation, alt text from images, week planning, sentiment, report recaps, AI agents and spend budgets are not ported.
- Media: no browser upload route for videos, no raw/stream delivery route for videos, no thumbnails for videos, no derived-variant (watermark/crop) handling, no rename. Image upload remains in the existing `/api/media` and Publishing media screens. The import UI does not refresh the list after success (asks for a page refresh).
- Quota counts `media` rows plus up to 1000 stored images (flagged approximate beyond that).
- Holder attribution scans posts with a substring match bounded by `media.holderScanLimit`; truncation is reported, and forced deletion is refused when truncated.
- Thumbnails use the existing `/api/media/<id>` image route for stored images only.

## Evidence

Focused vitest: feeds-parse, feeds-service, feeds-mcp, media-library-net, media-library-service, ai-assist (mocked Prisma/SQL
text routing, injected network and provider). Not run: real PostgreSQL, browser (light/dark, phone/desktop, keyboard),
live provider calls, MCP wiring, authorization across API keys.
