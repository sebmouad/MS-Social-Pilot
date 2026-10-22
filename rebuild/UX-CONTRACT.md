# MS Social Pilot UX Contract

This contract records observable behavior for the rebuild. It does not override the server's permission, publishing, provider, or data-lifecycle rules. Current gaps are marked as such so future batches cannot mistake intent for shipped behavior.

## Product context

The product serves teams publishing to selected social channels, managing responses and ads, and reporting results. Customer copy is required in English and French; merged Root-editable module catalogs provide partial source coverage. Full localization and browser verification remain open. The workspace timezone governs publishing dates; API timestamps remain absolute. Target accessibility is WCAG 2.2 AA. The user selects a theme in Appearance; visual rules live in [DESIGN.md](DESIGN.md).

## Business-context sources

| Scope | Authoritative source |
|---|---|
| Module and route availability | `src/modules/*/manifest.ts`, `src/server/entitlements` |
| Member and channel permissions | `src/server/permissions`, `src/server/context.ts` |
| Post lifecycle and remote deletion | `src/modules/publishing/server/deletion.ts`, `src/server/publishing/lifecycle.ts`, platform adapter contracts |
| Connection selection and disconnection | `src/server/connections` |
| Workspace export and erasure | `src/server/data-control`, `src/app/settings/data/IMPLEMENTATION.md` |
| Facebook capabilities | `src/platforms/facebook`, `docs/PLATFORMS.md` |
| Root configuration | `src/lib/config/registry.ts`, `docs/ROOT_RUNTIME_CONFIG.md` |

There is no released billing or legal-copy contract for the rebuild. Do not invent subscription or regulatory promises in UI copy.

## Canonical UI map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Navigation | `src/components/AppShell.tsx` | Module manifests and private Root manifest | Desktop module rail plus contextual sidebar; phone bottom rail and one contextual drawer | Root drawer Tab/Escape/focus-return checked in Chrome; scope, failure and desktop-transition regressions |
| Theme and Scrollbar | `src/styles/tokens.css` | `DESIGN.md` | Vivid, Meta blue, Warm, Clean; each light/dark plus system mode | Older Publishing Lighthouse/Chrome results used Grove/Coast/Clay/Nightfall. They are historical evidence; the current eight-palette all-route matrix and scrollbar checks remain open |
| Read-only table | `src/components/DataTable.tsx` | Server list query | Sortable or static columns | Posts now has scoped database pagination; other table pagination parity pending |
| Post preview | `src/components/PostPreview.tsx` | Scoped post list and destination records | Feed and Cards, alongside default Table | First comment, safe media/link handling and destination outcomes covered; local Chrome filter/view checks |
| Post attachments | `src/modules/publishing/components/PostAttachments.tsx` | Root ceilings, shared authoring validation and adapter media metadata | Ordered remote media / local images; trusted unsaved preview distinct from saved validation | Order, description association, upload retry, multi-editor focus and actual local HTTP/MCP/browser checks; wider release matrix remains open |
| Table Selection | No shared owner yet | `UX-CONTRACT.md` | None until a shared owner exists | Define before bulk table actions |
| Select/Listbox | Native `<select>` | `DESIGN.md` and this contract | Browser-owned popup; application labels English/French | Posts filter selection persisted after navigation in a 390px Chrome mobile preview; keyboard checks pending |
| Date | Native date/time inputs | Workspace timezone policy | Date or datetime-local | Date-only parsing and browser checks pending |
| Form | `src/components/FormValidation.tsx`, `src/lib/ui/form-validation.ts` and domain services | Server validation | Client-validated mutation; server-validated GET/action | Shared constraints, associations and focus tested; migration and browser evidence below |
| Multiline input | `src/components/AutoTextarea.tsx` | `DESIGN.md` | Controlled, uncontrolled and read-only | Growth/shrink/reset/ref behavior tested with synthetic DOM geometry; real browser layout checks pending |
| Dialog | `src/components/ModalDialog.tsx` | This contract | Confirmation or selection | Ads/Inbox failure recovery, native Tab wrap, Escape and opener restoration checked in Chrome; other dialog flows pending |
| Toast | Inline `role=status`/`role=alert` | This contract | Success or error | Shared notification owner pending |
| CRUD | Server services | Domain services | Create, edit, delete | Full failure-path E2E coverage pending |
| CSV download | `src/components/CsvExportButton.tsx` | Publishing/Ads export services and product wrappers | Confirmed CSV receipt; Ads requires matching safe filename | Deduplicated pending, stale/unmounted cancellation, safe feedback and scoped HTTP/MCP checks; representative browser proof in PREVIEW_QA |

## Workflow ledger

| Operation | Pending | Success | Failure recovery |
|---|---|---|---|
| Connect source | Disable repeat start while OAuth begins | Show discovered channels and ad accounts with checkboxes | Keep workspace page and a retry path; do not expose credentials |
| Change selection | Keep current choices visible; disable duplicate save | Persist selected local state and refresh the connection table | Keep the selection dialog open with entered choices |
| Disconnect source | Ask retain or delete, show related-data preview for delete | Confirm scope and update the table | Keep dialog and choice; never claim provider revocation |
| Create/edit post | Preserve composer values and target choices; block duplicate upload/submission | Return to a refreshed post list with status | Dedicated creation and inline editing retain service/network failure values; unconfirmed save directs the user to inspect Posts before retry. |
| Delete published post | Separate local removal from optional remote deletion; disable repeats | Show per-destination receipt and local-finalization state | Durable status and externally verified recovery retain identity and confirmation; uncertain provider outcomes are never automatically retried or claimed verified |
| Export workspace | Show coverage and generate a no-store archive | Download ZIP with manifest | Fail visibly if files/records are missing or unsafe |
| Delete workspace data | Exact confirmation after row preview | Show resumable progress and completion | Preserve purge state and retry cleanup without repeating DB deletion |

The server sources above govern permission, idempotency, and deletion semantics. Rows describe UI consequences, not new business policy.

