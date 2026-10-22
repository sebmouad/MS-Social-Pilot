# MS Social Pilot: instructions for every coding agent

## Active project and required reading

The application is **`rebuild/`**, the live production app at `social.newsgeet.com`.
The legacy application was removed from this repository and from the server on
2026-10-22 (lane 47); there is no legacy tree anymore.

Before planning, coding, reviewing, or delegating any task, read:

1. [`rebuild/docs/ARCHITECTURE_CONTRACT.md`](rebuild/docs/ARCHITECTURE_CONTRACT.md): mandatory target and boundaries, approved by the user.
2. [`rebuild/docs/ARCHITECTURE.md`](rebuild/docs/ARCHITECTURE.md): current implementation, known gaps, and source map.
3. [`rebuild/DESIGN.md`](rebuild/DESIGN.md) and [`rebuild/UX-CONTRACT.md`](rebuild/UX-CONTRACT.md) for any UI work.
4. [`rebuild/docs/CUTOVER.md`](rebuild/docs/CUTOVER.md) before migration, deployment, service changes, or destructive cleanup.
5. [`rebuild/docs/LEGACY_CAPABILITY_PARITY.md`](rebuild/docs/LEGACY_CAPABILITY_PARITY.md) before claiming feature or rebuild completion.
6. [`rebuild/docs/GOAL.md`](rebuild/docs/GOAL.md), [`rebuild/docs/DELIVERY_PLAN.md`](rebuild/docs/DELIVERY_PLAN.md), and [`rebuild/docs/AGENT_HANDOFF.md`](rebuild/docs/AGENT_HANDOFF.md): active goal, shared plan and durable Codex/Claude continuation context. Revalidate handoff facts against current state; these documents do not weaken the contract.

These files govern the app. Do not silently replace them with an agent's preference or a smaller implementation that is easier to test. Direct user instructions take precedence. Clarify actual conflicting product decisions; do not ask again for routine work already authorized.

## Work rules

- Work in reviewable batches. The user requested independent lower-cost agents, commits to `main`, and continued implementation until the full objective is verified.
- Before every session ends, commit and push all completed, verified work to GitHub (`origin/main`). Verify the remote branch contains the intended commits. Never force-push or silently discard concurrent changes. If publishing is blocked, report the exact reason and remaining local commits instead of claiming GitHub is current. Unfinished work must be identified explicitly; do not label unverified code release-ready merely to publish it.
- Give every delegated agent the contract path, owned files, dependencies, and verification expectations. Prevent concurrent edits to the same files.
- Re-check the current tree before relying on old reports. Distinguish required behavior, implemented source, automated evidence, browser evidence, live provider evidence, and production evidence.
- Update the architecture status and affected UX/operation documents in the same batch when behavior or ownership changes. Change the target contract only to reflect an explicit user architecture decision, with its reason recorded.
- Keep the shared goal, delivery plan and handoff in Git. Update continuation context when a batch changes the next action or important evidence. Never publish private memory dumps, credentials, environment files, session tokens, customer records or raw private logs.
- Run checks from `rebuild/` for app changes: targeted tests, `npm run typecheck`, and the appropriate full suite/build.
- Real data/API testing and identifiable test content are authorized. Verify remote outcomes and clean up test content. Never expose tokens, passwords, or customer records in logs or reports.
- Local app previews and browser tests use realistic synthetic example data in a dedicated local database, as the user requested. Do not use production customer data as the default local fixture. Keep live-provider/release verification distinct from example-data UI testing.
- Releases go through `rebuild/scripts/prod-deploy.sh` only, after the documented backup, rehearsal and rollback gates pass.
- Do not declare completion from passing tests or manifests alone. Every requirement in the contract needs evidence at its actual scope.
