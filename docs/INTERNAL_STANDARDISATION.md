# Internal app standards and audit remediation

This document owns cross-screen UI contracts. `DESIGN.md` owns visual tokens and layout; server authorization remains in `role-access`, `page-access`, and route/domain functions.

## Shared contracts

| Concern | Shared owner | Contract |
| --- | --- | --- |
| Browser JSON mutations | `src/lib/client-request.ts` | Preserve HTTP status, fields, trace ID and transport uncertainty; never automatically retry a write. |
| Modal and drawer focus | `src/components/useModalFocus.ts`, `Dialog.tsx` | Focus containment, Escape, inert background, body locking, opener restoration. Close mobile drawer at desktop breakpoint. |
| Confirmation | `ConfirmProvider.tsx` | Shared translated confirmation; no browser confirm prompts for app actions. |
| Editor navigation | `src/lib/navigation-guard.ts`, `Composer.tsx` | Confirm links, workspace changes, sign-out, Chrome history traversal; session recovery scoped by user/workspace/post. |
| Media reuse | `MediaPicker.tsx` | Authenticated workspace listing, explicit selection, no implicit upload or publish. Composer enforces attachment limits. |
| Destination content | `src/lib/composer-state.ts` | Nonblank destination override replaces common caption; text-only excludes attachments. Server remains authoritative. |
| Segmented radio groups | `src/lib/segmented-radio.ts` | One tab stop; arrows, Home/End, disabled-item skipping, RTL support. |
| CSV publishing | `BulkUpload.tsx`, `/compose/import` | Publish owns import; Settings links to it. Channel scope is authorized on server and selection uses TargetPicker. |
| Destination selection | `TargetPicker.tsx` | Search, selected visibility, group reuse, blocker text; shared composer/CSV selection. |
| Task workflow | `src/lib/task-workflow.ts` | Preserve created/failed/unattempted/uncertain outcomes; retry only known unresolved rows. Unknown creates require checking board. |
| Report context | reports page, `ReportControls`, reports API | CSV uses applied sidebar scope intersected with authorization; email uses selected Page context. |
| Delivery readiness | `emailEnabled`, report schedules | Unavailable delivery is unavailable; skipped/failed email cannot be reported as sent. |
| Audience metrics | `audience-growth-metrics.ts`, analytics view model | Labels follow source provenance; mixed follower/like sources cannot produce a meaningful net value. Missing data stays unavailable. |
| Disclosure and filters | `PhoneFold`, `SidebarDock`, `QuerySelect` | Desktop tools stay reachable across resizing; dock follows recreated shell target; changed searches reset pagination. |
| Copy and visuals | EN/FR catalogs, StatusBadge, theme tokens | Both languages, ICU counts, factual source scope, consistent scheduled/review colors. |

## Review matrix

For every changed feature, check desktop and phone, English and French, keyboard and touch, owner/editor/viewer capabilities, empty/populated states, pending/HTTP rejection/offline outcomes, and user/workspace changes. Readiness must describe operational capability, not a preference switch. Keep domain labels and policy in shared modules; do not duplicate permission rules in client UI.

## Remediation coverage

Implemented targeted fixes for composer reset/dirty state/recovery/preview/validation/actions, shell dock/modal/drawer/skip navigation, calendar keyboard/touch/transport handling, role-aware onboarding, invitation-only sign-in, actionable no-email recovery copy, status/theme consistency, local settings navigation, accessible metric help, report drafts/export/readiness/delivery/delete feedback, task pending/partial recovery, inbox draft scope, media reuse/delete feedback, destination identity and audience provenance.

Scope limits: no configured support address exists, so password recovery directs users to their administrator/inviter without inventing an address. Non-Facebook previews represent destination content rather than pixel-exact native network rendering. Session recovery requires browser storage; ordinary links and workspace changes still confirm when storage is unavailable. Browsers without the Navigation API use session recovery for Back/Forward. No production data or secrets are persisted by new shared helpers.

Existing unrelated mutations retain their established request handling; the shared request helper is the migration contract, not a claim that every fetch has been rewritten. Future migrations need the same pending/error/uncertainty checks and real behavior tests.
