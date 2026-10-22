# Legacy tokens, client invitations and ZIP export lane — 2026-10-22

Binding target: `rebuild/docs/ARCHITECTURE_CONTRACT.md`. Owned changes only;
no servers, database, provider, production, deployment or push operations.
Nothing in this handoff marks full parity or release readiness. The shared
architecture, continuation, MCP parity and sweep docs are outside this lane.

## Implemented within ownership

- `server/client-invitations.ts`: private installation-owner directory,
  create/replace and revoke services over the existing `client_invitations`
  table. Reads legacy rows without conversion. Creation stores only SHA-256,
  returns a one-use fragment link once, and distinguishes sent/unavailable/
  failed/uncertain mail. Root authority is current and rechecked under locks;
  creation/revocation audit shares the transaction, omits email and secrets,
  and is required to succeed. Accepted invitations cannot be revoked. Exact
  creation consent binds normalized email **and** suggested workspace name.
- `invitation-policy.ts`, `config.ts`: typed registered
  `agency.clientInvitationPolicy` and `agency.clientInvitationCopy` entries.
  Every operational limit/path/transaction bound and EN/FR UI/email label lives
  there. Issuance defaults **off** until registration consumption is integrated;
  listing/revocation remain available. No registry schema version change.
- `server/client-invitations-http.ts`, `root-mcp.ts`: tested thin REST and
  private installation-MCP adapters calling those same services. They are
  **not mounted/aggregated yet** because their host files are outside ownership.
  Never add these tools to person or workspace Agency MCP groups.
- `ui/clients/ClientInvitationsManager.tsx`,
  `RootClientInvitationsScreen.tsx`, `invitation-actions.ts`,
  `invitations.module.css`: Root-only server screen and authorized server
  actions, with a responsive directory, exact confirmation dialogs, pending/
  failure retention and one-time link display. UI writes call the same service
  as REST/MCP. The component is **not mounted yet**.
- `../settings/api-keys/LEGACY_TOKEN_REISSUE.md`: explicit English/French reissue
  path. Never import a one-workspace `msp_` credential into a multi-workspace
  Agency person credential. Documents same-user/workspace, read/write ceilings,
  explicit independent resource scopes, expiry, verification and retirement.
  The current replacement issuer's owner/admin restriction leaves legacy
  member/viewer issuance unresolved; no role escalation or identity substitution.
- `../../server/data-control/{index.ts,archive.ts,portable-files.ts,README.md}`:
  add safe ad inventory export and derive six portable JSON/CSV files from the
  existing authorized/scrubbed database export. ZIP already has shared UI/REST/
  MCP request/build/download surfaces; no new public capability is needed.
  Existing byte bounds, media safety and honest partial coverage stay in effect.

## Exact integration edits outside ownership

1. Add `src/app/api/root/client-invitations/route.ts` re-exporting
   `GET, POST` from `@/modules/agency/server/client-invitations-http`; add
   `[id]/route.ts` re-exporting `DELETE`. Declare Node runtime as with other
   Root routes. Root's shared route wrapper supplies session auth, same-origin
   writes, no-store responses and safe failures; service owns current authority,
   confirmation, persistence and audit.
2. In `src/server/mcp/root-tools.ts`, import and spread
   `rootClientInvitationToolDefinitions` into `rootToolDefinitions` and
   `rootClientInvitationResources` into `resourceDefinitions`. Before the
   unknown-tool case in `runRootTool`, dispatch tools in
   `rootClientInvitationTools` to
   `executeRootClientInvitationTool(viewer, name, args)` (pass the complete
   actor, not only userId; it refuses keys/customer scope). Existing central
   installation host must retain its current Root guard. The adapter honors
   `maxResultItems` and reports clipping.
3. Mount `RootClientInvitationsScreen` inside the existing private
   `/root/registration` screen, under the host's Root layout. Do not show it on
   customer `/agency/clients`; workspace managers are not installation owners.
4. Registration owner must implement one-use `client_invitations` acceptance
   before enabling issuance. Consume the new link's fragment `client` token;
   preserve bounded legacy `/register?client=…` links as a compatibility input
   without logging them. Validate SHA-256, expiry, `acceptedAt IS NULL`, and
   matching email. In one locked transaction create/verify the new user,
   select the current default plan, create their own workspace and owner
   membership, and mark `acceptedAt/acceptedByUserId`. Recheck concurrent
   revoke/replacement; do not attach the client to the inviter's workspaces.
   The current `settings/server/registration.ts` supports open-registration
   email verification only; do not invent a bearer-to-Root bypass or pretend
   enabling `auth.openRegistration` consumes a client invitation. Add shared
   service/UI/REST/MCP acceptance evidence and legacy-token replay tests.
5. Welcome parity remains outside ownership: legacy
   `src/app/(app)/welcome/page.tsx` + `src/components/WelcomeWizard.tsx` configure
   workspace name/timezone, audience countries/languages/timezone/calendars and
   selected channels. Settings owner must expose those through its shared
   authorized services and EN/FR onboarding screen, then test owner/admin versus
   member/viewer and cross-workspace refusal. Existing workspace-policy service
   covers timezone/approval only; it is not full welcome parity.
