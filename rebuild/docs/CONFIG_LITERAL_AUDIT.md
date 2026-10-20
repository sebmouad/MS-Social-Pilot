# Shared infrastructure and Root literal audit

Scope: this worker lane only. **Incomplete literal coverage; not a release/completion claim.**

The hard owned-path rule excludes `rebuild/docs/`. This reviewable audit is staged under the owned `src/lib/config/` directory; the integrator must copy/merge it to the requested `rebuild/docs/CONFIG_LITERAL_AUDIT.md`. No unowned files were edited.

Locations below are **pre-change HEAD line numbers**, so they continue to identify the moved literals after line shifts. The registered definitions are in `src/lib/config/shared-config.ts`. Fourteen new numeric settings plus `root.configCopy` were added. `CONFIG_SCHEMA_VERSION` was deliberately left unchanged.

## Moved numeric operational literals

| Original file:line | Root key | Preserved default |
| --- | --- | --- |
| `scripts/worker.ts:132` | `sync.workerDrainPollMs` | 250 ms |
| `src/server/jobs/worker.ts:58` | `sync.workerLeaseRenewalDivisor` | 3 |
| `src/server/jobs/worker.ts:66` | `logging.workerErrorMaxCharacters` | 2000 |
| `src/server/jobs/worker.ts:71` | `logging.workerSummaryMaxCharacters` | 2000 |
| `src/server/jobs/worker.ts:31` | `sync.workerPollSeconds` | 5 s (existing key; registry default for bootstrap failure) |
| `src/server/jobs/retry.ts:9` | `sync.retryBaseDelayMs` | 1000 ms (existing key) |
| `src/server/jobs/retry.ts:9` | `sync.retryMaxDelayMs` | 60000 ms (existing key) |
| `src/server/root/module-health.ts:28,31` | `root.jobHealthLookbackMinutes` | 1440 min |
| `src/server/data-control/index.ts:373,405` | `logging.purgeErrorMaxCharacters` | 1000 |
| `src/server/data.ts:103` | `data.postPageMaxItems` | 100 |
| `src/server/data.ts:191,214` | `data.insightDefaultDays` | 30 days |
| `src/server/data.ts:205` | `data.audienceCandidateLimit` | 20 |
| `src/server/connection-mutations.ts:80` | `data.connectionSelectionMaxItems` | 250 |
| `src/server/root/legacy/errors.ts:17` | `root.errorNameMaxCharacters` | 200 |
| `src/server/root/legacy/errors.ts:17` | `root.errorLocationMaxCharacters` | 300 |
| `src/server/root/legacy/errors.ts:17` | `root.errorReleaseMaxCharacters` | 64 |
| `src/server/mcp/server.ts:89` | `mcp.maxResultItems` | 100 (existing key) |
| `src/app/root/config/page.tsx:14` | `root.configSearchMaxCharacters` | 2000 |

Consumers of the moved values use runtimeConfig, runtimeConfigBatch, or the worker dependency backed by runtimeConfig. Configuration forms read the same validated/masked readConfig snapshot used by HTTP and MCP. The worker initial polling fallback is the registered default until its first successful tick; a failed configuration read must not create a zero-delay hot loop.

## Moved configuration operator copy

`root.configCopy` is a strict typed JSON catalog. Defaults live in the browser-safe `src/lib/config/root-config-copy.ts`, with the Root declaration/schema in shared-config.ts. It covers the index, metadata title and the reusable form on both the index and module pages. Stored overrides apply on the next page render. React renders catalog strings as text; named placeholders are interpolated without HTML.

The index intentionally changes its shared-only title/intro to explain the requested full catalog. Other existing form defaults retain their previous wording.

