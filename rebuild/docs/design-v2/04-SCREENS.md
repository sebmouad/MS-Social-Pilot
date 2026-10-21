# 04. Screen handoff specs

Format per screen: purpose · layout · data and service (reuse, never fork) · components · states · phone · accessibility.
Shared rules from 01–03 apply everywhere: channel scope, PageHeader, Filter model, ⓘ for caveats, tokens, and no provider words.
"Reuse" names existing services. A screen is a thin view over them (contract §4).

---

## Phone priorities (owner decision 2026-10-21)

The phone must be first-class for four tasks:

1. **Inbox replies:** S8.
2. **Create:** S7.
3. **Post status:** S2 and Home "Needs attention".
4. **Insights numbers:** S9.

Each one passes at 390 px with one hand: the primary action is reachable at the bottom, there is no horizontal page scroll, and the ⓘ opens as a bottom sheet. Acceptance details are in 08.

## S0. App frame (all signed-in customer pages)

- **Layout ≥1024 px:** `AppSidebar` (248/64) | content column (`--gutter` inset, max `--content-max`, centred). `TopBar` across the content column.
- **760–1023 px:** the sidebar is collapsed to a 64 px rail; expanding opens it as an overlay with a scrim (focus trap, Escape, inert background, scroll lock).
- **< 760 px:** no sidebar; `TopBar` (menu, scope chip, bell, avatar) + `BottomBar`.
- **Skip link** "Skip to content" (localized) is the first focusable element.
- **Loading:** a route `loading.tsx` renders the frame immediately with skeletons in the content. The frame never flashes.
- **Errors:** the error boundary renders **inside** the frame (today it renders above the shell) with `ErrorState` and Retry.
- **404:** unknown ids under a valid area return HTTP 404 with the themed not-found page inside the frame.

## S1. Home `/home`

**Purpose:** "What needs me today, and are we doing OK?" in 5 seconds.

**Layout** (12-column grid, 24 px gaps):

1. Header: "Good morning, Preview" (no workspace name in the greeting) + the date range chip (default 28 days) on the right.
2. **Needs attention** strip (only when non-empty), up to 4 compact rows linking to the fix:
   - "2 posts failed — Review"
   - "3 posts waiting for your approval"
   - "Facebook needs reconnecting"
   - "5 conversations waiting"
3. **4 MetricTiles**: Audience, Views, Engagements, Link clicks. Each has a delta against the previous period and an ⓘ.
4. Two columns:
   - Left (8 col): **Coming up**, the next 5 scheduled posts as `ListRow`s, with "Open calendar".
   - Right (4 col): **Inbox** (waiting count + 3 latest, "Open inbox") and **Best times**. Best times shows a small heatmap, or its empty state.
5. **Ad spend**: one tile per currency. Shown only if ads are entitled and selected.

**Reuse:** `readHomeOverview` (home/server), `readPublishingSummary`, the Inbox list read, `best-time`.

**States:**
- A first-run workspace (no channels) replaces sections 2–5 with one card: "Connect your first channel" + button.
- A card whose read fails shows its own inline error with Retry. The other cards stay.

**Phone:** sections stack: attention, KPIs (2×2), coming up, inbox. Ads collapse into one row.

**Accessibility:** cards are `section`s with `h2`; KPI deltas carry text ("up 12% versus the previous 28 days").

## S2. Content › Posts `/content`

**Purpose:** find any post and act on it.

**Header:** "Posts" + count chip. Actions: [Import CSV] (secondary, opens a Sheet) and [Create post] (primary). Tabs: Posts · Calendar · Queue · Approvals (badge) · Library.

**Filter row:** Filter (status, label, origin: manual/feed/recipe, date range), chips and search. There is no view switch: the table is the only list view, and the side preview shows each post as it will look (owner decision 2026-10-21).

**Table columns:** select · Post (thumb 40 + first line of text + "1 media" meta) · Channels (avatars, max 3 + "+2") · Status (StatusChip + per-destination count "2/2") · When (scheduled or published time in the workspace zone) · Actions menu.

**Row click:** opens `SidePanel` with the full `PostPreview`, destinations and their outcomes, first comment status, history and labels. It offers actions as buttons: Edit, Duplicate, Reschedule, Delete…. The URL becomes `/content?post=<id>` so the panel can be shared. On phone it opens `/content/post/[id]`.

**Bulk bar:** Reschedule, Add label, Approve (if allowed), Delete.

**Reuse:** `readPublishingPostPage`, `runBulkPostAction`, the existing action services. Do not re-implement lifecycle rules.

