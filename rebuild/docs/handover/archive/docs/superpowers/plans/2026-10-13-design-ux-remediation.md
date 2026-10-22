# MS Social Pilot Design and UX Remediation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task when that skill is available. Use delegation only if separately authorized. Steps use checkbox syntax for tracking. The full audit is embedded below, so this file can travel alone.

**Goal:** Resolve the 14 audited design/UX defects and standardise internal logic, shared features, visual primitives and interaction contracts without weakening publishing, workspace isolation, role permissions, or bilingual behavior.

**Architecture:** Preserve the Next.js shell and shared design tokens. Repair composer state and navigation lifecycle first, then shared overlays/responsive controls, destination review, and role-aware public/onboarding flows. Use existing server authorization and publishing contracts.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma/PostgreSQL, Tailwind, next-intl, Vitest, Playwright.

**Spec:** Complete audit included in Part II. Original source: `audit/design-ux-audit-2026-10-13.md`. Baseline `6cc5528325b55c108a55539e431b51589e97a914`.

## Agent instruction

Implement the fixes in Part I in order. First compare the current checkout with the audited baseline and reproduce each suspected defect; line numbers may have shifted. Record already-fixed or disproven findings with evidence rather than applying unnecessary changes. Use the repository's current CLAUDE.md, docs/ai/README.md, DESIGN.md, TESTING.md, PERMISSIONS.md, and applicable local skills. Do not assume the archived screenshots represent the current shell.

This handoff is a specification for another agent, not evidence that implementation or validation has occurred. All tasks start unchecked. Production observations are dated 13 October 2026 and must be refreshed before treating them as current configuration facts.

## Global constraints

- Keep navigation on the left: area rail + contextual sidebar; top bar for utilities. Preserve Facebook/Warm/Dark theme tokens and existing component classes.
- Every new UI string belongs in messages/en.json and messages/fr.json with identical placeholders and ICU plurals for counts. Use logical layout classes.
- Preserve multi-destination publishing, destination outcomes, approval enforcement, queue/native scheduling, workspace timezone handling, and current REST contracts unless a scoped additive UI change requires otherwise.
- Reuse server-side role/workspace/page scope checks; never grant access to fix a UI dead end. Keep technical tokens/scopes/raw diagnostics in root/admin surfaces.
- Use useConfirm(), not window.confirm(), for in-app choices. Preserve authentication hydration protections.
- Do not fetch production database contents, enter secrets into pages, or create user accounts. Use isolated test fixtures and stub network publishing for regressions.
- This deliverable authorizes preparing a remediation specification. It does not authorize deployment, live publication, messaging, email sending, deletion, SMTP changes, permission changes, or GitHub publication. Obtain explicit execution scope from the user before such actions. Repository auto-deploy instructions do not supply that authorization.
- Before making commits, inspect the current repository instructions; the audited repository says commit to main without PRs. Do not reset or overwrite unrelated user changes.
- A test skipped for missing infrastructure is not a passed test. Verify any documented pre-existing failure against a baseline run; do not blanket-ignore it.

## File responsibilities

