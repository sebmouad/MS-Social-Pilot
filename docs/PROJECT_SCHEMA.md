# MS Social Pilot — Project Schema

The agreed design for the full product. Every choice below was decided
explicitly; where something was not asked, it is marked **[assumption]** so you
can overrule it before implementation starts.

Status: **implemented**. Every section below has been built on
`claude/social-scheduler-facebook-api-c6kuza`. Where the implementation departed
from this document, the document has been corrected. The open questions in §11
remain open — they need answers from you, not code.

---

## 1. Decisions

| Area | Decision |
|---|---|
| Stack | Next.js 15 (App Router) + TypeScript + Prisma + Tailwind |
| Database | PostgreSQL |
| Networks | Facebook **Pages** and **Groups** only |
| UI languages | English + French |
| Team features | Approval workflow, email invitations, multiple clients/brands |
| Content features | AI captions, RSS auto-posting, link shortener + UTM, evergreen recycling |
| Commercial model | Internal tool — no plans, limits or billing |
| Notifications | Email on publish failure, token expiry warnings, exportable reports |
| Hosting | Docker on a VPS (web + worker + Postgres) |
| Email provider | Resend |
| Media storage | Local disk, behind a storage interface ready for S3 |
| Delivery | Everything in one delivery |

**[assumption] AI provider:** the Claude API (`claude-sonnet-5` for caption
generation; `claude-haiku-4-5-20251001` for cheap rewrites). Needs an
`ANTHROPIC_API_KEY`. Say if you would rather use a different provider.

**[assumption] PDF reports** are produced by a print-optimised HTML page rather
than a headless-browser PDF pipeline. CSV export is native. This avoids putting
Chromium in the production image for one feature; if you want true server-side
PDF generation, that is a deliberate extra.

**[assumption] Short link domain:** you will supply a domain or subdomain (e.g.
`go.yourdomain.com`). Without one the shortener falls back to
`APP_URL/l/<slug>`, which works but is less tidy in a post.

---

## 2. What changes because of PostgreSQL

The current schema deliberately avoided enums and JSON columns so one file
worked on both SQLite and Postgres. That constraint is now gone, and dropping it
is a real improvement:

- **Native enums** replace the string unions in `src/lib/constants.ts`. The
  database rejects an invalid status instead of trusting application code.
- **Native `Json` columns** replace JSON-in-TEXT for `media`, `linkPreview`,
  `insights` and `detail`, removing the tolerant-parse layer in `src/lib/json.ts`.
- **Partial and composite indexes** become available for the scheduler's hot
  query (due destinations).
- `SELECT … FOR UPDATE SKIP LOCKED` becomes available. The existing conditional-
  update claim is still correct and is **kept** — it is simpler and already
  proven by tests — but the option is there if throughput ever demands it.

Local development also moves to Postgres via Docker Compose, so dev and
production match.

---

## 3. Data model

Complete target schema. **Bold** models are new; others gain the listed fields.

### Identity and tenancy

**`User`** — gains `locale` (`en` | `fr`), `lastActiveWorkspaceId`.

**`Session`** — unchanged.

**`Workspace`** — one per client/brand. Gains:
- `slug` (unique, for the switcher URL)
- `defaultLocale`
- `requiresApproval` (bool) — turns the approval workflow on for this client
- `logoUrl`, `accentColor` — light branding for client-facing reports
- `utmSource`, `utmMedium`, `utmCampaignTemplate` — UTM defaults
- `shortenerEnabled`, `shortenerDomain`
- `aiEnabled`, `aiTone`, `aiBrandVoice` — defaults fed to the caption prompt

**`Membership`** — role becomes an enum: `owner` | `admin` | `editor` |
`contributor`. Approval rights sit with `owner`/`admin`; `contributor` can only
submit for approval.

**`Invitation`** *(new)* — `id`, `workspaceId`, `email`, `role`, `tokenHash`,
`invitedById`, `expiresAt`, `acceptedAt`, `acceptedByUserId`, `createdAt`.
Unique on `(workspaceId, email)` while pending. Token is stored hashed, like
sessions.

### Connections

**`SocialAccount`** — gains `expiryWarningSentAt` so the expiry job does not
email daily about the same token.

**`Target`** — unchanged (Page or Group; `socialAccountId` stays nullable so
disconnecting keeps published history).

### Content

