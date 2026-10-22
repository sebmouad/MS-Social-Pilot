# AI Studio module — consolidation record (2026-10-22)

Owner directive: AI Studio is its own product module for content generation,
auto-planning and all relevant features. The `agents`, `ai` and `caption-tests`
module directories were vacated and deleted; their code now lives here. URLs are
unchanged (`/content/ai-studio`, `/content/agents`, `/insights/tests`,
`/api/ai/*`, `/api/agents/*`, `/api/caption-tests/*`); only ownership, tabs and
feature ids changed. No new redirects.

## Owned files

- `manifest.ts` (id `studio`, area `content`, entry `/content/ai-studio`): pages
  `studio/ai-studio`, `studio/agents`, `studio/tests` (Insights area, tabOrder
  45); redirects `/publishing/ai-studio`, `/agents`, `/analytics/tests`; jobs
  `scheduledAgents`, `captionTests`, `aiVideos`; prefixes `agents.`, `ai.`,
  `captionTests.` plus explicit `publishing.captionTestsSchedule`.
- `config.ts`: every Studio Root entry with UNCHANGED key names (`ai.*`,
  `agents.*`, `captionTests.*`, `publishing.captionTestsSchedule`). New copy
  keys (`plan*`, `scheduledHistory`, `historyDrafts`) fill from shipped
  defaults so saved Root catalogs keep validating. No schema version bump.
- `mcp.ts`: `STUDIO_MCP` aggregating the assist, content-tools, caption-tests,
  agents and translated-posts groups. Tool names unchanged.
- `ai.ts`, `copy.ts`, `tool-errors.ts` (leaf: error-copy schema shared by
  config and services without a server import cycle).
- `agents/`: writing briefs + metered suggestions (`server/service.ts`),
  scheduled runs with run history (`server/scheduled.ts`), thin REST
  (`server/http.ts`, `server/scheduled-http.ts`), copy, `ui/` screens.
- `content-tools/`: pictures, video, voice, post checks (`server/`, `ui/`,
  `copy.ts`, `pure.ts`, `mcp.ts`).
- `caption-tests/`: A/B tests (`server/`, `ui/`, `copy.ts`, `pure.ts`, `mcp.ts`).
- `server/`: AI provider service (`ai.ts`, `access.ts`, `alt-text.ts`,
  `anthropic.ts`, `gemini.ts`, `openai.ts`, `sentiment.ts`, `usage.ts`,
  `tool-kit.ts`, `tool-config.ts` reader, `translated/`).
- `components/`: `AiAssist`, `AltTextSuggest` (mounted by Publishing composer).
- `ui/StudioLinks.tsx`: cross-links to the recipe planner (`/content/feeds`,
  Feeds-owned) and queue automation (`/content/queue`, Publishing-owned).

## Edits outside the module (same batch)

- `src/modules/index.ts`: `studioManifest` replaces `agentsManifest`.
- `installed-config.ts`, `installed-mcp.ts`: Studio spreads replace the five
  removed ones; tool order otherwise unchanged.
- `publishing/manifest.ts`: dropped the `ai-studio` page/redirect, the
  `captionTests`/`aiVideos` job spreads and the `ai.` prefix.
- `analytics/manifest.ts`: dropped the `tests` page/redirect.
- `src/server/permissions/index.ts`, `src/server/entitlements/index.ts`:
  feature ids renamed with preserved role access (editors keep write on
  `studio/ai-studio` and `studio/tests`; contributors keep write on
  `studio/ai-studio`; clients keep analytics-gated read on `studio/tests`).
- `src/modules/shell/copy.ts`: tab-label keys renamed; saved Root
  customizations of those three labels fall back to shipped text.
- `src/lib/config/ownership.ts`: explicit key declarations win over another
  module's prefix (only `publishing.captionTestsSchedule` changes owner).
- `src/server/jobs/runtime.ts`: worker imports follow the move (no logic change).
- Old entitlement keys (`entitlements.modules.agents`,
  `entitlements.features.agents/library`, `/publishing/ai-studio`,
  `/analytics/tests`) are orphaned; the generated `entitlements.*.studio*`
  keys default to available.

## Evidence

`npm run typecheck` (0 errors); vitest files listed in the handoff entry;
`tests/studio-installation.test.ts`, `tests/scheduled-runs-transport.test.ts`
and the run-history case in `tests/scheduled-agents.test.ts` are new.
Config schema stays 137 (`tests/config-validation.test.ts` pins it).