Remote post deletion commits one content-free intent per remote identity before dispatch. Provider exceptions remain uncertain, and partial success remains visible by destination. The customer can inspect status, record an outcome only after externally checking the platform, and finish local removal only after persisted confirmation for every required destination. Private Root provides bounded history and separately labeled human attestation. The app does not automatically verify an uncertain request; late provider effects remain possible. Alias records remain until workspace erasure. See [POST_DELETION_RECOVERY.md](docs/POST_DELETION_RECOVERY.md).

## Navigation, data, and feedback

The main rail contains only available customer modules. Following the user's 2026-10-16 direction, desktop has a narrow module rail plus a contextual sidebar containing route navigation, filters, view pickers, workspace utilities and quick creation. There is no third content-side navigation menu; Root categories use the contextual sidebar too. On a phone, contextual navigation and filters open from a labeled control rather than covering every page scroll. Root tools are private and separate from customer navigation. Committed filter and view state belongs in the URL when shareable; secrets never do. A data table must expose total/range when known, a deliberate page or load-more strategy, and a clear distinction between no records and no matches. Core design completion now precedes further Facebook capability expansion; see [design-v2](docs/design-v2/README.md). This is not yet consistent across all routes.

Connections rows show how many discovered channels are selected and offer direct Manage and Disconnect actions for authorized members. An ad account links to the selection dialog for its parent source. The selected source is focused in that dialog; disconnection still requires the retain-or-delete confirmation. Expired and revoked sources carry the Root-configured reconnect label. Existing selected resources can be removed and an unsaved change can be undone; newly selecting a resource requires an enabled platform and a current connection in the shared service. Restoring a checkbox to its saved state produces no selection write for that item.
The disconnect preview groups related local records under customer-facing names. Provider-scheduled posts are shown separately because they are a subset of linked posts and must be reconciled before local deletion.
Ads daily details render every stored action and additional measure as a labeled value, including measures unknown to this app version. Raw provider JSON is reserved for server and audit boundaries, not customer screens.

Ads creation forms receive safe option values, labels, defaults, name limits and confirmation templates from the selected account's platform module. Shared forms contain no provider objective enums or provider confirmation strings. Unsupported creation forms and their empty section headings stay hidden. Campaign and ad-set dialogs keep entered values and errors visible after a recoverable failure. Ad-set creation reports an audit failure after a confirmed remote success to discourage duplicate submission; campaign and MCP audit-failure reconciliation still require work. Synthetic Chrome checks verified campaign failure input/dialog retention and focus recovery; successful remote creation, ad-set failure and audit-failure reconciliation remain separate gates.

Use a real link for navigation and a button for mutation. Pending states disable duplicate submission without changing button geometry. Success copy repeats the action verb; inline errors stay near the action and preserve recoverable input. Destructive dialogs initially focus Cancel, keep the object and consequence visible, and close only after confirmed success. Escape and focus restoration must work. The shared native dialog exposes `aria-busy`, recovers focus when disabled controls lose it, and preserves its opener across preferred-focus changes. Styled dialogs disable closing while busy. Inbox deletion keeps its error in the open confirmation on failure; Calendar and Connections forward their pending state to the same dialog behavior. Remaining screen-local overlays and ad hoc notices still need consolidation.

The post composer validates that text, a usable link, or media provides post content; its caption can be empty when attachments supply the content. The text-only CSV importer still requires post text. Both validate their applicable URL syntax, attachment compatibility, and file selection before submitting. A failed local check keeps the entered draft, shows an associated inline error, and focuses the field requiring correction. Server publishing and CSV checks remain authoritative. Empty data-table copy sits outside the horizontally scrolling table so it remains readable at phone widths.

The Posts screen counts and pages after workspace and channel authorization. Table is the approved default; Feed and Cards share the same query and actions. View, status and channel controls live in the sidebar and persist in the URL across pages. A filtered empty result says no posts match rather than claiming the workspace has no posts. On 2026-10-16 Chrome changed Feed to Cards with Draft status using the sidebar, returning one draft with its first comment and retaining both choices. Actions and CSV import start collapsed; New post uses the dedicated composer link in the contextual sidebar. The shared drawer focuses its close control, traps Tab, closes with Escape, and returns focus to its opener; these behaviors were checked on Root configuration in Chrome at 390px. Earlier mobile Lighthouse scores predate the new shell and must not be treated as a fresh audit of it. This is local fixture evidence, not a large-data or provider test.

Workspace switching appears when there are multiple memberships. The API validates membership and sets the selection cookie; failure preserves the current workspace and exposes retry feedback. Quick creation requires feature write access. Sign-out failure leaves the user in place with a retry. Root has its own private manifest, grouped Overview/Operations/Activity and installation pages. Configuration search/categories portal into the contextual sidebar. The audit view now searches actions/people and filters exact workspace IDs and inclusive UTC dates, with Latest/Newer/Older cursor links in the contextual sidebar. It exposes allowlisted numeric/boolean details and explicit UTC times; raw payloads remain hidden. Counts describe the current page, not an invented installation total. Invalid filters preserve entered values and offer reset; no history, no matches and a changed/empty cursor page have distinct states. Missing legacy controls remain tracked in the parity inventory.

Publishing creation/edit/import picker choices now share `server/publishing/destinations.ts`: they respect workspace/channel scope, selected connections, enabled modules, adapter support and credential expiry. Expired sources can retain visible history without being offered as ready to publish. The dedicated composer chooses one attachment, keeps selected destinations and scheduling in the contextual sidebar and allows a draft without date or destinations. Upload is completed before one create submission. A browser transport failure keeps text and first comment, re-enables controls and links to Posts in a new tab because the save outcome may be unknown. It does not promise exactly-once persistence after a lost response. Sidebar-associated form submissions close the phone drawer and reveal top-of-form feedback. Queue and approval cards include saved attachments/first comments/destination outcomes; action permissions and pending state remain separate from the preview.

