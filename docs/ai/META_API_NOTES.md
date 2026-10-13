# Meta Graph API — what this codebase learned the hard way

Graph version pinned by `FACEBOOK_GRAPH_VERSION` (v26 era). Ratings use
`RATINGS_GRAPH_VERSION = v21.0`. Client: `src/lib/facebook/graph.ts`
(`graphRequest`, `graphPaged`, budget tracking in `budget.ts` from the
`x-app-usage` header; background syncs stand aside when usage is high).

## Facts verified against live data (2026-10-11)
- **Reactions:** read `reactions.summary(total_count)`, not `likes` — the likes
  edge counts only 👍 (a post with 78 reactions read 64). Insights'
  `post_reactions_by_type_total` has no "care" bucket.
- **Followers by country/city:** `page_follows_country` / `page_follows_city`
  return data only with `period=day` (lifetime → "No data returned").
  `page_fans_*` breakdowns are gone; age/gender (`page_fans_gender_age`) and
  language (`page_follows_locale`) are rejected with `(#100) The value must be a
  valid insights metric` — no replacement.
- Impressions were retired (Nov 2025) and reach (`*_impressions_unique`) with v26
  (Jul 2026): use `page_media_view` (views) and `page_total_media_view_unique`
  (viewers); for posts `post_media_view` / `post_total_media_view_unique`.
- New/lost followers: `page_daily_follows_unique` / `page_daily_unfollows_unique`
  (`page_fan_adds/removes` withdrawn).
- A Page **cannot hide its own comments**: `(#200) Can not hide or unhide this
  comment`. Reply and delete work.
- Deleting a natively scheduled post (`scheduled_publish_time`) removes it from
  Facebook; the app does this on cancel.
- The app enforces **appsecret_proof**, so Graph API Explorer calls fail; test
  through the app (e.g. `POST /api/analytics/<targetId>` with
  `{"action":"probe","period":"day","level":"page"}` from the signed-in browser).
- Groups API publishing was removed by Meta on 22 Apr 2024
  (`publish_to_groups` etc. are filtered out of scopes).
- Reels: `video_reels` start → upload → finish with `video_state=PUBLISHED`.
  Stories: `photo_stories` (photo uploaded unpublished first) / `video_stories`.
  Neither can be natively scheduled; Pages only.
- Messenger replies only within the 24-hour standard messaging window
  (`messaging_type: RESPONSE`).
- Instagram: publish via containers then `media_publish`; captions carry no
  clickable link; needs an https media URL (signed media links from
  `media-links.ts`).

## Earnings (H17, checked 2026-10-12 against the docs, not yet live)
The Page Insights reference still lists earnings metrics, all estimates
("the final amount may differ") and only for Pages enrolled in Meta's
monetisation programmes; the token holder must be able to see the Page's
monetisation insights:
- Page: `monetization_approximate_earnings` (day/week/days_28/month,
  breakdown `monetization_tool`), `content_monetization_earnings` (day/week/
  days_28, breakdown `earning_source`; marked "in development", added v23),
  `page_daily_video_ad_break_earnings_by_crosspost_status` (+ `_cpm_`,
  `_ad_impressions_`).
- Post: `monetization_approximate_earnings`, `content_monetization_earnings`,
  `post_video_ad_break_earnings`, `post_video_ad_break_ad_cpm`,
  `post_video_ad_break_ad_impressions`, `creator_monetization_qualified_views`.
The app lists them in the catalogue (`metrics.ts`, category monetisation);
the probe decides per Page whether Meta serves them. A Page not enrolled gets
no rows, and the screens say nothing rather than showing 0. Confirm on a
monetised Page before promising the figure to anyone.

## Permissions (see `src/lib/facebook/permissions.ts`, `env.facebookScopes`)
Base: pages_show_list, pages_manage_posts, pages_read_engagement,
pages_manage_engagement, read_insights, business_management (+ ads_read when ads
on). Feature-gated: messaging → pages_messaging, pages_manage_metadata;
instagram → instagram_basic, instagram_manage_insights, instagram_content_publish.
Asking for a scope the app is not approved for breaks the whole consent dialog —
that is why the extras are behind switches.

## Tools
- Meta DevTools MCP (connected): `devtools_app_list`, `devtools_app`
  (basic_settings, advanced_settings, security, restrictions), `devtools_app_review`
  (status, history, privileges, requirements), `devtools_api_usage`,
  `devtools_api_changelog`, `devtools_compliance`, `devtools_webhook_*`,
  `devtools_discovery`. App ID 699780715171676.
- Docs: https://developers.facebook.com/docs/graph-api/ and
  https://developers.facebook.com/documentation/pages-api/platforminsights/page.md

## Reach by country or city (checked 2026-10-13)

The current Page Insights reference
(developers.facebook.com/documentation/pages-api/platforminsights/page.md)
lists no reach or impressions metric broken down by country or city; the only
geographic breakdowns left are `page_follows_country` and `page_follows_city`.
The deprecated-metrics page retires the whole `page_impressions*` family and
every `*_by_country_unique` / `*_by_city_unique` click metric. So the
"fans / reached" toggle on the audience maps cannot be built for Facebook Pages:
there is no "reached" side to show.
