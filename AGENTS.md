# MS Social Pilot: instructions for every coding agent

## Active project and required reading

The active project is **`rebuild/`**, a replacement application. The root `src/`, root package scripts, and most root `docs/` describe the legacy production app. They are references for capability parity, data, and recovery; they do not define the rebuild's design or architecture.

Before planning, coding, reviewing, or delegating any rebuild task, read:

1. [`rebuild/docs/ARCHITECTURE_CONTRACT.md`](rebuild/docs/ARCHITECTURE_CONTRACT.md): mandatory target and boundaries, approved by the user.
2. [`rebuild/docs/ARCHITECTURE.md`](rebuild/docs/ARCHITECTURE.md): current implementation, known gaps, and source map.
3. [`rebuild/DESIGN.md`](rebuild/DESIGN.md) and [`rebuild/UX-CONTRACT.md`](rebuild/UX-CONTRACT.md) for any UI work.
4. [`rebuild/docs/CUTOVER.md`](rebuild/docs/CUTOVER.md) before migration, deployment, service changes, or destructive cleanup.
5. [`rebuild/docs/LEGACY_CAPABILITY_PARITY.md`](rebuild/docs/LEGACY_CAPABILITY_PARITY.md) before claiming feature or rebuild completion.

These files govern the rebuild. Do not silently replace them with legacy docs, an agent's preference, or a smaller implementation that is easier to test. Direct user instructions take precedence. Clarify actual conflicting product decisions; do not ask again for routine work already authorized.

## Work rules

- Work in reviewable batches. The user requested independent lower-cost agents, commits to `main`, and continued implementation until the full objective is verified.
- Give every delegated agent the contract path, owned files, dependencies, and verification expectations. Prevent concurrent edits to the same files.
- Re-check the current tree before relying on old reports. Distinguish required behavior, implemented source, automated evidence, browser evidence, live provider evidence, and production evidence.
- Update the architecture status and affected UX/operation documents in the same batch when behavior or ownership changes. Change the target contract only to reflect an explicit user architecture decision, with its reason recorded.
- Run checks from `rebuild/` for rebuild changes: targeted tests, `npm run typecheck`, and the appropriate full suite/build. Root package commands validate or deploy the legacy app unless explicitly changed and reviewed.
- Real data/API testing and identifiable test content are authorized. Verify remote outcomes and clean up test content. Never expose tokens, passwords, or customer records in logs or reports.
- Keep production running until the documented migration, authorization, feature, live integration, backup, and rollback gates pass. Existing `socialpilot-deploy` still deploys legacy; do not mistake it for a rebuild cutover.
- Do not declare completion from passing tests or manifests alone. Every requirement in the contract needs evidence at its actual scope.

## Legacy maintenance

For an explicitly requested legacy maintenance task, read [`docs/LEGACY_AGENT_GUIDE.md`](docs/LEGACY_AGENT_GUIDE.md). Its Facebook styling, translation paths, and deploy rules apply to legacy only. They do not override the rebuild contract or current user authorization.