**`Post`** — gains:
- `approvalStatus`: `not_required` | `pending` | `approved` | `rejected`
- `submittedById`, `submittedAt`, `reviewedById`, `reviewedAt`, `reviewNote`
- `variants` (`Json`) — alternate wordings used by evergreen recycling
- `recycleEnabled`, `recycleEveryDays`, `recycleLimit`, `recycleCount`,
  `recycleNextAt`
- `sourceFeedItemId` — set when the post came from RSS
- `originPostId` — set on a recycled copy, pointing at the original

`status` gains `pending_approval` and `rejected`.

**`PostTarget`** — unchanged. Still the unit of work the scheduler claims.

**`Media`** — gains `storageProvider` (`local` | `s3`), `checksum`.

**`QueueSlot`** — unchanged.

### New feature models

**`FeedSource`** — `id`, `workspaceId`, `name`, `url`, `enabled`,
`messageTemplate`, `targetIds` (`Json`), `publishMode`, `autoApprove`,
`lastPolledAt`, `lastEtag`, `lastModified`, `pollErrorCount`, `lastError`.
The ETag/Last-Modified fields make polling cheap and polite.

**`FeedItem`** — `id`, `feedSourceId`, `guid`, `url`, `title`, `publishedAt`,
`postId`, `createdAt`. Unique on `(feedSourceId, guid)` — this is the
de-duplication guard that stops a feed re-posting its whole history when a
publisher changes their URLs.

**`ShortLink`** — `id`, `workspaceId`, `slug` (unique), `targetUrl`,
`postId`, `clickCount`, `createdAt`.

**`LinkClick`** — `id`, `shortLinkId`, `createdAt`, `ipHash`, `userAgent`,
`referer`, `country`. IPs are hashed, never stored raw.

**`AiGeneration`** — `id`, `workspaceId`, `userId`, `kind`, `prompt`, `output`,
`model`, `inputTokens`, `outputTokens`, `createdAt`. Exists so AI spend is
visible rather than a surprise on the invoice.

**`NotificationSetting`** — `id`, `userId`, `workspaceId`, `onPublishFailure`,
`onTokenExpiry`, `onApprovalRequest`, `onApprovalDecision`. Per user per
workspace, so an agency owner is not emailed about every client.

**`EmailLog`** — `id`, `workspaceId`, `to`, `template`, `providerId`, `status`,
`error`, `createdAt`. Needed to answer "was the failure alert actually sent?"

**`ActivityLog`** — unchanged, `detail` becomes `Json`.

---

## 4. Feature specifications

### 4.1 Multiple clients/brands

Each client is a `Workspace`. A user can belong to many with different roles.

- Workspace switcher in the navigation; selection persisted on
  `User.lastActiveWorkspaceId` and in a cookie.
- **`getAuthContext` must change.** It currently returns the *first* membership,
  which is the single most important existing thing this feature breaks. It
  becomes: resolve the requested workspace, verify membership, fall back to last
  active.
- Every query is already scoped by `workspaceId`. That scoping becomes a
  security boundary between clients rather than a convenience, so it gets a
  dedicated test that a member of workspace A cannot read or write anything in
  workspace B via any API route.

### 4.2 Approval workflow

Enabled per workspace (`requiresApproval`).

- A `contributor` composing a post can only **submit for approval**; the post
  lands in `pending_approval` and is invisible to the scheduler.
- Owners/admins see an **Approvals** screen: approve (which schedules it),
  or reject with a note (back to the author as `rejected`).
- Approval decisions are recorded in `ActivityLog` and emailed if the recipient
  has opted in.
- **The scheduler must never publish an unapproved post.** The due-work query
  gains `approvalStatus IN ('not_required','approved')`, with a test asserting a
  `pending` post is not claimed even when its scheduled time has passed.

### 4.3 Team invitations

- Admin invites `email` + role → `Invitation` row + Resend email with a signed
  link valid for 7 days.
- Accepting while signed out routes through registration, then attaches the
  membership. Accepting while signed in attaches immediately.
- Re-inviting a pending address resends rather than creating a duplicate.

### 4.4 AI caption assistance

In the composer: **Generate** (from a short brief) and **Improve** (rewrite
existing text) with tone options, seeded by the workspace's brand voice.

- Streams into the textarea; the user always edits before posting. Nothing is
  ever auto-published from AI output.
- Every call is logged to `AiGeneration` with token counts.
- Rate-limited per workspace per hour **[assumption: 100/hour]** so a stuck
  client loop cannot run up a bill.
