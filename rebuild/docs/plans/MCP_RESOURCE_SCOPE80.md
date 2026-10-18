# MCP credential resource scope — batch80

Implements the existing architecture contract's authenticated workspace/resource
scope requirement. User already approved checkbox resource selection and shared
UI/API/MCP permissions. Production stays legacy; no production migration here.

## Design

Keys have an independent resource ceiling, intersected with fresh membership
permissions on every request. Resources are neutral target identities, including
channels and ad accounts. Explicit selected IDs never mean all; selected empty
means no target access. An explicit all mode includes future authorized selected
resources. Legacy NULL ceilings retain their original membership-derived access;
new UI/API issuance chooses a mode explicitly. Invalid stored scope fails closed.
No key grants Root or another workspace. Provider details stay in adapters.

Workspace-wide operations without resource-scoped semantics require an all-resource
key. A registry of reviewed scope-safe tools/resources controls discoverability
and direct invocation; unknown/new operations fail closed for restricted keys.
Do not claim a tool is scoped merely because its listing is hidden. Review every
service path and apply the same restriction to resources/read.

## Implementation and proof

1. Audit tool/resource handlers and existing key-creation/authentication tests.
   Define a neutral validated scope contract and intersection tests, including
   all/none/foreign/malformed/duplicate IDs and revoked membership limits.
2. Add nullable JSONB resourceScope to root additive migration and mapped schemas.
   Pin checksum, backup local synthetic database, scratch restore/apply/verify
   original data, then apply locally. Update cutover guards; never edit applied SQL.
3. Issue keys through a shared authorized Settings service. Validate current
   feature/write and selected-resource scope in one guarded/audited transaction.
   Store only credential hashes; record content-free identity/scope audit.
   Authenticate with current scope intersection and fresh entitlement membership.
4. Add customer checkbox resource choice, all/future consequence, key-table scope
   summary and safe revoke confirmation. Keep forms and table desktop design
   consistent, retain failed input, show secret once, accessible phone controls.
5. Test scoped Sharing minting, list/read/post/analytics/Ads isolation, empty scope,
   global operation refusals, direct tools/resource bypass attempts, foreign IDs,
   selected-resource changes and current-role revocation. Actual localhost
   HTTP/MCP/PostgreSQL verifier cleans fixtures and restores settings exactly.
6. Isolated full tests/build/serial typecheck, desktop/phone browser review,
   documentation/parity/handoff, main commit/push and exact remote SHA verification.

## Limits to retain

No production cutover until all original feature/provider/migration/rollback gates
pass. The held Facebook photo-cleanup ledger and Page lock remain untouched.
Independent Claude review is evidence only after findings are verified by parent.