Calendar Previous/Today/Next navigation now belongs in the contextual sidebar; its duplicated main-content Month/Week picker and New post shortcut were removed. A View post button opens the full shared preview dialog, with Escape and opener focus recovery. Browser/server ICU differences were reproduced for Casablanca; real calendar data now carries server clock labels, wall times, move choices and elapsed-slot state. The client checks basic date/time shape and unchanged values, then the existing service decides future/DST/state/permission validity when saving. Elapsed week slots refuse dragging. The move receipt carries a server-formatted workspace time. These improvements do not replace the remaining high-volume, cross-zone and authorization browser release gates.

Calendar has Month and Week views selected by `view` and anchored by `date` (older `?month=YYYY-MM` links still work); channel and status filters live in the sidebar and the URL. Its database query covers timestamps near the workspace-local boundary of the visible range before exact timezone grouping, without truncating to recent posts. Published posts use their actual publish time when present; scheduled posts use their scheduled time. Each post shows channel badges and a status chip with a label and shape. Future days and week slots link to the composer with `date` and `time`; the composer accepts a draft or atomically creates a scheduled post in the workspace time zone. A scheduled post that is still local and editable by the member can be rescheduled by dragging it or with its Move dialog (keyboard and touch alternative); both end in a confirmation that shows the current and new time in the workspace zone, a visible success message, and an inline error that keeps the dialog open if the server refuses. The server is the authority: role and authorship, channel scope, state, workspace time zone (non-existent daylight-saving times are rejected) and the past. Below 720px the calendar becomes an agenda. Unit tests cover the server rules; drag-and-drop was exercised in a local desktop preview and the phone layout and Nightfall theme were looked at there, but there is no automated browser test and no high-volume or real-provider check.

Client-handled forms that contain credentials, recovery codes, or other private input declare `method="post"` in the rendered HTML. This prevents an early submission before hydration from placing values in a GET URL. Authentication forms own validation with `noValidate`, visible field errors, `aria-invalid`, and focus on the first invalid field. The server remains the authority for credentials and rate limits.

## Resilience and verification

Server authorization applies equally to UI, API, and MCP. Hiding a button is never the permission boundary. Any operation that may create remote content needs an idempotency or reconciliation path. A provider failure must not be presented as a confirmed deletion or publication. The current UI has shared route loading/error states, but specific forms and long jobs still need fuller recovery and progress coverage.

For each batch, run typecheck, targeted and full tests, and a production build when it does not conflict with the live dev preview. Inspect changed flows in a real browser at a narrow phone width and short desktop height, in Grove and Nightfall, with keyboard focus and a failure/empty state. Browser-only Lighthouse scores are supporting evidence, not proof of all flows. The production cutover remains gated by `docs/CUTOVER.md`.

Root Users and Workspaces search live in the contextual sidebar. Directory forms and confirmations use shared `.ui-field`/`.ui-input` theme primitives and `Button`; the remaining screen-local forms still need migration. Workspace access is explicit Active/Suspended text. Suspend/Restore asks for the exact stable workspace ID and action, initially focuses Cancel, preserves failed input, disables repeat submission and restores opener focus. Suspension retains local records and remote content. Customer access-limited pages keep workspace selection and sign-out available; they do not explain private installation setup.

The private Root overview explains installation MCP session access and provides a copy action for this app's actual origin. Copy failure leaves a readable relative endpoint and status feedback. Workspace role/key scope is distinct from installation-owner authority; customers see workspace policy copy and no Root enablement instructions. A signed-in owner with no memberships is redirected to Root; a customer without memberships has an invitation message and the shared sign-out menu. Anonymous visitors must sign in. Next.js can send the owner redirect as a streaming meta redirect; browsers must reach the Root route without an empty-state dead end.


## MCP error and recovery contract

MCP text and structured failures expose safe product messages and stable codes. Unexpected database, provider and filesystem text must not reach customer clients. An unknown write outcome asks the client to inspect current app/remote state before repeating. When a domain service has returned but its secondary MCP audit fails, preserve its receipt and report the audit warning separately. Do not turn partial publishing outcomes into full-success claims. These response rules do not replace durable provider reconciliation or transactional domain audits.


## Root module organization — user clarification, 2026-10-16

Root controls every installed product and platform module through its private interface. The design and sidebar must reflect ownership: shared installation controls separately from product modules and platform modules. A module's configuration, availability, capabilities and operational information belong together under that module. No third settings menu. Source folders stay self-contained outside Root; source organization alone does not satisfy this UX requirement. The current Root module-management design remains incomplete until those screens and controls work.

Root Users uses sidebar name/email and status filters, bounded pagination, active verified session counts and both authenticator/passkey status. Access/recovery dialogs require exact confirmations, preserve failed input, guard duplicate submissions and accept only matching success receipts. Sign-out copy distinguishes sessions from API keys.


Implemented Root organization now uses expandable Shared controls/Product modules/Platform modules groups in the existing contextual sidebar. Installed declarations generate links. Each module owns a scoped settings screen; shared configuration excludes module-owned settings. Product availability appears first. Provider settings use useful inner categories; historical key namespaces never override declared platform ownership. Labels uniquely identify boolean controls. Search/categories remain in the sidebar/mobile drawer. Complete module health/actions and missing operator workflows remain unfinished.

Root module diagnostics use sidebar-only run controls and a bounded provider connection picker. A phone submission closes the existing navigation drawer, reveals the work area, and focuses result/error feedback after rendering. Pending requests prevent duplicate submits. Recoverable failures retain the selected connection. Only a matching typed scope/connection receipt triggers success; unconfirmed transport outcomes direct operators to history. Results distinguish Pass, Fail and Skipped with timings and safe recovery text. Recent runs expand to their own safe results, and an unconfirmed completion remains visible. Root controls the operational display timezone to avoid hydration disagreement; API/MCP timestamps remain UTC. This does not complete all provider-operation or operator UX.

Inbox browsing now uses separate list/history cursors in the URL, with all filters and page links in the contextual sidebar or its existing phone drawer. Changing filters resets both positions; paging preserves an authorized selected thread even when absent from the current list page. Latest links recover invalid/changed history positions. Displayed counts describe stored matches/messages/replies and explicitly avoid claiming complete platform history. Native number/select/search controls follow the existing browser-owned policy; the server owns filter validation. Current read-only channel members can reach the page through its scoped shell. Full four-theme, keyboard and failure-state browser coverage remains pending.