6. Setup bootstrap remains a Root/auth/shared-infrastructure task. Legacy
   `src/lib/setup.ts`, `src/app/setup/page.tsx`, `src/app/api/setup/route.ts`
   derive current setup/runtime checks. Add a Root-owned shared readiness
   service/UI/REST/installation-MCP, using installed platform diagnostics rather
   than a Facebook branch. Preserve pre-config database/encryption bootstrap
   trust boundaries and secure first-owner provisioning; do not expose an
   unauthenticated endpoint that grants Root. Show checks from current state,
   never a persisted wizard-complete flag. No bootstrap implementation is
   claimed by this lane.
7. `tests/agency-service.test.ts:372` has an exact registry-key inventory. Add
   `agency.clientInvitationPolicy` and `agency.clientInvitationCopy` to its
   expected list. This test is outside ownership; do not change product code to
   conceal registered keys. Integrator bumps `CONFIG_SCHEMA_VERSION` and its
   version expectation once for all integrated keys.
8. Update `docs/MCP_PARITY.md` after mounting: rows for client directory,
   create/replace and revoke map the Root component/REST adapters/private MCP
   tools to `server/client-invitations.ts`, with exact confirmations and audit.
   `docs/LEGACY_SWEEP_2026-10-21.md` may mark the **documented token reissue
   path** and **portable ZIP additions** done with these file/test paths, but
   leave client invitations partial until acceptance + hosts ship. Welcome and
   setup stay missing/partial. Update architecture/goal/delivery/handoff evidence
   in that integration batch; keep complete export parity open.

## UI rules applied and limits

Only new, unmounted Root client-invitation screen/component; no existing screen
changed. Required skills read at `~/.claude/skills/`: taste-skill (including app
screens), web-design-guidelines (pinned local guidelines), composition-patterns,
react-best-practices. Repository DESIGN/UX contracts retain precedence.

- Taste: primary job is a client invitation directory; clear identity/subline,
  meaningful status, no invented metrics/chart/KPI decoration, restrained
  surfaces and shared theme tokens. Plain outline action icons and generous
  form spacing; table becomes shared phone cards, controls stack at narrower
  widths. No new palette/type system, gradients, tinted icon tiles or zebra rows.
- Web guidelines: native labeled email/name inputs with name/autocomplete,
  semantic buttons, decorative icons hidden, live feedback and focus target,
  shared accessible dialogs, exact typed consent, errors preserve confirmation,
  long identities/URLs wrap. Accepted rows omit revoke.
- Composition: one explicitly named manager component with server-provided
  directory/catalog; shared Button/DataTable/Badge/useConfirm; no boolean mode
  framework or duplicate confirmation primitive.
- React: server reads directory/copy in parallel, sends only safe serializable
  data, no mount fetch, event-driven writes, no storage of the secret, ref-based
  duplicate-submission guard. A confirmed write followed by failed reload keeps
  its receipt/link and does not reopen a repeatable failed create action.

No server/browser/visual inspector was run, as the lane forbids starting
servers. DOM tests prove scoped interaction behavior only, not polished browser,
keyboard/theme/contrast/phone clearance. Perform that review after mounting.

## Verification

Run from `rebuild/`; `--no-cache` avoids Vitest trying to write its cache through
the pre-existing node_modules symlink outside the writable sandbox.

- `npx tsc --noEmit -p .`: exit 0, no errors after all source/test additions.
- Seven new Agency-owned test files: **36/36 pass** using
  `--config src/modules/agency/vitest.config.ts` (the default host includes only
  `tests/**`; explicitly run the colocated tests during integration).
- Existing `parity-guard`, `data-control`, `data-control-archive`,
  `data-control-deletion-order`, `workspace-export-jobs`,
  `workspace-export-surfaces`: **71/71 pass**.
- `tests/config-validation.test.ts`: **6 pass, 1 fail**, solely the pre-existing
  unregistered `calendarExtras.policy` / `calendarExtras.customerCopy` reads in
  `modules/calendar-extras/server/settings.ts`. New invitation entries are
  registered and pass their own registry/ownership/schema tests.
- Full required suite excluding `facebook-diagnostic-transport.test.ts`:
  final rerun **650 files pass, 4 fail, 49 skipped; 10,131 tests pass,
  8 fail, 2,153 skipped**. Failures are the exact Agency inventory edit above,
  Calendar Extras registration, Calendar Extras French punctuation (`copy.ts:50`),
  and five `facebook-native-http.test.ts` cases blocked by sandbox
  `listen EPERM ::1`. No attempt to open a server/socket or relax sandbox rules.
  The final rerun includes the inventory export addition (53.96 s). Colocated
  Agency tests are separate from these default-host counts.

No complete ZIP/data-erasure contract, actual legacy credential migration,
actual new-client signup, browser clearance, real database concurrency/rollback,
live authenticated MCP execution or production outcome has been established.