- Degrades cleanly: no `ANTHROPIC_API_KEY` means the buttons are hidden, not
  broken.

### 4.5 RSS auto-posting

- A workspace adds feed sources with a message template
  (`{{title}}`, `{{link}}`, `{{description}}`), destinations, and whether new
  items auto-approve or go to the approval queue.
- The worker polls each source on a fixed interval **[assumption: every 15
  minutes]**, sending `If-None-Match` / `If-Modified-Since`.
- New items are matched on `guid`, falling back to canonical URL. Items already
  seen are skipped. On first poll of a new source, only items newer than the
  subscription time are taken — otherwise adding a blog dumps years of archive
  into the queue.
- Each item becomes a normal `Post` in the next free queue slot, so everything
  downstream (approval, retries, analytics) works unchanged.
- A source that fails repeatedly is disabled after `pollErrorCount` reaches
  **[assumption: 10]**, and the owner is emailed.

### 4.6 Link shortener + UTM

- On publish, links in the post are rewritten: UTM parameters appended from the
  workspace template, then optionally shortened to `shortenerDomain/<slug>`.
- `GET /l/:slug` records a click and 302s to the target.
- Click counts appear per post alongside Facebook's own metrics.
- **Interaction with link previews:** Facebook scrapes the *shortened* URL. The
  redirect must therefore be a clean 302 to a URL whose `og:` tags Facebook can
  read, or the preview card will be empty. This is a known sharp edge and gets
  an explicit test.
- Bot filtering on clicks is best-effort (user-agent based). Click counts are
  indicative, not audit-grade.

### 4.7 Evergreen recycling

- A post can be marked evergreen with an interval, a repeat limit, and a list of
  text variants.
- When due, the worker **creates a new post** (a copy, `originPostId` set) rather
  than republishing the original row — keeping per-attempt history clean and
  making each run independently retryable.
- Each cycle rotates to the next variant. **Facebook rejects identical repeated
  content with error 506**, which is exactly why variants exist; recycling with
  only one variant is warned about in the UI.
- Recycling stops at `recycleLimit`, or when the post is unmarked.

### 4.8 Notifications and reports

**Email (Resend):** publish failure, connection expired/revoked, token expiring
in 7 days, approval requested, approval decision. All respect
`NotificationSetting`, all logged to `EmailLog`.

**Token expiry job:** daily pass over `SocialAccount.tokenExpiresAt`, warning
once per token (`expiryWarningSentAt`). This is what stops the classic silent
failure where a 60-day token dies and nobody notices until a client asks why
nothing posted.

**Reports:** per workspace and date range — posts published, per-page
engagement, reach, clicks (Facebook + short-link). CSV download, plus a
print-optimised HTML view for PDF.

### 4.9 Internationalisation (EN/FR)

- `next-intl` **[assumption]** with message catalogues in `messages/en.json` and
  `messages/fr.json`.
- Locale resolution: user preference → workspace default → `Accept-Language` →
  English.
- Dates, times and numbers localised via `Intl`; **timezone handling is
  unchanged** — locale affects display only, never the stored instant.
- Server-side error messages (`src/lib/**`) are currently English strings inside
  thrown errors. They move to message keys so API errors are translatable too.
  This touches most of the existing error paths and is the least visible but
  largest part of the i18n work.

---

## 5. Architecture

```
                    ┌──────────────────────────────┐
  Browser ────────► │ Next.js (web + API)          │ ──► Graph API
                    └──────────────┬───────────────┘     Claude API
                                   │                     Resend
                            ┌──────▼──────┐
                            │  Postgres   │
                            └──────▲──────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │ Worker                       │ ──► Graph API
                    │  · publish due posts (30s)   │     RSS feeds
                    │  · poll RSS (15m)            │     Resend
                    │  · evergreen recycling (1h)  │
                    │  · token expiry check (24h)  │
                    │  · analytics refresh (6h)    │
                    └──────────────────────────────┘
```

The worker grows from one loop into a small scheduler of five jobs at different
intervals. Each job is an independent function that can be called from a test or
an admin endpoint — the same shape as today's `runSchedulerTick`.

**Docker Compose:** `web`, `worker`, `postgres`, and a named volume for media.
One image, two commands.

---

## 6. Settings and environment

