# Active delivery goal

Updated 2026-10-21. **Status: active; incomplete. Rebuild is in production.**

Deliver the full modular, platform-neutral MS Social Pilot replacement in
`rebuild/`: complete useful legacy capabilities, Facebook integration, one themed
English/French customer experience, shared UI/REST/MCP services, typed Root
configuration, safe data control, live-provider outcomes and verified recovery.
[ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md) remains binding and unchanged;
[LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md) preserves the inventory.

The owner cut over on **2026-10-20**. The rebuild serves
`https://social.newsgeet.com`; legacy web/worker were disabled. Deploy with
`rebuild/scripts/prod-deploy.sh`; legacy `socialpilot-deploy` is guarded. Recorded
evidence and remaining operational checks are in [CUTOVER.md](CUTOVER.md) and the
results sections of [RELEASE_GATES_PLAN.md](RELEASE_GATES_PLAN.md).

Deployment does not close full parity, configuration, localization, provider,
current-theme browser or rollback evidence gaps. Vivid/Meta blue/Warm/Clean with
light/dark, shared component/chart libraries, AI providers, per-destination
scheduling and WordPress automation are implemented source slices with different
verification scopes; do not infer they all ran live from the cutover record.

Continue from [DELIVERY_PLAN.md](DELIVERY_PLAN.md) and
[AGENT_HANDOFF.md](AGENT_HANDOFF.md). Keep the goal active until every requirement
has evidence at its actual scope. Do not narrow completion to deployment, a test
count, manifests or the next batch. Current worker scope is documentation only:
no servers, deploy, push or production operations.
