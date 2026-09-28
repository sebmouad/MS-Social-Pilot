# Setting up the Meta app

This is the part that blocks people, so it is written as a checklist. Budget an
hour for the setup and several days for App Review.

**You do not have to copy URLs from this page.** Once the app is running, the
**Setup** screen (and **Connections**, for an admin) shows a *Meta app settings*
panel with every value below already built from your `APP_URL` — redirect URI,
callbacks, Graph version and the exact permissions requested — each with a copy
button and the place it goes in Meta's dashboard. It also warns when `APP_URL`
is not https or is still localhost.

Checked against Meta's changelogs as of September 2026; see
[What Meta has retired](#what-meta-has-retired) for the changes that shaped it.

---

## 1. Create the app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) →
   **Create App**.
2. Use case: **Other** → type: **Business**.
3. Connect a Business Portfolio when asked. Advanced access to the Pages
   permissions requires a verified business, so doing this now saves a repeat.

Copy **App ID** and **App Secret** from Settings → Basic into your `.env`:

```env
FACEBOOK_APP_ID="..."
FACEBOOK_APP_SECRET="..."
```

---

## 2. Add Facebook Login

Products → **Facebook Login for Business** (or classic Facebook Login) → Set up.

Under **Facebook Login → Settings**:

| Setting | Value |
|---|---|
| Client OAuth login | Yes |
| Web OAuth login | Yes |
| Valid OAuth Redirect URIs | `https://your-domain.com/api/facebook/callback` |
| Enforce HTTPS | Yes |

The redirect URI must match `APP_URL` **exactly**, including scheme and any
trailing path. `http://localhost:3000/api/facebook/callback` is accepted for
local development.

---

## 3. Turn on app secret proof

Settings → Advanced → Security → **Require app secret proof for server API
calls: Yes**.

This app always sends `appsecret_proof`, so enabling it costs nothing and means
a leaked access token cannot be used without your app secret.

---

## 4. Permissions

### What is asked for by default

These six are requested on every login. They are the minimum for scheduling to
Facebook Pages, and nothing else in the app is switched on until you say so.

| Permission | What you lose without it |
|---|---|
| `pages_show_list` | No Pages appear to connect. |
| `pages_read_engagement` | Page details and post engagement stay empty. |
| `pages_manage_posts` | **Nothing can be published.** |
| `pages_manage_engagement` | Comments can be read but not replied to, hidden or deleted. |
| `read_insights` | Reach, impressions and follower figures stay empty. |
| `business_management` | Pages owned through a Business Portfolio are invisible. |

### The optional ones

Each feature switch on **Settings → Configuration** adds its own permissions.
They are off by default on purpose: **asking for a permission your app has not
been approved for fails the entire consent dialog**, not just that permission —
so a switch turned on too early stops anybody connecting at all.

| Switch | Adds | Gives you |
|---|---|---|
| Page inbox | `pages_messaging`, `pages_manage_metadata` | Reading and answering Messenger threads. |
| Instagram | `instagram_basic`, `instagram_manage_insights`, `instagram_content_publish` | Instagram analytics, and posting to Instagram. |
| Ad spend | `ads_read` | Campaign spend and results. |

The Instagram switch asks for the publishing permission alongside the two
reading ones. That is deliberate: Facebook grants what it has approved and
quietly omits the rest, so asking early costs nothing, and *not* asking would
mean that the day your review comes through, everybody still has to reconnect
before they can post.

### Development mode, and getting out of it

In development mode every permission works immediately — but **only for people
with a role on the app** (Settings → Roles: admins, developers, testers).
Anyone else gets an error at the login dialog. That is a perfectly good way to
run the app for yourself or a small team, indefinitely.

To open it to other people, submit **App Review**. You will need a screencast
of the whole journey — connect, compose, schedule, publish — plus a privacy
policy URL and test credentials. Reviews take several days and are rejected for
unclear screencasts far more often than for anything technical.

Review each permission separately, in the order you actually need them:

| Ask for | To be able to |
|---|---|
| `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights` | Schedule and publish for people who have no role on your app |
| `pages_manage_engagement` | Moderate comments |
| `pages_messaging` | Read and answer the Page inbox |
| `instagram_basic`, `instagram_manage_insights` | Instagram analytics |
| `instagram_content_publish` | **Post to Instagram** — a separate review from the two above |
| `ads_read` | Ad spend reporting |

Until `instagram_content_publish` is granted, Instagram accounts still appear
in the app as destinations, but switched off and saying why. Turn them on from
**Connections** once the review lands.

---

## 5. Callbacks (required for App Review)

Set both in Facebook Login → Settings:

| Field | URL |
|---|---|
| Deauthorize callback URL | `https://your-domain.com/api/facebook/deauthorize` |
| Data deletion request URL | `https://your-domain.com/api/facebook/data-deletion` |

Both are implemented. They verify Facebook's `signed_request` signature and
reject anything unsigned. Deauthorize flags the connection so the UI asks the
user to reconnect; data deletion destroys the stored tokens, cancels queued
posts and returns a confirmation code.

Both must be publicly reachable — Facebook calls them from its own servers.

---

## 6. Groups — not possible any more

Meta removed the Groups API from **every** API version on **22 April 2024**.
`publish_to_groups` and `groups_access_member_info` no longer exist, and no
third-party app can publish to a Group.

The `FACEBOOK_ENABLE_GROUPS` switch is kept so an old configuration still loads,
but it no longer adds those scopes: a permission that does not exist makes the
whole login dialog fail, so turning it on used to stop anybody connecting.
Leave it off.

---

## 7. Instagram (optional)

An Instagram Business or Creator account, linked to one of your Pages, is
reached with that **Page's** token — there is no separate Instagram login. So
the setup is: link the account on Facebook's side, then press **Find Instagram
accounts** on the Connections screen.

```env
FACEBOOK_ENABLE_INSTAGRAM="true"
```

Three things behave differently from Facebook, and they surprise people:

- **Instagram has no text-only post.** A caption with no picture or video is
  refused before anything is sent. RSS auto-posting is therefore Facebook-only,
  and the feeds screen does not offer Instagram destinations.
- **Instagram has no scheduling of its own.** Posts always go out from this
  app's worker at the moment they are due, so the worker has to be running.
- **Instagram fetches your media itself.** It takes a URL, not an upload, which
  means `APP_URL` must be reachable from the public internet for Instagram
  publishing to work at all. See [DEPLOYMENT.md](DEPLOYMENT.md#media-storage).

---

## 8. Testing before review

Development mode gives you everything you need:

1. Settings → Roles → add yourself as Administrator (usually automatic).
2. Roles → Test Users → create one, and give it a test Page.
3. Connect that account in the app and publish to the test Page.

Test Pages are invisible to the public, so you can publish freely.

---

## Troubleshooting

**"URL blocked: this redirect failed"** — `APP_URL` does not match the Valid OAuth
Redirect URI byte for byte. A trailing slash counts.

**"Invalid Scopes: pages_manage_posts"** — the app is in development mode and the
account has no role on it, or the permission has not been approved.

**Posts fail an hour after connecting** — the long-lived token exchange is being
skipped. This app performs it in `exchangeForLongLivedToken`; if you have
modified the callback, that is where to look.

**Error 190, subcode 460** — the user changed their password or revoked access.
Only reconnecting fixes it, which is why the app stops retrying and asks.

**Error 200 / "requires pages_manage_posts"** — approved permission, but the
connected user's *role on that Page* does not allow creating content. Check the
`CREATE_CONTENT` task; the Accounts page shows this per destination.

**Error 506 "duplicate status message"** — Facebook rejects identical content
posted twice in quick succession. Not retryable, and the app does not retry it.

**Link preview shows stale content** — press "Refresh card" in the composer. That
calls the scrape endpoint, which is the documented way to bust Facebook's cache.

**Groups list is empty** — expected. Meta removed the Groups API in April 2024;
see section 6.

**No Instagram accounts found** — the account must be Business or Creator (not
personal) and linked to a Page you have connected here. Check it on Facebook
first: Page → Settings → Linked accounts.

**Instagram post fails with "could not process the file"** — Facebook is
quoting its own rule about the file: aspect ratio, length, or codec. The exact
reason is passed through to the post list.

**Instagram post fails and the Page is fine** — `instagram_content_publish` is
a separate App Review from the Instagram reading permissions. The Connections
screen says which destinations are waiting on it.

**Everything worked and now no one can connect** — you turned on a feature
switch whose permission is not approved yet. Facebook fails the *whole* consent
dialog in that case, not just the one permission. Turn the switch back off.

---

## Where to go next

- [DEPLOYMENT.md](DEPLOYMENT.md) — going live, the worker, backups, key rotation
- [ARCHITECTURE.md](ARCHITECTURE.md) — how publishing, scheduling and tokens work
- The app's own **Setup** screen walks a fresh installation through the first
  few steps, and **Connections** tells you which permissions are actually
  granted for each connected account.

---

## What Meta has retired

Meta retires metrics and edges on its own schedule, often **on every API version
at once**, so pinning an old version does not protect you. What this app does
about each, from Meta's own changelogs:

| When | What | What this app does |
|---|---|---|
| 22 Apr 2024 | Groups API (`publish_to_groups`) removed | Never requested; see §6. |
| 21 Apr 2025 | Instagram `impressions`, `plays` and reel play counts | Not requested; `views` is read instead. |
| v22.0 | Page ratings (`/{page}/ratings`) deprecated | Read up to v21 only; the Reviews view keeps what was stored and says why nothing new arrives. |
| 15 Nov 2025 | Page and post **impressions** and **fans** (`page_impressions`, `post_impressions`, `page_fans*`, `page_fan_adds/removes`) | Not requested; `page_media_view` / `post_media_view` (views), `page_follows*` and `page_daily_follows_unique` / `page_daily_unfollows_unique` are read instead. |
| 29 Jul 2026 (v26.0 release) | Page and post **reach** (`page_impressions_unique`, `post_impressions_unique` and every `*_unique` impressions metric) | Not requested; `page_total_media_view_unique` / `post_total_media_view_unique` (viewers) are read instead. Stored history under the old names still counts — each day is read once, from whichever name it holds. |

The retired names stay listed in the metric catalogue, marked with the date,
so the coverage screen can say "Meta retired this" rather than show a gap.

**Graph API version.** The default is **v25.0**, supported until 29 July 2028.
v21.0, the previous default, expires on 21 January 2027 — if your `.env` pins
`FACEBOOK_GRAPH_VERSION="v21.0"`, change it (and set the app's API version in
Meta's dashboard to match). Between v21 and v25 the only change that touches
this app is Page ratings, above.

**Scheduling on Facebook.** A post Facebook holds (native scheduling) must be
between **10 minutes and 30 days** ahead. Anything later is scheduled by this
app's worker instead; the composer says so rather than letting Graph refuse it.

