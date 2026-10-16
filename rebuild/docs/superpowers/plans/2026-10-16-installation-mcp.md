# Installation MCP Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a verified installation owner use private Root MCP without workspace membership, while preserving workspace/API-key boundaries.

**Architecture:** A discriminated installation identity contains no workspace or fabricated entitlements. One Root tool dispatcher serves both contexts; HTTP authentication selects explicit installation/workspace scope or the existing automatic workspace default with an owner-only fallback. Root operations recheck current account authority and reuse audited domain services.

**Tech Stack:** Next.js, TypeScript, PostgreSQL, Vitest.

**Spec:** `docs/ARCHITECTURE_CONTRACT.md` sections 2, 8 and 9; approved private Root design in `docs/CORE_DESIGN_PLAN.md`.

## Global Constraints

- Workspace owners/admins and workspace API keys never acquire Root authority.
- Global MCP availability, request limits, session verification and disabled-user checks remain enforced.
- Installation context exposes only private Root tools/resources; workspace operations require real membership/permissions.
- No fabricated workspace IDs, roles or entitlements; no production migration/cutover.
- Existing config/access domain audits remain authoritative; do not add a failing post-commit audit that makes a confirmed change appear unconfirmed.
- Publish verified batches to GitHub main.

## Review Focus

- Owner with no membership, denied workspace role, or absent workspace grants can still choose private installation access.
- Non-owner, pending/disabled session, revoked/invalid bearer and bearer-plus-owner-cookie cannot enter Root context.
- Explicit workspace scope never silently upgrades to Root; malformed/repeated scope is rejected.
- Forced workspace tool/resource calls from installation context fail before domain/provider access.
- Current Root demotion and unexpected config/database failures deny safely, without raw errors or credential leakage.

## Tasks

- [x] Add failing identity/transport/dispatcher tests for the cases above; observe failure.
- [x] Add discriminated identities, shared Root dispatcher and scoped HTTP authentication; preserve domain confirmations/audits and apply no-store responses.
- [x] Run targeted tests and real local HTTP/MCP checks, including an isolated account with no memberships and cleanup.
- [x] Add private Root connection guidance and appropriate empty-workspace recovery; verify phone/desktop themes and access boundaries.
- [x] Review security, run full suite, typecheck and isolated production build; update architecture/UX/parity/preview evidence.
- [ ] Commit/push verified work and confirm remote HEAD.

## Execution ledger

Implementation ran inline after an earlier independent-agent credit failure. A fresh lower-cost reviewer was successfully dispatched for this batch's final security gate. User has already authorized implementation, identifiable local tests, configuration changes and publication.

Inline review reproduced an owner-created workspace-key suspension exception; explicit workspace sessions and bearer keys now resolve entitlements without installation inspection. Real password/TOTP/HTTP/MCP tests passed with zero owner memberships, correct pending-session denial, private resources, config audit, scoped bearer priority, disposable workspace suspension/restoration and immediate demotion/disable denial. Cleanup verifies users, sessions, keys, workspace/membership and probe audits are absent and the original configuration record is restored exactly. Browser copy, owner recovery, four-theme phone overflow and console checks passed. No production/provider changes. Fresh lower-cost independent security review completed with no actionable findings in the requested diff; that reviewer ran whitespace checks, not tests. Main verification passed 568 tests across 113 files, four PostgreSQL probes, typecheck and an isolated production build.