- Composer.tsx: draft values, submission outcomes, destination payload inputs, validation, preview/action wiring.
- AppShell.tsx and SidebarDock.tsx: navigation/workspace transitions, dock mount lifecycle, mobile drawer.
- Dialog.tsx and ConfirmProvider.tsx: reusable accessible overlays and explicit choices.
- PostPreview.tsx: destination-specific approximate rendering; no publishing decisions.
- CalendarWeek.tsx, CalendarDrag.tsx, PhoneFold.tsx: contextual creation, reschedule feedback, responsive reachability.
- TargetPicker.tsx: selection and visible readiness explanations.
- GettingStarted.tsx: role-aware achievable onboarding, using existing policy modules.
- AuthForm.tsx and auth pages: public access guidance and policy-aware calls to action.
- messages/*.json: all user copy. globals.css: shared responsive/safe-area styling.
- Existing tests/e2e specs: regressions below. New helpers may be added near the owning components if needed; avoid speculative framework rewrites or unapproved dependencies.

## Review focus

1. Partial success and lost responses: distinguish an existing post from a failed creation; never duplicate public content through retries (Tasks 1 and 14).
2. Draft ownership: navigation recovery cannot leak content between users, workspaces, or edited posts (Task 2).
3. Lifecycle transitions: collapsed sidebar, persisted collapse, breakpoint crossings, and stacked overlays keep controls and focus reachable (Tasks 3–6).
4. Payload fidelity: per-target overrides/media exclusions and approval modes remain reflected in previews/actions (Tasks 7 and 9).
5. Restricted/configuration states: unavailable modules, clients/viewers, closed signup, missing email/contact yield achievable guidance without broader permissions (Tasks 10–13).

## Verification workflow

Read current docs/ai/TESTING.md and e2e/README.md before setup. Audited scripts: npm run typecheck, npm test, and npx playwright test. Playwright is not a declared dependency; follow the repository's documented optional installation without committing dependency/lockfile churn. The e2e prepare step resets its isolated schema: never point E2E_DATABASE_URL at production.

For each task: add a meaningful regression, run it to observe the failure, implement, rerun the regression plus typecheck, then inspect the diff. Use local database fixtures and network stubs; do not test send buttons against live social accounts. Run focused specs using the same isolated database environment described by TESTING.md. At the end, run the full relevant Vitest and browser suites and git diff --check; report exact outcomes and limitations.

## Part I — Fix tasks

### Task 1: Reset the composer after every created post

**Audit finding:** 1. **Modify:** `src/components/Composer.tsx`. **Regression files:** `e2e/compose.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** After the API confirms creation, reset variants, textOnly, place, background, fieldValues, caption-test, translation, and stagger state alongside the existing content reset. Run the same reset before returning from partial-failure handling. Preserve published links, undo metadata, and retry guidance. Do not reset unsaved content on HTTP or transport failure. Keep selected destinations and timing as defaults, but reset overrides tied to the previous post.

**Acceptance/regression scenario:** Two sequential posts in one mounted composer: the first uses different captions, text-only exclusions, and custom fields; the second uses new content/media. Inspect requests and stored results: no previous override or exclusion appears in the second. Repeat with partial success and all-destination failure after successful creation. A rejected creation keeps the original draft intact.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 2: Protect unsaved composer work

**Audit finding:** 2. **Modify:** `src/components/Composer.tsx; src/components/AppShell.tsx; src/components/ConfirmProvider.tsx`. **Regression files:** `e2e/compose.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Track every persisted editable field, including variants, textOnly, custom fields, handler, and schedule. Implement recoverable local draft state scoped to user + workspace + post/new-draft identity, with a schema version, explicit restore/discard, and cleanup on successful save. Do not persist credentials or inline media bytes. Integrate a leave choice with internal links, workspace switching, and history navigation; retain beforeunload for document exits. Prefer existing navigation boundaries over global router monkey-patching. Saving must finish successfully before completing requested navigation.

**Acceptance/regression scenario:** Internal Calendar/Home links, workspace switching, browser Back, reload, and close cannot silently lose meaningful edits. Test override-only edits and custom-field-only edits. Keep editing cancels navigation; failed Save draft leaves the user in place; successful save clears recovery state. Restoring in another user/workspace never exposes the previous draft. Storage unavailable still leaves an explicit navigation guard.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 3: Repair sidebar dock lifecycle

**Audit finding:** 3. **Modify:** `src/components/SidebarDock.tsx; src/components/AppShell.tsx; src/components/ChannelsLayout.tsx`. **Regression files:** `e2e/selection.spec.ts; e2e/phone.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Expose the actual mounted dock element through reactive shell context/callback ref. Rebind when collapse/expand removes or creates the target. When no target exists, render children in their inline location. Do not retain detached DOM nodes. Preserve filter selections and URL state through docking changes; keep screen controls available in collapsed mode.

**Acceptance/regression scenario:** On analytics, posts, reports, and ads: collapse/expand repeatedly without navigation. Channel/date/actions stay usable and only one copy is visible. Start with persisted collapse. Resize across 1024px in both directions. No stale portal, missing tools, duplicate IDs, or lost selection.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 4: Contain dialog and drawer focus

**Audit finding:** 5. **Modify:** `src/components/Dialog.tsx; src/components/AppShell.tsx; src/components/ConfirmProvider.tsx`. **Regression files:** `e2e/accessible.spec.ts; e2e/phone.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Share modal behavior for dialogs and mobile navigation: initial focus, Tab/Shift+Tab containment, Escape, inert background, body scroll lock, and return focus. Filter disabled/hidden controls out of focus candidates; focus the panel when it has no available control. Avoid resetting focus on every changing onClose callback. Keep least-destructive initial focus for confirmations. Restore background/scroll correctly with stacked overlays.

**Acceptance/regression scenario:** Cycle focus forward/backward in confirmation, report customization, command palette, and mobile drawer. It never escapes to background controls. Escape restores focus to opener. Empty/disabled-only dialog receives focus. Opening a second overlay and closing it does not unlock the background prematurely.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 5: Make week-calendar creation keyboard and touch accessible

**Audit finding:** 6. **Modify:** `src/components/CalendarWeek.tsx; src/app/globals.css`. **Regression files:** `e2e/accessible.spec.ts; e2e/phone.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Remove display:none as the default for focusable creation links. Use opacity/focus-within for hover-capable devices and visible controls on no-hover devices. Preserve the selected slot datetime and give frequently used touch actions generous nonoverlapping hit areas.

**Acceptance/regression scenario:** Without mouse movement, Tab reaches a future slot creation action and Enter opens the correct local datetime. A touch/no-hover viewport exposes the same action. Past slots do not offer creation. Zoom and long labels do not hide the action.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 6: Keep responsive tool disclosures reachable

**Audit finding:** 7. **Modify:** `src/components/PhoneFold.tsx`. **Regression files:** `e2e/phone.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Separate desktop visibility from the phone disclosure state, or subscribe to breakpoint changes so closed details cannot coexist with a hidden summary on desktop. Preserve the user's mobile disclosure choice when returning to phone width.

**Acceptance/regression scenario:** Mount at 390px with tools closed; widen to 1440px and verify all tools visible. Close tools on phone and repeat. Shrink desktop to phone and verify a working disclosure. Repeat on reports and calendar.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 7: Make previews destination-aware

**Audit finding:** 4. **Modify:** `src/components/Composer.tsx; src/components/PostPreview.tsx; src/components/FeedPost.tsx; src/lib/network-rules.ts`. **Regression files:** `e2e/compose.spec.ts; e2e/platforms.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Add a named selector for selected preview destinations. Pass the effective message override, effective media after textOnly exclusion, and network type to preview. Preview only selected destinations; fall back deterministically if its selected destination is removed. Use network-appropriate rendering where supported and an explicit approximate-preview label elsewhere. Represent experiments/translations honestly rather than implying a single common caption. Do not change publishing payload semantics.

**Acceptance/regression scenario:** For Facebook + LinkedIn with overrides and media exclusions, each preview matches that destination's submitted content. Verify Instagram required media, Reel/Story, links, no destinations, and deselection. Network is explicitly named. Two sequential posts have fresh previews. All EN/FR strings and phone controls are available.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 8: Retain field-specific composer errors

**Audit finding:** 8. **Modify:** `src/components/Composer.tsx; src/components/blockerMessage.ts`. **Regression files:** `e2e/compose.spec.ts; e2e/accessible.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Keep the returned fields map rather than reducing it to one string. Map known API keys to controls, add inline errors with aria-invalid/aria-describedby, expand disclosures containing invalid fields, and focus the first invalid field after failed submission. Show unknown/global errors in an accessible summary. Preserve all draft values. Clear only resolved/stale errors when fields change.

**Acceptance/regression scenario:** Return multiple validation errors including one in a collapsed section. Both messages are visible/associated; first invalid field receives focus and is not covered by chrome. Unknown field names use the summary safely. Network failure yields recovery guidance, no cleared inputs, and a usable retry button.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 9: Keep mobile composer actions accessible while scrolling

**Audit finding:** 9. **Modify:** `src/components/Composer.tsx; src/components/SplitButton.tsx; src/app/globals.css`. **Regression files:** `e2e/phone.spec.ts; e2e/compose.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Create a mobile persistent action region using existing buttons, with save draft, explicit action name, selected-destination count, and timing/timezone summary. Add safe-area padding and content clearance. Keep desktop placement coherent. Ensure no duplicate IDs or duplicate submission handlers; preserve contributor approval wording, disabled blockers, upload/pending states, and undo/results.

**Acceptance/regression scenario:** At 390px with long caption, multiple attachments, expanded options, and French text: primary actions remain reachable; last content and focused inputs are unobscured. Keyboard viewport changes do not hide recovery controls. One tap produces exactly one request. Schedule, Queue, Now, and Submit for approval describe the actual action.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 10: Expose destination blockers without hover

**Audit finding:** 10. **Modify:** `src/components/TargetPicker.tsx; src/components/blockerMessage.ts`. **Regression files:** `e2e/compose.spec.ts; e2e/phone.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Keep names/account lines concise but render the unavailable reason separately with wrapping text. Add a permitted reconnect/details link where a concrete action exists. Do not rely on title for essential explanations or expose raw technical diagnostics. Retain the ability to untick a destination disabled after an existing post was created.

**Acceptance/regression scenario:** Long destination names and long translated blockers remain readable at phone width without page overflow. Keyboard/touch users can read reasons. Blocked destinations cannot be newly selected; existing blocked selections can be removed. No forbidden reconnect action appears for a restricted role.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 11: Make getting-started steps achievable for each role

**Audit finding:** 11. **Modify:** `src/components/GettingStarted.tsx; src/app/(app)/dashboard/page.tsx; src/lib/role-access.ts; src/lib/constants.ts; src/lib/modules.ts`. **Regression files:** `tests/role-access.test.ts; e2e/screens.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Pass role, allowed modules, client access, and relevant capabilities into checklist construction. Reuse existing authorization helpers without changing privileges. Filter steps by both route availability and write capability. Base completion denominator on shown steps. Do not mark Connect complete solely because an unusable target exists without explaining readiness. Clients may land on Calendar rather than Dashboard: do not add dashboard access just for onboarding.

**Acceptance/regression scenario:** Owner/admin/editor/contributor/viewer each see only achievable steps. Disabled modules have no suggested actions. Empty step list yields a sensible empty/hidden state, not division by zero. Client onboarding, if shown on its permitted landing screen, stays within allowed routes. No API permission changes.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 12: Align sign-in with registration policy

**Audit finding:** 12. **Modify:** `src/components/AuthForm.tsx; src/app/(auth)/login/page.tsx; src/app/(auth)/register/page.tsx; src/lib/auth.ts`. **Regression files:** `tests/auth-form.test.ts; e2e/signed-out.spec.ts; e2e/invite.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Resolve registration policy server-side and pass a boolean/policy prop to AuthForm. On invitation-only installations, replace generic signup CTA with accurate invitation guidance. Retain valid invitation registration, first-run setup, and existing return/invite parameters. Avoid revealing invitation existence or sensitive policy internals to anonymous users.

**Acceptance/regression scenario:** Closed registration: no generic Create one dead end. Open registration: normal signup link remains. Valid team/client invitations still reach registration with correct email/workspace context and return destination. Server-rendered auth safety and pending behavior remain intact.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 13: Give password recovery an actionable support path

**Audit finding:** 13. **Modify:** `src/app/(auth)/forgot-password/page.tsx; src/lib/brand.ts; src/lib/operator.ts; src/lib/settings/definitions.ts`. **Regression files:** `e2e/signed-out.spec.ts; tests/configuration-docs.test.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Use an existing public support contact if available. If absent, add a narrowly scoped optional public support setting through the existing registry and root configuration UI, documenting its exposure. Validate contact/link values. Display it in the email-disabled fallback; keep the normal recovery flow when email is enabled. Do not invent an operator address or silently change SMTP settings.

**Acceptance/regression scenario:** Email enabled: normal recovery form. Email disabled + configured contact: visible working support link. No configured contact: honest fallback and report configuration required. No secret/credential exposure or user-enumeration regression. Configuration remains root-controlled. Verify EN/FR.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

### Task 14: Report failed calendar moves

**Audit finding:** 14. **Modify:** `src/components/CalendarDrag.tsx`. **Regression files:** `e2e/compose.spec.ts; e2e/phone.spec.ts` (extend existing specs; add narrowly named cases).

**Implementation contract:** Catch rejected fetch, show translated actionable failure status, keep the original placement until confirmed success, and allow retry using the intended date/time. Prevent concurrent moves while pending and clear busy in every path. Treat a server-accepted move whose response was lost carefully: refresh authoritative state before asserting that it failed or retrying blindly.

**Acceptance/regression scenario:** HTTP validation failure, offline/rejected fetch, delayed response, and successful move all terminate pending state with truthful feedback. Failed move does not silently jump dates. Retry works and preserves intended timezone/minutes. Success refreshes position. No unhandled promise rejection.

- [ ] Confirm the finding on the current checkout and record reproduction/baseline evidence.
- [ ] Add the regression scenario above using existing test helpers and fixtures.
- [ ] Run the focused regression and confirm it fails for the audited behavior.
- [ ] Implement the contract above; add paired EN/FR copy when needed.
- [ ] Run the regression and `npm run typecheck`; inspect related behavior and `git diff --check`.
- [ ] Record actual results and review the task diff before moving on.

## Secondary design work after defects

These are recommendations rather than proven defects. Keep them separately reviewable; do not turn them into a broad redesign while fixing P1 issues.

- Show a compact active-scope summary (workspace, channels, date window) near the title even with a collapsed sidebar.
- Improve 10px rail labels and very small network marks; use readable text labels and generous touch targets. Preserve recognizable network identity.
- Keep technical scheduling choices in progressive disclosure; retain editability/reliability consequences and explicit timezone in review.
- Add product identity, configured support, and explicit EN/FR choice to public entry pages using existing branding/locale mechanisms. Do not expose root-only configuration.
- Review empty/restricted/not-synced states with a single achievable next action.

## Final delivery contract for the fixing agent

Return a finding-by-finding table: finding number, verified defect/already fixed/not reproduced/configuration needed, changed files, regression case, and result. Include exact commands run, test failures/skips, screenshots at 1440px and 390px of changed populated flows, and outstanding configuration decisions. Test EN/FR and all three themes; verify keyboard focus, long user content, slow/offline requests, role differences, and viewport transitions. Do not claim authenticated production verification without an available authenticated session. Public screenshot checks do not prove authenticated behavior.

Report publication/deployment status explicitly. If the user authorized code fixes only, deliver the local changes and verification evidence without deploying. For live configuration requirements, prepare the concrete setting and reviewable UI first; request only the missing configuration or consequential action when necessary.

## Consistency and standards — required extension

This section extends the 14 defect tasks with a product-wide consistency pass. Apply it to changed screens first, then inventory all user-facing screens. These checks are not a claim that the app currently conforms to an accessibility standard.

### Evidence-backed consistency gaps

| ID | Source at audited baseline | Gap | Required resolution |
|---|---|---|---|
| C01 | Composer.tsx format/timing controls; DesignEditor.tsx size controls | Buttons declare role=radio but do not implement radio-group arrow navigation or a single tab stop. | Use native radios or complete APG radio behavior; do not attach radio roles to ordinary buttons without the keyboard contract. |
| C02 | StatusBadge.tsx POST_COLOURS/TARGET_COLOURS | Scheduled posts use blue; scheduled_remote targets use violet, also used for pending approval. | Make scheduled/native scheduled share the scheduling semantic color; preserve their distinct text. Reserve violet for review. Confirm the shared status vocabulary across calendar, list, approvals, dashboard, and reports. |
| C03 | GettingStarted.tsx SVG strokes versus globals.css theme tokens | The progress ring hardcodes Facebook blue and grey instead of theme roles. | Use theme variables; distinguish functional network colors and media/content colors from product chrome. Do not blindly replace network identity or user-selected design colors. |
| C04 | AppShell.tsx main landmark | No skip-to-main link exists in the audited shell. | Add a visible-on-focus bypass link, stable main target, and focus behavior that works on route transitions. Apply the same pattern to root shell where appropriate. |
| C05 | SettingsNav.tsx versus AnalyticsTabs.tsx/SubTabs.tsx | Settings use a horizontally scrolling mobile strip; analytics uses a select; other local navigation uses pills. | Define when to use each pattern based on number of destinations and width. Keep equivalent behavior/active state and avoid hiding important routes behind an unexplained fade. Not every navigation must look identical. |
| C06 | InfoTip.tsx | Help is a focusable role=img with hover/focus text and no explicit touch toggle/dismiss behavior. | Use a consistent help/popover pattern with touch activation, Escape dismissal and correct semantics. Refactor callers that would otherwise create nested buttons. Do not make essential information tooltip-only. |

### Standards hierarchy

1. Direct user scope and authorization.
2. Current repository product constraints and contracts.
3. Accessibility requirements; WCAG 2.2 AA is the target for complete user journeys.
4. Shared tokens/components and documented interaction contracts.
5. Local screen exceptions, only when the task requires them and the reason is documented.

WAI-ARIA APG patterns are implementation guidance, not a conformance certificate. Repository visual conventions must not override accessibility requirements. Automated checking covers only part of the acceptance process.

### Visual system contract (product rules)

| Area | Standard |
|---|---|
| Page frame | Keep area rail/contextual sidebar and utility-only top bar. Use a stable content width and shared horizontal padding. Scope controls remain reachable when navigation folds. |
| Page heading | ScreenHeader is the default: one h1, existing text-xl / sm:text-2xl font-semibold scale, concise subtitle, grouped actions. Avoid custom heading variants without a functional reason. |
| Typography | System font stack; ordinary UI text uses existing text-sm/text-[15px] roles; captions use text-xs. Tiny rail/network labels are supplemental, never the only way to identify a task or network. Numeric columns use nums. |
| Spacing | Use the existing Tailwind spacing scale. Standard card padding p-4 sm:p-5; inter-section rhythm gap-6/space-y-6; compact dense lists may use smaller documented spacing. Avoid arbitrary values for routine spacing. |
| Surfaces | Reuse card/card-viz, existing rounded-lg/xl roles and shadow-surface. Pill shape is for segmented controls, chips and badges; ordinary actions use shared button shape. |
| Color | Use brand/slate/status tokens in product chrome. Brand accent and button fill retain distinct accessible roles. Facebook, Warm, and Dark must all work. Network identity, charts and authored media use their own established tokens/semantics. |
| Actions | btn-primary = main action; btn-secondary = supporting action; btn-ghost = tertiary; destructive variants identify consequences with words. Group a single main action per task region; avoid competing main actions. |
| Icons | Use Icon and NetworkMark; standard icon sizes by context. Decorative icons are hidden from assistive technology. Essential icon-only controls have a named label and a generous hit target. |
| Forms | Reuse input/input-sm/label/hint/error-text. Labels are persistent and clickable, hints are associated, units and required/optional conventions are consistent. Compact controls cannot become illegible on mobile. |
| Tables/charts | Reuse data-table and chart frames, consistent number alignment, readable headers, units/window/freshness context, table alternative, and internal horizontal scroll for genuinely two-dimensional content. |

### Interaction contract

- Navigation destinations are links; actions are buttons. Active navigation has aria-current. Radio choices, tabs and ordinary segmented buttons use different semantic/keyboard contracts; matching appearance does not make them interchangeable.
- Follow APG modal/radio behavior for the custom widgets. Never make a selection dependent only on hover, color or drag. Drag operations retain an ordinary edit alternative.
- Async actions expose pending, success, partial success, HTTP failure, and transport failure. Keep user input on failure. Pending prevents duplicate writes; success tells the user what changed and where to go next.
- Use consistent feedback placement and tone. Field errors stay with fields; task-level outcomes stay near their task. Nonurgent outcomes use status announcements; urgent failures use alerts judiciously. Clear stale outcomes when a new task starts.
- Confirmations name the action and consequence. Use explicit cancel alternatives when Cancel is ambiguous. Preserve useConfirm and undo flows; do not add confirmation to harmless navigation or every reversible edit.
- URL state carries shareable filters/views/pagination; local transient state handles open menus and draft edits. Preserve scope across compatible screens, but clear incompatible view-specific filters.
- Search/reset/bulk-selection language states its scope. A selected destination should not vanish because of search. Disabled choices explain why and provide a permitted next step.
- Menus, popovers and disclosures share Escape/outside-close behavior where appropriate, focus restoration, mobile reachability, and clipping rules. Avoid background interactions through an overlay.

### Vocabulary and bilingual copy contract

Create a small terminology matrix in docs/ai/DESIGN.md using existing translations as the starting point. Review EN and FR together; do not rename database enums or API fields solely to standardize labels.

- Distinguish Workspace (client container), Account/profile (login/connection identity), Channel/destination (publishing target), and Facebook Page (network-specific object). Stop using these interchangeably in the same journey.
- Use a stable verb for each operation: Save draft, Schedule, Add to queue, Publish now, Submit for approval, Retry failed, Disconnect, Remove. Distinguish removing a local record from deleting a published platform post.
- Sentence case, short explicit labels, consistent punctuation/loading ellipsis, no unexplained acronyms. Error copy states what happened and how to recover.
- Pair message keys/placeholders and count plurals. Localize dates, numbers and currencies; always disambiguate scheduling timezone. Let French text wrap rather than shrinking it or relying on title attributes.
- Help/support should appear in a predictable location across public/restricted screens. A missing configuration is not the same as an empty list or lack of permission.

### Accessibility acceptance target

Target [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/): text contrast 4.5:1 (large text 3:1), applicable non-text contrast 3:1, keyboard access, visible/unobscured focus, 320 CSS px reflow with applicable exceptions, and 200% text resizing. Minimum pointer targets are 24×24 CSS px or qualify for a specified exception; adopt 44×44 as the product preference for frequent touch controls. Include field error identification, labels, page language, and status announcements.

These values are acceptance criteria, not evidence of measured passes. Measure actual color pairs in every theme. Inspect full journeys with keyboard and assistive technology. Use [APG modal guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [APG radio guidance](https://www.w3.org/WAI/ARIA/apg/patterns/radio/) for custom widgets.

### Task 15: Normalize shared visual primitives and status semantics

**Modify:** src/components/StatusBadge.tsx, src/components/GettingStarted.tsx, src/components/ScreenHeader.tsx, src/app/globals.css, docs/ai/DESIGN.md, affected screen callers.

- [ ] Inventory heading, card, action, and status variants across changed screens; record purposeful exceptions.
- [ ] Add theme/status regressions for scheduled versus review semantics and progress-ring token usage.
- [ ] Replace the hardcoded progress-ring chrome colors; align native/app scheduling status colors without losing labels.
- [ ] Normalize callers to existing primitives without a mass component rewrite.
- [ ] Verify populated screens in Facebook/Warm/Dark and EN/FR; measure contrast and inspect focus/disabled styles.

**Done when:** Identical statuses/actions carry stable semantics across screens; changing the theme reaches all affected product chrome. Missing values, null metrics and unknown statuses never read as invented zeroes or an unexplained blank.

### Task 16: Complete segmented-control semantics and skip navigation

**Modify:** src/components/Composer.tsx, src/components/DesignEditor.tsx, src/components/AppShell.tsx, src/components/RootShell.tsx; regression e2e/accessible.spec.ts.

- [ ] Add failing tests for radio Arrow keys, single Tab entry, checked-state announcements, and skip-to-main.
- [ ] Use native radios or implement the documented radio keyboard pattern. Keep tabs/links/buttons semantically appropriate.
- [ ] Add skip links with stable main targets and visible focus.
- [ ] Verify keyboard, disabled options, route changes, modal focus, and EN/FR labels.

**Done when:** Keyboard users can change format/timing/design size predictably and bypass repeated shell navigation. Tests check behavior, not only presence of ARIA attributes.

### Task 17: Standardize local navigation and help

**Modify:** src/components/SettingsNav.tsx, src/components/AnalyticsTabs.tsx, src/components/SubTabs.tsx, src/components/InfoTip.tsx, relevant callers; regression e2e/phone.spec.ts and e2e/accessible.spec.ts.

- [ ] Inventory long local navigation and help patterns; map them to documented responsive rules.
- [ ] Add failing tests for mobile route discovery, long French labels and touch/keyboard help activation.
- [ ] Improve settings mobile navigation without removing permitted routes; preserve active state and query context.
- [ ] Introduce consistent tooltip/popover behavior and remove nested-interactive callers if necessary.
- [ ] Verify Escape, focus return, touch, scroll-container clipping and desktop/mobile transitions.

**Done when:** All permitted local destinations and help content are discoverable without hover; no clipped popover or inaccessible nested button remains in changed callers.

### Task 18: Normalize terminology, forms and feedback

**Modify:** messages/en.json, messages/fr.json, docs/ai/DESIGN.md, affected components; regression tests/locale.test.ts and relevant e2e flows.

- [ ] Build the terminology matrix and inventory mismatches with file/key locations.
- [ ] Standardize equivalent labels and consequences; preserve distinctions between materially different operations.
- [ ] Check shared pending/success/error/empty/restricted patterns across composer, connections, calendar, reports and onboarding.
- [ ] Verify message parity/plurals, locale formatting, assistive associations and long French content.

**Done when:** The same operation is named consistently, every refusal explains an achievable next step, and editorial UI avoids root-only technical details.

### Task 19: Enforce consistency through a reusable review matrix

**Create:** docs/ai/UI_CONSISTENCY_CHECKLIST.md. **Modify:** applicable existing e2e specs and docs/ai/DESIGN.md.

- [ ] Record each component's visual, semantic, keyboard, feedback and responsive contract plus allowed exceptions.
- [ ] Add meaningful regressions for C01–C06, reuse tests from Tasks 1–14, and avoid duplicate superficial snapshot checks.
- [ ] Evaluate populated workflows at 320/390/768/1024/1440px, 200% text resizing, zoom/reflow, all themes and both languages; include viewport transitions.
- [ ] Run accessibility automation if available, then keyboard and screen-reader review of the changed complete journeys.
- [ ] Deliver an issue matrix with source, rule, severity, fix, screenshot/test evidence, and unresolved exceptions.

**Done when:** Every audit finding and C01–C06 has an explicit disposition. Report measured failures/skips and manually unchecked criteria separately. Do not claim WCAG compliance from an automated scan or this checklist alone.


## Internal app standardisation — shared logic, features and visuals

### Objective and boundary

Standardise how the app implements equivalent capabilities, not just how screens look. A fix to a shared workflow should improve every participating screen. Preserve domain differences: publishing, invitations, uploads, analytics refresh, and moderation do not have identical side effects or retry safety.

This is an incremental consolidation specification. The audited source already has shared modules; extend them before adding replacements. Repeated code is an extraction candidate, not proof of a defect. Confirm equivalent semantics before merging implementations. Do not replace the app with a generic CRUD framework, universal schema-driven page generator, global client store, or new component library.

### Existing shared foundations to preserve

| Concern | Existing authority | Standardisation rule |
|---|---|---|
| API responses | src/lib/api.ts: route, handleApiError, ApiErrorBody | Preserve `{error, fields?, traceId?}`. Client helpers must be browser-safe and must not import this server module or Prisma. |
| Domain errors | src/lib/errors.ts: AppError and errors | Keep translation-key domain errors and generic handling of unexpected exceptions. Do not expose secrets/raw diagnostic context in editorial feedback. |
| Roles/capabilities | src/lib/constants.ts: CAPABILITIES and can-functions; src/lib/role-access.ts | Compose capability, screen, module and ownership checks. UI explanations derive from policy; server enforcement remains mandatory. |
| Workspace/page scope | src/lib/page-access.ts; src/lib/page-filter.ts: loadPageFilter | Every relevant list/export/action applies authorized scope. User-selected filters can narrow scope, never widen it. |
| Selection | src/lib/selection.ts; PagesSidebar; ChannelsLayout; SidebarDock | One selection/query model per workspace; preserve network/group/channel behavior across compatible screens. |
| Publishing rules | src/lib/posts.ts; src/lib/network-rules.ts; scheduler modules | Keep server validation authoritative; derive client warnings and preview inputs from compatible shared pure logic. Never move publish side effects into presentation helpers. |
| Dates/ranges | src/lib/time.ts; src/lib/date-range.ts; DateRangePicker | Store UTC, input/display workspace-local time, explicit locale. Keep windowed and unwindowed analytics distinct. |
| Pagination | src/lib/paging.ts; Pagination; QuerySelect | One parsing/count contract; reset page on filters that change the result universe. Preserve unrelated URL scope. |
| Domain presentation | StatusBadge; NetworkMark; FeedPost; PostPreview; blockerMessage | Share status/network/content interpretation while retaining context-specific layouts and truthful payload previews. |
| Visual primitives | ScreenHeader, EmptyState, Dialog, ConfirmProvider, Icon, chart frames; globals.css | Use shared tokens and primitive contracts; consolidate repeated variants where behavior is equivalent. |
| Runtime settings | src/lib/settings/definitions.ts and index.ts | Extend the registry; do not introduce a second settings source or embed environment reads inside UI. |
| Localization | messages/en.json, messages/fr.json; src/i18n | Shared vocabulary/formatting contracts, contextual messages where necessary. No new parallel translation system. |

### Observed consolidation candidates

- ConnectionsClient, FeedsClient, TasksClient and TeamClient each implement their own request/pending/error/refresh flow. Feeds retains a first field error; Connections primarily consumes a general error; Tasks uses a boolean error flag. Consolidate transport parsing and lifecycle conventions while retaining operation-specific consequences and partial-result handling.
- QuerySelect rewrites a filter parameter without resetting pagination; AnalyticsTabs explicitly clears view-scoped parameters. A shared URL update policy should state which keys survive each kind of transition, rather than leaving that decision to each control.
- Shell navigation and GettingStarted independently determine available actions. Reuse capability/module/route evaluation so onboarding and page actions cannot invite operations the server denies.
- Status and content presentation exist across posts, calendar, dashboard, approvals and reports. Inventory actual duplicated mappings before extracting; do not assume all views render the same payload.
- Role/scoping, network rules, date arithmetic, API error handling and settings already have shared modules. Treat those as consolidation anchors, not code to bypass.

### Required shared contracts

**Transport and mutations:** A browser-safe typed request helper distinguishes HTTP errors, transport errors, aborted requests, malformed bodies and valid empty responses. Preserve field errors and safe diagnostic references. Pending is scoped to an operation/resource, not one global boolean. Refresh/navigation happens only after a confirmed outcome; raw transport code does not navigate. No automatic retry for non-idempotent writes, publishing, sending messages, invitations or uploads. Domain-specific partial success stays in its feature layer.

**Forms:** Consistent initial values, dirty detection, field-error association, pending state, recoverable failure, successful-save baseline and reset behavior. Draft persistence is opt-in and scoped; not every form stores sensitive data locally. Do not store credentials, tokens or account security fields in draft recovery. Reuse a small behavior helper only where at least two real forms need the same contract.

**Policies:** Define action availability from role + module + workspace status + page scope + ownership + resource state. Keep a reason for disabled/hidden actions when needed. The same domain rule informs composer/list/calendar/approval controls and is independently enforced server-side. Do not convert client policy objects into an authorization boundary.

**Post/destination content:** Shared pure resolution of common text versus destination override and media versus text-only exclusion. Publishing inputs, warnings and previews agree. Model approval, native scheduling, editing restrictions and partial outcomes explicitly; avoid generic booleans that erase distinct states.

**Query/scope:** Explicit update semantics for filter, view, sort, pagination, date and channel changes. Preserve scope, clear invalid page numbers, and support bookmarks/back navigation. Use existing selection/page-filter logic; never trust remembered client selection as authorization.

**Feature scaffolding:** Shared layout/toolbar/filter/feedback/empty/pagination building blocks with composition. Feature-specific server queries and mutations stay in their domain modules. A screen can reuse a layout without sharing another feature's permissions or operations.

**Visual contracts:** Shared hierarchy, spacing, actions, statuses, input states, overlays, lists, tables and charts. Behavioral variants have named intent and documented defaults. Prefer composition over dozens of boolean props and conditional feature branches in universal components.

**Feature parity:** Maintain a matrix of which operations are available from Composer, Posts, Calendar, Queue, Approvals, Dashboard and Reports. Differences must follow role/resource/network constraints or a deliberate product decision. Reusing a button never silently changes what the operation does.

### Task 20: Inventory shared behavior and assign ownership

**Create:** docs/ai/INTERNAL_STANDARDISATION.md.

- [ ] Build a screen × feature matrix covering scope, filters, date handling, content preview, create/edit, scheduling, review, retry, bulk actions, export, feedback and permission behavior.
- [ ] List duplicate implementations with concrete file/symbol locations, equivalent/different semantics, chosen existing owner and migration callers.
- [ ] Document server-only, client-safe and presentation boundaries; identify imports that cross them incorrectly.
- [ ] Classify every candidate: reuse existing, extend existing, extract shared, or keep distinct with reason.

**Done when:** Every proposed abstraction has demonstrated callers and an owner. No new framework or dependency is justified solely by a hypothetical future feature.

### Task 21: Consolidate browser request and mutation handling

**Modify:** ConnectionsClient.tsx, FeedsClient.tsx, TasksClient.tsx, TeamClient.tsx; introduce a small client-safe transport module only if inventory confirms no existing equivalent. **Tests:** a focused helper test plus feature browser regressions.

- [ ] Pin the existing API error shape and field-error preservation in tests.
- [ ] Define and test typed transport outcomes for HTTP failure, network failure, abort, malformed JSON and successful empty response.
- [ ] Migrate one representative feature first, then the remaining equivalent callers; keep per-operation pending keys and domain-specific success/partial handling.
- [ ] Verify no automatic write retries, duplicate requests, leaked diagnostics or unconditional success refresh.

**Done when:** Equivalent failures/pending states behave consistently; every caller retains its actual operation outcome. Avoid converting all endpoints to a new envelope merely to simplify the client.

### Task 22: Consolidate form lifecycle and recovery

**Modify:** Composer.tsx, ReportBuilder.tsx and representative SettingsClient forms; integrate earlier Tasks 1, 2 and 8 rather than reimplementing them.

- [ ] Inventory fields/initial values/dirty/save/error/reset behavior and sensitive-field exclusions.
- [ ] Extract only equivalent validation-feedback and dirty-baseline behavior; keep composer draft recovery and security forms distinct.
- [ ] Test field-only edits, failed saves, changed server initial values, workspace changes and successful saves.
- [ ] Verify discarded/cancelled form changes have explicit behavior, with no stale previous-resource state.

**Done when:** Saving, failing, resetting and leaving forms follow documented contracts; stored drafts never include secrets or cross scope boundaries.

### Task 23: Reuse policy decisions across feature entry points

**Modify:** existing constants/role-access/modules/page-access owners and their UI consumers; preserve server handlers.

- [ ] Inventory repeated role comparisons, module checks and resource-state action guards.
- [ ] Reuse existing helpers or add narrow pure policy composition where truly duplicated.
- [ ] Migrate navigation, onboarding, composer, post list, calendar and approval actions incrementally.
- [ ] Run policy/tenant-isolation regressions for restricted roles, own versus others' posts, disabled modules and unavailable destinations.

**Done when:** Same operation/resource/context produces the same availability/reason across entry points, and API/scheduler protections remain intact. Do not change the approved capability table.

### Task 24: Consolidate effective destination content and action semantics

**Modify:** Composer.tsx, PostPreview.tsx and existing pure domain modules; integrate Task 7.

- [ ] Trace actual server interpretation of overrides/media exclusions before selecting the shared helper boundary.
- [ ] Test common caption, empty override, target override, media exclusion, deselected target, translation/experiment variants and network limitations.
- [ ] Reuse client-safe pure resolution in preview/warnings; reconcile with server payload resolution without importing server modules into clients.
- [ ] Review edit/retry/cancel/publish/approve controls across post surfaces against existing domain restrictions.

**Done when:** Shared logic represents the actual content and allowed actions, with per-network exceptions preserved. No scheduler behavior changes from a visual consolidation.

### Task 25: Standardise selection, filter and date state

**Modify:** QuerySelect.tsx, AnalyticsTabs.tsx, PagesSidebar.tsx, DateRangePicker.tsx, existing selection/date-range/paging modules and compatible screen consumers.

- [ ] Document update rules: filters/view changes reset page; page changes preserve filters; incompatible view parameters are removed; authorized channel scope persists.
- [ ] Add tests for stale page numbers, bookmarked URLs, Back/Forward, group/network/channel combinations and workspace switching.
- [ ] Route equivalent controls through existing shared URL/scope helpers; keep date-window constraints per feature.
- [ ] Verify DST boundaries, workspace-local scheduling and locale display using existing time tests.

**Done when:** The same scope/filter changes behave predictably across screens without widening access or misrepresenting unwindowed data.

### Task 26: Standardise shared feature presentation

**Modify:** existing shared primitives and confirmed duplicate callers across posts/calendar/dashboard/approvals/reports/connections.

- [ ] Build a component catalog of owners, props, states, accessibility and responsive contracts.
- [ ] Consolidate repeated feedback, toolbars, empty states, status mapping and common post metadata through composition.
- [ ] Preserve intentional differences such as compact calendar chips, detailed post cards and print reports.
- [ ] Verify cross-screen content/status consistency, French expansion, themes, pagination and populated mobile layouts.

**Done when:** Fixes to common presentation propagate through actual shared components. Feature components do not grow unrelated conditionals or hide server/domain behavior behind styling props.

### Task 27: Prove feature parity and prevent renewed duplication

**Modify:** docs/ai/INTERNAL_STANDARDISATION.md, docs/ai/UI_CONSISTENCY_CHECKLIST.md, focused regression suites.

- [ ] Fill the feature parity matrix with implemented/unsupported/role-limited states and explicit reasons.
- [ ] Add cross-entry-point regressions for shared policies, destination content, scope and feedback, using real production classes/modules with isolated fixtures.
- [ ] Document extension instructions: which shared owner to update for a new action/status/network/filter and which callers/tests must be checked.
- [ ] Remove superseded implementations only after all callers migrate and regressions pass.
- [ ] Deliver a before/after ownership map, migrated callers, preserved exceptions and actual test results.

**Done when:** The agent can demonstrate fewer independent implementations of equivalent behavior, consistent features and visuals, and unchanged publishing/access contracts. File-count or line-count reductions alone are not success criteria.

### Execution sequencing and migration rules

Complete Task 20 before selecting extraction boundaries. Apply the P1 repairs early, then combine each later audit fix with its owning standardisation task. Tasks 21–26 are migration streams, not an instruction to rewrite the app in one patch. Each stream should prove one pilot feature, migrate equivalent callers, then remove obsolete code. Task 27 checks the whole result.

Update the final finding report to cover original findings 1–14, consistency gaps C01–C06, and standardisation Tasks 20–27. Label newly discovered defects separately from refactoring opportunities. Report retained exceptions with rationale instead of forcing incompatible features into a shared abstraction.


## Part II — Complete audit and evidence

# MS Social Pilot — design and UX audit

Date: 13 October 2026. Repository: https://github.com/sebmouad/MS-Social-Pilot

Audited commit: `6cc5528325b55c108a55539e431b51589e97a914`.

## Assessment

The product has a coherent visual foundation: shared surfaces and buttons, theme tokens, useful empty-state primitives, explicit destination blockers, bilingual copy, workspace timezone hints, and chart table alternatives. The main weaknesses are interaction reliability and confidence before publishing. Repair those before investing in a broad visual redesign.

The current shell has a 76px area rail, a 240px contextual sidebar, utility header, and screen filters moved into the sidebar. This improves grouping, but makes essential controls depend on shell state. The composer has useful progressive disclosure, yet its preview cannot represent all the content it sends.

## Scope and evidence

- Read the current shell, composer, previews, destination picker, onboarding, connections, calendar, analytics navigation, report builder, chart frame, authentication, theme CSS, and accessibility/browser test coverage.
- Inspected repository screenshots for composition and hierarchy. They show an older shell; they are not proof of the current authenticated UI.
- Inspected production sign-in, registration-closed, and password recovery pages in the browser. Checked sign-in and recovery at 390 × 844; desktop sign-in at the default 1280 × 720 viewport.
- Production had no authenticated session in the available browser. Authenticated findings below are source-backed; their reproduction instructions are proposed checks, not claims of completed browser reproduction.
- No account creation, publishing, production configuration, or application source changes. No authenticated end-to-end suite executed; this report does not certify accessibility compliance or test success. Production commit parity with the cloned repository was not established.

Priority: P1 = risk of lost work, wrong publication, or essential controls disappearing. P2 = substantial usability or accessibility friction. Recommendations are design judgments, not measured user-study results.

## Findings

### 1. P1 — Destination overrides carry into the next post

**Source:** `src/components/Composer.tsx:528–565`, with outgoing overrides at `:461–462`.

After successful creation, the composer clears the main message and media but does not clear `variants` or `textOnly`. The next post can reuse an old destination caption or silently omit its media. The partial-failure branch also returns before resetting stagger, caption-test, and translation state.

**Check:** Create a post for two destinations with an override and a text-only destination; create another in the same composer session. Inspect the second request and resulting destination content. Repeat after partial success.

**Fix:** Reset all post-specific state after creation, including overrides, media exclusions, location/background/custom fields and experiment state. Keep destination/time defaults only as an explicit product decision. Preserve failure outcomes separately from the next draft.

### 2. P1 — Internal navigation can discard unsaved work

**Source:** `src/components/Composer.tsx:303–326`; navigation links in `src/components/AppShell.tsx`.

The only guard is `beforeunload`, which handles document unloads, not ordinary Next.js client navigation. Clicking Calendar or Home can unmount the composer without warning. Dirty detection also omits destination overrides, text-only exclusions, custom fields, and handler changes when editing.

**Check:** Type a caption, click Calendar, return. Separately modify only a destination override on an existing post and leave.

**Fix:** Add draft recovery/autosave and an in-app leave guard covering links, workspace changes, and history navigation. Track every meaningful edited field. Offer “Save draft”, “Discard changes”, and “Keep editing”.

### 3. P1 — Collapsing the sidebar strands filters in a detached portal

**Source:** `src/components/SidebarDock.tsx:24–32`; `src/components/AppShell.tsx:411–421`.

SidebarDock captures its portal element once and updates only when the media query changes. Collapsing unmounts that element while the portal retains it. Expanding creates a different element that the portal does not discover. Channel selection and screen tools can remain invisible until the screen remounts or the breakpoint changes.

**Check:** Open a docked screen, collapse then expand the sidebar without navigating or resizing. Verify channels, date controls, and screen actions remain usable. Also start with a persisted collapsed sidebar.

**Fix:** Expose the current dock target through shell context or a callback ref; render tools in the content area when the dock is absent. Essential filters should survive every shell state.

### 4. P2 — Preview does not show the actual destination payload

**Source:** `src/components/Composer.tsx:1040–1048`; `src/components/PostPreview.tsx:9–33`.

The preview gets the first selected destination plus the common message/media. It receives no network type, destination caption override, or text-only exclusion. It remains Facebook-shaped for other networks. A user can approve a preview that differs from what will publish.

**Check:** Choose Facebook and LinkedIn, customize one caption, exclude its media, and compare the preview with the outgoing request.

**Fix:** Add a destination preview selector and render each destination’s effective caption, attachments, and relevant network format. Label approximations clearly. Keep the preview adjacent to the content on wide screens and behind a named preview control on phones.

### 5. P2 — Shared modal accessibility is incomplete

**Source:** `src/components/Dialog.tsx:34–48` and `:57–64`; `src/components/AppShell.tsx:459–470`.

Dialog moves focus in and restores it, but does not trap Tab/Shift+Tab or make background content inert. `aria-modal` alone does not implement either behavior. The mobile navigation drawer similarly lacks focus entry/containment/restoration and body scroll locking.

**Check:** Open confirmations, report customization, and the phone menu; cycle forward and backward through every focusable element. Focus must remain inside until close.

**Fix:** Use a robust shared modal primitive, safe initial focus, focus containment, inert background, restoration, and scroll locking. Test nested/stacked overlays as well as empty dialogs.

### 6. P2 — Week-calendar creation depends on hover

**Source:** `src/components/CalendarWeek.tsx:113–117`.

The slot’s plus link starts at `display:none`, then uses `group-hover:flex` and `focus-visible:flex`. A hidden link cannot receive keyboard focus, so focus-visible cannot reveal it. Touch users also lack a dependable visible affordance for selecting a slot. Global New post remains available, but loses this contextual shortcut.

**Fix:** Keep it focusable using opacity and focus-within, and visible on devices without hover. Give each slot a touch-friendly creation action. Validate keyboard and touch without moving the mouse.

### 7. P2 — Responsive tools can disappear after resizing

**Source:** `src/components/PhoneFold.tsx:15–22`.

On mount below 1024px the details element is closed. Resizing wider does not reopen it, while its summary becomes hidden at `lg`. The tools can therefore remain closed with no visible way to open them. The same applies when a user closes the tools and then widens the viewport.

**Fix:** Respond to breakpoint changes, or render desktop tools independently of the mobile disclosure state. Test narrow-to-wide and wide-to-narrow transitions, not only isolated viewports.

### 8. P2 — Composer errors lose field context

**Source:** `src/components/Composer.tsx:493–496` and `:1329–1335`.

The response’s field map is reduced to its first message and displayed in a general alert near the bottom of the right column. The relevant field is neither marked invalid nor focused. On phones, users may need to scroll back through the editor to find what to correct.

**Fix:** Retain field errors; attach them with `aria-invalid`/`aria-describedby`; focus the first invalid field and expand its containing disclosure. Keep an error summary for multiple failures.

### 9. P2 — Primary save/publish actions sit at the end of a long mobile journey

**Source:** `src/components/Composer.tsx:655`, `:1040–1053`, and `:1383–1425`.

DOM order puts the editor and preview before destinations, scheduling, feedback, and actions. The action row has no sticky behavior. As content and options grow, checking the post and then saving requires substantial scrolling.

**Fix:** Use a compact, safe-area-aware action bar with “Save draft” and the explicit send action, plus destination count/time summary. Keep detailed validation nearby and ensure the bar does not cover focused inputs or the last content.

### 10. P2 — Destination blocker explanations are truncated

**Source:** `src/components/TargetPicker.tsx:174–178`.

The account/network line and the reason a destination is unavailable share a single truncated line. The full reason is only in the label’s title, which is unreliable on touch and unavailable on a disabled checkbox’s keyboard focus.

**Fix:** Put the blocker in a wrapping line and offer a named details/reconnect action where appropriate. Users should see why a destination cannot be selected without hovering.

### 11. P2 — Getting-started actions ignore the current role

**Source:** `src/components/GettingStarted.tsx:8–26`; `src/app/(app)/dashboard/page.tsx:157`.

The dashboard supplies workspace/developer state but no role or allowed screens. The checklist can invite a contributor/viewer to manage connections, queue settings, team, or client links that their navigation intentionally withholds. Completion counts also reflect the whole workspace rather than that person’s achievable next steps.

**Fix:** Build steps from the member’s abilities and enabled modules. Show editorial onboarding to writers and client guidance to clients; reserve workspace setup for managers. Verify all roles against the same access rules as navigation.

### 12. P2 — Sign-in advertises registration that production forbids

**Live verified:** `/login` → “Create one” → `/register` → “Registration is closed”.

**Source:** `src/components/AuthForm.tsx:213–218`; `src/app/(auth)/register/page.tsx:35–36`.

A prominent acquisition action leads to refusal on the deployed invitation-only installation.

**Fix:** Pass registration policy to the sign-in UI. Replace the link with invitation guidance or a real request-access path, while retaining invitation-specific registration.

### 13. P2 — Password recovery provides no actionable contact

**Live verified:** `/forgot-password` says the server cannot send email and tells users to ask its operator. Only “Back to sign in” is offered.

The message is truthful, but users who do not know the operator cannot recover through the interface.

**Fix:** Configure email recovery and expose it normally. Until then, display a configured support contact or an existing support path. Provide a next step users can actually complete.

### 14. P2 — Calendar move failures can produce no feedback

**Source:** `src/components/CalendarDrag.tsx:64–81`.

HTTP failures are handled, but a rejected fetch has no catch branch. A connection drop clears the busy flag without a visible failure explanation, leaving users unsure whether the post moved.

**Fix:** Catch transport failures, show an actionable status, retain the original placement until success, and offer retry. Consider undo after a successful reschedule.

## Design recommendations

1. **Preserve the current visual system.** Consistent white surfaces, restrained blue accents, clear status colors and typography are useful foundations. Avoid a cosmetic rebuild before repairing reliability.
2. **Make the composer the primary product experience.** Organize it around Content → Destinations → Timing → Review. Fold experiments/custom fields beneath meaningful labels. Use a destination-aware review and persistent action row.
3. **Separate navigation from active scope.** Keep a visible summary of selected channels, workspace, and date window near the page title even when filtering controls live in the sidebar. Screen tools must remain reachable when the sidebar closes.
4. **Keep scheduling copy outcome-based.** The “who holds the post” distinction matters, but can live under scheduling options with a concise explanation of editability/reliability. Retain the timezone next to time selection and in the final action summary.
5. **Increase small-control readability.** Rail labels use 10px type; network badges at 14px render two-letter marks around 6px. Make labels the main recognition cue, reserve tiny badges as reinforcement, and use generous hit areas for frequent phone actions.
6. **Improve public identity and language choice.** Live sign-in has a generic heading and tagline with no visible product logo/name in the page body, language switch, or support link. Add lightweight branding and a public EN/FR switch. Browser language negotiation is useful but does not replace user choice.
7. **Make empty and restricted states role-specific.** Give each state one achievable next action, named ownership when someone else must help, and clear differentiation between unavailable, disconnected, paused, and not-yet-synced data.

## Recommended order

**First:** Reset post state, protect drafts/internal navigation, and repair sidebar docking. These can cause wrong content, lost work, or disappearing controls.

**Next:** Fix modal/drawer focus, hover-only calendar controls, responsive disclosures, preview fidelity, and inline errors.

**Then:** Improve mobile action placement, role-aware onboarding, blocker explanations, public access/recovery, and transport-failure feedback.

## Acceptance checks before calling the UX ready

- Two consecutive multi-destination posts never inherit captions/media exclusions from one another; repeat with partial publication failure.
- Leaving any dirty composer through navigation, workspace switching, Back, reload, or close preserves work or provides a meaningful choice.
- Collapse/expand and breakpoint changes preserve channels, filters, reporting actions, and selected scope.
- Every modal/drawer contains keyboard focus, restores it, and leaves the background noninteractive.
- Touch and keyboard users can create a week-calendar post at a chosen slot.
- Preview content matches the effective destination payload and explicitly names its network.
- Invalid fields are identifiable, announced, and reachable on a phone.
- Owner, admin, editor, contributor, viewer, and client receive useful permitted onboarding.
- Test English and French, all themes, long captions/names, populated lists, partial failures, slow/offline requests, and narrow/wide transitions.
- Extend browser coverage beyond the current control-name/focus smoke tests. Add the journeys above and automated accessibility checks; do not infer full compliance from the existing suite.


## Part III — Authenticated Chrome observations

# MS Social Pilot — authenticated Chrome audit

Date: 13 October 2026. Target: https://social.newsgeet.com/dashboard

## Scope and evidence

Inspected the user's authenticated Google Chrome session, using native screenshots and accessibility state. The session used the Warm theme and English interface with real connected Facebook channels. Screens inspected: Dashboard, Analytics Summary, Compose, and Calendar Month. Connections navigation was attempted, but capture did not reliably show its contents; it is not counted as inspected.

The production commit was not determined. Findings below concern the observed deployed UI, not proof of parity with the earlier repository baseline. Native screenshots were viewed in tool output; no exportable screenshot files were saved. Intermittent capture failures and user tab changes limited the remaining walk. No publishing, scheduling, saving drafts, uploads, messages, emails, account changes, or channel enable/disable actions were performed.

One temporary caption was entered into an initially empty composer solely to test navigation. It was lost during that test; no post was created. Sidebar collapse was toggled and expansion restored. Channel selection remained on the original single channel. French, other themes, mobile widths, restricted roles, modal focus behavior, network publishing and payload reset were not tested in this authenticated pass.

## Verified defects

### L01 — P1: Internal navigation silently discards a caption

**Observed sequence:** Open Compose. Enter `UX audit — temporary unsaved text`. Confirm the textarea value, 33-character counter, preview text and enabled Schedule action in the accessibility state. Click Calendar. The calendar opens without a leave/save/discard choice. Click New post. The composer returns with an empty textarea, zero characters and the empty preview.

**Impact:** A writer can lose work by navigating to another screen, even though document-unload protection may exist.

**Fix ownership:** Shared dirty/draft/navigation behavior, with Composer and AppShell integration. Existing handoff Tasks 2 and 22.

**Acceptance:** Link navigation, history navigation and workspace switching preserve meaningful edits or offer an explicit save/discard/keep-editing choice. Verify override-only edits and custom-field-only edits as well as captions. A failed save cannot complete the requested navigation.

### L02 — P1: Reopening the calendar sidebar does not restore its tools

**Observed sequence:** Calendar initially contains Month/Week/Channel feed links, Drafts switch, Subscribe, saved-view controls, group picker, channel search and a 1-of-12 selection. Collapse sidebar: these controls disappear. Expand sidebar: Publishing navigation and New post return, but the calendar controls/channel picker remain absent. A subsequent full accessibility snapshot and screenshot show the expanded navigation with an empty area below it.

**Impact:** Users lose the ability to change calendar view and channel scope through the expected controls. The calendar still renders, making the missing tools easy to mistake for an intentional mode.

**Fix ownership:** AppShell / SidebarDock target lifecycle and inline fallback. Existing handoff Tasks 3 and 25.

**Acceptance:** Repeated collapse/expand without navigation preserves all tools and selections. Verify initial persisted collapse, docked Analytics/Reports/Posts, and breakpoint transitions. Do not treat a full reload as the fix.

### L03 — P2: Disabled-destination explanation is visually truncated

**Observed:** Compose shows the disabled test channel with its reason cut off as “Turned off fo…”. The full reason is available in accessibility text/hover help, but the visible row combines network, account identity and blocker in one shortened line.

**Impact:** Users cannot reliably read why a destination is unavailable from the displayed row.

**Fix ownership:** TargetPicker and shared blocker presentation. Existing handoff Task 10.

**Acceptance:** Give blocker text a separate wrapping line. Keep account/name truncation where useful, but do not truncate essential recovery information. Verify long EN/FR messages and touch/keyboard use.

## Live consistency and hierarchy findings

These are observed interface issues and design judgments. Their underlying data/implementation causes were not verified in this browser pass.

### L04 — P2: Analytics repeats summary and detail content

The Summary page contains “What changed”, headline metrics, Trend, Best posts and When posts do best. Later, “This channel in detail” repeats the same findings under “What stands out”, repeats Best posts, and repeats the When posts do best chart. The exact two finding sentences recur.

**Recommendation:** Keep a concise Summary with links or a deliberate disclosure for detail. Give each analytical view a clear responsibility. Reuse the same analytical view model; do not independently recompute equivalent findings in both sections. Preserve advanced detail without forcing users through duplicate content.

**Acceptance:** One summary finding list and one primary best-time/best-post block per visible Summary journey. Opening detail is intentional, preserves selection/date scope and explains what additional evidence it adds. Link to existing standardisation Tasks 24–27.

### L05 — P2: Dashboard and Analytics count different publication universes without an upfront shared explanation

For the selected channel, Dashboard shows Published 0 and “Nothing published yet”. Analytics shows 4 posts and real Facebook content. This can be correct if Dashboard counts app-created posts and Analytics includes externally published posts; the observed numbers alone do not prove a data bug.

**Recommendation:** Make scope visible: “Published through this app” versus “All channel posts”, and reuse a shared scope/source label across cards, lists and reports. Explain empty states accordingly.

**Acceptance:** Users can understand both screens without deducing the distinction from distant help text. Tests use a channel with externally published posts and no app-created posts. Do not alter counts merely to make them match.

### L06 — P2: Navigation and screen names vary for the same area

The rail says Home while the page title says Dashboard. The rail says Publish, contextual heading says Publishing, and page title says Compose. Analytics starts at an Overview sidebar entry while Summary is another subordinate link and the title is Analytics.

**Recommendation:** Define area, screen and view names in one navigation/terminology model. Distinct hierarchy levels may have different names, but breadcrumbs and active entries should make the current location unambiguous. Avoid duplicate synonyms for the same level.

**Acceptance:** A route has a documented area/screen/view identity used by shell, breadcrumb, title, command palette and local navigation. Keep existing route URLs unless migration is necessary. Tasks 18, 20, 26.

### L07 — P2: Dashboard's upper section leaves considerable empty space while the main content continues below

With one selected channel, the channel/ad cards occupy the left of a broad region, while the right remains empty. Statistics and goals appear below this region. The layout has consistent surfaces, but places more emphasis on a small channel inventory than on actionable overview information.

**Recommendation:** Design an intentional single-channel layout and a separate scalable multi-channel arrangement using the same components. Bring next action, connection readiness and relevant results into the first useful region. Avoid adding decorative cards merely to fill whitespace.

**Acceptance:** One-, several-, and many-channel states retain balanced hierarchy and keep the user's next task easy to identify. Validate at normal laptop and wide desktop widths; do not infer phone behavior from the wide screenshot.

### L08 — P2: An obsolete-platform notice occupies normal dashboard space

The Dashboard shows a long message about Facebook Groups API removal even though the inspected channel is a Facebook Page and no active group-publishing workflow is being used.

**Recommendation:** Show historical/platform limitations contextually in connection help or when the user seeks that unsupported capability. Keep the home overview focused on current workspace actions and problems.

**Acceptance:** Page-only workspaces do not receive an irrelevant persistent Groups warning; a user exploring group publishing still gets accurate contextual guidance. No unsupported publishing action is introduced.

### L09 — P2: Analytical confidence and score denominator need clearer presentation

The inspected health card says its score is built from “the four things below”, but the accessibility state exposes two component entries (Posting consistency and Follower growth). The page also has only four posts and shows strong relative claims such as 90× typical and 2263% follower growth. These figures were not independently verified and should not be described as incorrect.

**Recommendation:** Name the active score components/denominator and clearly show omitted inputs, sample size, coverage and comparison baseline near the conclusion. Keep raw values available. Reuse shared metric definitions and confidence presentation across Summary, details and reports.

**Acceptance:** Missing inputs never silently masquerade as a complete four-part score. Small-sample conclusions have visible context; outlier percentages identify their comparison baseline. Analytical explanations remain consistent across representations.

## What worked in the observed session

- Warm theme carried through dashboard, shell and composer with coherent surfaces and typography.
- The same selected channel was retained across Dashboard, Analytics and Calendar/Compose navigation.
- Navigation had named controls and identifiable active areas.
- Composer counter and preview reflected entered text once the updated state was captured.
- Calendar and scheduling copy named UTC explicitly.
- Analytics exposed table alternatives and explanations for metrics.
- The paused destination was unavailable for selection rather than offered as a publishable target.

These observations do not establish complete accessibility, payload correctness or publishing reliability.

## Agent remediation order

1. Fix L01/L02 first, adding browser regressions based on the exact sequences above.
2. Fix L03 through the shared destination/readiness component.
3. Resolve L04/L05/L09 through common analytic scope, metric definition and presentation contracts, preserving distinct data universes.
4. Standardise naming and contextual help (L06/L08), then adjust single-channel dashboard composition (L07).
5. Complete the untested portions: real phone/responsive transitions, EN/FR, other themes, role-specific views, overlays, Reports, Posts, Queue, Connections, and multi-destination previews.

Do not mark the earlier source-only findings as live-confirmed unless this report explicitly verifies them. In particular, persistent destination overrides, partial-publish reset behavior, modal containment and failed calendar requests still need isolated test reproduction. Do not create live posts to verify those without per-action authorization.


## Part IV — Deeper authenticated audit and shared feature remediation

# Deeper authenticated app audit — shared logic and feature consistency

Date: 13 October 2026. Product: https://social.newsgeet.com

## Evidence and limits

This extends the first authenticated Chrome audit. In the second pass, the following rendered screens were inspected in the user's Chrome: Connections, Workspace Settings, Queue, Compose, Posts, Reports, Inbox, Comments, Tasks, Team and Media Library. Combined with the first pass, coverage includes Dashboard, Analytics and Calendar. Ads navigation was attempted, but its content was not reliably captured, so Ads is not counted as inspected.

The session used real workspace data, English, Warm theme and the current owner account. Inspection included visible controls, accessibility state, the Queue-to-Compose transition, template-dialog opening/closing, and report cancellation/reopening. No post, invitation, task, report schedule, uploaded file, message or configuration was created or saved. No item was deleted. A temporary report title was entered, cancelled, verified on reopening, then cleared and cancelled again. Apply was never clicked.

Browser capture sometimes returned stale page content while the address/title had already changed. Routes were checked again and some empty forms/screens were reloaded to verify the final state. Such capture lag is not treated as a proven application performance defect. Keyboard modal containment was inconclusive; the earlier source-backed focus concerns remain unverified live. No screenshots were exported to files.

Source tracing uses the existing audit clone at commit `6cc5528325b55c108a55539e431b51589e97a914`. Production version parity remains unknown. Source findings must be checked against current code before fixing; they are not claims of observed production side effects. Current repository instructions/docs may have moved since this baseline.

Priority: P1 = plausible lost work, unintended publication timing or misleading client delivery/export. P2 = significant usability, clarity or consistency issue. Feature improvements are explicitly distinguished from proven bugs.

## Findings verified or observed in Chrome

### D01 — P1: Free queue-slot action loses its scheduling intent

**Evidence:** Queue displays a free slot on 14 October at 09:00 with “Write a post and add it to the queue”. Its link is `/compose?to=<channel>`. Compose selects the channel but has Schedule selected, Queue unselected and a default 13 October 23:31 time. A full reload of the same composer URL confirms Schedule mode. No content was submitted.

**Source anchor:** QueueClient.tsx:404–405; Composer.tsx initializes timing to schedule at :179.

**Impact:** The natural continuation of a queue task can schedule a post at a different time/mode. All free-slot links have the same intent-free URL, despite representing different slots.

**Fix:** Define the intended operation. If these are “next queue slot” actions, pass an explicit queue intent and name it accordingly. If a particular slot is selectable, carry the validated slot/date/time and re-check availability server-side. Preserve channel scope. Do not promise a reserved slot before the server resolves it.

**Regression:** Click two different free-slot cards and verify the chosen contract. Queue intent survives reload/back navigation. A slot that became occupied yields truthful recovery guidance. Contributor approval still applies.

### D02 — P2: Report Cancel retains unsaved branding edits

**Evidence:** Customise → enter a temporary Cover title → Cancel → Customise again. The temporary title remains. The live report itself did not change. The temporary value was cleared without applying.

**Source anchor:** ReportBuilder.tsx state initialized from props; close at :47–50 only closes and clears error.

**Impact:** Cancel reads as discarding changes, but a later Apply can persist an earlier cancelled edit. The same risk exists for section selections.

**Fix:** Reset the modal's editable draft from the latest committed report/branding state on open or cancel. If preserving a draft is intentional, name the operation Close and make pending edits visible; do not label it Cancel.

**Regression:** Edit title and sections, cancel, reopen: committed values restored. Apply, reopen: saved values present. A failed Apply preserves the current edit and exposes the error. Refresh of server props cannot leave stale branding.

### D03 — P2: Report customization advertises unavailable demographics

**Evidence:** The Audience option says “Followers, countries, cities, age and gender.” The report itself explains that age, gender and language breakdowns are unavailable from Meta and therefore not shown.

**Fix:** Derive feature descriptions/options from the same network capability model as the report. Use accurate section copy and retain an explanation for unavailable metrics when needed.

**Regression:** Meta Audience configuration advertises only rendered capabilities; other networks retain their actual supported fields. Both languages match.

### D04 — P2: Audience metric names disagree with their definitions

**Evidence:** Reports has “New likes” and “Lost likes”, but their help defines people who started/stopped following. The adjacent chart calls these “Followers gained and lost”. Analytics describes net/gained/lost followers. The same data is named differently inside one report.

**Source anchor:** messages/en.json newLikes/lostLikes versus their help strings at the audited baseline.

**Fix:** Use a shared metric dictionary including stable metric identity, source, display name, definition, unit and aggregation. Separate page likes from follows; preserve historical metric identities rather than relabeling all old data as current follows.

**Regression:** Summary, Audience, details, report and export headers name the same metric consistently. Missing/retired values remain unavailable rather than fabricated zeroes.

### D05 — P2: Email readiness differs across features

**Evidence:** Team explicitly says email is not configured and invitations must be shared manually. Reports offers Email report; its component has no email-readiness input in the reviewed source. Scheduled email was not created or sent in this audit.

**Fix:** Use a shared server-derived delivery-readiness view model. Distinguish enabled, unavailable, failed and skipped delivery. Team can still create a manually shareable invitation, but the button should say Create invitation link in this mode. Reporting should offer downloads and explain why email is unavailable.

**Regression:** Email-off state is coherent across Team, Reports, notifications and recovery. Do not expose SMTP credentials or require ordinary editors to configure providers. See D19 for the source-backed delivery-outcome issue.

### D06 — P2: AI configuration copy exposes internals while the enable control remains on

**Evidence:** Workspace Settings says no ANTHROPIC_API_KEY is set and composer tools are hidden, while Enable AI writing help is checked and editable. Default tone, brand voice and other AI fields remain available.

**Interpretation:** Saving preferences before provider setup can be valid; the defect is unclear distinction between preference and availability, plus technical copy in a workspace workflow.

**Fix:** Show “Writing help is unavailable until the service administrator connects a provider”, separately from saved workspace preference. Apply provider-neutral readiness logic to captions, translations, images, negative-comment analysis and report recap; do not assume all features support the same providers/models.

**Regression:** Workspace enable state does not falsely imply the feature is usable. Configured providers with unsupported capabilities have specific explanations. Technical setup remains in root.

### D07 — P2: Bulk scheduling uses a different destination-selection feature

**Evidence:** Compose has a searchable destination picker with identity/readiness context. Settings → Bulk schedule from CSV lists eleven standalone checkboxes without search, grouping or the same row information.

**Fix:** Reuse TargetPicker's selection/readiness behavior, with appropriate CSV-specific supported networks and permissions. Keep draft destinations separate from the global analytics/calendar view selection. Preserve selected items during search.

**Regression:** Many channels, long names, disabled channels, group selection, role scope and French blockers behave like Compose. Unsupported network/content combinations remain unavailable.

### D08 — P2: Connection identities are difficult to distinguish

**Evidence:** Two connected Facebook identities have the same display name and separate channel collections. Ad accounts also include duplicate names, including repeated identity/currency combinations. Last-sync time differentiates some rows but does not identify ownership.

**Fix:** Provide a stable human-readable discriminator and meaningful grouping, such as business/profile context or a short account identifier. Keep token/scope diagnostics in root. Do not deduplicate solely by display name or disconnect either record without domain verification.

**Regression:** Two legitimate identities with the same name remain independently recognizable; reconnect/disconnect target the intended record. Test long names and missing metadata.

### D09 — P2: Media Library acts as inventory rather than a reusable asset workflow

**Evidence:** The populated library shows storage usage, a thumbnail/file name and Delete. The inspected Composer exposes upload/drop only. The reviewed source has no library-selection control in Composer.

**Classification:** Feature-completeness improvement, not a demonstrated failure of an existing reuse promise.

**Fix:** Define a shared workspace asset picker with preview, selection, accessibility/alt-text metadata, usage references and authorized reuse. Keep deletion separate and protected when a post depends on the file. Do not copy uploaded bytes or mint public URLs solely to share internal selection state.

**Regression:** Existing assets can be reused without reupload where supported; only authorized workspace assets appear. Reusing/editing metadata cannot damage a different scheduled post. Media-dependent network requirements remain enforced.

### D10 — P2: Empty Posts state describes an unexplained filter failure

**Evidence:** Posts is on All status for one selected channel, shows No posts and “No posts match these filters.” Analytics for that channel has external Facebook posts, while Comments explicitly covers posts sent through this app.

**Fix:** Use an explicit content-source contract in headings/empty states. Distinguish no app-created posts, an empty filtered result and incomplete synchronization. Offer one achievable action or scope reset. Do not broaden post-management scope merely to hide the empty state.

**Regression:** A channel with external posts only gets accurate copy in Posts, Analytics and Comments. Changing a search/status uses an appropriate filtered empty state.

### D11 — P2: Publishing features are buried inside general Settings

**Evidence:** Workspace Settings contains general workspace preferences, link tagging, AI settings, a migrated-queue placeholder and bulk CSV scheduling. The queue placeholder instructs “Schedule → Queue”, while the live rail is Publish and the contextual heading is Publishing. A second Settings navigation repeats Team/Client links available in the Workspace sidebar.

**Fix:** Establish one ownership/entry-point map: settings configure capabilities; publishing screens perform publishing work. Put CSV scheduling in the publishing workflow, replace the stale naming and remove permanent migration notices once routes are discoverable. Retain compatibility links where required.

**Regression:** Each capability has a clear primary home; shortcuts use the same labels and preserve context. Existing URLs still resolve or redirect meaningfully.

### D12 — P2: Inbox empty state implies completion without establishing coverage

**Evidence:** Unified Inbox says every comment and message on the channels is marked done. Dedicated Comments says it covers posts published from here and has captured no comments. The inspected channel has externally published posts with comments in Analytics.

**Interpretation:** The live data does not establish whether any stored items were resolved; no claim is made that messages/comments were lost. The completion wording exceeds what an empty result alone proves.

**Fix:** Distinguish empty captured set, resolved captured set, restricted source coverage, unavailable permission and stale sync. State the source scope and last successful sync. Share the readiness/source model with Comments and analytics.

**Regression:** Empty database, all captured items resolved, external-only comments, missing permission, stale sync and active filters produce different truthful states. No fake “all done” claim for unobserved external content.

## Source-backed findings requiring current-version verification

### D13 — P1: CSV export does not preserve the selected report channels

**Observed UI support:** The inspected single-channel report's Download CSV URL contains from/to/format only.

**Source:** ReportControls.tsx builds that URL without target/selection. src/app/api/reports/route.ts applies only auth.pageScope to buildReport; it does not resolve the report's selected channel subset. An all-pages owner therefore exports all authorized workspace channels rather than the selected report subset in this baseline.

**Boundary:** This is a scope/accuracy defect within authorized data, not proof of unauthorized cross-workspace access. No CSV was downloaded in the live audit.

**Fix:** Pass an explicit validated ReportContext to display, CSV, PDF, templates and email scheduling. Intersect requested targets with authorization server-side and preserve period/source semantics. Clearly define format-specific section support; do not imply every format includes the same content if it does not.

**Regression:** With two allowed channels and a report selecting one, exported rows include exactly one. With a restricted member, forged selection cannot add unauthorized channels. Explicit report scope wins over stale remembered view selection.

### D14 — P1: Task workflow loses unfinished rows after partial failure

**Source:** TasksClient.tsx:61–79 creates tasks sequentially, stops on failure, then clears steps unconditionally. It silently slices input to 30 lines and each title to 200 characters.

**Fix:** Validate before writing; show length/row limits rather than silently truncating. Report completed/failed/unattempted rows and retain failed/unattempted content. A retry must not recreate successful tasks.

**Regression:** Fail the third of five creates; retain rows 3–5 with correct statuses, preserve already-created rows, and retry only unresolved rows. Validate 31 lines and a 201-character title explicitly. Do not run this against production task data.

### D15 — P2: Single task creation has no in-flight submission guard

**Source:** TasksClient.tsx add/call lacks a pending guard; its Add control depends on title content, not request state.

**Fix:** Use the shared mutation lifecycle to disable duplicate submission per operation and retain input until confirmed creation. Do not use automatic write retries.

**Regression:** Double click/Enter under a delayed request creates one task; transport/validation failure restores retryability with the input intact.

### D16 — P1: Switching Inbox conversations discards reply drafts

**Source:** InboxPanel.tsx:111–116 sets selected thread and immediately clears text on every thread click, including reselecting the current thread. No conversation-scoped draft recovery is present in this baseline.

**Fix:** Preserve unsent replies per conversation, scoped to current user/workspace. Reselecting the same thread is a no-op. If closing/leaving cannot preserve a draft, offer an explicit discard choice. Recheck the platform reply window before sending.

**Regression:** Type in thread A → open B → return A: original draft survives. Clicking A again does not erase it. Different users/workspaces cannot recover each other's drafts. Closed reply windows retain text but do not offer an invalid send.

### D17 — P2: Media deletion transport failure has no useful feedback

**Source:** MediaLibrary.tsx remove uses try/finally without catch; HTTP failure has copy, a rejected fetch does not. Its error container lacks the shared announcement pattern.

**Fix:** Shared mutation/error feedback for HTTP and transport failures, preserving the row and resetting busy. Keep the in-use guard, confirmation and server enforcement. If a response is lost, reconcile state before retrying destructive actions.

**Regression:** Network rejection produces visible/announced feedback and retryability. In-use and restricted-role cases do not offer unusable actions. Test locally, not by deleting the production file.

### D18 — P2: Report-schedule removal ignores the result

**Source:** ReportSchedules.tsx remove catches fetch failure to null, ignores non-success status, then refreshes without a reported outcome.

**Fix:** Use a resource-scoped pending guard; distinguish confirmed removal, refusal and transport uncertainty. Keep the schedule visible until authoritative success and report how to recover.

**Regression:** 403/500/offline responses display a failure and leave the schedule; successful removal reports success. Double click does not duplicate attempts.

### D19 — P1: Skipped report email is treated as delivery success

**Source:** src/lib/email/send.ts documents a skipped outcome when no provider is configured. src/lib/report-schedules.ts:188–211 considers only failed outcomes bad; otherwise it emits report.ready and advances lastRunAt/nextRunAt with no lastError. Thus skipped deliveries can look successful in this baseline.

**Fix:** Separate report generation status from email delivery status. A generated report can be ready while delivery is unavailable, skipped, partial or failed. Do not mark skipped recipients as sent or emit a delivery-success event. Keep event semantics/backward compatibility explicit and avoid automatic duplicate sends.

**Regression:** All skipped, one failed/one sent, all sent and provider disabled between schedule creation/run each yield truthful recipient/outcome accounting. Tests stub delivery; no real email is sent.

## Shared ownership/remediation map

| Shared concern | Existing owner to extend | Findings | Migration rule |
|---|---|---|---|
| Composer entry intent | compose page + Composer + link builders | D01 | All queue/calendar/template entry points explicitly carry allowed intent and context. |
| Draft/form lifecycle | Composer/ReportBuilder/InboxPanel; small shared behavior where equivalent | D02, D14, D16; earlier L01 | Separate committed baseline, editable draft, cancellation, successful save, partial outcomes. Sensitive/security forms remain excluded from persistence. |
| Report context | reports/date-range/page-filter/ReportControls | D13 | One validated selection/period/source contract passed to every representation. |
| Capability/readiness | existing settings/email/provider/network capability modules | D03, D05, D06, D12, D19 | Server computes safe user-facing readiness; UI and worker agree, with domain-specific consequences. |
| Metric identity | existing metrics/analytics/report definitions | D04; L04/L05/L09 | Shared definition/label/unit/source/confidence; preserve retired historical series. |
| Mutation outcomes | existing API error contract + browser-safe transport helper | D14, D15, D17, D18, D19 | Pending/error/partial/uncertain states are explicit; no blind write retry. |
| Target/asset selection | TargetPicker, PagesSidebar, media domain | D07–D09 | Share selection behavior but distinguish view scope from publishing choices and storage permissions. |
| Screen ownership/empty state | navigation model, ScreenHeader, EmptyState | D10–D12 | One primary home and accurate source/readiness-specific explanation. |

## Additional fix tasks for the agent

### Task 28: Preserve composer entry intent

- [ ] Verify D01 on current source and add a browser regression for Queue free-slot entry.
- [ ] Define next-slot versus exact-slot semantics and implement the corresponding validated URL/initial state.
- [ ] Verify channel, timezone, mode, reload/history behavior, occupied slots and approvals.

### Task 29: Implement transactional form drafts and partial-work recovery

- [ ] Fix D02 committed-versus-editable report state, with Cancel/Apply regressions.
- [ ] Fix D14 partial task workflow accounting and D15 submission guards with stubbed writes.
- [ ] Fix D16 conversation-scoped draft preservation; integrate with earlier unsaved composer remediation.
- [ ] Confirm no cancelled/failed edits silently become later writes and no cross-scope draft recovery.

### Task 30: Share explicit report/export context

- [ ] Test D13 using two-channel fixtures and restricted member fixtures before refactoring.
- [ ] Pass explicit selection/period/source into the existing report service and export UI/API.
- [ ] Verify report, CSV, PDF, templates and email context, documenting meaningful format differences.

### Task 31: Share capability/readiness and truthful delivery outcomes

- [ ] Align Team/Reports/AI/Inbox readiness (D03/D05/D06/D12).
- [ ] Fix D19 recipient delivery accounting; separate ready/generated from sent/delivered.
- [ ] Add skipped/partial/failed/provider-change regressions and preserve established event contracts intentionally.

### Task 32: Consolidate domain labels, selectors and feature entry points

- [ ] Fix metric vocabulary D04 with paired message keys and source-specific definitions.
- [ ] Reuse authorized destination selection in CSV scheduling (D07), disambiguate connections (D08).
- [ ] Treat media reuse (D09) as a scoped feature addition using existing storage/access contracts, not merely visual cleanup.
- [ ] Correct publishing feature placement and empty-state scope (D10/D11); retain compatibility routes.

### Task 33: Migrate remaining mutation feedback and verify cross-screen parity

- [ ] Fix D17/D18 through shared HTTP/transport/pending feedback.
- [ ] Run the audit acceptance matrix across actual migrated callers, including partial and uncertain outcomes.
- [ ] Deliver exact tests/results, screenshot evidence where available and remaining unverified live paths.

## Acceptance and remaining coverage

Reuse the previous 27-task plan rather than implementing parallel abstractions. Validate each source finding against the current checkout; old line numbers are search anchors, not patch instructions. Add meaningful regression cases against production modules, use isolated data/network stubs, and run the relevant typecheck/unit/browser suites. The audit itself has not executed those suites.

Still required: EN/FR and all themes, authenticated mobile/responsive transitions, all restricted roles, actual keyboard/screen-reader modality, populated app-created posts, multi-destination effective previews, print/PDF output, Ads, and transport-failure simulations. Source-reviewed findings are not permission to send real emails, publish test posts, delete files/schedules, change roles or reconfigure providers.

### Evidence disposition

- **Behavior reproduced:** D01 queue intent, D02 report Cancel retention; earlier L01 lost composer caption and L02 missing docked tools.
- **UI observed/design gap:** D03–D12, plus earlier hierarchy/terminology findings.
- **Source-backed at audit baseline:** D13–D19; confirm current-version status before implementing.
- **Inconclusive:** Native capture lag, modal focus containment and Ads rendering; do not record them as proven product defects.
