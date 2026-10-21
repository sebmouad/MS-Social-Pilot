# MS Social Pilot architecture

Updated 2026-10-21 against local HEAD `8852d367` and commits since 2026-10-20.
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) remains the binding target,
unchanged. This document describes implementation and gaps; deployment, source,
automated tests, browser checks and live-provider evidence are separate claims.
Older batch details remain in the linked feature documents and Git history.

## Production status

The owner cut over on **2026-10-20 at 22:09 CEST**. The rebuild serves
`https://social.newsgeet.com`; `social-pilot-rebuild` and
`social-pilot-rebuild-worker` were recorded active/enabled, and legacy web/worker
inactive/disabled. Legacy files remain for rollback. Releases use
`rebuild/scripts/prod-deploy.sh`; legacy `socialpilot-deploy` refuses while the
rebuild is enabled except for status or an explicit legacy override.

These are recorded production outcomes in [RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md#production-cutover--2026-10-20-2209-cest),
not fresh probes by this documentation worker. That log records 34 applied
migrations, backup, health checks, ownership repair, owner sign-in confirmation,
legacy configuration import and later AI/browser checks. Cutover happened; full
contract completion is still unproven. The exact deployed revision and application
of migrations added after cutover must be checked before claiming newer source live.
See [CUTOVER.md](CUTOVER.md) for current status and historical migration procedures.

## Source and service boundaries

Next.js App Router, React, TypeScript, Prisma and PostgreSQL provide the web app;
a separate worker handles leased jobs. UI, REST and MCP must enter the same
product service, which owns current identity, tenant/resource scope, entitlements,
confirmations, state transitions and domain audit. Transport guards supplement
that boundary. The remaining deviations are tracked in [MCP_PARITY.md](MCP_PARITY.md).

| Location | Ownership |
| --- | --- |
| `src/modules/<module>/manifest.ts` | Routes, features, Root namespaces and job declarations |
| `src/modules/<module>/config.ts` | Typed owning-module Root definitions |
| `src/modules/<module>/mcp.ts` | Tools/resources, confirmation and credential-scope metadata |
| `src/modules/<module>/server/`, `ui/` | Product services and screens |
| `src/modules/installed-config.ts`, `installed-mcp.ts` | Installed-module aggregation |
| `src/platforms/facebook/` | Facebook protocol, credentials, OAuth/discovery, publishing, Inbox, analytics/Ads storage mapping and jobs |
| `src/server/platforms/` and `src/platforms/types.ts` | Neutral contracts, installed host registration and dispatch |
| `src/server/` | Shared authentication, authorization, jobs, mail, audit, configuration, data control and private Root infrastructure |
| `src/app/` | Thin pages, HTTP entry points and shared/authentication shell |

Facebook is the only installed customer platform. Instagram/other legacy connector
code does not establish usable rebuild support. Shared services consume adapter
capabilities, format catalogs and normalized measures, never provider branches.
Encapsulation is not complete: shared legacy storage reads in `src/server/data.ts`
and product account helpers in `src/server/account-settings.ts` still need coordinated
moves. Registration of a module does not prove its workflows or health.

## Configuration and public origin

`src/lib/config/registry.ts` aggregates module/platform declarations and
`src/lib/config/shared-config.ts`. Local HEAD has schema version **104**. Runtime
consumers use `runtimeConfig`; Root validates and transactionally audits saves,
encrypts secrets and groups controls under Shared, Product and Platform owners.
Database access and encryption trust material remain bootstrap dependencies.

`app.publicOrigin` supplies the browser-facing origin for same-origin checks and
absolute links behind the proxy; production was set to `https://social.newsgeet.com`.
`src/server/request-origin.ts` loads it at Node startup, retains it on `globalThis`
across Next bundles and refreshes on `app.publicOriginRefreshSeconds` and local
Root saves. Empty falls back to the received origin; `app.developmentOrigins`
provides Root-trusted preview origins. This fixed recorded production write refusals.

[CONFIG_LITERAL_AUDIT.md](CONFIG_LITERAL_AUDIT.md) records extensive extracted
limits/copy, current consumers and residual literals. Synchronous policy uses a
validated process snapshot; cross-process refresh is eventual. Standalone workers
need explicit refresh if they use those helpers; browser fallbacks need serialized
policy. Root recovery limits, `http.oauthAuthorizeMaxBodyBytes` and
`shared.reschedulePolicy` are implemented. Whole-app configurable copy, AI prompts,
remaining Root/calendar labels and several transport/UI ceilings are still gaps.
The two OAuth consent settings have readers but stale inactive metadata.

## Themes, components and charts

The current palettes are **Vivid**, **Meta blue**, **Warm** and **Clean**, each with
light/dark palettes; system mode follows the device. Root `theme.default` and
`theme.defaultMode` set defaults. Runtime tokens are in `src/styles/tokens.css`;
metadata is in `src/lib/themes.ts`. Module icon colors and Tabler icons are shared.
Grove/Coast/Clay/Nightfall names in older evidence describe the previous system.

[DESIGN_COMPONENTS.md](DESIGN_COMPONENTS.md) documents shared tables, forms,
selects, menus, tabs, confirmations, drawers, filters, feedback and accessibility
behavior. [CHARTS.md](CHARTS.md) documents lazy ECharts time series, bars, donuts,
heatmaps, funnels, sparklines and audience pyramids, with theme tokens, keyboard
interaction, data tables and unknown-value gaps. Home, Publishing, Inbox,
Analytics/Ads, Tasks, Agency, Settings, Root and public/auth screens have adopted
shared controls in recent commits. Adoption and component tests do not establish
a fresh all-route browser/keyboard/failure-state pass in the new eight palettes.
English/French catalogs have expanded; localization is incomplete, including
some dynamic analytics labels and source error/default copy.

Settings appearance UI/REST/session MCP share a service storing `users.theme`;
mode remains cookie-only. Global layout still initializes from cookies/Root
without an account-preference fallback; ThemeProvider writes cookies directly
with a fixed lifetime. Whole-app appearance writes therefore are not yet unified.

## Implemented product slices and limits

| Module | Implemented source | Evidence / remaining gap |
| --- | --- | --- |
| Home | Authorized stored-data overview, charts, REST and `get_home_overview` | Workspace-wide tool refuses resource-limited keys; new visual matrix remains open |
| Publishing | Drafts/composer, CSV, previews, list/calendar/queue, approvals, templates/labels/fields/notes/versions, bulk actions, first comments, recovery, best times, mix/recycle and short links | Shared UI/REST/MCP coverage documented in PARITY_PUBLISHING_INBOX; native/live and new scheduling runtime checks remain partial |
| Inbox | Scoped threads/nested replies/reviews, sync, moderation/deletion recovery, assignment/notes/replies, quick filters, contact details, bulk actions and shortcuts | Contact-details REST added in `8852d367`; bulk has UI/MCP but no REST entry. Provider history/metadata and live moderation remain partial |
| Analytics | Catalog/series, previous-period points, comparison, posts, audience history, ad objects, pins, goals, reports/exports and charts | Stored-data surfaces share services; complete readable-provider collection, labels and report response breakdowns remain partial |
| Ads | Account/performance/directory/compare/export, hierarchy charts, creation options, durable confirmed management and creative creation | Session REST/MCP plus key REST v1; live permissions, creative/management outcomes and exhaustive metrics unproven |
| Settings | Connections/selection, profiles/watermark, team/invitations, account/security/sessions, appearance, notifications, exports/erasure and keys | Broad service parity; confirmation consistency, shell appearance and live mail/security/data coverage remain gaps |
| Media / Feeds / AI | Media images/videos/import/quota; RSS/Atom/WordPress feeds; recipe planner; AI writing/recap/sentiment | Shared UI/REST/MCP slices; real storage/source/automation and current browser/live evidence vary by feature |
| Tasks / Agency / Sharing / Integrations | Task workflows, Agency overview/clients/export/switching, review/bio links, webhooks, scoped REST/OAuth connectors | Shared services exist; credential-specific capabilities and confirmation exceptions must remain explicit |
| Root | Owned settings, diagnostics/stored health, users/workspaces/plans/audit/errors, registration, installation transfer, connection refresh/disconnect and recovery | Private UI/HTTP/installation MCP; backups page is read-only, full operations/configuration and production-scale proof incomplete |

## Scheduling and durable remote effects

Scheduling is chosen **per destination**: application worker or platform-held,
with a post default and Root fallback. Neutral adapter catalogs supply native
support/lead windows; Facebook owns Meta behavior. Supported holds become
`scheduled_remote`; unsupported/too-soon/too-far choices stay pending for the app
and return explicit deferral reasons. Comments wait for positive publication.
Queue honors these choices; mix/recycle hand-off follows each automation run.
Reschedule/cancel act on held copies before local changes and retain uncertain
outcomes. Source and mocked tests are recorded in
[PARITY_PUBLISHING_INBOX.md](PARITY_PUBLISHING_INBOX.md); migration
`20261031100000_rebuild_destination_schedule_mode` is pinned, but this review
establishes no database application or live hold/cancel/reschedule proof.

Publication, first-comment and deletion journals retain intent/receipts separately
from local projection. Unknown/submitted outcomes remain held; status reconciliation
uses positive matching identity, never a failed lookup as proof of absence.
Rejected-only comment retry is separately confirmed. Native formats have source
integration and proof/recovery paths; default-off/private capability and mocked
evidence do not establish live delivery. See FACEBOOK_NATIVE_FORMATS.md,
PUBLICATION_RECOVERY.md, FIRST_COMMENT_SCHEDULING.md and INBOX_WRITE_RECOVERY.md.
Preserve the unresolved photo-canary ledger/Page lock in FACEBOOK_LIVE_MEDIA_CANARY.md.

## WordPress recipes and AI

[FEEDS.md](FEEDS.md) documents the recipe source: read-only WordPress MariaDB,
Root-controlled field mapping, caption/image/recipe metadata, guarded image fetch
and WebP-to-JPEG conversion, canonical recipe first comment, configurable local
slots/timezone/horizon/cooldown and distinct allocation. A per-slot ledger holds
uncertain outcomes; ordinary Publishing services create scheduled posts and apply
approval/scope rules. UI, REST and five MCP tools share the service. The feature
ships disabled and new sources paused. Its 48 `feeds.wordpress.*` keys and pinned
`20261031140000_rebuild_wordpress_sources` migration exist; real MariaDB/PostgreSQL,
storage, browser and Facebook planning outcomes remain unverified. The dependency
lockfile was integrated in `b940fad9`, superseding the lane's lockfile warning.

AI adapters for **OpenAI, Gemini and Anthropic** are selected by `ai.provider`,
with provider-specific Root credentials/models/endpoints. The release log records
successful OpenAI/Gemini tests and composer suggestion generation; Anthropic
returned insufficient account credit. This is limited provider evidence, not
verification of every prompt, report recap or sentiment job.

## Facebook collection and evidence boundaries

[FACEBOOK_DATA_COVERAGE.md](FACEBOOK_DATA_COVERAGE.md) records resumable Page post
history, independent per-metric failures, reaction counts, Ads hierarchy/action
breakdowns and configurable extra collection. History cursors now have a dedicated
tenant/target-bound table and pinned migration
`20261031120000_rebuild_facebook_sync_cursors`; application/export/erasure on real
PostgreSQL still needs proof. Shared `sync.cursor.*` job progress remains a separate
configuration/state design gap.

Owner-supplied 2026-10-21 evidence found three posts over twelve months for one
Page and refused six former insight defaults. Replacement candidates are not
live verified; persisted Root overrides are not changed by source defaults.
Neither that count nor configured metrics proves exhaustive history or Graph
eligibility. Conversation attachment/participant metadata, video/Reel/Story
collection eligibility and all readable metric presentation remain incomplete.

## Verification and continuation

Historical browser evidence includes 328/328 synthetic dev-preview checks
(WAVE1_VERIFICATION.md) and the recorded production Chrome sweep in
RELEASE_GATES_PLAN.md. Neither covers all changes through local HEAD or replaces
provider/MCP transport checks. Latest lanes primarily have unit/render/mocked
transport evidence. See [MCP_PARITY.md](MCP_PARITY.md),
[LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md) and
[DELIVERY_PLAN.md](DELIVERY_PLAN.md) for remaining work. No full rebuild completion
or exact latest production revision is claimed here.