| Original source | Catalog field (`root.configCopy.<field>`) |
| --- | --- |
| `src/app/root/config/page.tsx:7` (rewritten for full catalog) | `metadataTitle` |
| `src/app/root/config/root-config-form.tsx:93` (stored source projection) | `databaseSource` |
| `src/app/root/config/page.tsx:23` (rewritten for full catalog) | `pageTitle` |
| `src/app/root/config/page.tsx:22` | `eyebrow` |
| `src/app/root/config/page.tsx:24` (rewritten for full catalog) | `intro` |
| `src/app/root/config/page.tsx:26` (shared-only wording generalized) | `unavailable` |
| `src/app/root/config/root-config-form.tsx:60` | `sectionsLabel` |
| `src/app/root/config/root-config-form.tsx:61` | `find` |
| `src/app/root/config/root-config-form.tsx:62` | `searchPlaceholder` |
| `src/app/root/config/root-config-form.tsx:63` | `categoriesLabel` |
| `src/app/root/config/root-config-form.tsx:68` (search template) | `searchResults` |
| `src/app/root/config/root-config-form.tsx:68` (count template) | `count` |
| `src/app/root/config/root-config-form.tsx:70` | `empty` |
| `src/app/root/config/root-config-form.tsx:31` | `saving` |
| `src/app/root/config/root-config-form.tsx:31` | `clearing` |
| `src/app/root/config/root-config-form.tsx:36,48` (operation template) | `saveFailure` |
| `src/app/root/config/root-config-form.tsx:36,48` (operation template) | `clearFailure` |
| `src/app/root/config/root-config-form.tsx:39` | `invalidResponse` |
| `src/app/root/config/root-config-form.tsx:46` | `saved` |
| `src/app/root/config/root-config-form.tsx:46` | `cleared` |
| `src/app/root/config/root-config-form.tsx:78` | `enabled` |
| `src/app/root/config/root-config-form.tsx:81` | `hidden` |
| `src/app/root/config/root-config-form.tsx:81` | `enterSecret` |
| `src/app/root/config/root-config-form.tsx:87` (label template) | `invalidJson` |
| `src/app/root/config/root-config-form.tsx:90` | `save` |
| `src/app/root/config/root-config-form.tsx:91` | `clearSecret` |
| `src/app/root/config/root-config-form.tsx:93` | `source` |
| `src/app/root/config/root-config-form.tsx:93` | `defaultSource` |
| `src/app/root/config/root-config-form.tsx:93` | `active` |
| `src/app/root/config/root-config-form.tsx:93` | `configured` |
| `src/app/root/config/root-config-form.tsx:93` | `planned` |
| `src/app/root/config/root-config-form.tsx:93` | `concealed` |
| `src/app/root/config/root-config-form.tsx:97` | `inventory` |
| `src/app/root/config/root-config-form.tsx:98` | `inventoryDescription` |
| `src/app/root/config/root-config-form.tsx:99` | `modules` |
| `src/app/root/config/root-config-form.tsx:100` | `features` |
| New owner grouping label | `shared` |
| New owner grouping label | `product` |
| New owner grouping label | `platform` |

## Protocol and representation invariants retained

- HTTP response codes, JSON-RPC error numbers, supported MCP wire-version dates and registered route identifiers remain protocol constants. A configurable string cannot install new routing or protocol behavior. MCP supported versions are explicitly documented in server/mcp/server.ts.
- AES-256-GCM v1 key/nonce widths and random audit identifier entropy are named constants in server/config/store.ts. Existing legacy scrypt/session compatibility sizes, RFC TOTP/base32 math, encryption envelope fields and token encodings remain fixed.
- Calendar/cron field domains, UTC/ISO serialization widths, minute/day unit conversions and ZIP header/CRC32 structure remain format/math constants. ZIP safety headroom is separately listed below as an operational follow-up; it is not excused as ZIP structure.
- Registry validation bounds and setting metadata remain in their owning declarations. Other request/service/client validation ceilings are **not** assumed protocol invariants; see the unresolved work below.

## Unresolved coverage in owned source

These were found but are not represented as newly consumed settings in this batch. Do not mark this lane exhaustive.

| Source | Unresolved operational values / required work |
| --- | --- |
| `src/server/rate-limit.ts:28` | 10,000 in-memory keys. hit() is synchronous and imported by many unowned routes/modules. Add a validated async policy load at callers or a documented shared policy lifecycle; do not launch a database read on every hostile request. |
| `src/lib/connection-health.ts:10` | Seven-day warning default plus localized health copy. Settings/provider callers outside this lane must supply a validated policy/catalog to the synchronous helpers. |
| `src/server/account-settings.ts:18` | 100-character profile-name bound. Its unowned Settings route must load/pass a policy if the validator stays synchronous. |
| `src/server/auth.ts:17` | 800-byte legacy password guard. auth.passwordMaxBytes already exists but may exceed this guard; coordinate all synchronous hashing/verification callers before changing compatibility behavior. |
| `src/server/invitation-http.ts`, `src/server/invitation-session.ts`, `src/lib/diagnostics.ts`, `src/lib/root-user-controls.ts`, `src/lib/root-workspace-access.ts` | Input/token/confirmation/diagnostic size ceilings and helper copy still need per-boundary review and typed policy propagation. Do not relabel them crypto invariants. |
| `src/server/root/platform-publication-evidence.ts`, `src/server/root/RootPlatformPublicationAction.tsx`, `src/server/root/RootPlatformPublicationEvidence.tsx`, `src/server/mcp/root-tools.ts` | Metadata, identifier, options, field count/length and result-message bounds are duplicated across service/client/wire schema. Centralize one typed policy and propagate it to all three surfaces. |
| `src/server/root/legacy/shared.ts`, `connections.ts`, `errors.ts`, `sessions.ts`, `privileges.ts`, `lifecycle.ts`, `transfer.ts`, `mcp.ts`, `connection-refresh.ts` (same directory) | Remaining identifier/page/name/confirmation/email/feature bounds, connection invalid-reason truncation and static Root service/wire copy. Some search ceilings are the maximum of existing configurable policies; others are independent operational values. |
| `src/server/mail/index.ts` | Recipient/workspace/template/message-ID length bounds. Existing SMTP deadlines and body/subject limits already consume mail settings. |
| `src/server/data-control/zip.ts:27` | ZIP32 headroom (64 MiB below the format limit), separate from format widths. Coordinate export caller limits and writer options. |
| `src/app/root/activity/AuditControls.tsx:22` | One-second object URL release delay, export filename and remaining operator copy. Audit form bounds mirror registry schema limits; if made configurable, enforce the same policy in saveAuditSettings. |
| `src/lib/reschedule.ts`, `src/lib/calendar-dates.ts`, `src/lib/themes.ts` | Fixed quick-move options, presentation locales, theme names and display catalogs need coordination with owning customer UI/module callers. Mathematical/date format constants are not operational settings. |
| Other `src/app/root/**`, `src/server/root/**`, `src/lib/root-*.ts`, `src/server/diagnostics/**`, `src/server/mcp/**` | Static operator labels, feedback, table headings, declaration descriptions and default options remain outside the configuration-page catalog. A configurable config form is not proof of complete Root copy coverage. |
| `src/server/root/legacy/backups.ts`, `src/app/root/backups/page.tsx` | Fixed last-24-hours error-count metric and all associated copy. Preserve metric semantics if introducing a configurable reporting window and a new response field. |

