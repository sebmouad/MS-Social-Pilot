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
