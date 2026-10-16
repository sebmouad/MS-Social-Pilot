# Root Audit History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give private Root a searchable, bounded historical audit view with sidebar filters and matching HTTP/MCP reads.

**Architecture:** One authorized service validates filters and Root limits, queries PostgreSQL with tuple cursors, and exposes only the existing safe audit projection. UI, HTTP and MCP call that service. Cursor version, encoding, timestamp precision and digest shape are wire-format invariants; operational page/search/cursor-size limits use the typed Root registry.

**Tech Stack:** Next.js, TypeScript, Zod, PostgreSQL, Vitest.

**Spec:** `docs/ARCHITECTURE_CONTRACT.md` sections 6, 8 and 9; `docs/CORE_DESIGN_PLAN.md`; `DESIGN.md`; `UX-CONTRACT.md`.

## Global Constraints

- Private installation-owner authority; workspace API keys cannot gain Root privileges.
- Navigation, filters and pickers stay in the contextual sidebar; shared themes, fields and buttons.
- Audit reads never return raw JSON details or credentials. Actor identity remains private Root data.
- Keep production running; no migration or provider calls in this batch.
- Commit verified work to main and publish to GitHub; full rebuild remains subject to release gates.

## Review Focus

- Equal timestamps and newly inserted events: deterministic cursor order, no skipped tied records.
- Literal percent/underscore/backslash searches: do not become unintended wildcards or SQL.
- Invalid dates, reversed ranges, malformed or mismatched cursors: safe validation and visible recovery.
- Disabled/demoted owners and workspace API keys: deny before audit reads.
- Empty/deleted cursor pages and narrow screens: keep filters and Latest recovery accessible.

### Task 1: Shared authorized query and wire validation

Files: `src/server/root/activity.ts`, `src/lib/root-activity.ts`, `src/server/root/read-model.ts`, `src/lib/config/registry.ts`; tests `root-activity.test.ts`, `root-activity.integration.test.ts`.

Interfaces: `listRootActivity(actorId, input, maxResultItems?)` returns safe items, normalized filters, effective limits and newer/older cursors. Query includes action/actor substring, exact workspace ID and inclusive UTC date range. Root page/search limits are read at runtime.

- [x] Add failing tests for authority, strict filters, literal matching, tied timestamp pagination and sanitization.
- [x] Run targeted tests and observe the expected missing-service failure.
- [x] Implement the service and versioned filter-bound cursors; add active search/cursor character settings, bump registry version.
- [x] Run unit and rollback-only PostgreSQL tests; verify temporary probe rows are absent afterward.

### Task 2: Root UI, HTTP and MCP

Files: `src/app/root/activity/page.tsx`, `src/server/root/RootActivityFilters.tsx`, `src/app/root/root-control-center.css`, `src/app/api/root/activity/route.ts`, `src/server/mcp/server.ts`; affected route/MCP tests.

Interfaces: HTTP query strings map to the same typed service input. MCP `list_root_activity` accepts equivalent typed filters; resource `msp://root/activity` returns the default bounded page.

- [x] Add access, strict-input and safe-error tests; observe failure before wiring.
- [x] Implement sidebar filters and Latest/Newer/Older links, count/empty/invalid/unavailable states, HTTP and private MCP reads.
- [x] Run targeted tests and inspect phone/desktop, keyboard, two themes, no-match and malformed cursor recovery in Chrome.

### Task 3: Integrated proof and publication

- [x] Review authorization, SQL binding, cursor behavior and raw-detail boundaries.
- [x] Run full suite including isolated PostgreSQL probes, typecheck, isolated production build and whitespace checks.
- [x] Update architecture, UX, registry, parity and preview evidence with actual limitations.
- [ ] Commit/push verified batch to main and verify remote HEAD.

## Execution ledger

Ruling: execute inline because the prior independent-agent attempt returned exhausted workspace credits. User already authorized autonomous implementation and GitHub publication; no repeated approval checkpoint.

Implementation review: literal SQL values, private actor checks, malformed/changed cursors, duplicate/special URL parameter names and retained empty/error recovery reviewed inline. Non-UTC PostgreSQL session and upper-date-boundary regressions were reproduced and fixed before publication. Full suite passes 546 tests across 110 files, including four rollback-only PostgreSQL probes. Independent agent review remains unavailable because the agent service reported exhausted workspace credits; it is not claimed as completed.