## Shared form controls — 2026-10-16

`useFormValidation` validates named native controls and optional domain errors on submit, with no browser bubbles, associated `.ui-field-error` messages and first-invalid focus after rendering. Current copy is English independent of browser locale. Disabled/read-only controls do not contribute native errors. Password whitespace is preserved; the account form also checks the server-provided UTF-8 byte bound. This does not replace server authorization, validation or confirmations. Earlier authentication/publishing custom validation remains in the shared utility and still requires eventual consolidation.

Ads creation/budget, account/security, MCP keys, team addition, Root workspace creation, Calendar picking and Inbox reply use the shared hook. Existing server-owned GET/action filters explicitly suppress browser bubbles and retain server validation. Native controls and metadata are retained for keyboards and semantics. Recoverable request errors retain entered data and existing dialogs. `AutoTextarea` now covers all product multiline inputs, including composer/first comment, editing, approvals, reply, Root JSON and token output, using natural document growth rather than a new bounded scroller.

A newly issued MCP bearer stays masked until Show token. Copy token is an explicit clipboard action with safe success/failure feedback; it can copy while masked. A new issuance clears prior reveal/copy status. No secret is written to URLs, persistent browser storage or feedback. Full session-expiry, unsaved-change, field-level server-error mapping and all-screen browser/accessibility verification remain open.

Inbox resolve/reopen changes local workflow state. Authorized writers can use it for stored history even with expired credentials, while remote reply/moderation/deletion still require provider readiness and grants. Displayed success requires an explicit valid receipt; a lost/malformed response preserves the reply text or delete confirmation and asks the user to inspect current Inbox/platform state before repeating. Sync counts/times are validated before display. Remote deletion's durable journal/status/recovery UX and MCP delete remain unimplemented; INBOX_WRITE_RECOVERY.md records the required behavior.

Inbox comment deletion checks its durable status before exposing a new destructive action. Started/uncertain operations retain the dialog and expose Check deletion status; only persisted remote confirmation exposes Finish removal from Inbox. Completed state and both confirmation booleans are required before navigation/success. Existing requests show Close, with explicit copy that closing cannot undo a remote request. Private Root Inbox recovery uses the shared table/dialog/form controls and clearly labels external human verification, exact confirmation and retained failure context. Representative phone/theme/status/offline/operator/finalization Chrome checks are recorded in PREVIEW_QA.md; complete keyboard/visual/accessibility coverage remains open.

## Analytics explorer — 2026-10-16

Analytics filters, comparison choice, channel/ad-account selection, metric search/detail selection, result paging, export and retry/reset live in the contextual sidebar or its phone drawer. Cards contain summaries and semantic SVG previews with the shown-versus-stored date count; full dates and resource/category values use paginated tables. Detail mode hides the unrelated metric-card pager and retains series/resource paging plus a sidebar return link. Current and comparison UTC dates, coverage, freshness, missing/partial/changed-coverage copy and provider overlap caveats are explicit. Selected ads can render without any channel; absent audience data is not displayed as zero people. CSV discloses its configured ceiling. Comprehensive inline filter correction and all-state accessibility/visual coverage remain open; see ANALYTICS_READS and PREVIEW_QA.

## First-comment delivery — 2026-10-16

Post previews and row actions show first-comment delivery separately from post publication. A confirmed post stays published if its comment fails. Ready comments allow one explicitly confirmed send; uncertain comments require an explicit externally checked outcome, with a late-result warning and a comment ID for SENT. Manual absence records no remote operation and permits a separate send. The app never presents human attestation as automatic platform verification.

The existing shared dialog/theme/form controls retain outcome, acknowledgement, identifier and focused error after a rejected or unconfirmed request. Closing/reopening clears old dialog inputs/errors; cancelling an uncertain send preserves its review state. Pending actions disable submission and closing. An error receipt cannot trigger native form reset or a server-refresh remount. Successful recording closes the dialog and moves focus to the delivery group if its original button disappears. Actual phone failure/success and representative themed checks are recorded in PREVIEW_QA.md; automatic remote reconciliation and full all-state accessibility remain open.

## Publishing read visibility — 2026-10-17

Posts, Queue, Approvals, Calendar, Home publishing counts and MCP post reads use
the shared current-authorized Publishing read service. Channel choices use one
selected-resource resolver, including publishing capability/kind and entitlement
checks. Expired credentials may retain readable history while publishing stays
unavailable. A mixed visible/hidden-destination post is excluded whole, avoiding
partial previews and misleading action scope. No retained data is erased.

An unavailable channel URL produces zero matches and an explanation; shared
native options preserve “Unavailable channel” until the user chooses another
channel or resets. Filters remain in the contextual sidebar / phone drawer.
The drawer gives open native selects the first Escape on supported engines,
respects already-handled/composing events and restores its opener when dismissed.
Read bounds are Root-managed. The new HTTP Posts route shares page/service
validation and returns no-store success/errors. PUBLISHING_READS.md owns the
business/authorization references; PREVIEW_QA.md records evidence and limits.


## Publication recovery — 2026-10-17

Business authority: docs/PUBLICATION_RECOVERY.md and the current service in
modules/publishing/server/publication.ts. An unconfirmed publication is held;
the app must not invite another send until its outcome is resolved. Show the
post and destination context, distinguish a saved receipt awaiting local update
from an unknown result, and explicitly describe human external verification.
A reported absence may be followed by a delayed remote effect. Never label a
human attestation as an automatic platform check. Preserve entered outcome,
receipt and confirmation on recoverable failure; expose focused feedback and
status refresh. Local finish sends no provider request or first comment.
Private Root keeps these controls under Publishing, with workspace/destination
context and the same exact-operation confirmation model. All controls use the
shared themed fields, buttons, validation and dialog behavior.

Publishing choices also require a decryptable destination credential and the
adapter's recorded operation grants. They share current availability with MCP
destination tool/resource output. Missing grants never invite publishing from
the composer; retained history keeps its independent read authorization.
Root's Facebook API scopes category owns separate publish/delete policies.
See docs/PUBLISHING_READINESS.md for behavior and verification boundaries.

