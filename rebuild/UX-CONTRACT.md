# MS Social Pilot UX Contract

This contract records observable behavior for the rebuild. It does not override the server's permission, publishing, provider, or data-lifecycle rules. Current gaps are marked as such so future batches cannot mistake intent for shipped behavior.

## Product context

The product serves teams publishing to selected social channels, managing responses and ads, and reporting results. Current UI language is English. The workspace timezone governs publishing dates; API timestamps remain absolute. Target accessibility is WCAG 2.2 AA. The user selects a theme in Appearance; visual rules live in [DESIGN.md](DESIGN.md).

## Business-context sources

| Scope | Authoritative source |
|---|---|
| Module and route availability | `src/modules/*/manifest.ts`, `src/server/entitlements` |
| Member and channel permissions | `src/server/permissions`, `src/server/context.ts` |
| Post lifecycle and remote deletion | `src/server/publishing` |
| Connection selection and disconnection | `src/server/connections` |
| Workspace export and erasure | `src/server/data-control`, `src/app/settings/data/IMPLEMENTATION.md` |
| Facebook capabilities | `src/platforms/facebook`, `docs/PLATFORMS.md` |
| Root configuration | `src/lib/config/registry.ts`, `docs/ROOT_RUNTIME_CONFIG.md` |

There is no released billing or legal-copy contract for the rebuild. Do not invent subscription or regulatory promises in UI copy.

## Canonical UI map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Navigation | `src/components/AppShell.tsx` | Module manifests | Desktop sidebar, phone bottom rail | Browser keyboard and viewport checks |
| Theme and Scrollbar | `src/styles/tokens.css` | `DESIGN.md` | Grove, Coast, Clay, Nightfall | Publishing mobile Lighthouse accessibility 100 in all four themes; shared muted-text contrast test passes; other screens and scrollbar checks pending |
| Read-only table | `src/components/DataTable.tsx` | Server list query | Sortable or static columns | Posts now has scoped database pagination; other table pagination parity pending |
| Table Selection | No shared owner yet | `UX-CONTRACT.md` | None until a shared owner exists | Define before bulk table actions |
| Select/Listbox | Native `<select>` | `DESIGN.md` and this contract | Browser-owned popup in English UI | Posts filter selection persisted after navigation in a 390px Chrome mobile preview; keyboard checks pending |
| Date | Native date/time inputs | Workspace timezone policy | Date or datetime-local | Date-only parsing and browser checks pending |
| Form | Screen-local forms plus server validation | Server validation | Create or edit | Shared field error and first-invalid-focus owner pending |
| Dialog | `src/components/ModalDialog.tsx` | This contract | Confirmation or selection | Focus, Escape, restoration browser checks pending |
| Toast | Inline `role=status`/`role=alert` | This contract | Success or error | Shared notification owner pending |
| CRUD | Server services | Domain services | Create, edit, delete | Full failure-path E2E coverage pending |

## Workflow ledger

| Operation | Pending | Success | Failure recovery |
|---|---|---|---|
| Connect source | Disable repeat start while OAuth begins | Show discovered channels and ad accounts with checkboxes | Keep workspace page and a retry path; do not expose credentials |
| Change selection | Keep current choices visible; disable duplicate save | Persist selected local state and refresh the connection table | Keep the selection dialog open with entered choices |
| Disconnect source | Ask retain or delete, show related-data preview for delete | Confirm scope and update the table | Keep dialog and choice; never claim provider revocation |
| Create/edit post | Preserve composer values and target choices | Return to a refreshed post list with status | Show actionable error; avoid duplicate remote publish |
| Delete published post | Separate local removal from optional remote deletion | Show actual local and remote outcomes | Preserve reconciliation state for uncertain remote outcome |
| Export workspace | Show coverage and generate a no-store archive | Download ZIP with manifest | Fail visibly if files/records are missing or unsafe |
| Delete workspace data | Exact confirmation after row preview | Show resumable progress and completion | Preserve purge state and retry cleanup without repeating DB deletion |

The server sources above govern permission, idempotency, and deletion semantics. Rows describe UI consequences, not new business policy.

## Navigation, data, and feedback

The main rail contains only available customer modules. Route tabs and filters live with the rail; on a phone, filters open from a labeled control rather than covering every page scroll. Root tools are private and separate from customer navigation. Committed filter state belongs in the URL when shareable; secrets never do. A data table must expose total/range when known, a deliberate page or load-more strategy, and a clear distinction between no records and no matches. This is not yet consistent across all routes.

Connections rows show how many discovered channels are selected and offer direct Manage and Disconnect actions for authorized members. An ad account links to the selection dialog for its parent source. The selected source is focused in that dialog; disconnection still requires the retain-or-delete confirmation.
The disconnect preview groups related local records under customer-facing names. Provider-scheduled posts are shown separately because they are a subset of linked posts and must be reconciled before local deletion.
Ads daily details render every stored action and additional measure as a labeled value, including measures unknown to this app version. Raw provider JSON is reserved for server and audit boundaries, not customer screens.

Use a real link for navigation and a button for mutation. Pending states disable duplicate submission without changing button geometry. Success copy repeats the action verb; inline errors stay near the action and preserve recoverable input. Destructive dialogs initially focus Cancel, keep the object and consequence visible, and close only after confirmed success. Escape and focus restoration must work. One shared dialog and notification pattern should replace screen-local overlays and ad hoc notices.

The post composer and CSV importer validate required text, optional URL syntax, attachment exclusivity, and file selection before submitting. A failed local check keeps the entered draft, shows an associated inline error, and focuses the field requiring correction. Server publishing and CSV checks remain authoritative. Empty data-table copy sits outside the horizontally scrolling table so it remains readable at phone widths.

The Posts screen counts and pages after workspace and channel authorization. Its status and channel filters live in the sidebar and persist in the URL across pages. On 2026-10-15 the local 390px mobile preview showed the filter drawer without horizontal overflow; applying Draft changed the URL and retained the selected value after navigation. A mobile Lighthouse navigation audit of that filtered route scored 100 for accessibility, best practices, SEO, and agentic browsing. This is local fixture evidence, not a large-data or provider test.

Calendar selects its month through a URL parameter and sidebar month picker. Previous and next month links preserve direct navigation. Its database query covers timestamps near the workspace-local month boundary before exact timezone grouping, without truncating to recent posts. Published posts use their actual publish time when present; scheduled posts use their scheduled time. The September 2026 route and picker were checked in the local 390px Chrome preview. High-volume and real-provider calendar checks remain open.

Client-handled forms that contain credentials, recovery codes, or other private input declare `method="post"` in the rendered HTML. This prevents an early submission before hydration from placing values in a GET URL. Authentication forms own validation with `noValidate`, visible field errors, `aria-invalid`, and focus on the first invalid field. The server remains the authority for credentials and rate limits.

## Resilience and verification

Server authorization applies equally to UI, API, and MCP. Hiding a button is never the permission boundary. Any operation that may create remote content needs an idempotency or reconciliation path. A provider failure must not be presented as a confirmed deletion or publication. The current UI has shared route loading/error states, but specific forms and long jobs still need fuller recovery and progress coverage.

For each batch, run typecheck, targeted and full tests, and a production build when it does not conflict with the live dev preview. Inspect changed flows in a real browser at a narrow phone width and short desktop height, in Grove and Nightfall, with keyboard focus and a failure/empty state. Browser-only Lighthouse scores are supporting evidence, not proof of all flows. The production cutover remains gated by `docs/CUTOVER.md`.