**States:**
- Empty workspace: "No posts yet" + Create post.
- No match: "No posts match these filters" + Clear filters.
- Failed destination: the row shows ⚠ "Needs attention" and the panel explains what happened and why, with a recovery action.
- Uncertain outcome: "We could not confirm this post was published. Check Facebook, then record what you see." This stays a held state with no resend button (contract).

**Phone:** `ListRow`s with a 72 px row height, so about 8 posts fit per screen.

## S3. Content › Calendar `/content/calendar`

- Header tabs as in S2.
- Toolbar inside the content: ‹ Today › · "October 2026" · Month | Week segmented · Filter. This moves the calendar controls out of the sidebar.
- **Month cell:** the day number (today highlighted with `--accent`) and up to 3 post pills (time + avatar + 1 line), then "+N more" opening a day popover.
- **Queue slots:** free queue times show as dashed "Free slot 09:00" pills. Clicking one opens Create pre-filled with that time.
- **Drag** to reschedule: the existing confirmation dialog with old and new time in the workspace zone, plus the keyboard alternative ("Move…" in the item menu).
- Past days are greyed; dropping on them is refused with the reason.
- **Phone:** an agenda list grouped by day, with a sticky day header.
- **Reuse:** `readPublishingCalendar`, `reschedulePost`, and the queue times read.

## S4. Content › Queue `/content/queue`

- **Two panels.** Left (main): "Next in queue", the upcoming queued posts in order with their slot times, plus the "Add to queue" button. Right (side, 360): "Queue times", the weekly slot editor (day chips + time list + add time) with Save.
- Mix and recycle settings sit under an "Automation" disclosure in the right panel.
- **Reuse:** `list_queue_times` / `replace_queue_times` services, the content mix and recycle services.

## S5. Content › Approvals `/content/approvals`

- A list of posts waiting for review, each with its preview inline at a readable measure (max 640).
- Actions: [Approve] (primary) and [Request changes] (opens a textarea). Keyboard: A approves, R requests changes. Both show the existing confirmation.
- Empty: "Nothing waiting for review."
- **Reuse:** the existing approval/review services (`review_post` path).

## S6. Content › Library `/content/library` (Media · Templates · Labels · Fields · Feeds)

- Section tabs (link variant).
- **Media:** a grid of thumbnails with name, type, size and usage count. Upload/import button; a sheet for details (rename, where used, delete).
- **Templates, Labels and Fields:** simple tables with a create button and inline edit.
- **Feeds:** feed sources table plus the recipe source card, with its status, next times and supply. Technical mapping sits in an "Advanced" disclosure.
- **Reuse:** media, templates, labels, collaboration and feeds services. All create/edit/delete keep their existing confirmations.

## S7. Create `/create` (full-screen sheet)

**Purpose:** write once, send to the right channels, at the right time, with no detours.

**Layout ≥1024 px:** a full-screen `Sheet` with a top bar ("New post" / "Edit post", the autosave status, a Close × that returns to the previous page). Below it, two columns:
- **Editor** (max `--form-max`), scrollable.
- **Preview** (420 px, sticky), with a channel switcher if more than one is selected.

**Editor, top to bottom:**

1. **Channels**: avatar chips of all postable channels; click toggles. The scope from the sidebar is pre-selected. An unavailable channel (expired, no grant) is shown disabled with a tooltip and "Reconnect". "Customize per channel" (disclosure) opens per-channel text/format overrides.
2. **Text**: `AutoTextarea`, placeholder "What do you want to share?", a counter showing the strictest selected channel limit, and AI assist ("Improve", "Shorter", "Translate") if entitled.
3. **Media**: a drop zone plus [Upload] [From library] [Add link]. The attachment list is reorderable (drag, plus Move up/down buttons), each item with alt text and remove. The link preview card shows when a link is present.
4. **First comment**: collapsed ("+ Add first comment"); expands to a textarea and delay.
5. **Advanced** (collapsed): format per channel, who sends (app or platform, with plain words "Send from Social Pilot" / "Let Facebook publish it"), labels, custom fields.

**ActionBar** (sticky bottom):
- Left: the validation summary ("Add text, media or a link") or "Draft saved 11:05".
- Right: [Save draft] and `SplitButton` [Schedule ▾]. The split button menu holds Publish now, Add to queue and Schedule….
- **Schedule…** opens a `Popover`: date, time and the "Best times" suggestions as chips, plus the time zone shown in text.
- The primary label adapts: "Schedule for Oct 23, 09:00" once a time is picked, or "Publish now" if chosen.

