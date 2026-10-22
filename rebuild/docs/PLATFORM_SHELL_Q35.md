# Legacy platform shell — q-35 (2026-10-22)

Changes remain uncommitted for integration. No application server, deployment,
push, live provider action or production action was performed.

## Implemented behavior and ownership

- **Installable app:** Settings owns public branding and document generation,
  account-authorized preparation and the browser installation controls. Thin app
  routes serve `/manifest.webmanifest`, `/sw.js`, `/offline?lang=en|fr` and
  `/app-icon/192|512`. Root layout emits current localized metadata, manifest and
  Apple icon links. The persistent browser provider retains install prompts across
  route changes. Actual PNG dimensions are verified with Sharp.
- **Privacy:** the browser worker caches only two public offline documents and the
  public icon. Navigation is network-first; private pages/API responses and writes
  are never cached. Activation removes only this rebuild's old offline revisions.
  Root disable serves a worker that clears its owned caches and unregisters.
  Increment `cacheRevision` when changing cached branding/copy. Existing installed
  devices need to reconnect and receive the new worker before changes apply.
- **Same service:** Appearance, GET/POST `/api/settings/web-app`, `get_web_app`
  and `prepare_web_app_installation` use the same Settings service. Preparation
  requires exact `PREPARE WEB APP INSTALLATION`, current session, membership,
  feature/read-write permission and account audit. Audit failure refuses success.
  Bearer keys cannot prepare account installation. The receipt says
  `installed: false`; MCP cannot perform a local browser installation ceremony.
- **Cross-site protection:** global Node middleware checks every mutation,
  including server actions, using validated current Root origins. It rejects
  untrusted/malformed origins, sibling/cross-site Fetch Metadata and cookie writes
  without trustworthy browser provenance; forwarded headers and bearer headers
  cannot bypass it. Originless cookieless clients still reach their independently
  authenticated MCP/OAuth/signed-callback handlers. Existing domain authorization
  and local origin checks remain.
- **Audience identity:** the provider adapter maps stored growth measures to
  neutral likes/followers and gained/lost identities. Existing Analytics shared
  aggregation and REST/MCP detail responses preserve this metadata. Comparison
  refuses incompatible identities. Unknown measures remain unclassified; raw
  metric/period keys and established aggregation semantics stay independent.
  Historical likes receive bilingual labels; no provider branch enters shared code.

No new table/migration or backend job was needed. Existing synchronization keeps
using the shared job runner with leases/run history. A browser service worker is
local browser infrastructure, not a backend synchronization job. Facebook Groups
were not added; they are dropped by the owner's 2026-10-22 decision.

## Root settings

New registered typed key: **`settings.webApp`**, declared in
`src/modules/settings/web-app/config.ts`, spread into Settings' registered
configuration. It controls availability, public EN/FR branding/copy, launch path,
display mode, bounded preparation timeout, light/dark offline colors, icon monogram/colors and cache revision.
Only public branding belongs here; documents intentionally expose it anonymously.
The fixed worker/document route identities, browser manifest dimensions and
confirmation token are protocol invariants documented beside their declarations.

Expanded existing catalogs: `meta.metricLabels`, `analytics.overviewCopy` (older
saved catalogs retain overrides and gain defaulted new entries). Middleware uses
existing `app.publicOrigin` / `app.developmentOrigins`; no new security setting.
**CONFIG_SCHEMA_VERSION remains unchanged; integrator must bump it.**

## UI rules and observable changes

| Screen | Applied skills and existing owners | Visible change |
| --- | --- | --- |
| Settings → Appearance | taste-skill: one purposeful panel matching existing hierarchy; web-design-guidelines: native named buttons, decorative icon, status announcement and shared focus-managed dialog; composition-patterns: installation lifecycle lifted into persistent provider; react-best-practices: one listener/registration per shell, public copy loaded on server. Existing SettingsPanel, Button and useConfirm remain canonical. | EN/FR installation guidance and device icon; confirmed preparation, native browser install action when available, installed/cancelled/failure/retry states; reader controls omitted. |
| Analytics metric cards | taste-skill: preserve cards/charts, hide number caveat behind information disclosure; web-design-guidelines: keyboard-native details/summary, decorative information icon, 44px target and theme focus; composition-patterns: existing AnalyticsMetric composition; react-best-practices: identity normalization stays server-side with no new browser request/state. | Historical likes and current follower growth have separate understandable labels and an EN/FR “About audience growth” disclosure. |
| Offline fallback | taste-skill: branded, restrained hierarchy with one recovery link; web-design-guidelines: semantic main/header/headings/link, fixed icon dimensions, visible focus and wrapping copy; composition-patterns: shared document generator with thin route; react-best-practices: self-contained HTML with no hydration or script. Root palettes own offline light/dark colors. | Branded EN/FR offline notice, honest publishing explanation and reconnect link; no private cached content. |

No screenshots or real browser/device installation, offline, keyboard, theme or
viewport matrix was run because this lane prohibits starting a server. DOM and
static evidence do not replace those checks. Shared premium audit reports 39
pre-existing form violations elsewhere; none points to this lane's changed UI.
Build attempt is blocked by Google Fonts DNS (`ENOTFOUND fonts.googleapis.com`),
so production build validation remains open rather than claimed successful.

## Verification

Commands run from `rebuild/`; `--no-cache` avoids writing Vitest's cache through
the externally located node_modules symlink.

- `npx tsc --noEmit -p .`: zero errors.
- `npm run typecheck`: passes.
- PWA documents/service/transports/UI/public routes + parity/config targeted run:
  **7 files / 67 tests pass** (including parity 22/22, config 7/7).
