# Active delivery goal

Updated 2026-10-21 against local HEAD `46c6bdae` (since `1240a9ce`). **Status: active; incomplete. Rebuild is in production.**

Deliver the full modular, platform-neutral MS Social Pilot replacement in
`rebuild/`: complete useful legacy capabilities, Facebook integration, one themed
English/French customer experience, shared UI/REST/MCP services, typed Root
configuration, safe data control, live-provider outcomes and verified recovery.
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) remains binding and unchanged;
[LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md) preserves the inventory.

The owner cut over on **2026-10-20**. The rebuild serves
`https://social.newsgeet.com`; legacy web/worker were disabled. Release `46c6bdae`
is recorded as the deployed release. Deploy with `rebuild/scripts/prod-deploy.sh`;
legacy `socialpilot-deploy` is guarded. Recorded evidence and remaining
operational checks are in [CUTOVER.md](CUTOVER.md) and the results sections of
[RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md).

Deployment does not close full parity, provider, configuration or recovery gaps.
Since `1240a9ce`, merged source adds themed bilingual error boundaries
(`error.tsx`, `global-error.tsx`), Settings single-selection/disconnect callers on
the confirmed services, a session-only partial account export (route, MCP tool and
Account download), Root workspace/directory/configuration/error services that own
actor checks and confirmations, Ads paused-ad creation with a missing-grant
reconnect notice, and fixes for the queue-cancel, Root activity, two-step, join
and calendar-contrast browser findings. Configuration schema version is **114**.
Remaining service differences (Agency switching, Sharing copy-only saves) and the
gaps listed in [MCP_PARITY.md](MCP_PARITY.md) still prevent full parity.

Evidence has advanced, by kind:

- **Production (owner-recorded):** the post-cutover rollback drill passed on
  2026-10-21 (restorable backup and a startable legacy and rebuild artifact on
  spare ports; not a proxy cutback). The first full recipe day published 40/40
  posts with 40/40 first comments across the 07:00, 11:00, 15:00 and 17:00
  Europe/Paris slots; article links were removed from comments on owner request.
- **Live provider (limited):** Graph v26.0 post-metric probe accepts current
  metrics and rejects old ones.
- **Browser (local production build, synthetic data):** Chromium rounds 1–2, then
  Firefox and WebKit (Safari engine) rounds 3–4 on two themes. Defects remain and
  the matrix is not a clean pass.
- **Source and automated:** everything else, including Ads management, which is
  off by default and awaits a live `ads_management` grant.

None of these prove every workflow, full data portability, remaining provider and
legacy scope, or every later merge. Which migrations are applied on production
after the rollback drill still requires verification.

Continue from [DELIVERY_PLAN.md](DELIVERY_PLAN.md) and
[AGENT_HANDOFF.md](AGENT_HANDOFF.md). Keep the goal active until every requirement
has evidence at its actual scope. Do not narrow completion to deployment, a test
count, manifests or the next batch. Current worker scope is documentation only:
no servers, deploy, push or production operations.
