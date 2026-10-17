# Codex and Claude project memory / handoff

Updated: 2026-10-17. This is durable project context, not proof of current runtime
state. Recheck Git, code and external state before acting. Never copy credentials,
session tokens, private environment contents, customer records or raw logs here.

## Canonical context

- Goal remains active: [GOAL.md](GOAL.md).
- User-approved target: [ARCHITECTURE_CONTRACT.md](ARCHITECTURE_CONTRACT.md).
- Current implementation: [ARCHITECTURE.md](ARCHITECTURE.md).
- Work order: [DELIVERY_PLAN.md](DELIVERY_PLAN.md).
- Design and behavior: [../DESIGN.md](../DESIGN.md), [../UX-CONTRACT.md](../UX-CONTRACT.md).
- Capability and release gates: [LEGACY_CAPABILITY_PARITY.md](LEGACY_CAPABILITY_PARITY.md), [CUTOVER.md](CUTOVER.md).

## Accepted decisions to preserve

- Fresh replacement in `rebuild/`; old routes, icons and workflows need not survive.
  Preserve useful capabilities and needed data; obsolete data requires backup and
  verification before removal.
- Private Root manages every module. Product and platform implementation stays in
  self-contained module folders; shared infrastructure stays provider-neutral.
- Facebook first. Everything provider-specific belongs in its adapter/module.
  Instagram follows after core design and Facebook; other providers ship later.
- Two left sidebars, no third menu. Contextual navigation, filters and pickers live
  in the second sidebar; phones use the accessible shared drawer.
- Posts defaults to Table with Feed/Cards available. One branded system with Grove,
  Coast, Clay and Nightfall themes; customer UI contains no operator setup jargon.
- Discovery adds only checkbox-selected channels/ad accounts. Disconnect asks to
  retain or delete related data. Published-post deletion offers remote deletion
  and reports actual per-destination status and uncertain/partial effects.
- Analytics exploits every readable metric; audience sums selected eligible channels
  with coverage and freshness, without implying deduplicated unique people.
- Root owns typed, validated, versioned configuration and diagnostics. UI/API/MCP
  share current permissions, tenant scope, confirmations and application services.
- Automatic sync qualifies through any active owner's plan/access by default;
  the same owner must grant both product feature and platform access.
- Real API/settings/test-content checks and deployment are authorized. Use
  identifiable records, verify remote outcomes, clean up, and keep release gates.
- Local previews use realistic synthetic examples. Keep provider/live evidence
  distinct. Publish completed work to GitHub before the session ends.
- User requested faster, larger feature batches and lower-cost parallel agents.
  Assign independent files, integrate once and avoid repeated narrow polishing.

## Verified application baseline

Latest application batch: `58f43a72dc6c0eaf2af1b6e89ebedc8321856112`
(`feat(settings): unify team access workflows`), verified on `origin/main` with a
clean tree after publication. This documentation commit follows that baseline.

Batch 61 moved team membership into Settings-owned services, added scoped
confirmations, current authority checks, atomic grants/audits, bounded directory
reads, recoverable dialogs and four workspace MCP tools plus the team resource.
Registry version 56 owns six Team defaults/limits. No invitation, registration,
mail delivery or subscription seat-plan implementation is established by this
batch. See TEAM_ACCESS.md.

Evidence: 1,743 tests / 244 files passed with guarded PostgreSQL checks enabled;
rebuild typecheck and isolated build passed. Real localhost HTTP/MCP-key/DB checks
verified grants, audit, cross-workspace refusal, owner/self protection, current
disabled/suspended access, and removal preserving unrelated access. Browser
add/edit/remove and offline failure recovery passed; disposable records and the
owned browser tab were cleaned up. Details and limitations: PREVIEW_QA.md.

## Immediate continuation

No onboarding implementation was started after batch 61 when this handoff was
written. Resume DELIVERY_PLAN.md stage 1 with explicit agent ownership for mail,
invitation/account services, frontend and tests. Inspect legacy Invitation,
EmailToken and EmailLog tables before extending the rebuild projection. Current
Prisma models are a partial legacy compatibility view; do not run schema push or
infer production migration readiness from adding a model.

Known phone issue: at 390px emulation the document scroll width reached 601px,
with a wide fixed module rail and touch click timeouts; keyboard workflows worked.
Do not claim mobile visual acceptance. Investigate the containing/visual viewport
and shared shell instead of adding screen-specific overflow clipping.

## Operational boundaries and remaining release gaps

- Local preview: `http://localhost:3200`; verify its live process before restarting.
  PostgreSQL preview is separate and synthetic. Do not publish environment files
  or credentials. Test guards require an explicit isolated loopback preview DB.
- Production still runs legacy. `socialpilot-deploy` still targets legacy.
- The live Facebook multi-photo canary has an explicit feed-deletion receipt but
  held photo-cleanup evidence. Unreadable objects or an incomplete listing do not
  prove deletion. Preserve the private ledger and per-Page lock; no blind retry or
  further canary on that Page. See FACEBOOK_LIVE_MEDIA_CANARY.md for safe context.
- Full onboarding/recovery, native Facebook formats, complete Inbox/Ads workflows,
  broad legacy capability parity, full Root/MCP coverage, live runtime proof,
  migration/media/permission rehearsal, backup/rollback and cutover remain open.
- Previous estimates: overall ~65%, design/UX ~80%, core ~70%, Facebook ~55%.
  These are subjective engineering estimates; do not inflate them from test count.

Update this handoff and the relevant evidence/plan documents when a batch changes
what the next agent must know. Preserve required target scope; report limitations
rather than rewriting the target around unfinished implementation.
