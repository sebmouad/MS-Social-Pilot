# Simplified — detailed audit (Social Media module)

10 October 2026 · workspace "Mouad" (trial, 6 days left) · accounts For Lady's
and Délices Rapides · desktop Chrome 1728 px · French UI.
Read-only: nothing created, saved, published or changed. Companion to
[README.md](README.md) (structure & styles). Screens `41–50` were added for
this audit.

## Scorecard

| Area | Score | One-line verdict |
|---|---|---|
| Information architecture | 7/10 | Clear module menu and a consistent "accounts column + view tabs" frame; 4 of 10 menu items open sales pages |
| Analytics | 7/10 | Good KPI cards, comparisons, demographics and report builder; several number/scale bugs |
| Publishing & composer | 8/10 | Strong: 4 views, queue slots, per-network tabs, first-comment delay, live preview |
| Collaboration & permissions | 8/10 | Per-module seats, 4 social roles, per-account visibility per member, approval board |
| Visual design | 7/10 | Coherent dark theme with one amber accent; dense, small text |
| Copy & localisation | 4/10 | Mixed FR/EN, mistranslations, typos |
| Accessibility | 4/10 | Many unnamed icon buttons, tiny text, no `h1`, colour-only states |
| Trust & monetisation | 5/10 | Heavy upsell, AI actions that run (and may bill) on one click, ad/tracking scripts in the app |

---

## 1. Analytics

### Strengths
- **Change vs previous period on every KPI**, with an editable comparison
  start date; the comparison keeps the same length (44).
- **KPI cards double as series toggles**; chart tooltip lists every selected
  series for the hovered day with coloured values (42).
- **Honest metric tooltips** (definitions below), including Meta deprecations.
- **Insight tiles** (best day, best frequency) in plain language.
- **Demographics**: countries and cities by fans *or* reach, map + ranking.
- **Report builder**: modules tree, branding, PDF/PNG, templates, live preview.
- Date picker: presets, two-month custom range, future days disabled (43).

### Issues

| Sev. | Issue | Evidence |
|---|---|---|
| 🔴 | **One y-axis for all selected series**: impressions (13 k) flatten engagement (26/day), audience (1/day) and posts (7/day) into a line at 0 — the default view is unreadable for 3 of 4 KPIs | 42 |
| 🔴 | **"Engagements" column in % (500 %–8 600 %)** in the post table and report, while the post modal shows the same field as a count (5) | 07, 09, 17 |
| 🟠 | **"+4.1k %" change** when the previous period had ~1 post: percentage on a tiny base, no "new" / absolute fallback | 01 |
| 🟠 | **Deprecated metric still displayed** (Nouveaux fans = 14) although its own tooltip says Meta stopped it on 15 Nov 2025 | 41 |
| 🟠 | **Deep links ignored**: `/analytics/overview` opens the last-used tab (Démographie) | — |
| 🟠 | **"Aperçu de tous les comptes"** did nothing when chosen (stayed on Délices Rapides) | 02 |
| 🟡 | Report "Meilleures publications" shows **Portée 0** for every post | 17 |
| 🟡 | Daily reach is summed across days — the tooltip admits totals differ from Meta | tooltip |
| 🟡 | No per-metric chart type (all area lines), no export from a single chart, Excel only via the report ▾ | 04 |

### Metric definitions (verbatim meaning, translated)
- **Portée de la Page** — people who had any content from or about the Page
  on screen (posts, stories, check-ins, ads, social info…); each day counted
  separately, so the total differs from Meta's dashboard.
- **Impressions de post (total)** — times the Page's posts appeared on a
  screen (statuses, photos, links, videos…).
- **Nombre de posts** — posts published.
- **Réactions** — daily total of reactions on the Page's posts, by type.
- **Engagements sur la page des posts** — times people interacted with posts
  through reactions, comments, shares and more.
- **Nouveaux fans** — new people who liked the Page vs previous period;
  *deprecated by Meta on 15 Nov 2025*.
- **Total des followers** — followers minus unfollows over the Page's lifetime.

## 2. Publishing & composer

### Strengths
- **Four views** of the same plan: calendar, list (upcoming/past), feed
  preview, grid; drafts can be overlaid on the calendar.
- **Queue system**: weekly time slots per account (or all accounts), "Add to
  queue", shuffle / clear queue from the account menu.
- **Composer**: Post/Reel/Story, per-network tab over a shared draft, media
  (upload, library, AI), Facebook coloured backgrounds, location, mentions,
  hashtags, snippets, counters, **first comment with a delay**, labels, save
  as group, live Facebook preview.
- **Awareness days** pre-filled on the calendar; day-hover quick actions.
- **Per-account UTM + link shortening**.

### Issues

