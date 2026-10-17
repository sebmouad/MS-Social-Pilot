# Facebook media outcome resolution — batch 54 implementation plan

Required target: ARCHITECTURE_CONTRACT.md. This original batch plan is retained
as design context. Implemented behavior and evidence now live in
FACEBOOK_MEDIA_RECOVERY.md and PREVIEW_QA.md; they distinguish tested local
behavior from pending live-provider and production gates. Batch 53 (`5f799cf`)
was the starting baseline.

## Boundaries

Facebook owns all photo/feed/deletion state interpretation, Root action metadata,
attestation storage and late-response classification. Shared Root owns bounded
neutral action fields, active-owner authority, module dispatch and the shared
dialog/HTTP/installation-MCP interfaces. The customer product remains neutral.
Human reports are visibly distinct from provider receipts. No lookup failure,
missing story field, timeout or elapsed-time assumption proves absence.

## Implemented batch target

- A new additive migration preserves the seven pinned migrations. It adds an
  immutable, content-free workspace-owned resolution event ledger and explicit
  attested/conflict states to existing step/deletion journals. Binding, actor,
  source, outcome, safe remote identity and time remain available after local
  object removal. No tokens, post content, URLs or raw Graph responses are stored.
- `meta.manualMediaAttestationEnabled` is Facebook-owned, Root-managed and off
  by default. Each local-only report requires external verification/race
  acknowledgment plus exact operation-specific typed confirmation.
- Unknown photo/feed steps may be externally reported present with an exact
  observed remote ID or absent. A present feed report also requires all exact
  ordered known photos and acknowledgment of that Page/post association.
- An unknown photo deletion may be externally reported deleted or still present.
  The latter permits only a new explicit manual cleanup action with fresh
  checks; the original intent is never resent automatically. Any feed intent
  other than a definitive provider rejection blocks destructive photo cleanup,
  including a human report that the feed is absent.
- Root freezes a started parent to uncertain before recording external reports.
  Existing workspace/post/target/current-owner guards serialize actions. Every
  step binding is rechecked against its parent without hiding corrupt feed rows.
- Matching late provider receipts append evidence without discarding the human
  report. Contradictory photo/feed/delete outcomes append evidence and hold the
  affected operation/destination against new publication or erasure. A late
  response must remain capturable after the parent is no longer started.
- Parent PUBLISHED requires known complete ordered photo/feed evidence; parent
  ABSENT requires every upload effect settled and known unused photos deleted.
  A local step report alone does not automatically project a post or release
  a retry. Unknown or conflicting evidence remains held.
- Neutral bounded text/choice/checkbox fields carry module metadata and scalar
  values. Shared code interprets no provider fields. `attested` is a distinct
  successful action result, never mislabeled as remote-confirmed deletion.

## Verification and release

DDL must stabilize and pass schema review before a private exact backup/restore
rehearsal and preview-only application. Test transport/receipt faults and late
response races in both orders, binding/identity collisions, explicit retry
semantics, export/erasure ownership and current Root authorization across UI,
HTTP and MCP. Real Chrome examples remain synthetic and disposable. Full suite,
TypeScript, isolated production build and representative browser checks precede
commit/push to main. Document scope and any unverified evidence explicitly.

This batch does not infer automatic absence, implement provider-wide candidate
search, resolve arbitrary conflicting multi-object evidence, or prove live
Facebook create/delete behavior. Those remain part of the full rebuild target,
alongside broader module/legacy parity, migration and production cutover gates.
