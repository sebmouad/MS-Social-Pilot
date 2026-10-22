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
