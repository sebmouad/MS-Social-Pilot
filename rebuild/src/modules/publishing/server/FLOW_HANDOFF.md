# Publishing flow lane — 2026-10-21

Scope: source, mocked services and synthetic DOM/render checks only. No app server,
browser, provider, production, deployment or Git publication was performed.

## Changes

- Composer serializes background saves. Continued typing during a slow create
  cannot start a second create; changed content is saved to the returned draft.
  Repeated manual submits while waiting for autosave resume once, retaining the
  chosen schedule intent and all ten Page destinations. A failed unchanged
  autosave does not retry in a loop.
- The authorized destination projection retains the channel picture. Composer
  reuses the existing Avatar and saved-preview components for the destination
  summary and live preview. No new visual tokens or hardcoded operational values.
- Queue and Calendar now expose rescheduling for mixed pending/application and
  platform-held destinations. Their state eligibility comes from the same pure
  predicate used inside the lifecycle service. Current membership, author/manager
  authority, tenant/channel scope, adapter support, allowed times, remote-first
  ordering, audit and recovery remain service-owned.
- Calendar previews preserve first-comment IDs, times and safe errors from the
  authorized read instead of projecting them away and misreporting sent comments.

No new Root keys, migrations, routes, tools or resources. Existing operational
settings and English/French catalogs are reused. CONFIG_SCHEMA_VERSION unchanged.

## Existing surface mapping (integrator: add to docs/MCP_PARITY.md)

| Capability | UI | REST | MCP | Shared service |
| --- | --- | --- | --- | --- |
| Move mixed app/platform scheduled posts | Queue reschedule; Calendar Move/drag + confirmation | POST /api/publishing/posts/[id]/reschedule; POST /api/v1/posts/[id]/reschedule; POST /api/publishing/posts/bulk (reschedule) | reschedule_post; bulk_post_action (reschedule) | lifecycle.reschedulePost / reschedulePostToInstant (Queue bulk delegates here) |
| Retain saved first-comment outcomes | Calendar post preview | GET /api/publishing/posts | list_posts | Existing authorized Publishing reads; calendar projection now preserves receipts |
| Serialized composer draft saves | Composer autosave/Save draft/Schedule | Existing create/update post routes | create_post/update_post | Existing createPost/updatePost/schedulePost; only client dispatch serialization changed |

## Design rules applied

- Composer: taste-skill's existing-product imagery/layout rule; real selected Page
  thumbnails in existing fixed-size avatars. Composition patterns: reuse Avatar
  and PostPreview; no boolean styling variants. React guidance: effect cleanup,
  single in-flight dispatch and memoized destination selection. Web guidelines:
  preserve typed input and avoid duplicate pending submissions.
- Queue: preserve existing themed Reschedule disclosure, native date/time inputs,
  localized exact-confirmation dialog and inline failure recovery. Users can now
  move platform-held schedules without first cancelling them.
- Calendar: preserve existing themed cards, thumbnails, Move dialog and keyboard
  alternative to dragging. Held schedules get the same Move control, and preview
  comment status retains its saved receipt.

## Evidence and remaining work

Targeted DOM tests use ten synthetic Recipe Pages, mixed app/native states,
WordPress-shaped recipe content, first comment and Europe/Paris times. They cover
owner/admin/editor, author contributor, unrelated member, viewer, changed states,
slow autosave, duplicate manual submissions and retained comment receipts.
Service regression tests cover scope denial, native scheduling, remote-first
moves, uncertain results, contributor approval and first comments after publish.

The strict Premium static audit reports 31 pre-existing project findings and zero
findings in the three changed screens; it is not visual/accessibility clearance.
The sandbox prohibits local listening sockets. Full-suite loopback HTTP tests in
facebook-native-http.test.ts fail with listen EPERM; optional PostgreSQL suites
are skipped without their dedicated database environment. Browser/theme/viewport,
actual REST/MCP clients, database concurrency and live-provider verification remain
open. Shared PostPreview still contains English literal labels and does not expose
saved first-comment delay; fixing it requires ownership outside this lane.

Integrator-owned documentation updates required: ARCHITECTURE.md (implementation
status), DESIGN.md/UX-CONTRACT.md (thumbnail, mixed-schedule controls and receipt
projection), MCP_PARITY.md (mapping above), AGENT_HANDOFF.md/DELIVERY_PLAN.md (local
evidence and remaining runtime checks). The lane cannot edit these owned paths.

Final verification:

- `npx tsc --noEmit -p .` from rebuild: exit 0, no errors.
- Targeted 13-file run (composer UI/actions, destination choices, mixed held
  screens, native scheduling/reschedule, auth/read scope, first-comment UI,
  parity guard and config validation): 149 passed. The subsequently added
  cross-workspace case was rerun in publishing-reschedule: 14/14 passed.
- Final `npx vitest run --no-cache --exclude
  '**/facebook-diagnostic-transport.test.ts'`: 7011 passed, 6 failed, 245 skipped;
  615 files passed, 2 failed, 49 skipped. Five failures are the sandbox's
  `listen EPERM ::1` in facebook-native-http. One is the 5000ms Root
  owner-aware search timeout. Isolated root-config-form rerun: 11/11 passed
  (search 1764ms). No suite assertions were weakened or timeout raised.
- Cache disabled because the default Vitest results cache resolves through a
  node_modules symlink to a read-only location; the initial 79-assertion targeted
  run passed assertions but exited with EPERM while writing that cache.
- `git diff --check`: passed. Working tree left uncommitted for integration;
  Git publication/deployment is outside this worker's authorization.
