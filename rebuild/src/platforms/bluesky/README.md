# Bluesky staged transport

Not customer-ready. The installed settings and runtime reader are present;
The module is absent from `PLATFORM_MODULES`, recorded in
`STAGED_PLATFORM_IDS`, and the local manifest declares
all capabilities unsupported. No credential persistence or application entry point
is exposed. These low-level clients must only be called behind the shared service.

Implemented: credential validation, connection verification and text-only publish,
Root endpoint/timeout/text bounds/English-French failure copy, redirect refusal,
sanitized errors and no automatic retry of ambiguous writes. Protocol methods,
credential syntax and response shapes are documented invariants in `client.ts`.

Legacy reference: `src/lib/networks/bluesky.ts` and
`src/app/api/networks/bluesky/route.ts` at repository root.

## Required integration outside this lane

- Settings module: shared credential-connection service with current role,
  workspace/resource scope, entitlement, exact confirmation, encrypted credentials,
  explicit resource selection and atomic audit; browser, REST and MCP call that service.
- Neutral connection/host contracts and `src/server/platforms/index.ts`: register
  credential-based connection workflow and authenticated publishing adapter; never
  branch on providers in shared product code. Recheck grants at dispatch.
- Settings UI/REST/MCP owners: add EN/FR credential entry, selection and recovery
  states, shared-service entry points and role/cross-workspace refusal tests.
- Documentation owners: update ARCHITECTURE, MCP_PARITY, shared handoff and
  LEGACY_SWEEP_2026-10-21 only after integration evidence; do not mark done yet.
- Legacy migration owner: map existing encrypted credentials and target identities
  through a read-only preview before migration. No data has been read or migrated.
- Integrator owns CONFIG_SCHEMA_VERSION. New key: `bluesky.policy`.

Remaining legacy parity: media publication; Bluesky rich-text facets, external
cards, remote delete, counters and replies; credential refresh/revocation handling.
Bluesky deliberately uses only the Root-configured PDS, never an untrusted DID
endpoint. No browser, real-provider or production evidence exists for this batch.

## Local checks

From `rebuild/`: `npx vitest run --config src/platforms/bluesky/vitest.config.ts --no-cache`
runs both owned provider test files (13 tests passing). The separate configuration
is necessary because the main Vitest include pattern covers only `tests/`.
`npx tsc --noEmit -p .` and the standard parity/config guards passed. These
transport tests use fake fetch responses and do not prove service authorization.

Full suite (excluding facebook-diagnostic-transport, no cache): 652 files passed,
2 failed, 49 skipped; 10,137 tests passed, 6 failed, 2,153 skipped. Five
facebook-native-http failures are sandbox loopback listen EPERM. One
platform-modules failure is caused by this batch registering new correctly owned
setting groups: `tests/platform-modules.test.ts:33` hardcodes only Facebook and
Instagram. Its owner must validate each setting's declared platform owner against
installed or staged provider IDs instead. Do not mislabel settings to pass it.
The suite is not green. No completion claim or sweep status change is warranted.