A recovery that changes list membership preserves the committed Posts URL
filters and view, sets a result notice bound to the opaque operation, and focuses
the shared RouteNotice after the initiating row disappears. Query notice copy
is an allowlisted UI result, not evidence of server success on its own. The
service receipt is validated before navigating. Root operation rows preserve
their focused success notice after their available action changes.

## Platform workspace availability — 2026-10-17

Root groups default inclusion and plan access keys with their owning platform
under Workspace access in the existing contextual sidebar/mobile drawer. An
installation switch remains distinct from a workspace inclusion policy. These
technical controls never become customer setup instructions. Connection
choices, resources, reports and supported actions honor the same current
platform entitlement across UI/HTTP/MCP. A suspended customer workspace does
not gain access from its member's installation-owner status; private Root
recovery remains available.

An empty Connections view says No available connections; it does not imply
that retained records were deleted or that the workspace never connected.
Root policy changes retain data and selected-resource state. Actual local
representative Clay desktop/Nightfall phone checks and restoration evidence
are recorded in PREVIEW_QA.md. All-state/four-theme coverage remains open.

## Post duplication — 2026-10-17

Manage post offers Duplicate as draft through the same actions in Table, Feed
and Cards for eligible current writers. It names the copied content and makes
clear that no remote content changes. Copying disables the row's other mutation
controls. A matching confirmed receipt opens the Drafts table with a focused
result notice; an unknown result retains the same retry ID, focuses a safe
error and offers Check Drafts in another tab. Confirmed success ends that
intent so the next deliberate duplication receives a new ID. Leaving/reloading
the component loses its local retry ID; the recovery link remains necessary.
Business/authorization authority is docs/POST_DUPLICATION.md and its service.
No new dialog, theme rule or third navigation surface is introduced.

## Posts search and CSV — 2026-10-17

Search text and first comments from the existing sidebar or phone drawer.
Search, channel, status and view are applied together; applying filters resets
page position, while pagination retains them. Counts reflect the same scoped
query. Invalid search keeps the entered value and shows focused safe guidance;
no matches has distinct copy, and failed reads expose no misleading empty list.

Export matching posts uses applied URL filters across all result pages. Root's
row and byte ceilings are visible; oversized matches are refused rather than
downloaded partially. Pending prevents duplicate clicks. A confirmed response
needs the version, safe count and matching actual byte size before a Blob
download starts. Feedback is focused, retains filters and says Prepared CSV,
which does not assert the browser saved a file. The phone drawer retains export
feedback inside its focus boundary. Content, first comments, all valid media
references and normalized destination outcomes are included; this CSV is not a
workspace archive or an import template. POST_SEARCH_EXPORT.md owns business
and interface details; PREVIEW_QA.md records the local checks and limitations.

### Provider signing readiness

Provider signing controls belong only to private Root platform configuration.
Customers do not receive app-secret or protocol setup instructions. Missing or
unreadable signing material preserves authorized stored Publishing/Ads history;
live Publishing/Ads controls use current provider readiness and safe unavailable
behavior. Root diagnostics retains technical configuration validation. Signing
configuration and a connectivity pass do not prove full provider operation
coverage. FACEBOOK_REQUEST_SIGNING.md and PREVIEW_QA.md record the current slice.

## Ordered media authoring — 2026-10-17

Composer and local edit initialize and submit the complete ordered media list.
Add URLs or select several local images, edit each image description, Move up/down
without dragging, and Remove without deleting the underlying image library file
or remote content. Count/limit guidance explains unavailable add actions; unsupported
formats/local uploads are absent for selected destinations. Pending Files remain
visible when destination selection makes them incompatible and can be removed or
the selection changed. Root/destination MIME intersections and the smallest byte
bound apply; service validation remains authoritative.

Sequential uploads commit each confirmed reference before continuing. Failure
preserves files, order, descriptions, text, first comment and destination choices;
retry reuses confirmed uploads and focuses the failed row. Multi-image editing
is supported. A failed/unconfirmed save retains the complete submitted list and
asks the user to inspect current state before repeating. Actual draft save/edit
returns to Posts with existing focused feedback. The phone sidebar closes on
upload failure and reveals its focused error. Unsaved browser Files are not a
durable session; navigation/reload/cancel recovery remains unfinished.

Strict action `mediaJson` and MCP `media` arrays use the same field shape and
ordered persistence. Metadata is returned only for currently ready destinations;
missing support produces customer-safe unavailable copy. No protocol/setup jargon
belongs in the customer editor. ORDERED_MEDIA_AUTHORING.md owns domain details;
PREVIEW_QA.md distinguishes checked behavior from the remaining credit-blocked
browser matrix and other release gaps.


## Captionless posts — 2026-10-17

Composer and local edit accept an empty caption when a link or media supplies
post content. Selected local image Files count before upload; empty attachment
rows and a first comment alone do not. The optional-caption label is shared
across the creation/edit flows. Empty-content errors retain all entered values
and focus the text field for correction. Existing attachment, destination and
Root limits remain authoritative at the service boundary.

Saved social previews render the actual attachment/link without missing-caption
filler. Posts table and Calendar reuse `modules/publishing/content-summary.ts`
for neutral image/video/link summaries when text is absent. Existing malformed
saved references are not described as usable attachments. The summary describes
content only; it does not claim delivery or preview inaccessible remote media.
CAPTIONLESS_POSTS.md records the service and MCP behavior; PREVIEW_QA.md separates
automated/local HTTP evidence from the outstanding browser/provider checks.


## Module-owned publication evidence in Root — 2026-10-17

A platform with installed publication-recovery metadata adds one evidence panel
inside its existing private Root module section. Shared tables render its safe
column schema. Operation ID filtering and reset stay in the contextual sidebar;
invalid input is retained with field-associated feedback, and clearing it restores
unfiltered history. Empty history, no matching operation, unavailable storage and
truncation have different copy. Filtering does not promise to remove configured
limits. Long identifiers remain in the shared scrollable table and use wrapping
cells. Modules without evidence omit that panel; disabling customer module access
does not hide operator evidence or remove safety guards.

