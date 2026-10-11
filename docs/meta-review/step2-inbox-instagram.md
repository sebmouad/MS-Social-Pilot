# MS Social Pilot — Meta App Review, step 2 (Inbox + Instagram)

App: **MS-Social-Pilot** (ID 699780715171676) · https://social.newsgeet.com

**When:** only after the step-1 submission (ID 1483029746846765, PENDING since
10 Oct 2026) has been decided. Meta reviews one submission at a time.

**Before recording:** turn on *Inbox* and *Instagram* under Settings →
Configuration → Features, then reconnect Facebook once so the consent dialog
asks for the new permissions. As an app admin, you can use the permissions in
development mode before approval, which is what the screencasts need.

Permissions in this submission:

| Permission | Feature it powers |
| --- | --- |
| pages_messaging | Page Inbox: read and answer Messenger conversations |
| pages_manage_metadata | Required with pages_messaging to read the Page's conversations |
| instagram_basic | Find the Instagram professional account linked to a Page and list its media |
| instagram_manage_insights | Instagram analytics: reach, profile views, media results |
| instagram_content_publish | Schedule and publish Instagram posts, carousels and Reels from the composer |

## Reviewer instructions (paste into "How to test")

The app now has a left sidebar. Every screen named below is in it.

1. Open https://social.newsgeet.com and sign in with the test account:
   **meta-review@newsgeet.com**. The account owner types the password into Meta's form.
2. Sidebar → **Connections** → **Connect Facebook**. Log in with a Facebook account
   that manages a Page linked to an Instagram professional account, and allow the
   requested permissions.
3. **Inbox:** Sidebar → **Pages** (under Analytics) → **Inbox** tab. Pick the Page.
   Press **Pull from Facebook**; the Page's Messenger conversations are listed; open one, type a reply, press Send. The
   reply appears in Messenger.
4. **Instagram analytics:** Sidebar → **Pages** → **Instagram** tab. The linked account's
   followers, reach and recent media with their results are shown.
5. **Instagram publishing:** Sidebar → **New post**. Under "Where to post", tick the
   Instagram account, add a photo, write a caption, press **Publish now**. Open the
   Instagram profile: the post is there.

## Per permission

### pages_messaging
**Use case:** People who manage a Page answer the messages their customers send it
from the same place they plan posts. MS Social Pilot lists the Page's Messenger
conversations and sends the replies the person types. It never sends anything on its
own, and only replies within Meta's 24-hour standard messaging window.
**Screencast:** Pages → Inbox → select the Page → open a conversation → type a reply →
Send → show the reply arriving in Messenger on a phone.

### pages_manage_metadata
**Use case:** The Graph API's Page conversations edge requires it together with
pages_messaging. MS Social Pilot uses it only to read the conversations of Pages the
person connected, so they can be listed and answered in the Inbox. It changes no Page
settings.
**Screencast:** same recording as pages_messaging: send a message to the Page from
another account, press "Pull from Facebook" in the Inbox, and show it in the list.

### instagram_basic
**Use case:** After a Page is connected, MS Social Pilot finds the Instagram professional
account linked to it, shows its name and picture as a destination in the composer, and
lists its recent media on the Instagram analytics tab.
**Screencast:** Connections → the Page shows its linked Instagram account → New post →
the Instagram account appears under "Where to post".

### instagram_manage_insights
**Use case:** The Instagram tab shows the account's reach, impressions, profile views
and follower count over the chosen period, and each post's results, so the person can
compare Instagram with their Facebook Page in one report.
**Screencast:** Pages → Instagram tab → choose "Last 30 days" → the figures and the media
table → Reports → the report including the Instagram section.

### instagram_content_publish
**Use case:** The person writes a post once and publishes it to their Facebook Page and
its Instagram account together, now or at a scheduled time. Photos, carousels and Reels
are published only when the person presses Publish, or when a post they scheduled
comes due.
**Screencast:** New post → tick the Instagram account → add a photo → caption → Publish
now → open Instagram and show the published post.

## After approval

- Under Settings → Configuration, leave Inbox and Instagram on.
- Each workspace reconnects Facebook once to grant the new permissions.
