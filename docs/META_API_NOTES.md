# Meta Graph API notes

Facts learned against live data and Meta's documentation, with the date each
was checked. Add new findings here, dated.

## Client and versions

- Graph version is the `FACEBOOK_GRAPH_VERSION` setting (v26 era). Page ratings
  use `RATINGS_GRAPH_VERSION = v21.0` until Meta retires v21.
- Client: `src/lib/facebook/graph.ts` (`graphRequest`, `graphPaged`). Usage is
  tracked from the `x-app-usage` header (`src/lib/facebook/budget.ts`), per Page
  and per worker job (`call-source.ts`); background syncs stand aside when
  usage is high. Root › Platforms › Meta › API usage shows it.
- The app sends `appsecret_proof` on every call, so Graph API Explorer calls
  fail against this app. Test through the app instead (for example
  `POST /api/analytics/<targetId>` with
  `{"action":"probe","period":"day","level":"page"}` from a signed-in browser).

## Verified facts (2026-10-11, live data)

- **Reactions**: read `reactions.summary(total_count)`, not `likes`; the likes
  edge counts only "Like" (a post with 78 reactions read 64). Insights'
  `post_reactions_by_type_total` has no "care" bucket, so "Reactions by type"
  can differ slightly from the total.
- **Followers by country / city**: `page_follows_country` and
  `page_follows_city` return data only with `period=day` (lifetime gives "No
  data returned"). `page_fans_*` breakdowns are gone; age/gender
  (`page_fans_gender_age`) and language (`page_follows_locale`) are rejected
  with `(#100) The value must be a valid insights metric`, with no replacement.
- **Impressions and reach**: impressions were retired (Nov 2025) and reach
  (`*_impressions_unique`) with v26 (Jul 2026). Use `page_media_view` (views)
  and `page_total_media_view_unique` (viewers); for posts `post_media_view` and
  `post_total_media_view_unique`.
- **New / lost followers**: `page_daily_follows_unique` and
  `page_daily_unfollows_unique` (`page_fan_adds/removes` withdrawn).
- **Comments**: a Page cannot hide its own comments (`(#200) Can not hide or
  unhide this comment`); reply and delete work. The app hides the Hide button
  for them.
- **Native scheduling**: deleting a post scheduled with `scheduled_publish_time`
  removes it from Facebook; the app does this on cancel.
- **Groups**: Meta removed Groups API publishing on 22 Apr 2024
  (`publish_to_groups` and `groups_access_member_info` no longer exist). The
  `FACEBOOK_ENABLE_GROUPS` switch is kept so old configurations load, but adds
  no scopes; leave it off.
- **Reels**: `video_reels` start → upload → finish with `video_state=PUBLISHED`.
  **Stories**: `photo_stories` (photo uploaded unpublished first) and
  `video_stories`. Neither can be natively scheduled; Pages only.
- **Messenger**: replies only within the 24-hour standard window
  (`messaging_type: RESPONSE`).
- **Instagram**: publish through containers then `media_publish`; captions have
  no clickable links; no text-only posts; no native scheduling (the worker
  publishes when due); media must be an https URL Instagram can fetch (signed
  links from `src/lib/media-links.ts`), so `APP_URL` must be public. Instagram
  professional accounts are reached with the linked Page's token; there is no
  separate Instagram login. `impressions` and `plays` were retired on 21 Apr
  2025; `views` is read instead.

## Reach by country or city (2026-10-13)

The Page Insights reference lists no reach or impressions metric broken down by
country or city; the only geographic breakdowns left are `page_follows_country`
and `page_follows_city`. A "followers / reached" toggle on the audience map
cannot be built for Facebook Pages.

## Place tags, mentions and text backgrounds (2026-10-13)

- `place` (a place Page's id) is accepted on feed and multi-photo posts.
  Mentions are written `@[page-id]` in the text, as Graph documents. Searching
  places or Pages by name needs Page Public Content Access (not requested).
- Coloured backgrounds use `text_format_preset_id`, which Meta's reference does
  not list (ids taken from Facebook's own site, `src/lib/text-backgrounds.ts`).
  Text-only, at most 130 characters, feed posts only. Ids can change without
  notice; not yet tried on a live Page.

## Earnings (2026-10-12, documentation only)

Earnings metrics are estimates and only for Pages enrolled in Meta's
monetisation programmes; the token holder must be able to see monetisation
insights.
- Page: `monetization_approximate_earnings` (day / week / days_28 / month,
  breakdown `monetization_tool`), `content_monetization_earnings` (day / week /
  days_28, breakdown `earning_source`; "in development", added v23),
  `page_daily_video_ad_break_earnings_by_crosspost_status` (+ `_cpm_`, `_ad_impressions_`).
- Post: `monetization_approximate_earnings`, `content_monetization_earnings`,
  `post_video_ad_break_earnings`, `post_video_ad_break_ad_cpm`,
  `post_video_ad_break_ad_impressions`, `creator_monetization_qualified_views`.

They are in the catalogue (`src/lib/facebook/metrics.ts`, monetisation
category); the probe decides per Page whether Meta serves them, and screens show
nothing rather than 0 when it does not. Confirm on a monetised Page before
promising the figure.

## Permissions

Requested scopes come from `src/lib/facebook/permissions.ts` and the
`FACEBOOK_SCOPES` setting. Base: `pages_show_list`, `pages_read_engagement`,
`pages_manage_posts`, `pages_manage_engagement`, `pages_read_user_content`,
`read_insights`, `business_management`. Feature switches add more:

| Switch | Adds |
|---|---|
| Inbox (`FACEBOOK_ENABLE_MESSAGING`) | `pages_messaging`, `pages_manage_metadata` |
| Instagram (`FACEBOOK_ENABLE_INSTAGRAM`) | `instagram_basic`, `instagram_manage_insights`, `instagram_content_publish` |
| Ads (`FACEBOOK_ENABLE_ADS`) | `ads_read` |

Asking for a scope the app is not approved for fails the whole consent dialog,
which is why the extras are behind switches. If nobody can connect after a
switch was turned on, turn it back off. In development mode every permission
works, but only for people with a role on the Meta app.

## Setting up a Meta app

1. developers.facebook.com → Create App → use case Other → type Business;
   connect a verified Business Portfolio.
2. App ID and secret go in Root › Platforms › Meta.
3. Add Facebook Login for Business. Valid OAuth redirect URI:
   `https://<domain>/api/facebook/callback` (must match `APP_URL` exactly);
   Client and Web OAuth login on, Enforce HTTPS on.
4. Settings › Advanced: require app secret proof.
5. Callbacks (required for App Review): deauthorize
   `https://<domain>/api/facebook/deauthorize` and data deletion
   `https://<domain>/api/facebook/data-deletion`. Both verify Facebook's
   `signed_request`; deauthorize flags the connection for reconnecting, data
   deletion destroys stored tokens, cancels queued posts and returns a
   confirmation code.
6. Privacy policy `/privacy-policy`, terms `/terms`, data deletion page
   `/data-deletion`.

## Troubleshooting

- "URL blocked: this redirect failed": `APP_URL` does not match the redirect URI
  byte for byte (a trailing slash counts).
- "Invalid Scopes": development mode and the account has no role on the app, or
  the permission is not approved.
- Posts fail an hour after connecting: the long-lived token exchange
  (`exchangeForLongLivedToken`) was skipped.
- Error 190 subcode 460: password changed or access revoked; only reconnecting
  fixes it, so the app stops retrying.
- Error 200 "requires pages_manage_posts": the user's role on that Page lacks
  the `CREATE_CONTENT` task.
- Error 506 "duplicate status message": identical content twice in quick
  succession; not retried.
- Stale link preview: "Refresh card" in the composer calls the scrape endpoint.
- No Instagram accounts: the account must be Business or Creator and linked to
  a connected Page.
- Instagram "could not process the file": aspect ratio, length or codec; the
  reason is passed to the post list.

## App Review (status 2026-10-13)

- App **MS-Social-Pilot**, ID 699780715171676; business verification passed.
  The Meta DevTools MCP (`devtools_app`, `devtools_app_review`,
  `devtools_api_usage`, `devtools_api_changelog`, `devtools_compliance`,
  `devtools_webhook_*`) is connected for it. Check the live state with
  `devtools_app_review status|privileges`.
- **Step 1** (Pages, insights, business, ads): submitted 2026-10-10, submission
  1483029746846765. Screencasts are on the GitHub release
  `meta-review-screencasts-2026-10-10` (not in git).
- **Step 2** (Inbox and Instagram), not submitted; Meta reviews one submission
  at a time. Permissions and use cases:
  - `pages_messaging`: list the Page's Messenger conversations and send the
    replies the person types, only within the 24-hour window, never on its own.
  - `pages_manage_metadata`: required with `pages_messaging` to read the Page's
    conversations; changes no Page settings.
  - `instagram_basic`: find the Instagram professional account linked to a
    Page, show it as a destination, list its media.
  - `instagram_manage_insights`: the account's reach, views, profile views,
    followers and each post's results in Analytics and reports.
  - `instagram_content_publish`: publish photos, carousels and Reels when the
    person presses Publish or a scheduled post comes due.
  Before recording: turn on Inbox and Instagram in Root › Platforms › Meta and
  reconnect Facebook once (app admins can use the permissions in development
  mode). Reviewer steps must use the current UI: Workspace › Channels to
  connect, New post to publish, Inbox for messages, Analytics for Instagram
  figures. The reviewer test account's password is typed by the owner only.
- After approval: switch the app to Live, keep the switches on, and each
  workspace reconnects Facebook once.
- Later: `ads_management` (to promote posts) and Page Public Content Access
  (place and Page search, competitor benchmarks) would each need their own review.

## Documentation

- https://developers.facebook.com/docs/graph-api/
- https://developers.facebook.com/documentation/pages-api/platforminsights/page.md
