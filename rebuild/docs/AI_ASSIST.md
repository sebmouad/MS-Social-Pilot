# AI writing assist

Module: `src/modules/studio/` (2026-10-22: the AI module moved into AI Studio; config.ts, mcp.ts, ai.ts pure prompts/validation, copy.ts en+fr, server/, components/AiAssist.tsx). HTTP: `/api/ai`. Settings are Root-owned and listed under AI Studio (`ai.` prefix).

**Suggestions only.** Every path returns text for review. Nothing is saved, scheduled, sent or published by AI; the composer changes the post only when the member presses "Use this text" / "Add to post".

## Capabilities (legacy parity)

Legacy composer assist: write a caption from a brief, improve wording, hashtags, translate, with workspace tone, brand voice and avoid-words, plus a report recap. Rebuilt: `caption`, `improve`, `translate`, `hashtags` (composer, HTTP, MCP) and a reusable `summarize()` for report recaps. Workspace "AI voice" settings (`aiEnabled`, `aiTone`, `aiBrandVoice`, `aiAvoidWords`, Settings > Workspace operations) are now consumed: `aiEnabled=false` hides and refuses assist; voice and avoid-words are sent as delimited style guidance only; the workspace tone is the default when the member picks none.

Shipped since: scheduled agents write weekly drafts (Studio › Writing agents), alt text from images, comment sentiment for spike alerts, AI image/video/voice generation, and reply-draft suggestions. Not ported: per-channel voice. Spend: Root `ai.monthlyBudgetUsd` (0 = off), `ai.priceOverrides` (per-model USD per million tokens), `ai.fallbackInputPricePerMillionUsd`/`ai.fallbackOutputPricePerMillionUsd` and `ai.charactersPerToken` meter every answer (composer, recap, sentiment) as an `ai.completed` activity row (kind, model, estimated tokens, cost; never text). Tokens are estimated from characters because providers return no counts through the port; a model with no price is recorded without a cost and shown as unpriced, never as zero, and is not stopped by the budget. A spent monthly budget refuses at the usage claim before any provider call. The shared status (UI note, `GET /api/ai`, MCP `get_ai_assist_status`) carries `usage` (month, requests, spent, unpriced requests, budget, remaining). The hourly limit still applies. Mocked tests only (`tests/ai-budget.test.ts`).

## Root configuration (`ai.*`, schema 82)

`ai.enabled` (default off), `ai.provider` (anthropic), `ai.apiKey` (secret, encrypted, never returned), `ai.model` (default `claude-sonnet-5-5`), `ai.endpoint`, `ai.requestTimeoutMs`, `ai.maxOutputTokens`, `ai.maxInputCharacters`, `ai.hourlyRequestsPerWorkspace`, `ai.maxHashtags`, `ai.transactionTimeoutMs`, `ai.transactionMaxWaitMs`. Assist is hidden everywhere until enabled and a key is saved.

## Authorization and bounds

One service (`server/ai.ts`) backs UI, API and MCP. `authorizeAi` rebuilds membership, workspace suspension/purge, entitlement and the member's read/write grant (and any MCP key ceiling) on every call. Composer assist needs write on `publishing/posts`; `summarize` needs write on `analytics/reports` by default. Input is capped by `ai.maxInputCharacters`, request bodies at 100 KB, output is stripped of control characters and bounded. Each request is claimed first in `activity_logs` (`ai.requested`, kind and input length only, never text) under a per-workspace advisory lock and counted over a rolling hour against `ai.hourlyRequestsPerWorkspace`; failed provider calls still count. Provider failures return fixed messages, never provider text or the key.

## Surfaces

- Composer: `AiAssist` mounted in `PostComposer` below the message field; `ComposeScreen` passes the server-computed `aiStatus` (no client fetch, nothing rendered when unavailable).
- API: `GET /api/ai` (status), `POST /api/ai` (same-origin; body `{kind, text, tone?, language?}`).
- MCP: `get_ai_assist_status`, `ai_assist_write` (group `ai`, feature `publishing/posts`, write tool needs write access; classified resource-safe because it touches no channel data).

## Reusable recap

```ts
import { summarize } from '@/modules/studio/server/ai';
const { text } = await summarize({ userId, workspaceId }, { facts: 'compact figures text', subject: 'Page name, period', language: 'French' }, { feature: 'analytics/reports' });
```

Only `facts` and `subject` reach the provider. Throws `OperationError` `unavailable` when AI is off (omit the section), `conflict` at the hourly limit, `forbidden` without access. Shares the workspace limit. The caller owns placement and must keep AI text clearly labelled as generated.

## Tests and limits

`tests/ai-assist.test.ts` and `tests/ai-assist-ui.test.ts` mock the provider (no network, no customer data). Not verified: a live Anthropic call, real PostgreSQL claim concurrency, browser/theme checks. French copy exists but the UI renders English until the locale rollout.
