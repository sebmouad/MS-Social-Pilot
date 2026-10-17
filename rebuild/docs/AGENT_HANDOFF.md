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

Latest verified batch is 64: Publishing labels, password recovery and advanced
metric exploration, including independent domain/HTTP/MCP checks and registry
59 integration. Exact staged source passed 1,861 tests / 262 files with guarded
PostgreSQL checks, typecheck and production build. Source gaps, scope and proof
are recorded in PUBLISHING_LABELS.md, ACCOUNT_RECOVERY.md, ANALYTICS_EXPLORER.md
and PREVIEW_QA.md. Password reset lacks fresh real SMTP/DB/browser proof.

Previous published application batch `c6e1d89` adds templates/composer reuse,
Inbox assignment/notes/saved replies and workspace time zone/approval policies
(registry 58). Guarded real HTTP/MCP/DB probes now pass for those flows and for
labels/Explorer; cleanup restored exact settings and disposable fixtures.
Batch 64 fixes actual SQL advisory-lock/enum compatibility issues found by those
probes. Browser template create, phone review/offline error and delete cleanup
were observed; an uninterrupted online retry was disrupted by dev hot reload.

## Immediate continuation

Claude Code coordinator is running multiple Sonnet workers over the remaining
parity inventory. See CLAUDE_PARITY_COORDINATION.md and private local status
`/private/tmp/msp-claude-worker/coordinator-status.md`; results are in its sibling
`results/` directory. Four initial slices delivered SOURCE/MOCKED TESTS ONLY:
Publishing collaboration, sharing/bio, Ads extensions and Root legacy controls.
Independent Codex reviews own Root W4, sharing W2 and Ads W3 files. Later waves
cover remaining Analytics, agency/tasks, feeds/AI/media, integrations and native
Facebook formats. Modules requiring proposed migrations/host ports must stay
unavailable until integrated and verified; stored-only queue/recycle controls,
unverified Graph shapes or backup status do not count as complete features.

Lead owns central registry, manifests, permission/entitlement and MCP assembly,
review, exact-snapshot checks and Git publication. Do not broadly stage the
unfinished concurrent files. Preserve full target scope and keep useful legacy
gaps open until runtime/UI/API/MCP evidence exists. Production remains legacy;
all backup/restore and cutover gates still apply.

Known phone issue: at 390px emulation the document scroll width reached 601px,
with a wide fixed module rail and touch click timeouts; keyboard workflows worked.
The later fresh Templates phone check measured 390px throughout and touch controls worked; this does not establish every route/theme. Investigate the containing/visual viewport
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
