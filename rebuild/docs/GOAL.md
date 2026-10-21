# Active delivery goal

Updated 2026-10-21 against local HEAD `1240a9ce` (since `8852d367`). **Status: active; incomplete. Rebuild is in production.**

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

Deployment does not close full parity, provider, configuration or recovery gaps.
Since `8852d367`, merged source adds Root-editable EN/FR copy with validated-default
fallback, account appearance persistence, worker fetch-then-write/shutdown,
read-path indexes, recipe recovery/status/origin visibility, recent-table/account
data-control coverage and purge gates, and response-report legacy rounds 1–3.
The declaration guard now maps private Root operations without product-route
exceptions; Publishing draft/v1 consent gaps are closed at source. Remaining
Settings/Root/Agency/Sharing service differences still prevent full parity.

Evidence has advanced: Chromium browser rounds 1–2 cover current themes,
viewports, representative system mode, keyboard and failure paths on a local
production build with synthetic data, with unresolved defects and no Feeds table.
Owner-recorded first-day recipe batches at 07:00 and 11:00 Europe/Paris each
published 10/10 with comments; article links were removed from comments on owner
request. A limited live Graph v26.0 probe verifies current post metrics and rejects
old ones. These outcomes do not prove every workflow, recovery or client surface.
Exact release/migration state, full data portability, remaining provider/legacy
scope and post-cutover rollback evidence still require verification.

Continue from [DELIVERY_PLAN.md](DELIVERY_PLAN.md) and
[AGENT_HANDOFF.md](AGENT_HANDOFF.md). Keep the goal active until every requirement
has evidence at its actual scope. Do not narrow completion to deployment, a test
count, manifests or the next batch. Current worker scope is documentation only:
no servers, deploy, push or production operations.
