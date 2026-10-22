# Sharing connection eligibility — batch81

Status: locally verified and independently reviewed; not production-deployed.

## Behavior and ownership

Sharing's channel directory, create/access-edit validation and public views use
one provider-neutral `sharingChannels` query. It requires an enabled target, a
non-invalidated connection in the same workspace, and the current creator's
enabled/entitled installed platform list. Empty provider or channel ceilings
mean none. Filtering happens before the picker bound. Expired credentials retain
history visibility, consistent with Publishing and the selected-resource policy;
expiry does not imply a usable publishing credential.

Public reads do not take row locks. Create, access edits and public feedback
explicitly lock eligible channel/connection rows inside their existing transaction.
Public feedback locks the post before its resource rows, then rechecks pending
status, token/creator authority and channel coverage. A deciding link must cover
every destination; missing/cross-workspace joined destinations fail closed with
COALESCE. This supplements, rather than replaces, Publishing's approval transaction.
MCP actor ceilings remain deny-only and independent channel/ad-account key scopes
from batch80 remain enforced. Revocation/deletion of old links remains available.

Root registry73 adds consumed `sharing.channelPickerLimit` (default500), replacing
the old operational literal. Bio is independent and does not depend on platform
connection resolution. No DDL, migration, provider or production mutation belongs
to this batch.

## Evidence

- Original actual HTTP probe reproduced enabled orphan-channel creation, with
  downstream count/audit expectations also failing. All disposable data and
  captured Root settings were restored after that red run.
- A focused query regression failed before the fix and passed afterward.
- Five actual PostgreSQL tests verify valid/expired history, orphan/invalidated/
  deselected/foreign/cross-tenant exclusion, explicit empty ceilings, filtering
  before bounds, nonblocking reads and mutation-held connection/selection locks.
  Original read locking reproduced statement timeout57014 behind bookkeeping;
  corrected reads complete. Concurrent mutation attempts time out55P03 while the
  enclosing transaction holds resource locks. Disposable fixtures are removed
  with absence verified.
- Final isolated database-enabled suite:2717 tests/322 files, zero skips.
  Production build passed; subsequent serial typecheck passed.
- Earlier actual local HTTP/MCP/PostgreSQL/Chromium workflow passed eligibility
  after invalidation, deselection and platform disable, independent key scopes,
  Sharing/Bio/export/erasure and exact data/audit/media/settings cleanup.
- Claude account1 completed independent review. Its unnecessary read-lock finding
  was reproduced and corrected. Its proposed existing review-post-lock deadlock
  was unconfirmed by source; the new post-first ordering is defensive. Final
  follow-up found no new actionable findings. The expanded actual HTTP probe
  held a real post-row blocker, verified the waiting request via pg_blocking_pids,
  changed a second destination to an invalidated connection after preflight and
  confirmed refusal with unchanged post/no feedback. The full probe passed and
  verified exact fixture/audit/media/settings cleanup.

## Limits and next work

A platform enablement/entitlement snapshot is resolved per request; disabling a
module between resolution and transaction commit is not serialized by these row
locks. This batch does not prove global provider-flag atomicity, cross-process
rate limiting, all-theme/browser retry behavior, full Sharing legacy parity,
complete Root configuration, full Facebook capability coverage or production
migration/rollback. Existing held Facebook photo-cleanup evidence remains held.
Legacy all-channel links may briefly lock more selected connections than their
individual post needs during feedback; reads remain lock-free.
(Written pre-cutover; production now runs this rebuild.)