- Cross-site middleware: **41/41 pass**; final combined cross-site/audience/REST-MCP/UX run: **242/242 pass**.
- Audience/config targeted checks: **52/52 pass**; audience + existing REST/MCP
  integrations and UX checks: **201/201 pass**.
- PWA UI + route smoke: **1,371 pass, 1,946 skipped**. Public metadata routes are
  explicitly classified as public branding; no workspace authorization waiver.
- Generated worker code is executed in VM tests for installation/cache cleanup,
  private online navigation, localized offline failure and Root disable behavior.
- Actual public route tests decode generated 192/512 PNGs; invalid sizes refused.
- `git diff --check`: clean.

Required full suite, final run:

`npx vitest run --no-cache --maxWorkers=4 --minWorkers=1 --exclude "**/facebook-diagnostic-transport.test.ts"`

**660 files passed, 1 failed, 49 skipped; 10,288 tests passed, 5 failed,
2,191 skipped.** All five failures are in unchanged
`tests/facebook-native-http.test.ts`: `listen EPERM: operation not permitted ::1`
when attempting loopback sockets in this sandbox. No assertions were removed or
tests skipped to hide this. The required full suite is **not green**; rerun those
checks where loopback listening is permitted. The build is also **not green**
because the existing Inter download cannot resolve Google Fonts. No release-ready
or production claim is made. Both final rebuild TypeScript commands pass with
zero errors. All new/changed test files pass in the full run.

## Remaining checks and integration work

- Run browser install/offline/update/unregister checks on HTTPS or localhost in
  Chromium, Safari/iOS and supported browsers; include keyboard, EN/FR, desktop/
  phone and themes. Install UI relies on browser support; manual home-screen menus
  remain browser-owned and do not imply a server-side installation receipt.
- Re-run the native loopback transport tests in an environment permitting listening
  sockets, and production build where the existing Inter font can be fetched.
- The shared premium audit's 39 unrelated existing form issues remain outside this
  lane's fixes. Do not treat this as whole-application design clearance.
- Ownership excludes `rebuild/public`, `rebuild/DESIGN.md` and `rebuild/UX-CONTRACT.md`.
  Dynamic routes deliver the requested PWA assets without editing outside owned
  paths. No outside-path source change is required for functionality. If literal
  public-directory artifacts are mandatory, the integrator owns that relocation
  and should preserve runtime Root branding; do not copy static hardcoded values.
- Legacy manifest share-target and shortcut entries are not advertised here: the
  rebuild's composer must first support the incoming share fields to enable them
  honestly. This lane implements the explicitly requested installation/offline shell.

## Changed files

- `rebuild/docs/AGENT_HANDOFF.md`
- `rebuild/docs/ARCHITECTURE.md`
- `rebuild/docs/DELIVERY_PLAN.md`
- `rebuild/docs/GOAL.md`
- `rebuild/docs/LEGACY_CAPABILITY_PARITY.md`
- `rebuild/docs/LEGACY_SWEEP_2026-10-21.md`
- `rebuild/docs/MCP_PARITY.md`
- `rebuild/src/app/api/settings/web-app/route.ts`
- `rebuild/src/app/app-icon/[size]/route.ts`
- `rebuild/src/app/layout.tsx`
- `rebuild/src/app/manifest.webmanifest/route.ts`
- `rebuild/src/app/offline/route.ts`
- `rebuild/src/app/sw.js/route.ts`
- `rebuild/src/middleware.ts`
- `rebuild/src/modules/analytics/mcp.ts`
- `rebuild/src/modules/analytics/overview-copy.ts`
- `rebuild/src/modules/analytics/server/aggregate.ts`
- `rebuild/src/modules/analytics/server/catalog.ts`
- `rebuild/src/modules/analytics/server/comparison.ts`
- `rebuild/src/modules/analytics/ui/AnalyticsMetric.tsx`
- `rebuild/src/modules/analytics/ui/analytics.css`
- `rebuild/src/modules/settings/config.ts`
- `rebuild/src/modules/settings/mcp.ts`
- `rebuild/src/modules/settings/ui/appearance/AppearanceScreen.tsx`
- `rebuild/src/modules/settings/web-app/InstallControl.tsx`
- `rebuild/src/modules/settings/web-app/Registration.tsx`
- `rebuild/src/modules/settings/web-app/config.ts`
- `rebuild/src/modules/settings/web-app/documents.ts`
- `rebuild/src/modules/settings/web-app/http.ts`
- `rebuild/src/modules/settings/web-app/mcp.ts`
- `rebuild/src/modules/settings/web-app/protocol.ts`
- `rebuild/src/modules/settings/web-app/service.ts`
- `rebuild/src/platforms/facebook/analytics.ts`
- `rebuild/src/platforms/facebook/audience-growth.ts`
- `rebuild/src/platforms/facebook/config.ts`
- `rebuild/src/server/cross-site-write.ts`
- `rebuild/tests/analytics-audience-growth.test.ts`
- `rebuild/tests/cross-site-write.test.ts`
- `rebuild/tests/integrations-v1-analytics-ads.test.ts`
- `rebuild/tests/smoke-routes.test.ts`
- `rebuild/tests/web-app-documents.test.ts`
- `rebuild/tests/web-app-public-routes.test.ts`
- `rebuild/tests/web-app-service.test.ts`
- `rebuild/tests/web-app-transports.test.ts`
- `rebuild/tests/web-app-ui.test.ts`
- `rebuild/docs/PLATFORM_SHELL_Q35.md` (this report)