**Validation:** inline at the field. Submitting with errors focuses the first invalid field. The server stays authoritative.

**Recoverable failure:** keep everything and show a Notice in the ActionBar. Unknown outcome: "We couldn't confirm the save. Check Posts before trying again", with a link to Content.

**Reuse:** `createPost` / `updatePost` / `createQueuedPost` / `reschedulePost` through the same server actions as today; `publishingDestinationChoices`; formats; best-time; media upload.

**Phone:** a full-screen page with the preview as a "Preview" tab at the top (Edit | Preview) and the ActionBar fixed at the bottom. Media offers "Take photo" and "Choose from library" through the native file picker (`accept="image/*,video/*"`, with a `capture` option). Channels show as a horizontally scrollable chip row. Schedule opens a bottom sheet with date, time and best-time chips.

**Accessibility:** a dialog name ("New post"); Escape asks to keep the draft if there are unsaved changes; the channel chips are a group of toggle buttons (`aria-pressed`).

## S8. Inbox `/inbox` (tabs: Conversations · Rules)

- **Three panes ≥1280 px:**
  - List (360): quick filter chips (Unread, Needs reply, Negative, Mentions) in a horizontal scroll row, then rows.
  - Thread (flex).
  - Details (320, collapsible): contact, assignment, notes, tags, sentiment.
- **1024–1279 px:** the details pane becomes a toggle drawer.
- **< 1024 px:** list → thread as two pages. On phone, the reply box stays fixed above the keyboard. Saved replies open as a bottom sheet. Resolve sits in the thread header. A conversation is reachable in 2 taps from the bottom bar.
- **Header:** "Inbox" + waiting count, a [Sync now] secondary button, "Last synced 11:03" in an ⓘ, and the Filter button (channel type, status, hidden comments, assignee).
- **Thread:** messages grouped by day. The reply box sits at the bottom: textarea, [Saved replies ▾] (a menu inserting text), [Reply] primary, [Resolve] secondary. Moderation actions (Hide, Delete…) live in the message menu.
- **Keyboard:** J/K move, R reply, E resolve, `?` opens the shortcut sheet. The always-visible legend is removed.
- **Bulk:** select rows → BulkBar (Resolve, Assign, Mark read).
- **Reuse:** `readInboxList`, `readInboxThread`, `readInboxContactDetails`, the reply/resolve/moderation/bulk/productivity services.
- **States:**
  - Empty: "You're all caught up."
  - No channels with messages permission: an explanation plus "Manage channels".
  - Deletion in progress: today's durable flow (check status, finish removal).

## S9. Insights › Overview `/insights`

- **Header:** "Insights"; [Download report] (secondary). Tabs: Overview · Explore · Audience · Posts · Compare · Ads · Reports. Filter row: DateRangePicker (presets + compare toggle) and Filter.
- **Row 1:** 4 MetricTiles (Audience, Views, Engagements, Link clicks); pinned metrics append as extra tiles (max 8, then "Show all").
- **Row 2:** the main chart (card): a metric switcher (tabs inside the card), a line chart over time with the previous period dashed, and "Show data".
- **Row 3:** **Top posts** (5 rows: thumb, text, channel, views, engagements, link) | **Publishing activity** (published / scheduled / failed counts, with links into Content filtered).
- **Row 4** (if goals exist): goal progress bars.
- **Phone:** the tiles form a 2×2 grid; the chart sits in its card with horizontal scroll for long ranges; the date range is a bottom sheet; top posts become ListRows.
- All caveats move into ⓘ: period, UTC, coverage "2 of 4 channels", missing ≠ zero, overlap note for audience sums. Partial coverage turns the ⓘ into ⚠.
- **Reuse:** `readAnalytics`, `readAnalyticsSnapshot`, pins, goals, the publishing summary. No new calculations.

## S10. Insights › Explore `/insights/explore`

- **Two columns:**
  - Left (280, in-content list): search metrics, grouped by category (Audience, Content, Engagement, Video, Ads). Each item has a name and a tiny availability dot.
  - Right: the selected metric's chart, table and resource breakdown, with ⓘ.
- The metric choice is in the URL (`?metric=`). On phone, the list is a full page, and choosing a metric navigates to its detail.
- **Reuse:** `readAnalyticsExplorer`.

## S11. Insights › Audience, Posts, Compare, Reports