```env
# Core
APP_URL=
DATABASE_URL=postgresql://user:pass@postgres:5432/social_pilot
SESSION_SECRET=            # openssl rand -base64 48
ENCRYPTION_KEY=            # openssl rand -base64 32

# Facebook
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_GRAPH_VERSION=v21.0
FACEBOOK_SCOPES=
FACEBOOK_ENABLE_GROUPS=true
FACEBOOK_GRAPH_BASE_URL=   # override only to point at a recording proxy

# Scheduler
SCHEDULER_POLL_SECONDS=30
SCHEDULER_CONCURRENCY=4
SCHEDULER_MAX_ATTEMPTS=5
SCHEDULER_STALE_LOCK_MINUTES=15
RSS_POLL_MINUTES=15
EVERGREEN_CHECK_MINUTES=60
TOKEN_EXPIRY_CHECK_HOURS=24
BULK_ROW_LIMIT=500

# Analytics
ANALYTICS_REFRESH_HOURS=6
PAGE_INSIGHTS_HOURS=24
EDGE_SYNC_HOURS=6
INSTAGRAM_SYNC_HOURS=12
ADS_SYNC_HOURS=12

# Email (Resend)
RESEND_API_KEY=
EMAIL_FROM="MS Social Pilot <noreply@yourdomain.com>"

# AI (Claude)
ANTHROPIC_API_KEY=
AI_MODEL=claude-sonnet-5
AI_RATE_LIMIT_PER_HOUR=100

# Link shortener
SHORTENER_DOMAIN=          # e.g. go.yourdomain.com; blank uses APP_URL/l/

# Media
MEDIA_STORAGE=local        # local | s3
MEDIA_DIR=./media
MAX_UPLOAD_MB=25
# S3_BUCKET= S3_REGION= S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY= S3_ENDPOINT=

# i18n
DEFAULT_LOCALE=en          # en | fr

# Serverless trigger
CRON_SECRET=               # blank disables POST /api/cron/tick
```

Every variable above except `DATABASE_URL`, `SESSION_SECRET` and
`ENCRYPTION_KEY` is also editable on Settings → Configuration, which wins over
the environment. `src/lib/settings/definitions.ts` is the source of truth for
all three lists, and `tests/configuration-docs.test.ts` fails if this block,
`.env.example` and the registry stop agreeing.

**Per-workspace settings** (in the UI, not env): timezone, default locale,
require approval, queue slots, UTM defaults, shortener on/off, AI tone and brand
voice, branding, notification preferences.

---

## 7. Screens

| Route | Purpose |
|---|---|
| `/login`, `/register`, `/invite/[token]` | Auth and invitation acceptance |
| `/dashboard` | Stats, upcoming, recent, health warnings |
| `/compose` | Composer + AI + destinations + timing |
| `/calendar` | Month grid |
| `/posts` | List with filters and per-destination status |
| `/approvals` | **new** — pending queue for approvers |
| `/accounts` | Facebook connections and destinations |
| `/feeds` | **new** — RSS sources |
| `/reports` | **new** — analytics and export |
| `/settings` | Workspace, queue, UTM, AI, branding, bulk CSV |
| `/settings/team` | **new** — members, roles, invitations |
| `/settings/notifications` | **new** — per-user preferences |
| `/l/[slug]` | Short link redirect (public) |
| `/data-deletion` | Meta-required status page (public) |

---

## 8. Explicit non-goals

Not built, so nobody is surprised:

- Any network other than Facebook Pages and Groups.
- Billing, plans, usage limits, white-label domains.
- Editing a post after it is published (Facebook cannot change attachments).
- A social inbox / comment moderation.
- Native mobile apps.
- A public API for third parties.
- Real-time collaborative editing.

---

## 9. Risks

| Risk | Impact | Response |
|---|---|---|
| **Meta refuses `publish_to_groups`** | Groups never work | Highest-likelihood risk on the list. Pages are unaffected; Groups stay behind the existing flag. Do not build a plan around Groups until approval is in hand. |
| **App Review delay for `pages_manage_posts`** | Cannot onboard real users | Days to weeks. Development mode works for app-role users throughout; start the submission early. |
| **Evergreen trips error 506** | Recycled posts rejected | Variants are mandatory in practice; UI warns when only one exists. |
| **Shortened links break preview cards** | Posts look bare | Clean 302 to an OG-tagged URL, with a test. |
| **AI cost runs away** | Unexpected bill | Per-workspace hourly cap, every call logged with token counts. |
| **RSS floods the queue** | Dozens of posts at once | First poll takes only items newer than subscription; per-poll item cap. |
| **Client data leaking across workspaces** | Serious | Workspace scoping becomes a security boundary with dedicated cross-tenant tests. |
| **Local media on one VPS** | Loss on disk failure | Persistent volume plus backups; S3 interface ready if it outgrows one box. |

