# Setting up the Meta app

This is the part that blocks people, so it is written as a checklist. Budget an
hour for the setup and several days for App Review.

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

Requested by default (`FACEBOOK_SCOPES` in `.env`):

| Permission | Why it is needed |
|---|---|
| `pages_show_list` | List the Pages the user manages |
| `pages_read_engagement` | Read Page metadata and post engagement |
| `pages_manage_posts` | **Create, schedule and delete posts** |
| `pages_manage_engagement` | Read/manage comments and reactions |
| `read_insights` | Impressions, reach and clicks |
| `business_management` | Pages owned through a Business Portfolio |

While your app is in development mode these work immediately, but **only for
people with a role on the app** (Settings → Roles: admins, developers, testers).
Anyone else gets an error at the login dialog.

To publish for real users, submit **App Review** for `pages_manage_posts`,
`pages_read_engagement`, `pages_show_list` and `read_insights`. You will need a
screencast showing the whole flow — connect, compose, schedule, publish — plus a
privacy policy URL and test credentials. Reviews commonly take several days and
are rejected for unclear screencasts more often than for anything technical.

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

## 6. Groups (optional, read this first)

Meta restricted the Groups API in **April 2024**. Today:

- `/me/groups` returns only Groups where **your specific app is installed**.
- A Group admin installs it via Group Settings → Advanced settings → Apps.
- Publishing needs `publish_to_groups`, which requires separate approval, and
  Meta grants it narrowly.

If, and only if, you have that access:

```env
FACEBOOK_ENABLE_GROUPS="true"
```

That adds `publish_to_groups` and `groups_access_member_info` to the login
request and shows Groups in the UI. Two behavioural differences to expect:

- Group posts use the **user** access token, not a Page token.
- Facebook does **not** support `scheduled_publish_time` for Groups, so native
  scheduling is unavailable — the built-in scheduler handles them instead. The
  composer enforces this rather than letting Graph reject the post.

---

## 7. Testing before review

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

**Groups list is empty** — expected unless a Group admin has installed your app
in that Group. See section 6.