## Needed edits outside the owned paths

1. Copy/merge this document to `rebuild/docs/CONFIG_LITERAL_AUDIT.md`; update ARCHITECTURE.md, UX-CONTRACT.md and AGENT_HANDOFF.md to record: “Configuration index now exposes every registered owner with search; 15 shared settings extracted. DOM/service checks pass, browser evidence pending; exhaustive literal coverage remains open as listed in the audit.”
2. Integrator: bump CONFIG_SCHEMA_VERSION in src/lib/config/registry.ts for the 15 new keys after reconciling other lanes. Do not change installed-module declarations per shared key.
3. For synchronous policy consumers: update src/app/api/settings/account/route.ts (profile bound), auth routes and module callers of server/rate-limit.ts, and Settings/provider callers of lib/connection-health.ts to supply current validated limits. Those callers are outside this worker lane.
4. Existing provider-owned stored read logic in src/server/data.ts (getPageInsightRows/getLatestPageAudience/getAdPerformance) remains a pre-existing boundary gap. Move storage semantics behind platform contracts in the provider/module lanes; no new provider branching was added here.

## Evidence and limits

Final validation from rebuild/: `npx tsc --noEmit -p .` passed with zero errors; `git diff --check` passed. Targeted Vitest: **365 passed across 17 files**, no skips. After the final error-policy snapshot refactor, root-legacy-services.test.ts was rerun: **76 passed**, followed by another clean TypeScript check. The refactor reads shaping limits once per service response, rather than once per error row.

Command (the supplied node_modules symlink requires `--no-cache`):

```sh
npx vitest run --no-cache tests/shared-config-literals.test.ts tests/jobs-worker.test.ts tests/jobs-retry.test.ts tests/root-config-form.test.ts tests/root-module-pages.test.ts tests/root-module-health.test.ts tests/root-config-route.test.ts tests/config-validation.test.ts tests/connection-selection-health.test.ts tests/data-control.test.ts tests/post-list-pagination.test.ts tests/root-legacy-services.test.ts tests/root-legacy-http-mcp.test.ts tests/platform-errors.test.ts tests/mcp-installation-context.test.ts tests/mcp-security.test.ts tests/secret-crypto.test.ts
```
 No server, deployment, full suite, database migration, live-provider or production checks were run. Browser visual/theme/keyboard verification remains open. No push is authorized. Git metadata is outside the writable sandbox at `/Users/mouad/Documents/ChatGPT/MS Social Pilot/app/.git/worktrees/msp-config`; changes remain in the working tree.

## Changed files

- `scripts/worker.ts`
- `src/app/root/config/page.tsx`
- `src/app/root/config/root-config-form.tsx`
- `src/lib/config/CONFIG_LITERAL_AUDIT.md`
- `src/lib/config/root-config-copy.ts`
- `src/lib/config/shared-config.ts`
- `src/server/config/store.ts`
- `src/server/connection-mutations.ts`
- `src/server/data-control/index.ts`
- `src/server/data.ts`
- `src/server/jobs/retry.ts`
- `src/server/jobs/worker.ts`
- `src/server/mcp/server.ts`
- `src/server/root/RootModuleSettings.tsx`
- `src/server/root/legacy/errors.ts`
- `src/server/root/module-health.ts`
- `tests/connection-selection-health.test.ts`
- `tests/data-control.test.ts`
- `tests/jobs-retry.test.ts`
- `tests/jobs-worker.test.ts`
- `tests/post-list-pagination.test.ts`
- `tests/root-config-form.test.ts`
- `tests/root-legacy-services.test.ts`
- `tests/root-module-health.test.ts`
- `tests/root-module-pages.test.ts`
- `tests/shared-config-literals.test.ts`