Only active installation owners may read this content-free evidence through the
page, API or installation MCP. Customer recovery errors explain review actions
without exposing internal journal/protocol terms. Partial uploads are held rather
than claiming publication failure guarantees remote absence. Cleanup controls are
not offered until the module implements safe intent/receipt/reconciliation behavior.
FACEBOOK_MEDIA_RECOVERY.md owns current domain details; PREVIEW_QA.md distinguishes
component/API/MCP proof from browser and real-provider checks still pending.


## Module-owned Root recovery actions — 2026-10-17

An installed module may attach implemented actions to its private evidence rows.
Use one shared danger button and confirmation dialog with module-defined
consequences, exact typed confirmation and explicit acknowledgment. Cancel gets
initial focus. Pending disables close/competing submission. Only a matching
confirmed receipt permits success; malformed/unknown responses retain input,
focus useful guidance and block repeat. Close and review refreshes evidence;
recognized validation errors remain correctable. Preserve focused confirmed
feedback when the completed action disappears after refresh.

Facebook manual staged-photo deletion is opt-in and defaults off. Its copy must
state external verification and the race between inspection and deletion; a
missing story ID never means proven unused. Unknown feed/delete effects remain
held. No customer setup text, third menu or automatic retry is introduced.
FACEBOOK_MEDIA_RECOVERY.md owns domain policy; PREVIEW_QA.md separates component,
HTTP/MCP and browser/provider evidence.


## Typed Root outcome reports and resolved context — batch 54

Recovery modules may declare bounded text, choice and checkbox fields, with
module-owned labels, options, requirements and descriptions. The shared dialog
preserves entered values on correction/review paths, associates validation with
each field and focuses the first invalid field. Exact confirmation and explicit
acknowledgment remain required. Read-only context is derived by the module from
the selected evidence row, shown in a compact accessible label/value list, and
is not included in the submitted values.

An `attested` result shows that an operator recorded an external observation; it
must not be presented as a provider-confirmed success. Only a matching confirmed
receipt is described as confirmed. Unknown, malformed or conflicting receipts
keep the action held and require review; late provider evidence is retained
separately when it does not conflict. The UI does not offer generic conflict
clearing, remote candidate search or automatic resend. A human feed-absence report
does not authorize photo cleanup; cleanup still requires no feed intent or a
definitively provider-rejected feed, alongside the existing external check and
race acknowledgment. This update supersedes the earlier note that cleanup
controls awaited module implementation. See FACEBOOK_MEDIA_RECOVERY.md for the
current policy.

## Ads filter correction and selected totals — batch 56

Ad accounts and Campaigns preserve invalid sidebar selections and show a focused
route alert plus associated field errors, without loading a fallback report.
Unavailable accounts remain explicit choices needing correction. Invalid calendar
text stays editable rather than disappearing from a native date input. Preset
dates are disabled; selecting Custom dates enables them before submission.
Inputs use shared 44px fields and buttons. Account summary counts follow the same
selection as their cards. Actual phone correction/submission, stale account and
reversed-date checks are recorded in PREVIEW_QA.md; ADS_REPORT_FILTERS.md records
remaining policy, pagination and broader design/feature gaps.

## Ads report policy — batch 57

Root Ads controls define report preset IDs, labels, durations, default, calendar
ceiling and filter-string limit as one validated object. Both report pages use
those choices, including their correction views; custom ranges explain the
active day ceiling in the sidebar. Removed presets and an explicitly empty
account value require correction without loading a wider report. MCP uses the
same policy and UTC calendar parser, returns safe report options and labels its
exclusive end. Root invalid saves return a useful 400 without changing policy;
workspace owners/keys cannot acquire Root access. ADS_REPORT_FILTERS.md defines
date semantics; PREVIEW_QA.md distinguishes automated, rendered HTTP and actual
interactive browser proof. General copy configuration and complete reporting,
visual/accessibility and legacy parity remain open.

## Ads report pages and size failures — batch 58

Ads account cards and object summaries now have server-rendered pages. Sidebar
Previous/Next links retain period, custom dates and account; Apply and Reset
begin page 1. Headers/sidebar distinguish visible ranges from full scoped totals.
On phones, page navigation uses the same drawer and closes it after following a
link. Invalid page values fail before insight/readiness work; stale positive page
links show the clamped actual page. Page recovery retains filters.

Reports exceeding Root's row ceiling show a focused actionable correction and no
partial metrics/counts. The complete-or-refused rule is shared with MCP. Root
controls the default page size; MCP still caps explicit result requests. Stable
tuple identity/latest object naming prevent arbitrary tie order for unchanged
data. These are representative report flows; full-screen copy, status/freshness,
comparison/export and accessibility coverage remain open. ADS_REPORT_FILTERS.md
and PREVIEW_QA.md distinguish scope and actual proof.

## Complete stored Ads export and daily measures — batch 59

Ads exports applied filters across all pages and stored levels, with explicit
row/byte ceilings. The shared CSV control checks type/version/count/exact bytes
and filename before download. Pending clicks are deduplicated; unmount or scope
changes cancel and invalidate the old read. Focused success/error stays inside
the phone drawer, retains filters and supports retry. Prepared CSV describes an
application receipt, not proof of a saved local file. No management confirmation
is needed for an ordinary authorized read; spend-changing actions retain theirs.

Daily details show primary measures as well as ratios, actions and additional
fields. Report day and fetch time have separate labels; absent fetch provenance
is unknown. Raw credential fields are visibly redacted with provenance in API/
CSV. Both Ads routes explicitly admit current scoped readers while services keep
management restrictions. ADS_REPORT_EXPORT.md owns data, permissions, limits and
redaction policy; PREVIEW_QA.md owns actual evidence. Complete provider coverage,
comparison/status/freshness analysis and all-screen accessibility remain open.

## Workspace team access — batch 61

