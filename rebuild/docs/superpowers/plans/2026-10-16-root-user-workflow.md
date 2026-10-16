# Root user workflow implementation plan

> Execute the already-approved Root control-center design in independent lower-cost batches; integrate and review before committing to main.

**Goal:** Complete the existing Root user access/recovery workflow across UI, HTTP and MCP with consistent filtering, authorization, confirmations and feedback. User deletion and privilege/plan changes remain separate work.

**Architecture:** A private typed directory service returns bounded safe user metadata. Shared account actions recheck current installation-owner authority in their transaction, serialize actor/target changes, and commit mutation, session/factor removal and audit together. UI/API/MCP invoke those services; workspace keys never gain Root access.

**Spec:** `ARCHITECTURE_CONTRACT.md`, `CORE_DESIGN_PLAN.md`, `../UX-CONTRACT.md` and the user's approved Root/two-sidebar/four-theme forms.

## Tasks and ownership

- [x] Service worker: typed account action/confirmation contract; transaction-level current Root checks and actor/target locking; safe HTTP errors/no-store; meaningful service, route and rollback-only PostgreSQL tests. Own `server/root/user-controls.ts`, `lib/root-user-controls.ts`, existing user API route and related tests.
- [x] Main: private scoped user directory with bounded name/email search and all/active/disabled/owners filters; active-session counts; strict requests and configured limits. Expose `list_root_users`, `manage_root_user`, `msp://root/users` through the shared private dispatcher; test Root/key/argument/error boundaries.
- [x] UI worker: route and contextual-sidebar filters using `loadRootUsers(actorId, input, resultCap?)`; shared-theme table/statuses; deliberate empty/no-match/unavailable/invalid-filter states; recoverable access/recovery dialog with duplicate-submit protection and truthful unconfirmed-outcome messaging. Own Root Users route/client/filter components and UI tests.
- [x] Main: integrated suite, typecheck, isolated production build, actual local browser UI/API/MCP checks against disposable identifiable users, audit/outcome verification and cleanup. No provider request, production mutation or schema deployment.
- [ ] Independent review, affected architecture/UX/MCP/operation documentation and commit/push to main with remote verification.

## Review focus

1. Forged, demoted, disabled and workspace-key actors cannot read private users or invoke account actions.
2. Self actions, the last active owner, Root second-factor reset, stale confirmations and raced changes cannot bypass safeguards.
3. Failed audit writes roll back local mutations; transaction conflicts have a safe reload instruction.
4. Pending/expired sessions do not inflate the active-session count; no credentials/factor material enter the directory DTO.
5. Invalid/repeated filters and no matches stay recoverable in the two-sidebar design; network errors preserve dialog input and do not encourage blind retries.

## Evidence

663 tests/122 files including six PostgreSQL probes, typecheck, isolated build, real local password/TOTP/HTTP/MCP and Chrome dialog verification passed. Probe cleanup verified. Workers exhausted workspace credits; main completed integration and review, so an independent final review is unavailable. Local synthetic checks are distinct from live-provider and production evidence. Existing production remains unchanged.
