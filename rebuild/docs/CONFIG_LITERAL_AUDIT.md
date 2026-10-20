# Shared infrastructure and Root literal audit — round 2

Scope: this assigned worker lane. **Partial literal coverage; no rebuild or release completion claim.**

The hard owned-path rule excludes `rebuild/docs/`. This is the requested audit update prepared inside owned `src/lib/config/`; the integrator must merge it into `rebuild/docs/CONFIG_LITERAL_AUDIT.md`. The round-one document remains historical evidence. No unowned source or documentation was edited.

`CONFIG_SCHEMA_VERSION` is unchanged. This batch adds **96 Root keys: 94 consumed keys and two explicitly configured-but-inactive OAuth consent keys**. The complete list below includes defaults and declarations. Existing `auth.passwordMaxBytes`, `settings.accountNameMaxLength` and `data.postPageMaxItems` are reused, without duplicate Root declarations.

## Runtime behavior and shared boundaries

- Synchronous policies use one validated process snapshot, shared through `globalThis` across Next route/instrumentation bundles. The existing `request-origin.ts` startup and periodic public-origin refresh reads the keys through `runtimeConfig`; the existing `app.publicOriginRefreshSeconds` controls cross-process reload. No database read is launched by `hit()` or password/profile/receipt validation. A failed refresh retains the last validated value or the declared bootstrap default. A local `saveConfig` applies the new snapshot only after its setting and audit commit. This is eventual cross-process policy application, not per-request configuration reads. Browser helper imports contain only pure schemas/defaults; server-rendered connection consumers use the process snapshot. Browser-only callers need explicit policy propagation if added.
- The shared verifier has a separate `auth.passwordVerificationMaxBytes` policy. Its effective bound is at least the new-password maximum, so a newly permitted hash can be checked. Lowering only the new-password ceiling does not invalidate existing passwords accepted under the prior default. Legacy scrypt encoding and session-token protocols remain unchanged. Source/legacy application sign-in restrictions remain an external compatibility concern if larger passwords are enabled before cutover.
- Existing `settings.accountNameMaxLength` supplies the shared synchronous profile/helper and invitation HTTP name policy. Actual Settings profile service/UI already consume that setting directly. Settings-owned invitation registration may still impose its own narrower schema; see caller handoff.
- Root input schemas evaluate current snapshot limits when parsed, rather than capturing limits at module import. HTTP and MCP entry points delegate to the same services. Direct disconnect/session/workspace/account deletion and ownership-transfer paths now apply the relevant confirmation ceiling; exact phrase equality, authorization and audits remain. Root registration keeps its prior separate 255-character supported ceiling, which can be lowered. Plan editor receives the current name bound from its server page.
- Diagnostic input/receipt schemas use the same policy helpers. Diagnostic result ceilings can be lowered within the existing supported receipt maximum; browser receipt parsing retains compatible bootstrap upper bounds. These bounds reject invalid receipts rather than rewriting diagnostic content.
- Platform publication evidence uses one strict policy for request IDs, metadata, columns, context, actions, fields, options and result messages. Server pages pass the validated policy/copy to table/action clients. The service applies current policy for HTTP/MCP calls; wire descriptors advertise supported maxima. Existing host cell-integrity bounds remain an independent upper bound. Column/action metadata counts and provider row-cap compliance now have explicit guards (new defaults 100 columns and 1000 actions); those count limits were previously implicit/unbounded.
- ZIP32 headroom is Root-managed separately from the ZIP32 representation limit. The effective archive limit is `min(data.maxArchiveBytes, ZIP32_MAX_BYTES - data.zipSafetyHeadroomBytes)`. The writer checks local header, name, compressed body, cumulative directory and end-record bytes before admitting each entry, as well as ZIP32 name/count/size field widths. The normal configured archive size is preserved.
- Media, feeds, AI and integrations read their own current policies in shared module services. Static compatibility/MCP schemas use owning registry-supported maxima; effective service limits remain the current Root values. Feed parser/helper defaults reference the owning declarations, while ingest supplies current policy. Home source was audited and needed no operational-key extraction.

## Every new Root key and moved default

For catalogs and compound policies, every moved field/default is enumerated in the following section. Declaration paths are relative to `rebuild/`. Integer/string syntax restrictions and registry-supported maxima are covered under retained constants.

