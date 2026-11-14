# Meta App Review — resubmission package

App **MS-Social-Pilot** (ID 699780715171676), Business type, Facebook Login for Business. Site:
https://social.newsgeet.com. Data controller: ANASSO TRAVAUX (56 Hay Ghizlan Ain Aouda, Temara, Morocco),
contact@newsgeet.com. Reviewer test account: `meta-review@newsgeet.com` (password only in the submission form),
signed into its own empty workspace « Meta Review's workspace ».

Last updated 2026-11-14.

## 1. Status per permission

| # | Permission | Status | Video | Needs from the owner |
|---|---|---|---|---|
| 01 | pages_show_list | Approved 2026-10-24; video re-recorded on the new design | `01-pages_show_list.mp4` | — |
| 02 | business_management | Approved 2026-10-24; video re-recorded | `02-business_management.mp4` | — |
| 03 | pages_read_engagement | Ready | `03-pages_read_engagement.mp4` | — |
| 04 | read_insights | Ready | `04-read_insights.mp4` | — |
| 05 | pages_read_user_content | Ready | `05-pages_read_user_content.mp4` | — |
| 06 | pages_manage_posts | Recorded 2026-11-11 (old menu names); new script ready | `06-pages_manage_posts.mp4` | Allow or run `node v06.js` (publishes one post) |
| 07 | pages_manage_engagement | Recorded 2026-11-11 (old menu names); new script ready | `07-pages_manage_engagement.mp4` | Allow or run `node v07.js` (one public reply, hide, show) |
| 08 | pages_messaging | To record | — | Send a fresh Messenger message to one Page (24-hour reply window) |
| 09 | pages_manage_metadata | To record | — | Reconnect Facebook so the webhook subscription covers all Pages, then leave a comment |
| 10 | instagram_basic | To record | — | Link an Instagram professional account to a Page, then Reconnect |
| 11 | instagram_content_publish | To record | — | Same as 10 |
| 12 | instagram_manage_comments | To record | — | Same as 10, plus one visitor comment on Instagram |
| 13 | instagram_manage_insights | To record | — | Same as 10 |
| 14 | ads_read | Ready | `14-ads_read.mp4` | — |
| 15 | ads_management | Script ready (`v15.js`: campaign 01 off then on) | — | Allow or run `node v15.js` (blocked by the session's safety check) |

Every video: 1920×1080, English captions naming the permission, a red box and dot on each click, starting on the
app's sign-in page. The owner records the Facebook Login / permission grant (Facebook's own screens) once and it is
placed at the start of each video before upload. Recorder: `tools/review-recordings` (`node v01.js` …).

## 2. Texts for the submission form
### pages_show_list — 01-pages_show_list.mp4
MS Social Pilot lets a person manage the Facebook Pages they run. After Facebook Login we list the Pages the person
manages (Settings › Channels and the "Choose channels" window) so they can pick which Pages this workspace uses. The
chosen Pages are then offered as destinations in the post composer and in Insights. We only list the person's own Pages.

### business_management — 02-business_management.mp4
Many Pages and ad accounts belong to a Meta business portfolio. We use business_management to find the Pages and ad
accounts of the portfolios the person can use, show them in the "Choose channels and ad accounts" window, and let the
person choose which ones the workspace uses (for example the "Top Recettes" ad account, then shown in Ads).
We do not change business settings, people or assets.

### pages_read_engagement — 03-pages_read_engagement.mp4
We read the person's own Page posts and their engagement (reactions, comments, shares, views) to show them in Posts and
in Post explorer, where opening a post shows all its figures. The data is shown only to members of the workspace that
connected the Page.

### read_insights — 04-read_insights.mp4
We read Page Insights (views, reach, engagement, followers by country and city) for the Pages the person connected and
show them in Insights (Overview and Audience), with a "Sync now" button to refresh them. Figures are shown only to the
person's workspace and in the reports they download.

### pages_read_user_content — 05-pages_read_user_content.mp4
Visitors leave comments on the person's Page posts. We read those comments to show them in the Inbox with the post they
were left on, so the person can answer them. We do not read content from Pages the person does not manage.

