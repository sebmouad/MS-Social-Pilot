# Team chat delivery

Workspace UI, REST and MCP share `server/service.ts` for destination management
and explicitly confirmed tests. The service owns current membership, tenant,
purge, unrestricted scope, entitlement, permission, exact confirmation and audit
checks. Encrypted credentials and raw transport errors never reach a read view.

`server/delivery.ts` owns the durable transactional outbox. The shared workspace
notification producer enqueues publish-failure, inbox, approval and connection
alerts independently of individual email preferences. Sharing enqueues client
review decisions inside its decision transaction. Messages contain only typed,
Root-owned generic EN/FR copy; opaque event/resource identities are retained for
idempotency and current resource-access checks, never comments or message bodies.

The existing leased `notifications` worker invokes `runChatDeliveries`. Each
message claim commits immediately before network I/O. Unique workspace/channel/
event keys and compare-and-set claim tokens prevent overlap. Expired claims and
ambiguous transport/audit outcomes become `uncertain`, never pending again.
Rejected deliveries are terminal too. Current destination subscription, active
workspace, purge status, current owner authority, feature entitlement and
resource visibility are rechecked before sending. A composite foreign key binds
each outbox row to a destination in the same workspace.

Root operator monitoring is the sole installation incident system.
`enqueueOperatorIncident(tx, {eventId, state, workspaceId})` only queues explicitly
subscribed destinations in the workspace selected by
`root.monitoringPolicy.chatWorkspaceId`, provided an active installation owner
currently owns that workspace. Empty selection disables operator chat delivery.
The worker rechecks this owner before sending. Root monitoring owns email,
incident open/recovery/test transitions, UI, REST and installation MCP. There are
no separate `notifications.systemAlert*` settings or duplicate alert service.

## Configuration and storage

Registered keys: `notifications.chatPolicy` and `notifications.chatCopy`.
The policy owns limits, approved service origins, transaction/network timing,
per-delivery lease and batch sizes, and owner inspection bounds. New policy and
catalog fields have shipped defaults so saved pre-delivery Root overrides keep
working. Provider URL shapes and semantic receipts remain isolated in transport.

Repository migration `20261022190000_rebuild_chat_deliveries` adds the content-free
outbox and destination/workspace identity constraint. Workspace and destination
removal cascade to delivery records. Data-control ownership is documented in
`src/server/data-control/README.md`; live migration/erasure evidence remains a
release gate.

## Tests and visual scope

Main-suite tests are `tests/chat-channels-{service,http,transport,ui,delivery}.test.ts`.
They cover role/tenant boundaries, exact consent, transport receipts, localized
controls, saved-config compatibility, current resource access and committed
claims. Run these with the normal rebuild Vitest configuration, plus parity and
configuration guards. No nested Vitest configuration is needed.

The existing chat screen gains inbox and installation alert choices in its
localized subscription controls. Taste app-screen rules retain shared flat
surfaces and service icons; accessibility rules retain labeled checkboxes,
keyboard operation and exact-confirmation feedback. Composition patterns retain
the existing shared table/dialog controls; React practices add no client fetch
or component mode. No server/browser/provider was run; DOM checks do not prove
responsive layout, contrast, live delivery or production readiness.
