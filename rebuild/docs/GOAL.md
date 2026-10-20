# Active delivery goal

Updated: 2026-10-19. **Status: active; incomplete.**

Rebuild MS Social Pilot in `app/rebuild` as a production-ready modular,
platform-neutral application with a complete Facebook adapter, branded selectable
themes, comprehensive Publishing, Inbox, Analytics, Ads, Settings and private Root
workflows, full authenticated MCP parity, typed Root-managed configuration, safe
migration of needed legacy data, live platform testing, verified rollback, and
production deployment after functional, authorization, data, browser, API and MCP
checks pass. Work in reviewable committed batches using lower-cost agents for
independent modules; report evidence and remaining limitations.

This is the active user-approved objective, not a description of completed work.
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) defines the full requirements;
[LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md) remains a mandatory
capability inventory. Do not narrow the goal to implemented features, passing
checks, one provider format, or the next batch.

Production remains on the legacy application. Publishing source to GitHub does
not authorize bypassing the documented cutover gates. The existing
`socialpilot-deploy` command still deploys legacy; see [CUTOVER.md](CUTOVER.md).

Keep this goal active until the full objective has direct, scope-matched evidence.
A passing build, test count, manifest or progress estimate does not establish
completion. Only an explicit user instruction changes or pauses the objective.

Continue from [DELIVERY_PLAN.md](DELIVERY_PLAN.md) and
[AGENT_HANDOFF.md](AGENT_HANDOFF.md). These documents are shared by Codex and Claude.

Reports batch82 is verified local progress, not achievement of this full goal.
See REPORT_WORKFLOWS.md and the current handoff for evidence and next work.

Channel organization continuation (2026-10-20): selected-channel groups and
per-channel profile labels have a local implementation on `codex/page-profiles`.
This does not close Settings parity or change the overall goal. See
[CHANNEL_PROFILES.md](CHANNEL_PROFILES.md) for migration and verification gaps.
