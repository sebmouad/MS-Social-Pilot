# AI media generation and composer checks (with caption tests)

Lane: legacy AI and content tools. Source and automated tests only; no live provider,
browser, real database or production run. See also `../../caption-tests/`.

## What exists

| Capability | Service | REST | MCP | Screen |
| --- | --- | --- | --- | --- |
| Picture from a description (saved to the media library) | `server/media.ts` `generateImage` | `POST /api/ai/image` | `generate_ai_image` | `/publishing/ai-studio` |
| Spoken audio (returned, not stored) | `generateVoice` | `POST /api/ai/voice` | `generate_ai_voice` | same |
| Short video (asynchronous, finished into the library) | `startVideo`, `listVideos`, `pollAiVideos` | `POST`/`GET /api/ai/video` | `start_ai_video`, `list_ai_videos` | same |
| Availability, formats, voices, confirmations, usage | `aiMediaStatus` | `GET /api/ai/media` | `get_ai_media_status` | same |
| Link preview | `server/checks.ts` `linkPreview` | `POST /api/publishing/link-preview` | `get_link_preview` | Post check tab |
| Engagement outlook | `engagementOutlook` | `POST /api/publishing/outlook` | `get_engagement_outlook` | Post check tab |
| Spam-risk check | `spamCheck` | `POST /api/publishing/spam-check` | `check_post_spam_risk` | Post check tab |

Caption tests (`src/modules/caption-tests/`): `listCaptionTests`, `startCaptionTest`, `learnCaptionTest`,
`settleCaptionTests` behind `GET`/`POST /api/caption-tests`, `POST /api/caption-tests/[id]/learn`,
MCP `list_caption_tests`, `start_caption_test`, `learn_from_caption_test`, screen `/analytics/tests`.

## Rules the code follows

- UI, REST and MCP call the same service. Each service re-reads membership, entitlement, grant and key ceiling
  (`authorizeAi`), then the channels it touches are intersected with the member's and key's grants.
- Generation needs the exact confirmation (`GENERATE IMAGE`, `GENERATE VOICE`, `GENERATE VIDEO`,
  `START CAPTION TEST`, `LEARN <id>`); the screens send it after an explicit consent dialog.
- Generation claims the shared hourly allowance and monthly budget (`activity_logs` `ai.requested` /
  `ai.completed`) before the provider is called. A price of 0 stays "unknown", never zero cost.
- Providers, endpoints, models (empty = newest listed model matching a pattern), sizes, voices, formats, limits,
  timeouts, prices and all customer copy are Root settings (`ai.imagePolicy`, `ai.voicePolicy`, `ai.videoPolicy`,
  `ai.linkPreviewPolicy`, `ai.outlookPolicy`, `ai.spamGuardPolicy`, `ai.toolsLimits`, `ai.toolsCopy`,
  `captionTests.policy`, `captionTests.copy`). Provider text and keys never reach the customer.
- Link preview uses the shared SSRF guard (`publishing/server/media/network/net-guard`); private addresses are refused.
- Outlook reads each channel's stored per-post figures through the platform module's `postPerformance`; the
  caption-test views and engagement measures are Root lists of measure names the platform module stores.

## Not done / open

- `pollAiVideos` and `settleCaptionTests` are exported for the shared worker; neither is registered as a job
  (needs a manifest `jobs` entry and worker dispatch outside this lane). Until then reads settle them lazily.
- The legacy Facebook link re-scrape (`refresh: true`) is not carried; it needs a Facebook-module hook.
- Composer integration (embedding the post check next to the editor; creating the A/B posts from the composer) belongs to Publishing.
- Learned caption results go to the workspace writing voice. Per-channel `targets.brandVoice` is not read by the rebuild's AI assist.
- `ai_generations` history (legacy usage/cost) is not part of the monthly budget; only rebuild `activity_logs` usage is.