- **Audience:** follower trend chart, demographics (bar for age/gender, ranked list for countries and cities), unknown categories called "Not provided".
- **Posts:** the post performance table (compact density): sortable columns, a search, the date range; clicking opens the same `SidePanel` as Content with metrics added.
- **Compare:** pick 2–4 channels or ad accounts (multi-select with a cap) and a metric set; a small-multiples or grouped bar chart plus a table. Ads mode compares accounts in the same currency only; mixed currencies show the "different currencies" notice.
- **Reports:** Templates · Schedules · History tabs (tables). [New report] opens a Sheet wizard: sections, period, format, recipients.
- **Reuse:** existing demographics, explorer-posts, comparison and report-workflow services.

## S12. Insights › Ads `/insights/ads` (sub-tabs Accounts · Campaigns · Manage)

- **Account switcher** in the filter row (`account=`; multi-select within one currency).
- **Accounts:** one row per account (name, status, currency, spend, results, cost per result, CTR, last synced) plus a spend chart for the selected account. Today's per-account wall of tiles, chart and funnel is removed. The funnel moves into the row detail SidePanel.
- **Campaigns:** a hierarchy table (campaign → ad set → ad, expandable rows), compact density.
- **Manage** (only when management is entitled and enabled for the account): create campaign, ad set, ad and creative through Sheets, with the existing exact confirmations. Status, budget and rename changes happen through the row menu. If the provider grant is missing: "Reconnect to allow ad changes" + button.
- **Reuse:** `readAdsPerformance`, `listAdsAccounts`, `readAdsDailyRows`, `readAdsCreationOptions`, the management preview/perform services.
- **Fix:** the screens must stop calling raw queries (07, item 1).

## S13. Settings `/settings/*`

- **Desktop layout:** an in-content section list (left, 220) plus a content column (max `--form-max`). Phone: the list page, then the section page.
- **Sections:**
  - **Workspace**: cards, each with its own Save and a "Saved" toast:
    1. Name & time zone (a searchable time zone `Select`, not free text).
    2. Approvals (switch + sentence).
    3. Posting hours (day toggles + two time inputs).
    4. Queue & spacing (gap minutes, undo seconds).
    5. Links (UTM fields under a disclosure, shorten links switch).
    6. AI voice (tone, brand voice, words to avoid).
    7. Moderation alerts.
  - **Channels**: one card per connected account. It shows:
    - the avatar, account name and status pill (Connected / Reconnect needed / Expired);
    - "3 of 4 Pages in use";
    - the buttons [Manage Pages] [Reconnect] and "⋯" (Disconnect…);
    - a "Permissions" disclosure listing only what is missing, plus the full list on demand. Internal IDs are hidden.
    Below the cards: Ad accounts (table: name, linked account, status, in use toggle via the selection dialog) and Channel groups & labels.
  - **Team**: members table + invite (Sheet) + pending invitations.
  - **Sharing**: tabs Client links · Link in bio.
  - **Integrations**: tabs AI assistants (MCP) · API keys · Webhooks.
  - **Account**: tabs Profile · Security (password, two-step, passkeys, sessions) · Appearance (theme, mode) · Notifications. The partial account export link sits in Data.
  - **Data & privacy**: export (ZIP status), partial account export, delete workspace data (exact confirmation flow unchanged).
- **Reuse:** all current settings services. Disconnect keeps its retain/delete choice and consequences.

## S14. Tasks `/tasks` and Agency `/agency` (optional areas)

- **Tasks:** Board | List tabs, a filter (status, assignee, due), [New task]. The task opens in a SidePanel (comments, checklist, linked post).
- **Agency:** an "All workspaces" overview table (workspace, channels, scheduled, waiting conversations, failures) and Clients. Switching workspace uses the same confirmed service on every channel (07).

## S15. Root `/root/*`

The same frame with Root areas. Overview (health cards), People (Users, Workspaces, Plans, Invitations, Sessions), Modules (Shared controls, Product modules, Platform modules, each with Settings · Availability · Diagnostics · Health tabs), Operations (Jobs, Errors, Backups, Diagnostics), Activity (audit). Tables are compact. Technical text is allowed here but uses the same components, states and tokens. JSON settings keep their themed editor.

## S16. Public and auth pages

Centred card (max 420) on `--canvas`: logo, title, form, one primary button, secondary links. This covers sign in, sign up, two-step, password recovery, email verification and join.
- `/join` without a token shows "Ask your workspace owner for a new invitation link" and makes no network call.
- Share and bio public pages follow their own branded layout with the workspace logo (existing policy).
- Unknown share and bio tokens return HTTP 404 with the themed page.