### pages_manage_posts — 06-pages_manage_posts.mp4
The person writes a post in the composer, chooses one of their Pages, adds a photo and presses Publish now (or schedules
it). We create the post on the Page with pages_manage_posts; it then appears in Posts as Published with a link to it on
Facebook. We also use it to delete a post the person asks us to delete. We only publish what the person writes.

### pages_manage_engagement — 07-pages_manage_engagement.mp4
In the Inbox the person answers visitors' comments on their Page: a public reply as the Page, and Hide / Show again to
moderate a comment. The video replies "Merci ! 😊" to a real comment, hides it, then shows it again. We act only when
the person presses the button.


### pages_messaging — 08-pages_messaging.mp4 (draft)
Visitors write to the person's Page on Messenger. The conversation appears in Inbox › Messages with its history, and
the person answers it from the app; the reply is sent with the Send API as the Page, within Messenger's 24-hour
window (the app shows when the window has closed and does not offer a reply then). We only send what the person
writes and only to people who wrote to the Page.

### pages_manage_metadata — 09-pages_manage_metadata.mp4 (draft)
We subscribe the person's Pages to webhooks (feed and messages) so a new comment or message reaches the Inbox within
seconds instead of at the next scheduled read. The video leaves a comment on a Page post and shows it arriving in the
Inbox. We do not change any Page setting.

### instagram_basic — 10-instagram_basic.mp4 (draft)
After the person links an Instagram professional account to their Page, we read its profile (name, picture) and its
media so it can be chosen as a channel and its posts listed in the app, next to the Facebook Pages.

### instagram_content_publish — 11-instagram_content_publish.mp4 (draft)
The person writes a post, adds a picture, selects their Instagram account and publishes (or schedules) it; the post
then appears in Posts as Published with a link to it on Instagram. We only publish what the person writes.

### instagram_manage_comments — 12-instagram_manage_comments.mp4 (draft)
Comments on the person's Instagram posts appear in the Inbox; the person replies, hides or deletes a comment from the
app. We act only when the person presses the button.

### instagram_manage_insights — 13-instagram_manage_insights.mp4 (draft)
We read the Instagram account's reach, impressions and follower figures and each post's engagement to show them in
Insights next to the Pages, and in the reports the person downloads.

### ads_read — 14-ads_read.mp4 (draft)
For the ad accounts the person chooses, we read campaigns, ad sets, ads and their daily results (spend, impressions,
clicks, CTR, CPC, CPM) and show them in Ads › Overview and Ads › Manage, with comparisons and CSV export.

### ads_management — 15-ads_management.mp4 (draft)
In Ads › Manage the person turns a campaign, ad set or ad on or off, changes a budget, renames it, or creates a new
campaign that starts paused. Each change is previewed and confirmed by the person before it is sent, and is listed in
Ads › Manage › History. Nothing is changed without the person's action.

## 3. Meta dashboard tasks (owner) — checked 2026-11-14 through the Meta developer tools
- Done: display name « MS Social Pilot »; privacy policy and terms URLs; deauthorize callback; OAuth redirect URIs
  (only `https://social.newsgeet.com/api/connections/facebook/callback` left); App Review can be submitted
  (privacy policy and business verification pass). In the review draft, every requested permission has its use case
  and data-use checkup done; only the screencast is missing.
- Done 2026-11-14: Data deletion URL `https://social.newsgeet.com/data-deletion` (public instructions page; the signed
  callback `…/api/platforms/facebook/data-deletion` also answers); contact email changed to contact@newsgeet.com.
- To do — **verify contact@newsgeet.com** (click the link in Meta's email; « Resend » on App settings › Basic).
- During the review window two-step sign-in is « off » in Root (so the reviewer can sign in); set it back to
  « admins » after approval.

## 4. Order of work left
1. Owner: send a Messenger message to a Page → record 08 within 24 hours.
2. Owner: link the Instagram professional account and Reconnect Facebook → record 09–13.
3. Owner: choose the ads change → record 14–15.
4. Owner: say yes to re-recording 06 and 07 (one real post, one real reply) so all videos show the same design.
5. Owner: record the Facebook Login / grant clip once; Claude places it at the start of each video.
6. Submit the 13 permissions still under review with these texts and videos.