---

## 10. Build order

Delivered in one piece, but built in this dependency order:

1. **Postgres migration** — provider swap, native enums and `Json`, migrations,
   Docker Compose. Everything else assumes it.
2. **i18n scaffolding** — `next-intl`, message extraction, error messages moved
   to keys. Earlier is cheaper: every later feature adds strings.
3. **Email + notification settings** — Resend, templates, `EmailLog`.
   Prerequisite for invitations and approvals.
4. **Multi-workspace** — switcher, `getAuthContext` rework, cross-tenant tests.
5. **Invitations**, then **approval workflow** (needs roles and email).
6. **Content features** — link shortener + UTM, AI captions, evergreen, RSS.
7. **Reports and export.**
8. **Token expiry job**, worker job scheduler, final documentation.

Test coverage grows with each step; the existing 92 tests must stay green
throughout, and the scheduler's integration suite is extended to cover approval
gating, evergreen recycling and RSS ingestion.

---

## 11. Open questions

1. **Short link domain** — which domain/subdomain, and can you point DNS at the
   VPS? Blank means `APP_URL/l/<slug>`.
2. **French copy** — machine-translated first pass for you to correct, or will
   you supply the translations?
3. **AI model** — `claude-sonnet-5` assumed. Fine, or prefer the cheaper
   `claude-haiku-4-5-20251001` or higher-quality `claude-opus-5`?
4. **Sending domain for Resend** — needs DNS verification before it can send to
   arbitrary addresses.
5. **Approval granularity** — is per-workspace on/off enough, or should approval
   depend on the destination (e.g. only the main brand Page needs sign-off)?

---

## 12. Amendment — full Graph coverage

Agreed after the original build. This widens the original scope, which was
"Facebook Pages and Groups only", so it is recorded here rather than folded
silently into the sections above.

### What changed

**The metric catalogue is now everything Meta documents** — 354 insight names
plus 110 Ads Insights fields, across five levels:

| Level | Names | Read from |
| --- | --- | --- |
| Page | 168 | `{page-id}/insights` |
| Post | 77 | `{post-id}/insights` |
| Video | 58 | `{video-id}/video_insights` |
| Instagram account | 28 | `{ig-user-id}/insights` |
| Instagram media | 23 | `{ig-media-id}/insights` |
| Ads | 110 fields | `{act_id}/insights` |

Deprecated names are listed, not deleted. A metric Meta removed in v4.0 still
appears tagged `deprecatedFrom`, so an empty chart carries a reason.

**Graph edges beyond `/insights`** are now read and stored: post comments (with
hide, unhide, delete and reply), Page ratings, inbox conversations, Page videos,
and `published_posts` — the last of these being what stops every Page-level
report from understating a Page whose team also posts from the Facebook app.

**Instagram Business analytics and Ads Insights** are read through the same
connected Page and user tokens. Instagram is analytics only; publishing to it is
a separate piece of work. Ads is read-only — `ads_read` is requested and
`ads_management` never is.

### Permissions

Three new permission families, each behind a flag because Meta reviews them
separately and requesting an unapproved one fails the entire consent dialog:

| Flag | Scopes | Unlocks |
| --- | --- | --- |
| `FACEBOOK_ENABLE_MESSAGING` | `pages_messaging`, `pages_manage_metadata` | Inbox tab |
| `FACEBOOK_ENABLE_INSTAGRAM` | `instagram_basic`, `instagram_manage_insights` | Instagram tab and job |
| `FACEBOOK_ENABLE_ADS` | `ads_read` | Ads tab and job |

Comments, ratings, videos and `published_posts` need only `pages_read_engagement`
and `pages_manage_engagement`, which the app already requests — so those tabs
work without any new app review.

### Worker

Three jobs added: `edges` (4h, always on), `instagram` (12h) and `ads` (12h).
The last two are not scheduled at all while their flag is off, so an unapproved
app does not spend its rate limit on a permission error every twelve hours.

### Open question added

6. **App review** — Instagram insights and Ads read both need Meta review
   against a live app. Do you want those submitted, or should the product ship
   Facebook-only with the flags left off?