| Sev. | Issue | Evidence |
|---|---|---|
| 🟠 | **# hashtag button immediately runs an AI generation** — no preview, no confirmation, no credit cost shown | 31 |
| 🟠 | **"Calendrier" is enabled on an empty post** and answers with an error toast instead of being disabled with a reason | 29 |
| 🟡 | "Calendrier" as the label of the schedule button is ambiguous (it is also the name of the view) | 28 |
| 🟡 | Best-time dialog is actually the full **account settings** dialog — the entry point is misleading | 23 |
| 🟡 | Feed/Grid views show "@" with no handle for a Facebook Page | 22 |
| 🟡 | Locale leaks: "Unassigned", "Everyday", English role descriptions | 20, 23, 50 |

## 3. Collaboration & permissions

- **Seats per module** (Project Management, Asset, Social Media, Graphics,
  Workflows, AI Writer, Videos, Link in Bio, Chatbot), "1/3 seats used",
  "Acheter des sièges" (49).
- **Social roles**: Admin (posts, channels, features, roles) · Member (all
  social features, calendar, analytics, inbox, approvals) · Creator (create
  and edit posts) · Approver (create, edit, approve, schedule) (50).
- **Per-member, per-account access**: show/hide each account and set a role
  per account — only once the member is a full Social Media member (47).
- **Planner settings**: auto-schedule drafts once approved (not for approvals
  made through shared review links); Slack notifications for client reviews (48).
- **Drafts board**: Draft → Pending approval → Ready → Rejected.
- Paid: client review bundles, client portal, shared calendars (no login
  needed for clients).

## 4. Visual design & UX

- ✅ One accent colour (amber) used only for primary actions, active tab and
  "today"; KPI colours stay constant across card, chart and tooltip.
- ✅ Every empty state says what's missing and offers the next action.
- ⚠️ Text is small: on the analytics page **65 text nodes at 11 px, 28 at
  10.5 px, 1 at 9.6 px** (axis labels, chips, hints).
- ⚠️ Inactive tabs collapse to bare icons — you must hover to know where they go.
- ⚠️ Pop-overs close when the mouse leaves the trigger area, so menus are
  hard to use (it took several attempts to reach "Personnalisé").
- ⚠️ Setup checklist (2/5), trial banner, AI-experts button and credits counter
  compete with the main navigation on every screen.

## 5. Copy & localisation

- Mixed languages: "Unassigned", "Everyday", "Account groups", role
  descriptions, "Workspace Owner", "New Layout", settings section titles
  ("Account", "Billing & usage", "Connections", "Advanced").
- Mistranslations/typos: "gérez facilement vos **massages**", "Vous n'avez pas
  encore de modèles. **Encore!**", "**Apercevrez** les changements", "Linkin
  Bio", "Simplifié" as the brand name in tab titles, "Publié Externe."
- Page `<html lang="en">` while the UI is French.

## 6. Accessibility (analytics page)

- **20 of 85 visible controls have no accessible name** (icon tabs, menu
  items, ⋮ buttons, info icons are plain `div`s).
- **No `h1`**; headings start at `h2`.
- Info tooltips open on hover only (icons are not focusable).
- Change direction is shown by colour + arrow (arrow helps); hidden accounts
  are shown only by grey text.
- 3 controls under 24 × 24 px.

## 7. Technical observations

- React + **Chakra UI**; fonts Inter and Bricolage Grotesque.
- Analytics page (warm cache): DOMContentLoaded ≈ 0.94 s, load ≈ 1.1 s,
  **138 requests from 17 hosts**, incl. Google Tag Manager (17),
  googlesyndication (ad network), Termly (consent), Stripe, Intercom.
- Each module has its own URL (`/publishing/calendar`, `/analytics/posts`,
  `/drafts/board`, `/settings/social-accounts/planner`), but some get
  rewritten to the last state.
- Wrong settings URLs silently land on "Mon compte" instead of a 404.
- Mobile web not tested (window resize was blocked); native iOS/Android apps
  exist (settings → Appareils).

---

## 8. Lessons for MS Social Pilot

**Copy:**
1. KPI cards as series toggles — **but give each series its own axis or
   normalise**, and default to one series at a time.
2. Change pills with a fallback: show "new" or "+12" when the base is < 5.
3. Metric ⓘ definitions on every number, focusable, with Meta deprecation
   notes (we already know Page fans/likes changes).
4. Comparison period visible and editable inside the shared date picker.
5. Queue time slots grid per Page + shuffle/clear queue.
6. First-comment delay; per-Page UTM template.
7. Social roles **Admin / Member / Creator / Approver** and per-Page access per
   member (fits "many Pages, many people").
8. Auto-schedule after approval (toggle).
9. Report builder with modules + branding + templates.

**Avoid:**
- Percent "engagements", summed daily reach without saying so, deprecated
  metrics shown as live data.
- One-click AI actions that cost credits; enabled buttons that only error.
- Menu items that are paywalls; mixed-language strings; tiny 10–11 px text.
- Hover-only tooltips and unnamed icon buttons.
- Ad/tracking scripts inside a logged-in tool.
