# MCP independent resource permissions — batch 80

Status: verified local batch; not a production release.

New workspace credentials require explicit feature grants, expiry, resource scope
and confirmation. A selected-resource credential contains separate channel and
ad-account lists. Empty lists grant no resources; all-resource mode includes
future selected resources. Every request intersects these ceilings with current
user access, workspace membership, provider availability and feature permissions.
Malformed stored scopes fail closed. Existing NULL scopes retain current account
permissions until revoked; they are labelled Legacy in the key directory.

The selected-resource marker is distinct from a user's channel restrictions.
Session users retain authorized workspace-wide features. Resource-limited keys
cannot invoke workspace-wide operations such as full data export, Tasks writes,
connection selection or Bio changes. Unknown tools/resources default to refusal.
Resource-safe Publishing and Inbox mutations receive explicit actor ceilings.
Ads and Analytics apply independent ad-account ceilings without treating account
identifiers as channel identifiers. Shared services own issuance and revocation;
secrets are shown once, stored hashed and excluded from audits.

Root registry 72 manages resource-count bounds, default lifetime and transaction
bounds. The manager groups implemented feature choices by product module and
shows separate channel/ad-account checkbox groups. Changing permissions, expiry
or name invalidates issuance consent. Failed requests preserve form choices.

## Evidence and verification state

- Focused session/key dispatch/authentication regression: 55 tests passed.
- Isolated database-enabled suite: 2711 tests passed across 321 files, zero skips.
- Production build and subsequent serial typecheck passed with the consent/name correction.
- Final scoped themed-control production build and serial typecheck passed.
  Chrome confirmed desktop1440px module groups and phone390px no page overflow;
  name/lifetime inputs measure322x40px on phone. Nightfall was visually inspected
  and temporary appearance restored to Coast. This is not full accessibility,
  all-theme or browser save/offline/retry proof.
- Earlier actual local HTTP/MCP/PostgreSQL probe passed independent key issuance,
  channel-only and account-only isolation, sibling account analytics exclusion,
  workspace-wide tool/resource refusal, confirmation and revocation. All test
  records, audit rows and captured Root settings were cleaned/restored.
  Repeated successfully against the final explicit selected-resource marker.
- Independent final Claude review stopped at account quota, without a review.

## Migration

Additive nullable JSON scope migration:
`20261018233000_rebuild_mcp_resource_scope`.
SQL SHA256: `465a5d76679b45d7cb3fa6560b9d6a32501e56faab1922107547452a0b5519ab`.
A private local backup was restored and the migration applied to scratch before
local preview application. Original 104 table counts/settings/key contents were
preserved. Fifteen migrations passed schema-only rehearsal. This is not customer
data/media or service rollback verification.

## Remaining requirements

Final-source database suite, typecheck and local HTTP/MCP probe passed; scoped
responsive browser inspection is recorded above. Full provider capability testing, legacy parity,
Root configuration coverage and production-shaped rollback remain separate gates.
Key-name bounds/copy and unbounded revoked-key history need further configuration
and scale work. Batch81 corrected Sharing target/public eligibility through current connections
and enabled/entitled providers; see SHARING_ELIGIBILITY.md. Broader Sharing
release limits remain explicit in CLIENT_SHARING.md.
Production and socialpilot-deploy remain legacy; preserve the held Facebook photo
cleanup ledger and lock.