Owners and admins can add an existing account, review its role/channel scope, edit another member, or remove workspace access through explicit exact-text confirmation. Changes preserve other workspace memberships. Owner/admin roles have all-channel access; only owners manage owner roles. Pending changes block duplicates and dialogs remain available after uncertain outcomes, with focused feedback and a directory refresh path. The current directory identifies unavailable prior channel grants; editing those grants still needs a clear recovery action before the workflow is complete. MCP uses the same confirmation and domain services. New invitations, account creation, mail and seat-plan policy are not implemented. See TEAM_ACCESS.md and PREVIEW_QA.md.

## Analytics Reports — batch82

Report templates, schedules and run history share `/analytics/reports`, with
contextual-sidebar actions and independent history paging. Template and schedule
page state remains in URL parameters. Complete authorized template choices are
loaded separately from the visible table page; saved unavailable choices remain
named in edit forms. Creation/edit/deletion use the shared dialog, preserve
entered values after failure, associate field errors and focus useful feedback.
Confirmation buttons use action verbs; result messages describe what completed.

Prepare report accepts one selected channel, an optional template and inclusive
UTC dates. It needs no email transport. Review explicitly says that nothing is
emailed, and uncertain responses retain the same request UUID for safe retry.
The CSV receipt validates its name, row count and exact UTF-8 bytes before a
Blob download; printable HTML is a downloaded artifact. Prepared is distinct
from scheduled delivery outcomes. Schedules/history remain manageable while
email delivery is unavailable; new sends are absent until their actual runtime
requirements are met. History times show the workspace timezone. Domain and
permission authority is [REPORT_WORKFLOWS.md](docs/REPORT_WORKFLOWS.md); final
browser/failure-path evidence is still pending for this batch.

## Destination formats (batch85)

The shared `DestinationFormats` owner renders selected-channel format metadata in
the contextual sidebar for compose/edit. One choice is a label, multiple choices
use the canonical browser-owned select; unknown saved values remain unavailable
until changed. Only selected target keys are serialized. Media checks use the
chosen descriptor. Managed action editors use `usePreserveFormState` to cancel
native resets in capture phase, keeping associated sidebar controls aligned with
React state after handled or transport failures. Success navigates away. The
unreferenced alternate quick-create component was removed. See
[DESTINATION_FORMATS.md](docs/DESTINATION_FORMATS.md) for persistence and remaining
provider limitations. Browser verification evidence is recorded with the batch.


### Confirmed authoring success (batch86)

The stateful composer receives an explicit server acknowledgement before navigating to Posts. Until navigation completes, show and focus a saved status with a normal fallback link, freeze edits and disable another submission. A cache refresh error after commit must not invite a second creation. A transport result that is unconfirmed remains distinct from a known failed validation; retain input and ask the user to inspect Posts before deliberate retry.

Root module settings must remain usable when searching by a long configuration key. Wrap the result heading and technical identifiers within the phone viewport; preserve sidebar filtering and the owning table scroller. Native-policy diagnostic results distinguish locally valid settings from provider verification and customer availability.


Root receipt evidence (batch89): module-owned summary columns must reference
validated schema keys; full declared fields remain accessible in a keyboard-
operable details disclosure. Receipt reads never execute recovery actions.
Unimplemented native actions stay absent/refused; a submitted receipt does not
mean a live publication. Filters remain in the contextual sidebar/drawer.

Batch89 verification: real local Chromium passed the Root receipt summary and
keyboard disclosure in Grove, Coast, Clay and Nightfall at1440px/390px, including
sidebar filter retention and no document overflow. Metadata row-identity guards,
action-unconfirmed messages and filter-scoped success notices have regressions.
This is scoped Root evidence UX proof, not a whole-app accessibility clearance.


Batch91 Root publication inspection uses the canonical shared action dialog and
secondary Button styling; recovery/delete actions retain danger emphasis. The
confirmation identifies final identity/Page and displayed revision. A built-server
probe passed Root API/installation-MCP authorization and eight desktop/phone views
across Grove, Coast, Clay and Nightfall. It verified wrong-confirmation no-GET,
visibility while platform/recovery are off, and exactly two HTTPS-mock reads:
accepted published proof via browser and held scheduled observation via MCP.
Screenshot inspection caught and fixed Cancel wrapping at390px. The responsive
single-column footer passed the final build/typecheck, eight-view probe and
corrected phone screenshot inspection.
This is scoped Root evidence, not whole-app UX clearance.


### Asynchronous publication receipt recovery (batch92)

The shared Root recovery dialog keeps long evidence inside a bounded scrolling
surface and leaves its actions reachable. The saved remote submission ID is read-only and selectable. When an
attempt has a known submitted ID, the dialog provides no `ABSENT` outcome and no
way to substitute a different ID; the confirmation is bound to the displayed
identity. A matching accepted Root attestation and customer publication status
are separate steps and surfaces. A provider submission, valid ID, or URL alone
does not show a live post. Root browser verification passed16 views across four themes/two widths,
including focus, fixed IDs and viewport fit. Customer recovery component tests
passed; its full browser matrix remains separate; see [ASYNC_PUBLICATION_RECEIPTS.md](docs/ASYNC_PUBLICATION_RECEIPTS.md).


## First-comment timing (batch94)
Composer/edit/template fields expose Root-bounded whole minutes, zero after
confirmed publication. Each destination uses its own publication time. Posts
show saved timing and an acknowledged Send now action; uncertain attempts remain
blocked for outcome recording. A successful local send replaces the prior
scheduled label. Numeric bounds, keyboard focus, mobile navigation closure and
themed layout have local probe evidence in docs/FIRST_COMMENT_SCHEDULING.md;
live-provider/native-format and full-app UX clearance remain separate.

## Stored audience history (2026-10-20)

Demographics keeps channel/date controls and scoped full-history CSV in the
contextual sidebar. Each keyboard-operable snapshot disclosure names its channel
and UTC as-of time; fetch time, original categories and within-snapshot shares
appear inside. Missing values read Not available / Non disponible. English and
French copy, failure filter retention and server rendering have synthetic tests;
actual browser/theme/viewport and download interaction checks remain open.


## Channel groups and profile labels (2026-10-20)

