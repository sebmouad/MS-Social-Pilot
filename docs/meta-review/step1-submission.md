# MS Social Pilot — Meta App Review (Advanced Access)

App: **MS-Social-Pilot** (ID 699780715171676) · Live at https://social.newsgeet.com
Business verification: passed · Privacy policy: set · Compliance: no open actions

## What the app is (for the "App details / platform" step)

MS Social Pilot is a publishing and analytics tool for people who manage several
Facebook Pages. A user signs in to MS Social Pilot, connects their Facebook profile
with Facebook Login for Business, picks the Pages they manage, and then from one
place: writes and schedules posts (with an optional first comment), sees each
Page's results, and answers and moderates comments. The app only acts on Pages
the person has chosen to connect, and only when that person (or a teammate they
invited) asks it to.

## Reviewer instructions (paste into "How to test")

1. Open https://social.newsgeet.com and sign in with the test account below.
2. Go to **Connections** (plug icon, top right) → **Connect Facebook**. Log in with
   a Facebook account that manages a Page, and allow the requested permissions.
3. The Pages appear under the profile. Tick the one to use.
4. **Publish:** Schedule → Compose. Tick the Page, write a message, optionally a
   first comment, choose "Publish now" or a time, press Publish/Schedule. The post
   appears on the Page; the first comment is added as the Page.
5. **Comments:** Analytics → Comments. Pick the Page; its comments are read by the worker on its own.
   Reply, hide or delete a comment; the change happens on Facebook.
6. **Insights:** Analytics → Analysis / Overview / By post for the Page.

Test account for the app: **meta-review@newsgeet.com** (Admin in the workspace).
Password: typed into Meta's form by the account owner, not stored here.

---

## Per permission

### pages_show_list
**Use case:** After a person connects their Facebook profile, MS Social Pilot
lists the Pages they manage so they can choose which ones to publish to and
report on. The list is shown on the Connections screen and as destinations in
the composer. Without it, the person cannot pick a Page.
**Screencast:** Connections → Connect Facebook → Facebook Login dialog showing the
permissions → back in the app, the Pages listed under the profile → tick one.

### pages_manage_posts
**Use case:** MS Social Pilot publishes posts the person writes in its composer
to the Pages they selected, immediately or at a time they schedule, and can post
a first comment on the post as the Page. Posts are only created when the person
presses Publish or Schedule, or when a post they scheduled comes due.
**Screencast:** Compose → tick the Page → write text (+ first comment) → Publish now
→ open the Page on Facebook and show the post and its first comment.

### pages_read_engagement
**Use case:** MS Social Pilot reads the Page's posts, their reactions, comments
and shares, and the Page's follower count, so the person sees how each post did
and can answer comments in one place. Data is shown only to the people in the
person's workspace.
**Screencast:** Analytics → By post (reactions, comments, shares per post) →
Analytics → Comments → comments, read automatically, listed under each post.

### pages_manage_engagement
**Use case:** From the Comments screen, the person can reply to a comment as the
Page, hide it, unhide it or delete it. Every action is taken only when the person
clicks it and is applied on Facebook straight away.
**Screencast:** Analytics → Comments → Reply to a comment (show it on Facebook) →
Hide a comment (show it hidden on Facebook).

### read_insights
**Use case:** MS Social Pilot reads Page and post insights (reach, views,
engagement, follows) to show each Page's results over a chosen date range,
compare Pages, find the best times to post, and build a report the person can
download or print.
**Screencast:** Analytics → Analysis (KPIs, best times) → Reports → download CSV.

### business_management
**Use case:** Many Pages are owned by a Business portfolio rather than a personal
profile. MS Social Pilot uses business_management only to list the Pages the
person can access through their Business portfolios, so those Pages can be
connected like any other. It does not change any Business settings.
**Screencast:** Connect Facebook with a profile whose Page is in a Business
portfolio → the business-owned Page appears in the list and can be selected.

### pages_messaging
**Use case:** The Inbox screen shows the Page's Messenger conversations and lets
the person reply as the Page, within Facebook's 24-hour window after the
customer's last message. Replies are sent only when the person presses Send; the
app never sends messages on its own.
**Screencast:** Analytics → Inbox → open a conversation → type a reply → Send →
show the reply in the Page's Messenger inbox on Facebook.

### pages_manage_metadata
**Use case:** Requested with pages_messaging so the app can read the Page's
conversation list and keep it in step with Facebook. It does not change Page
settings.
**Screencast:** Same as pages_messaging: the Inbox screen shows the Page's
conversations, read automatically by the worker.

### ads_read
**Use case:** The Ads screen shows read-only results for the ad accounts the
person connects: spend, impressions, clicks, cost per click, and which campaigns
the budget went to, over a chosen date range. The app never creates, edits or
pauses ads (it does not request ads_management).
**Screencast:** Connections → Find ad accounts → tick the account → Ads → Pull
from Facebook → spend and campaign table for the last 30 days.

### instagram_basic
**Use case:** Lists the Instagram professional accounts linked to the person's
connected Pages, with their profile details, so they can be chosen as
destinations and reported on next to the Pages.
**Screencast:** Connections → Instagram accounts → the linked account appears →
turn it on.

### instagram_manage_insights
**Use case:** Shows reach, views and engagement for the Instagram account and its
posts on Analytics → Instagram, over the chosen date range, next to the Page.
**Screencast:** Analytics → Instagram → account figures and the per-post table.

### instagram_content_publish
**Use case:** Publishes a photo post the person writes in the composer to their
Instagram professional account, immediately or at a scheduled time, alongside
the same post on their Facebook Page. Only when the person presses Publish or
Schedule.
**Screencast:** Compose → tick the Instagram account → add a photo and caption →
Publish now → show the post on Instagram.

## Data use checkup answers (every permission)
- Used for: providing the app's features to the person who connected the account.
- Not sold, not shared with third parties, not used for advertising.
- Stored encrypted (tokens) on the app's own server; deleted when the person
  disconnects, and on request via the data-deletion URL.

## Screencast tips (Meta rejects most often for these)
- Show the Facebook Login dialog with the permission list, every time.
- Show the result **on Facebook** for write permissions (post, reply, hide).
- English UI, captions or narration welcome; 1–3 minutes each; MP4.

## Before filming the extra permissions
- Inbox, Ads and Instagram are switched off in Settings → Configuration. They are
  switched on just before filming; as app admin your login is granted them, and
  people who are not admins only get them once Meta approves.
- Instagram needs an Instagram professional account linked to For Lady's (or
  another connected Page) in Meta Business Suite.
- Ads needs an ad account your profile can see.
