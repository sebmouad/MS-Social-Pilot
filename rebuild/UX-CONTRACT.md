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

| Capability | Current owner and decision | Verification or gap |
|---|---|---|
| Navigation | `src/components/AppShell.tsx`, module manifests | Desktop/sidebar and phone/bottom-rail browser checks |
| Theme and scrollbar | `src/styles/tokens.css`; theme metadata in `src/lib/themes.ts` | Theme screenshots; global scrollbar baseline still to be verified |
| Read-only table | `src/components/DataTable.tsx` | Native table, caption, header sort; server pagination is not universal yet |
| Table selection | No shared owner yet | Define before adding bulk table actions |
| Select/listbox | Native `<select>` for current English UI | Browser owns open popup; revisit for localized/authored popup requirements |
| Date | Native date/time input where used | Workspace timezone and date-only parsing need route tests |
| Forms | Screen-local forms plus server validation | Shared field error/first-invalid-focus owner remains to be built |
| Dialog | `src/components/ModalDialog.tsx` owns the native modal lifecycle; `Dialog.tsx` supplies the standard frame | Connections and post deletion use it; focus, Escape, restoration, and destructive flow browser tests remain required |
| Toast/status | Inline `role=status`/`role=alert` today | One shared notification owner remains to be built |
| CRUD | Server services are authoritative; screens keep context until confirmed | Full create/edit/delete and failure E2E coverage remains incomplete |

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

Use a real link for navigation and a button for mutation. Pending states disable duplicate submission without changing button geometry. Success copy repeats the action verb; inline errors stay near the action and preserve recoverable input. Destructive dialogs initially focus Cancel, keep the object and consequence visible, and close only after confirmed success. Escape and focus restoration must work. One shared dialog and notification pattern should replace screen-local overlays and ad hoc notices.

## Resilience and verification

Server authorization applies equally to UI, API, and MCP. Hiding a button is never the permission boundary. Any operation that may create remote content needs an idempotency or reconciliation path. A provider failure must not be presented as a confirmed deletion or publication. The current UI has shared route loading/error states, but specific forms and long jobs still need fuller recovery and progress coverage.

For each batch, run typecheck, targeted and full tests, and a production build when it does not conflict with the live dev preview. Inspect changed flows in a real browser at a narrow phone width and short desktop height, in Grove and Nightfall, with keyboard focus and a failure/empty state. Browser-only Lighthouse scores are supporting evidence, not proof of all flows. The production cutover remains gated by `docs/CUTOVER.md`.