Settings owns channel-group CRUD and channel labels with current authorization,
selected-resource locks and atomic workspace audit. UI, HTTP and MCP share one
service; composer, Posts filters and Analytics overview reuse scoped groups and
labels. See [CHANNEL_PROFILES.md](docs/CHANNEL_PROFILES.md) for limits, migration, evidence and open work.
The additive migration is unapplied; database/browser verification, broader
profile/filter parity, watermarking and new-label export coverage remain open.
This branch is local only; no push or deployment was authorized.

### Root registration administration (2026-10-20 branch)

`/root/registration` uses shared DataTable/Button/useConfirm with English/French
copy. Sidebar controls own search, invitation status/workspace filters and
independent directory paging. Registration state is read-only, with a configuration
search link; missing values say unavailable. Accepted invitations expose no revoke.
Mutations require exact typed phrases, disable duplicate submission and keep
input/error on failure; only a matching receipt closes the dialog. Unconfirmed
mail delivery stays explicit. Shared useConfirm supports optional asynchronous
exact confirmation while preserving simple callers. DOM/render checks pass; real
browser theme/viewport verification remains open. See ROOT_REGISTRATION_ADMIN.md.

Version restoration (local `codex/version-restore` batch): Restore first loads a
server review, showing current destinations, selected available format labels,
retained content/media/comment/delay and en/fr explanations of omissions.
Available historical formats are restored; unavailable ones need an explicit
closest-valid choice. The shared `useConfirm` supplies final confirmation.
An empty adapted post cannot be applied. Recoverable failures preserve the
review, with Review again for a changed proposal; approval reset is announced.
DOM checks cover review/confirmation/failure/retry and French empty-result
blocking. Actual browser themes, widths and keyboard verification remain open.


Best-time suggestions (2026-10-20 branch): the composer sidebar reads stored
performance for the selected destinations and shows en/fr loading, unavailable,
retry and suggested-time controls. Unknown history displays Not available / Non
disponible. Obsolete destination responses cannot fill the schedule. A click
fills workspace-local date/time without submitting. Queue mode prefers free
suggested slots only when workspace bestTimeMode is apply, then uses the saved
timetable; previews remain estimates. Workspace operations exposes that choice
with copy describing allocation-time preference. Unit/jsdom evidence only; see
[BEST_TIMES.md](docs/BEST_TIMES.md) for bounds and remaining runtime checks.


Root connection Refresh token (2026-10-20) uses shared Button/useConfirm, names the connection, requires exact `REFRESH CONNECTION <id>`, retains confirmation on unconfirmed errors and returns focus after an explicit renewed/not renewable/failed receipt. Copy is en/fr; unknown expiry is Not available. Provider/credential details never enter the dialog or feedback. DOM evidence and browser/live limits: docs/ROOT_CONNECTION_REFRESH.md.

## Current language and theme evidence — 2026-10-21

Source checked at `6fb0e57f`: Publishing, Inbox, Analytics, Ads, Home, Tasks and
Agency have module-owned Root-editable English/French catalogs (merged through
`38ab34f4`). Schema-checked readers use `configOrDefault` (`fb42b056`): missing,
unreadable or invalid stored catalogs fall back to the registry default validated
by the same schema. `configValueOrDefault` only checks broad type/array shape;
it is not equivalent to full schema validation. These fallback mechanisms do
not establish that all customer strings use a catalog.

`tests/ui-copy-coverage.test.ts` checks literal `t(...)` keys in Agency, Tasks and
Analytics Reports screens and nonempty English/French entries in those catalogs.
Other module copy tests have their own scopes; this test does not scan every
module, dynamic metric label, error, browser control or downloaded report.
Remaining Root/service copy, AI prompt language and other literal gaps are in
[CONFIG_LITERAL_AUDIT.md](docs/CONFIG_LITERAL_AUDIT.md). Current palettes are
Vivid/Meta blue/Warm/Clean in light/dark; older Grove/Coast/Clay/Nightfall browser
results retain only their original dated scope. Verify current language, keyboard,
failure recovery, desktop/phone and theme states with synthetic local data;
production planning/provider results cannot substitute for that UI evidence.

## Design v2 decisions (batch B0, 2026-10-21)

Source: [docs/design-v2/README.md](docs/design-v2/README.md) decision record (owner-approved). Behaviour changes ship batch by batch (B1 to B9); a row above stays current until its batch lands.

- Clean is the default theme for new users; saved choices are kept.
- Navigation target: one sidebar with areas Home · Content · Inbox · Insights and a channel list that scopes every page; a Filter button per page (B1). Supersedes filters in the contextual sidebar.
- Content target: Table with side preview; Feed and Cards views removed, old `view=feed|cards` values open the table with a one-time notice (B3). Supersedes "Feed and Cards, alongside default Table".
- Number caveats sit behind ⓘ; partial results show ⚠ (built in Insights Overview, B5; source and DOM evidence only). Charts show a "Show data" toggle, fill missing days as gaps, align the previous period by date offset and group beyond eight series or slices as "Other".
- Phone first-class flows: Inbox replies, Create, post status, Insights numbers.
- Form fields and controls use `--control-border` (3:1); focus is a 2 px outline on every control.


## Design v2 B7 — partial source behavior (2026-10-22)

Home first-run shows the connection next step in place of its cards; otherwise
its personal greeting leads to real waiting conversations, figures with InfoTip
caveats, scheduled-post ListRows and Inbox/Best times. Partial count coverage
uses the warning disclosure. A failed card offers refresh while other cards stay.
Tasks uses Board/List tabs, one header Filter and the shared detail SidePanel;
Escape/focus return and stale comment responses have jsdom tests. Pending writes
block competing task actions and preserve recoverable input. Agency/Clients use
header filters and the existing confirmed workspace selection; overview counts
remain withheld where access is missing. Its table-order sparklines are removed.
These are source/DOM behaviors, not browser or complete S1/S14 acceptance: see
[docs/design-v2/B7_IMPLEMENTATION.md](docs/design-v2/B7_IMPLEMENTATION.md) for the
missing shared-service/copy fields and actual verification limits.