| Root key | Default / moved literal | Owning declaration |
| --- | --- | --- |
| `auth.passwordVerificationMaxBytes` | `800` | `src/lib/config/shared-config.ts` |
| `root.platformEvidenceCopy` | `ROOT_EVIDENCE_COPY` | `src/lib/config/shared-config.ts` |
| `root.registrationIdentifierMaxCharacters` | `255` | `src/lib/config/shared-config.ts` |
| `diagnostics.identifierMaxCharacters` | `100` | `src/lib/config/shared-config.ts` |
| `diagnostics.labelMaxCharacters` | `160` | `src/lib/config/shared-config.ts` |
| `diagnostics.codeMaxCharacters` | `100` | `src/lib/config/shared-config.ts` |
| `diagnostics.messageMaxCharacters` | `500` | `src/lib/config/shared-config.ts` |
| `diagnostics.checksMaxItems` | `100` | `src/lib/config/shared-config.ts` |
| `diagnostics.confirmationMaxCharacters` | `300` | `src/lib/config/shared-config.ts` |
| `root.platformEvidencePolicy` | `ROOT_EVIDENCE_POLICY` | `src/lib/config/shared-config.ts` |
| `root.auditControlsCopy` | `ROOT_AUDIT_CONTROLS_COPY` | `src/lib/config/shared-config.ts` |
| `root.auditDownloadPolicy` | `ROOT_AUDIT_DOWNLOAD` | `src/lib/config/shared-config.ts` |
| `connections.expiryWarningDays` | `7` | `src/lib/config/shared-config.ts` |
| `connections.healthCopy` | `connectionHealthCopy` | `src/lib/config/shared-config.ts` |
| `root.connectionReasonMaxCharacters` | `200` | `src/lib/config/shared-config.ts` |
| `root.identifierMaxCharacters` | `200` | `src/lib/config/shared-config.ts` |
| `root.confirmationMaxCharacters` | `400` | `src/lib/config/shared-config.ts` |
| `root.pageMaxNumber` | `100000` | `src/lib/config/shared-config.ts` |
| `root.providerIdMaxCharacters` | `64` | `src/lib/config/shared-config.ts` |
| `root.emailMaxCharacters` | `320` | `src/lib/config/shared-config.ts` |
| `root.planNameMaxCharacters` | `60` | `src/lib/config/shared-config.ts` |
| `root.planKeyMaxCharacters` | `100` | `src/lib/config/shared-config.ts` |
| `root.planFeatureKeyMaxCharacters` | `60` | `src/lib/config/shared-config.ts` |
| `root.planFeatureMaxItems` | `60` | `src/lib/config/shared-config.ts` |
| `root.planQuotaMaxValue` | `1000000` | `src/lib/config/shared-config.ts` |
| `root.planMonthlyPriceMaxValue` | `10000000` | `src/lib/config/shared-config.ts` |
| `root.planYearlyPriceMaxValue` | `100000000` | `src/lib/config/shared-config.ts` |
| `root.planExtraChannelPriceMaxValue` | `1000000` | `src/lib/config/shared-config.ts` |
| `root.diagnosticsCopy` | `ROOT_DIAGNOSTICS_COPY` | `src/lib/config/shared-config.ts` |
| `root.jobsCopy` | `ROOT_JOBS_COPY` | `src/lib/config/shared-config.ts` |
| `root.operationsCopy` | `ROOT_OPERATIONS_COPY` | `src/lib/config/shared-config.ts` |
| `root.backupsCopy` | `ROOT_BACKUPS_COPY` | `src/lib/config/shared-config.ts` |
| `data.zipSafetyHeadroomBytes` | `67108864` | `src/lib/config/shared-config.ts` |
| `security.rateLimitMaxKeys` | `10000` | `src/lib/config/shared-config.ts` |
| `auth.invitationTokenMaxCharacters` | `128` | `src/lib/config/shared-config.ts` |
| `media.imageListLimit` | `1000` | `src/modules/media/config.ts` |
| `media.holderExcerptCharacters` | `80` | `src/modules/media/config.ts` |
| `media.identifierMaxCharacters` | `80` | `src/modules/media/config.ts` |
| `media.pageNumberMax` | `1000` | `src/modules/media/config.ts` |
| `media.importUrlMaxCharacters` | `2048` | `src/modules/media/config.ts` |
| `media.assetNameMaxCharacters` | `180` | `src/modules/media/config.ts` |
| `feeds.listScanMargin` | `100` | `src/modules/feeds/config.ts` |
| `feeds.qualifyingOwnerScanLimit` | `10` | `src/modules/feeds/config.ts` |
| `feeds.urlMaxCharacters` | `2048` | `src/modules/feeds/config.ts` |
| `feeds.identifierMaxCharacters` | `80` | `src/modules/feeds/config.ts` |
| `feeds.pageNumberMax` | `100000` | `src/modules/feeds/config.ts` |
| `feeds.hashtagsMaxCharacters` | `1000` | `src/modules/feeds/config.ts` |
| `feeds.entryTitleMaxCharacters` | `500` | `src/modules/feeds/config.ts` |
| `feeds.entryGuidMaxCharacters` | `500` | `src/modules/feeds/config.ts` |
| `feeds.entryDescriptionMaxCharacters` | `20000` | `src/modules/feeds/config.ts` |
| `feeds.wordpressPageSize` | `20` | `src/modules/feeds/config.ts` |
| `integrations.webhooks.errorMaxCharacters` | `200` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.purgeBatchSize` | `1000` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.eventErrorCodeMaxCharacters` | `80` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.eventDestinationIdsMaxItems` | `50` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.eventAuthorNameMaxCharacters` | `120` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.eventMessageMaxCharacters` | `500` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.eventDisconnectReasonMaxCharacters` | `120` | `src/modules/integrations/config.ts` |
| `integrations.api.postsBodyMaxBytes` | `256 * 1024` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.idMaxCharacters` | `80` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.nameMaxCharacters` | `60` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.urlMaxCharacters` | `500` | `src/modules/integrations/config.ts` |
| `integrations.webhooks.deliveryPageMaxNumber` | `10000` | `src/modules/integrations/config.ts` |
| `integrations.api.messageMaxCharacters` | `10000` | `src/modules/integrations/config.ts` |
| `integrations.api.targetIdMaxCharacters` | `200` | `src/modules/integrations/config.ts` |
| `integrations.api.targetIdsMaxItems` | `50` | `src/modules/integrations/config.ts` |
| `integrations.api.firstCommentMaxCharacters` | `10000` | `src/modules/integrations/config.ts` |
| `integrations.api.firstCommentDelayMaxMinutes` | `100000` | `src/modules/integrations/config.ts` |
| `integrations.api.linkMaxCharacters` | `2000` | `src/modules/integrations/config.ts` |
| `integrations.api.mediaUrlMaxCharacters` | `2000` | `src/modules/integrations/config.ts` |
| `integrations.api.mediaAltTextMaxCharacters` | `1000` | `src/modules/integrations/config.ts` |
| `integrations.api.mediaMaxItems` | `20` | `src/modules/integrations/config.ts` |
| `integrations.api.formatKeyMaxCharacters` | `200` | `src/modules/integrations/config.ts` |
| `integrations.api.formatValueMaxCharacters` | `100` | `src/modules/integrations/config.ts` |
| `integrations.api.formatEntriesMaxItems` | `50` | `src/modules/integrations/config.ts` |
| `integrations.oauth.clientNameInputMaxCharacters` | `200` | `src/modules/integrations/config.ts` |
| `integrations.oauth.clientNameMaxCharacters` | `60` | `src/modules/integrations/config.ts` |
| `integrations.oauth.redirectUriMaxCharacters` | `2000` | `src/modules/integrations/config.ts` |
| `integrations.oauth.redirectUrisMaxItems` | `10` | `src/modules/integrations/config.ts` |
| `integrations.oauth.authorizationStateMaxCharacters` | `1000` | `src/modules/integrations/config.ts` |
| `integrations.oauth.scopeMaxCharacters` | `200` | `src/modules/integrations/config.ts` |
| `integrations.oauth.resourceIdMaxCharacters` | `100` | `src/modules/integrations/config.ts` |
| `integrations.oauth.resourceIdsMaxItems` | `1000` | `src/modules/integrations/config.ts` |
| `integrations.oauth.issuedKeyNameMaxCharacters` | `100` | `src/modules/integrations/config.ts` |
| `integrations.oauth.defaultClientName` | `'MCP client'` | `src/modules/integrations/config.ts` |
| `integrations.oauth.issuedKeyNamePrefix` | `'OAuth: '` | `src/modules/integrations/config.ts` |
| `ai.sentimentLookbackDays` | `15` | `src/modules/ai/config.ts` |
| `ai.hashtagBodyMaxCharacters` | `60` | `src/modules/ai/config.ts` |
| `ai.outputInputMultiplier` | `2` | `src/modules/ai/config.ts` |
| `ai.languageMaxCharacters` | `32` | `src/modules/ai/config.ts` |
| `ai.summaryMaxCharacters` | `1200` | `src/modules/ai/config.ts` |
| `ai.summarySubjectMaxCharacters` | `200` | `src/modules/ai/config.ts` |
| `mail.recipientMaxCharacters` | `320` | `src/server/mail/config.ts` |
| `mail.workspaceIdMaxCharacters` | `128` | `src/server/mail/config.ts` |
| `mail.templateMaxCharacters` | `100` | `src/server/mail/config.ts` |
| `mail.providerIdMaxCharacters` | `255` | `src/server/mail/config.ts` |

### Existing keys newly consumed / duplicate ceilings removed

| Existing key | Moved use / prior literal |
| --- | --- |
| `auth.passwordMaxBytes` | Former 800-byte hashing/verification helper guard; invitation HTTP now validates UTF-8 bytes using the same new-password policy instead of a separate 200-character envelope. Verification also honors its separate compatibility policy above. |
| `settings.accountNameMaxLength` | Former 100-character synchronous profile helper and invitation HTTP name bound; no new duplicate profile-name Root setting. |
| `data.postPageMaxItems` | Integrations REST list fallback 100, for channel/post list operations when actor result cap is absent. |
| `root.legacy.searchMaxCharacters` | Removed independent 2000-character parser ceilings in Root connections, sessions, errors, privileges and registration; these already enforce the live search policy. |
| `settings.invitationSessionMinutes`, `auth.pendingMinutes` | Invitation session revalidation uses each registered schema instead of duplicating ceilings 1440 and 120. |
| `root.auditRetentionDays`, `root.auditExportMaxRows`, `root.auditRetentionBatchSize` | Form/server validation shares declaration-bound metadata `ROOT_AUDIT_BOUNDS` instead of duplicated 36500/100000/10000 bounds. |

## Every compound-policy field and copy catalog field

Catalog defaults live only in browser-safe files; strict Root schemas require the complete known field set. Named placeholders render as plain React text and never as HTML. Root operator catalogs preserve prior English wording. Connection health retains complete English and French catalogs. Module-supplied provider action metadata/confirmations remain module-owned.

### `root.platformEvidencePolicy`

| Field | Default |
| --- | --- |
| `providerIdCharacters` | 100 |
| `operationIdCharacters` | 200 |
| `resultCap` | 1000 |
| `actionIdCharacters` | 100 |
| `identifierCharacters` | 2048 |
| `confirmationCharacters` | 400 |
| `metadataTitleCharacters` | 200 |
| `metadataDescriptionCharacters` | 1000 |
| `columnCount` | 100 |
| `actionCount` | 1000 |
| `columnKeyCharacters` | 64 |
| `labelCharacters` | 120 |
| `actionDescriptionCharacters` | 1000 |
| `acknowledgmentCharacters` | 240 |
| `messageCharacters` | 500 |
| `contextCount` | 8 |
| `fieldCount` | 8 |
| `fieldKeyCharacters` | 64 |
| `fieldDescriptionCharacters` | 500 |
| `fieldValueCharacters` | 2048 |
| `choiceOptionCount` | 20 |
| `choiceValueCharacters` | 100 |

### `root.auditDownloadPolicy`

- `objectUrlReleaseMs`: 1000 ms, moved from Activity download cleanup timer.
- `filename`: `root-activity.csv`, moved from the Activity download control. MIME and CSV wire format stay fixed.

### `root.operationsCopy`

Source: `src/lib/config/root-operations-copy.ts`. Consumers: Operations page heading/metadata. Each field replaces the corresponding formerly inline label, heading, fallback or message template.

`metadataTitle`, `eyebrow`, `title`, `intro`.

### `root.backupsCopy`

Source: `src/lib/config/root-backups-copy.ts`. Consumers: Backups page plus shared backup/diagnostic-summary service. Each field replaces the corresponding formerly inline label, heading, fallback or message template.

`metadataTitle`, `summaryUnavailable`, `summaryRecent`, `summaryAttention`, `limitEntries`, `limitRestore`, `limitNoActions`, `providerHealthNote`, `eyebrow`, `title`, `intro`, `unavailable`, `recordsReadFailure`, `limitsLabel`, `lastSuccess`, `lastSuccessAgeUnknown`, `noSuccess`, `staleAfter`, `noRunsUnavailable`, `noRuns`, `runsRegion`, `runsCaption`, `runsTitle`, `finished`, `kind`, `result`, `note`, `offsiteBackup`, `restoreTest`, `success`, `failed`, `diagnosticsTitle`, `diagnosticsFailure`, `openErrors`, `errorsUnknown`, `openErrorLog`, `openAlerts`, `alertsUnknown`, `alertOpened`, `providerHealth`, `operationsLink`, `state.recent`, `state.stale`, `state.failed_latest`, `state.never_recorded`.

### `root.diagnosticsCopy`

Source: `src/lib/config/root-diagnostics-copy.ts`. Consumers: Shared diagnostic server notice, client controls, results and history. Each field replaces the corresponding formerly inline label, heading, fallback or message template.

`unavailableTitle`, `unavailableBody`, `sectionLabel`, `controls`, `title`, `testConnection`, `configurationOnly`, `connectionLimit`, `testing`, `run`, `wait`, `moduleHealth`, `explanation`, `disabled`, `fallbackFailure`, `invalidReceipt`, `outcomeUnconfirmed`, `auditWarning`, `checksFinished`, `latestResults`, `connection`, `noConnection`, `pass`, `fail`, `skipped`, `noResults`, `recentRuns`, `historyResult`, `startedUnconfirmed`, `viewResults`, `noRuns`, `auditActivity`.

### `root.jobsCopy`

Source: `src/lib/config/root-jobs-copy.ts`. Consumers: Worker health server component. Each field replaces the corresponding formerly inline label, heading, fallback or message template.

`unavailableTitle`, `unavailableBody`, `sectionLabel`, `eyebrow`, `title`, `enabled`, `disabled`, `freshHeartbeat`, `staleHeartbeat`, `noHeartbeat`, `sharedHistory`, `latestSucceeded`, `latestFailed`, `latestUnknown`, `noWindowAttempt`, `recentAttempts`, `caption`, `job`, `started`, `result`, `attempts`, `duration`, `errorRecorded`, `inProgress`, `noAttempts`.

### `root.platformEvidenceCopy`

Source: `src/lib/config/root-evidence-copy.ts`. Consumers: Publication evidence service, sidebar, table and action dialog; MCP delegates to service errors. Each field replaces the corresponding formerly inline label, heading, fallback or message template.

`filter`, `platformEvidence`, `operationId`, `exactOperationId`, `applyFilter`, `resetFilter`, `unavailableTitle`, `invalidOperationId`, `unavailable`, `platformOperations`, `evidenceBounds`, `noOperationEvidence`, `noPlatformEvidence`, `truncated`, `details`, `actions`, `viewReceiptDetails`, `viewReceiptDetailsFor`, `actionContext`, `refreshNotice`, `enterField`, `keepFieldWithin`, `chooseField`, `checkToContinue`, `errorResultUnconfirmed`, `humanReportPrefix`, `typeToConfirm`, `exactConfirmation`, `closeAndReview`, `cancel`, `working`, `evidenceReadFailure`, `actionResultFailure`, `unavailablePolicy`, `unavailableLimit`, `choosePlatformAndLimit`, `chooseInstalledPlatform`, `unavailableEvidence`, `choosePlatformForOperation`, `enterValidAction`, `enterValidFields`, `actionUnavailable`.

### `root.auditControlsCopy`

Source: `src/lib/config/root-audit-controls.ts`. Consumers: Activity CSV controls, retention controls and action feedback. Each field replaces the corresponding formerly inline label, heading, fallback or message template.

`exportFailure`, `invalidResponse`, `prepared`, `preparing`, `export`, `coverage`, `retention`, `exportRows`, `batchSize`, `warning`, `saving`, `save`, `invalidDays`, `saved`, `saveFailure`.

### `connections.healthCopy`

Source: `src/lib/connection-health.ts`. Each of the following fields exists in both `en` and `fr`: `token.valid`, `token.expiring_soon`, `token.expired`, `token.reconnect_needed`, `token.expiresOn`, `token.noExpiry`, `permissions`, `allGranted`, `granted`, `missing`, `unknown`, `missingSummary`, `unknownSummary`, `checked`, `checkedHint`, `reconnect`, `reconnecting`, `reconnectFailed`. Shared `connectionHealthText` reads the current validated process catalog. The warning threshold is no longer a fixed seven-day helper default.

## Source mapping for numeric and input policies

- `server/rate-limit.ts`: maximum tracked keys 10000 → `security.rateLimitMaxKeys`; fixed windows, per-actor budgets/window inputs, oldest-key eviction and counters are unchanged.
- `server/auth.ts`, `account-settings.ts`, `invitation-http.ts`, `invitation-session.ts`: password bytes, profile/name bounds, continuation-token max and Root confirmation bound use shared synchronous policy. Preview invitation token length 43 stays the exact base64url protocol.
- `lib/root-user-controls.ts`, Root HTTP mutation routes, `server/root/legacy/{shared,connections,sessions,errors,privileges,lifecycle,transfer,connection-refresh,mcp}.ts`, `registration-admin.ts`, `user-controls.ts`, `workspace-access.ts`: ID 200, registration ID 255, confirmations 400, page 100000, provider filter 64, email 320; plan name 60/key 100/feature name 60/feature count 60/quota 1000000/monthly 10000000/yearly 100000000/extra-channel price 1000000 now follow the matching Root settings listed above. Connection invalid reason 200 is independently configurable after redaction.
- `lib/diagnostics.ts`: receipt/run IDs 100, connection ID 200, diagnostic confirmation 300, label 160, code 100, message 500, checks 100 use the typed snapshot.
- `server/mail/index.ts`: recipient 320, workspace ID 128, template ID 100 and retained provider receipt 255 use current mail config. Template token syntax stays fixed; existing subject/body/deadline policies are unchanged.
- `server/data-control/{zip,archive}.ts`: 64 MiB ZIP32 headroom moved to `data.zipSafetyHeadroomBytes`; structural byte widths are listed below.
- `modules/media/server/library.ts` and `library.ts`: image enumeration 1000, holder excerpt 80, accepted IDs 80, max page 1000, import URL 2048, name 180 moved to media settings; service schemas/fallback helpers use current values or owning compatibility defaults.
- `modules/feeds/{feeds.ts,server/core.ts,server/feeds.ts,server/access.ts,server/ingest.ts}`: list margin 100, qualifying-owner fallback 10, URL 2048, ID 80, max page 100000, hashtags 1000, item title/GUID 500, description 20000 and WordPress per_page 20 moved to feed settings. Parser defaults and compatibility schemas derive from the same owning catalog.
- `modules/ai/{ai.ts,server/ai.ts,server/sentiment.ts}`: recap output 1200, subject 200, stored sentiment lookback 15 days, language 32, hashtag body 60 and output/input multiplier 2 moved to AI settings. Request and summary services use current policy; MCP descriptors advertise supported maxima.
- `modules/integrations/server/events.ts`: event error-code 80, destination IDs 50, author name 120, comment text 500 and disconnect reason 120 are separately configurable. `webhooks.ts`: stored error 200 and purge batch 1000 follow settings. Request services enforce every webhook and REST field/list limit listed in the key table. The declaration-only `REST_POSTS_BODY_MAX_BYTES` is removed; reader consumes the current 256 KiB default policy.
- `modules/integrations/oauth/{protocol,server}.ts`: registration name input 200 stays distinct from displayed name 60; redirect length 2000/count 10, selected IDs length 100/count 1000, issued key name 100 and fallback/prefix copy move to the OAuth catalog. Runtime registration/consent/key issuance enforce applicable active policies. State/scope consent settings are explicitly inactive pending unowned route/screen work.

## Intentionally retained constants and reasons

| Constants / source families | Reason |
| --- | --- |
| HTTP status classes/codes, methods, cache/referrer headers; JSON-RPC error numbers; MCP supported version dates; route/tool/resource IDs | Wire/protocol identity and dispatch. Root labels cannot install executable routes or change protocol semantics. |
| Exact confirmation phrase formats, operation/status discriminants, workspace roles and installed feature/provider/action-kind enums | Shared service transition/confirmation protocol; changing ordinary copy must not alter accepted authorization decisions or confirmed operation identities. |
| Legacy `scrypt:16384` encoding, 64-byte digest, 16-byte salt; 32-byte session token / canonical 43-character base64url; SHA-256; AES-GCM envelope widths and audit randomness | Existing cryptographic storage/compatibility contracts. Password request byte limits are now separate settings, not excused as crypto constants. |
| ZIP32 `0xffffffff`, `0xffff`, 30/46/22-byte headers, signatures/version/flags/method IDs, DOS bit positions/two-second resolution/1980 epoch, CRC32 polynomial and lookup-table arithmetic | File representation. A different width needs a ZIP64 implementation; the operational safety margin is now a setting. |
| UUID widths/version/variant patterns, PNG/JPEG/GIF/MP4/WebM signatures, private-file mode `0o600` | Storage/content identity and safe file construction, not enumeration/download policy. |
| Calendar day/hour/minute/second conversions, UTC serialization widths, day-of-week domains and heatmap dimensions | Calendar/ISO arithmetic. Home `DAY=86400000`, ISO day slice10 and stock/flow/rate calculations are representation/math. Customer display locale and move choices remain unresolved below. |
| XML entity names, Unicode scalar/surrogate bounds, HTML/XML/RSS/WordPress field mappings and string normalization | Data representation/parser semantics. Feed entry truncation limits and remote WordPress page size are now settings. |
| AI provider wire versions/header names/JSON shapes, prompt-delimiter escaping, known executable AI kinds/providers | Provider protocol and implemented behavior. Prompt wording/tone/default-language catalogs remain a separately identified coverage gap. |
| OAuth PKCE S256/verifier/challenge/client-ID syntax, exact registered redirect matching, HTTPS/loopback transport rules, finite grants/response types/events | OAuth and credential safety protocol. Name/URI/selection policies are separate settings; compatibility exports use owning declared defaults. |
| Registry-supported maxima, `INTEGRATIONS_INPUT_HARD_MAX=1000000`, browser text-catalog leaf bound4000 and Root audit form maxima | Declared supported configuration/parser envelope, rather than current effective operational policy. Runtime services enforce current narrower settings. The parser maximum is not being presented as an external protocol requirement. |
| `PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT` | Existing host receipt/storage integrity contract in excluded `server/platforms/host.ts`; effective Root policy is clamped to it. It is not newly reclassified from an ordinary operational setting. Host/integrator review of this envelope remains appropriate. |
| `openLast24h` and 24-hour query in backup diagnostic summary | Existing response field explicitly promises a last-24-hours metric. Retained to preserve that semantic contract; a configurable period needs a new honestly named response field and coordinated consumers. |
| Credential-redaction token-shape regexes / control-character exclusions | Existing credential-scrubbing and safe-identifier security boundaries. Not changed or made weaker by a display catalog; tunable additional scrub patterns, if required, need a security-preserving design. |

## Remaining coverage gaps — not protocol exceptions

1. Root copy extraction now covers Operations, Backups, shared Diagnostics, worker health, platform publication evidence and Activity controls. It is **not** full Root copy coverage: `app/root/{page,users,workspaces,plans,privileges,errors,sessions,connections,lifecycle,registration,activity}/**`, `server/root/legacy/copy.ts`, `legacy/shared.ts` feature/group labels, Root navigation/filter components, other recovery controls and many service/wire descriptions still have source catalogs or inline copy. Activity page/filter copy beyond the extracted controls is still source text. These are operational-copy backlog, not constants.
2. `lib/reschedule.ts`: hour/day/week quick-move choices and labels, `en-US` presentation locale, safe-message text; browser callers in Publishing need a serialized validated policy/catalog. `lib/calendar-dates.ts` internal Gregorian numeric formatting is fixed representation, but its fallback week-start parameter is not proof of configured customer preference. Publishing already passes weekStartsOn in the server calendar. Do not claim customer calendar policy is fully configured. `lib/themes.ts` is explicitly excluded from this lane.
3. Media still has generated `Uploaded image {id.slice(0,8)}`, fallback image/video names, and the minimum reference-fragment length8 in `assetReferences`; module-level runtime copy/reference policy and locale plumbing remain. Feeds still has source `DEFAULT_MESSAGE_TEMPLATE`, HTML text normalization choices and safe/customer failure catalogs. AI still has source prompts, tone names and default summary language English; moving provider input syntax limits does not complete configurable prompts or EN/FR customer-copy coverage. Home UI/copy was outside this non-UI module lane.
4. Non-evidence Root recovery controls/services still contain 200/300-character request/confirmation ceilings (`root/{publication-attempts,post-deletions,inbox-deletions}.ts` and related clients). Root account/registration services now use their policies; other direct wire/service limits and internal diagnostics/messages were not exhaustively converted.
5. New synchronous policies are refreshed by the existing Node startup lifecycle. Standalone scripts/worker processes do not start that Next lifecycle automatically; if they begin using these synchronous helper policies, invoke/maintain `refreshSynchronousPolicy` explicitly. Snapshot refresh is bounded by the existing origin reload interval; direct async service policy may observe a save slightly before another process’s synchronous snapshot. No cross-process immediate-apply claim is made.

## Exact edits needed outside owned paths

1. Integrator: merge this file into `rebuild/docs/CONFIG_LITERAL_AUDIT.md` and update `ARCHITECTURE.md`, relevant UX/operations notes, `DELIVERY_PLAN.md` and `AGENT_HANDOFF.md` with the batch scope, the evidence below, inactive keys and remaining gaps. These docs are outside the hard owned paths and remain untouched here.
2. Integrator: reconcile and bump `CONFIG_SCHEMA_VERSION` in excluded `src/lib/config/registry.ts` for all 96 listed keys alongside other lanes. No module-install registry hand edit is needed for module keys.
3. `src/app/api/oauth/authorize/route.ts`: replace static consent parsing with `authorizeParamsSchemaForLimits(rt)` using `requireOAuth()` current runtime; enforce state/scope limits before rendering decisions/redirects, replace selected-resource `.slice(0,2000)` with the runtime resource bound, and declare/consume its fixed 65536-byte form cap. `integrations.oauth.authorizationStateMaxCharacters` and `.scopeMaxCharacters` are correctly marked configured, not active, until this is done. The compatibility parser preserves prior 2000/1000/200 limits meanwhile.
4. `src/modules/integrations/oauth/ui/AuthorizeScreen.tsx`: use the same current OAuth parameter-policy factory when rendering consent; the default compatibility parser currently prevents raised redirect/state/scope limits from being effective there. `src/modules/integrations/ui/WebhookManager.tsx` name/URL maxLength60/500 need current service limits as props (or removal of independently binding native ceilings).
5. `src/app/api/oauth/register/route.ts`: declare/consume the 8192-byte body cap; reconcile with allowed registration metadata sizes. `src/modules/integrations/http.ts#jsonBody` (outside non-UI server/config assignment) still needs an explicit shared request-byte policy before JSON parsing.
6. Publishing-owned `ui/calendar/{CalendarScreen,CalendarBoard,actions}.tsx/ts`: serialize and pass any new move-choice/display-copy policy into `lib/reschedule` callers. Shared helpers alone cannot configure a client bundle from a server-only snapshot. Settings-owned registration/invitation validation may still cap names/passwords differently from the shared HTTP/helper snapshot; reconcile those service schemas when expanding the existing Settings name/new-password policies.
7. Existing provider-owned legacy storage reads in `src/server/data.ts` remain a prior boundary gap; no new provider branching was added. Moving those reads behind provider/module contracts is a separate lane.

## Verification and publication status

From `rebuild/`, final `npx tsc --noEmit -p .`: **zero errors**. Final targeted Vitest: **831 passed / 58 files / zero skipped**. `git diff --check`: clean. The exact targeted command is included below. Earlier intermediate runs exposed and corrected policy-default parameter literal inference, a new-config test mock, MCP copy mock/forwarding, and field-error classification tied to English copy. No full suite, build, server, browser, real database, live-provider, migration, deployment or production operation was run.

All changes remain in the working tree. No push was performed or authorized. Git metadata resolves to `/Users/mouad/Documents/ChatGPT/MS Social Pilot/app/.git/worktrees/msp-config2`, outside writable roots; no commit was attempted or claimed. Pre-existing root/rebuild node_modules symlinks are untouched.

```sh
npx vitest run --no-cache tests/account-settings.test.ts tests/ai-assist.test.ts tests/ai-provider-ports.test.ts tests/ai-sentiment.test.ts tests/config-validation.test.ts tests/connection-health.test.ts tests/data-control-archive.test.ts tests/data-control.test.ts tests/feeds-mcp.test.ts tests/feeds-parse.test.ts tests/feeds-polling.test.ts tests/feeds-service.test.ts tests/integrations-events.test.ts tests/integrations-module.test.ts tests/integrations-oauth.test.ts tests/integrations-services.test.ts tests/integrations-v1-posts.test.ts tests/invitation-http.test.ts tests/invitation-session.test.ts tests/mail-delivery.test.ts tests/mcp-installation-context.test.ts tests/mcp-security.test.ts tests/media-library-module.test.ts tests/media-library-service.test.ts tests/module-literal-policy.test.ts tests/root-activity-page.test.ts tests/root-audit-controls.test.ts tests/root-audit-route.test.ts tests/root-audit.test.ts tests/root-backups-copy.test.ts tests/root-config-form.test.ts tests/root-config-route.test.ts tests/root-connection-delete.test.ts tests/root-connection-refresh.test.ts tests/root-diagnostic-routes.test.ts tests/root-diagnostics-ui.test.ts tests/root-diagnostics.test.ts tests/root-legacy-http-mcp.test.ts tests/root-legacy-services.test.ts tests/root-legacy-sessions-connections.test.ts tests/root-module-pages.test.ts tests/root-operator-copy.test.ts tests/root-platform-publication-action-ui.test.ts tests/root-platform-publication-evidence-mcp.test.ts tests/root-platform-publication-evidence-route.test.ts tests/root-platform-publication-evidence-ui.test.ts tests/root-platform-publication-evidence.test.ts tests/root-platform-publication-table-ui.test.ts tests/root-registration-admin.test.ts tests/root-registration-page.test.ts tests/root-registration-ui.test.ts tests/root-user-controls.test.ts tests/root-user-route.test.ts tests/root-workspace-access-route.test.ts tests/root-workspace-access.test.ts tests/shared-config-literals.test.ts tests/synchronous-policy.test.ts tests/zip-policy.test.ts
```

## Changed files

- `src/app/api/root/connections/[id]/refresh/route.ts`
- `src/app/api/root/connections/[id]/route.ts`
- `src/app/api/root/installation/route.ts`
- `src/app/api/root/lifecycle/users/[id]/route.ts`
- `src/app/api/root/lifecycle/workspaces/[id]/route.ts`
- `src/app/root/activity/AuditControls.tsx`
- `src/app/root/activity/page.tsx`
- `src/app/root/backups/page.tsx`
- `src/app/root/operations/page.tsx`
- `src/app/root/plans/PlanEditor.tsx`
- `src/app/root/plans/page.tsx`
- `src/lib/config/CONFIG_LITERAL_AUDIT.md`
- `src/lib/config/copy-schema.ts`
- `src/lib/config/root-audit-controls.ts`
- `src/lib/config/root-backups-copy.ts`
- `src/lib/config/root-diagnostics-copy.ts`
- `src/lib/config/root-evidence-copy.ts`
- `src/lib/config/root-evidence-policy.ts`
- `src/lib/config/root-jobs-copy.ts`
- `src/lib/config/root-operations-copy.ts`
- `src/lib/config/shared-config.ts`
- `src/lib/config/synchronous-policy.ts`
- `src/lib/connection-health.ts`
- `src/lib/diagnostics.ts`
- `src/lib/root-user-controls.ts`
- `src/modules/ai/ai.ts`
- `src/modules/ai/config.ts`
- `src/modules/ai/mcp.ts`
- `src/modules/ai/server/ai.ts`
- `src/modules/ai/server/sentiment.ts`
- `src/modules/feeds/config.ts`
- `src/modules/feeds/feeds.ts`
- `src/modules/feeds/mcp.ts`
- `src/modules/feeds/server/access.ts`
- `src/modules/feeds/server/core.ts`
- `src/modules/feeds/server/feeds.ts`
- `src/modules/feeds/server/ingest.ts`
- `src/modules/integrations/config.ts`
- `src/modules/integrations/contracts.ts`
- `src/modules/integrations/mcp.ts`
- `src/modules/integrations/oauth/protocol.ts`
- `src/modules/integrations/oauth/server.ts`
- `src/modules/integrations/server/events.ts`
- `src/modules/integrations/server/rest.ts`
- `src/modules/integrations/server/webhooks.ts`
- `src/modules/media/config.ts`
- `src/modules/media/library.ts`
- `src/modules/media/manifest.ts`
- `src/modules/media/mcp.ts`
- `src/modules/media/server/library.ts`
- `src/server/account-settings.ts`
- `src/server/auth.ts`
- `src/server/config/store.ts`
- `src/server/data-control/archive.ts`
- `src/server/data-control/zip.ts`
- `src/server/invitation-http.ts`
- `src/server/invitation-session.ts`
- `src/server/jobs/RootJobHealth.tsx`
- `src/server/mail/config.ts`
- `src/server/mail/index.ts`
- `src/server/mcp/root-tools.ts`
- `src/server/rate-limit.ts`
- `src/server/request-origin.ts`
- `src/server/root/RootDiagnostics.tsx`
- `src/server/root/RootDiagnosticsClient.tsx`
- `src/server/root/RootPlatformPublicationAction.tsx`
- `src/server/root/RootPlatformPublicationEvidence.tsx`
- `src/server/root/RootPlatformPublicationTable.tsx`
- `src/server/root/audit-config.ts`
- `src/server/root/legacy/backups.ts`
- `src/server/root/legacy/connection-refresh.ts`
- `src/server/root/legacy/connections.ts`
- `src/server/root/legacy/errors.ts`
- `src/server/root/legacy/lifecycle.ts`
- `src/server/root/legacy/mcp.ts`
- `src/server/root/legacy/privileges.ts`
- `src/server/root/legacy/sessions.ts`
- `src/server/root/legacy/shared.ts`
- `src/server/root/legacy/transfer.ts`
- `src/server/root/platform-publication-evidence.ts`
- `src/server/root/registration-admin.ts`
- `src/server/root/user-controls.ts`
- `src/server/root/workspace-access.ts`
- `src/server/synchronous-policy.ts`
- `tests/ai-assist.test.ts`
- `tests/ai-sentiment.test.ts`
- `tests/data-control-archive.test.ts`
- `tests/feeds-service.test.ts`
- `tests/integrations-events.test.ts`
- `tests/integrations-module.test.ts`
- `tests/integrations-oauth.test.ts`
- `tests/integrations-services.test.ts`
- `tests/integrations-v1-posts.test.ts`
- `tests/mail-delivery.test.ts`
- `tests/media-library-service.test.ts`
- `tests/module-literal-policy.test.ts`
- `tests/root-activity-page.test.ts`
- `tests/root-audit-controls.test.ts`
- `tests/root-backups-copy.test.ts`
- `tests/root-diagnostics-ui.test.ts`
- `tests/root-legacy-sessions-connections.test.ts`
- `tests/root-operator-copy.test.ts`
- `tests/root-platform-publication-action-ui.test.ts`
- `tests/root-platform-publication-evidence-mcp.test.ts`
- `tests/root-platform-publication-evidence-ui.test.ts`
- `tests/root-platform-publication-evidence.test.ts`
- `tests/root-platform-publication-table-ui.test.ts`
- `tests/synchronous-policy.test.ts`
- `tests/zip-policy.test.ts`
