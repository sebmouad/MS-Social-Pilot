/**
 * The Graph API metric catalogue — everything Meta documents, without exception.
 *
 * Meta churns these hard: a batch was removed in v22 (April 2025) and more are
 * deprecated each version. Two consequences shape this file:
 *
 * 1. **Nothing here is assumed to work.** The catalogue is a list of things
 *    worth *asking for*. `probeMetrics` in analytics.ts finds out which ones
 *    this app, on this Graph version, with these permissions, actually gets —
 *    and the UI shows that rather than a guess. The fetcher bisects on error
 *    100, so one dead name costs only itself.
 *
 * 2. **`deprecatedFrom` is advisory.** It records the version Meta announced
 *    removal in, so a metric that stops returning data has an explanation
 *    instead of looking like a bug. Deprecated names are still listed — that is
 *    what "without exception" means, and Pages older than the deprecation
 *    sometimes keep serving them.
 *
 * Definitions are written as compact `[name, description]` rows grouped by the
 * level/category/period they share, because 400-odd fully-spelled object
 * literals is a file nobody can read.
 *
 * Reference: developers.facebook.com/docs/graph-api/reference/insights
 */

/** Which Graph object the metric is read from. */
export type MetricLevel = 'page' | 'post' | 'video' | 'ig_account' | 'ig_media';

/** Graph's aggregation windows. `lifetime` is only valid for some metrics. */
export type MetricPeriod = 'day' | 'week' | 'days_28' | 'lifetime' | 'total_over_range';

export type MetricCategory =
  | 'reach'
  | 'engagement'
  | 'audience'
  | 'demographics'
  | 'video'
  | 'clicks'
  | 'negative'
  | 'profile'
  | 'messaging'
  | 'monetisation';

export interface MetricDefinition {
  name: string;
  level: MetricLevel;
  category: MetricCategory;
  /** Periods Graph accepts. The first is what we request by default. */
  periods: MetricPeriod[];
  /** Plain-English meaning, shown in the UI next to the number. */
  description: string;
  /**
   * True when the value is a breakdown object (`{ "male.25-34": 120, … }`)
   * rather than a single number.
   */
  breakdown?: boolean;
  /** Graph version that announced removal, if any. */
  deprecatedFrom?: string;
}

/** A row in a group: the metric name and what it means. */
type Row = [name: string, description: string];

interface GroupShape {
  level: MetricLevel;
  category: MetricCategory;
  periods: MetricPeriod[];
  breakdown?: boolean;
  deprecatedFrom?: string;
}

/** Expand `[name, description]` rows that share a level, category and period. */
function group(shape: GroupShape, rows: Row[]): MetricDefinition[] {
  return rows.map(([name, description]) => ({
    name,
    description,
    level: shape.level,
    category: shape.category,
    periods: shape.periods,
    ...(shape.breakdown ? { breakdown: true } : {}),
    ...(shape.deprecatedFrom ? { deprecatedFrom: shape.deprecatedFrom } : {}),
  }));
}

/**
 * Metrics Meta has retired on *every* Graph version, by date rather than by
 * version bump. Pinning an older version does not bring them back: Graph
 * answers "invalid metric" for each. The version recorded is the one that was
 * current when the retirement took effect.
 *
 * Source: developers.facebook.com/docs/platforminsights/page/deprecated-metrics
 * and the v25.0 announcement (developers.facebook.com/blog/post/2026/02/18/).
 */
const RETIRED: Record<string, string[]> = {
  // March 14, 2024.
  'v19.0': [
    'page_consumptions',
    'page_content_activity',
    'page_content_activity_unique',
    'page_content_activity_by_action_type',
    'page_content_activity_by_action_type_unique',
    'page_content_activity_by_age_gender_unique',
    'page_content_activity_by_city_unique',
    'page_content_activity_by_country_unique',
    'page_content_activity_by_locale_unique',
    'page_cta_clicks_by_age_gender_logged_in_unique',
    'page_cta_clicks_by_site_logged_in_unique',
    'page_cta_clicks_logged_in_by_city_unique',
    'page_cta_clicks_logged_in_by_country_unique',
    'page_cta_clicks_logged_in_by_locale_unique',
    'page_call_phone_clicks_by_age_gender_logged_in_unique',
    'page_call_phone_clicks_by_site_logged_in_unique',
    'page_call_phone_clicks_logged_in_by_city_unique',
    'page_call_phone_clicks_logged_in_by_country_unique',
    'page_call_phone_clicks_logged_in_by_locale_unique',
    'page_get_directions_clicks_by_age_gender_logged_in_unique',
    'page_get_directions_clicks_by_site_logged_in_unique',
    'page_get_directions_clicks_logged_in_by_city_unique',
    'page_get_directions_clicks_logged_in_by_country_unique',
    'page_website_clicks_by_age_gender_logged_in_unique',
    'page_website_clicks_by_site_logged_in_unique',
    'page_website_clicks_logged_in_by_city_unique',
    'page_website_clicks_logged_in_by_country_unique',
    'page_website_clicks_logged_in_by_locale_unique',
    'page_daily_follows_by_source_unique',
    'page_daily_unfollows_by_source_unique',
    'page_engaged_users',
    'page_fans_by_like_source',
    'page_fans_by_like_source_unique',
    'page_fans_by_unlike_source',
    'page_fans_by_unlike_source_unique',
    'page_fans_gender_age',
    'page_follows_gender_age',
    'page_follows_locale',
    'page_impressions_frequency_distribution',
    'page_places_checkin_mobile',
    'page_places_checkin_mobile_unique',
    'page_places_checkins_by_age_gender',
    'page_places_checkins_by_city',
    'page_places_checkins_by_country',
    'page_places_checkins_by_locale',
    'page_positive_feedback',
    'page_positive_feedback_unique',
    'page_positive_feedback_by_type',
    'page_positive_feedback_by_type_unique',
    'page_posts_impressions_frequency_distribution',
    'page_views_by_age_gender_logged_in_unique',
    'page_views_by_city_logged_in_unique',
    'page_views_by_country_logged_in_unique',
    'page_views_by_internal_referer_logged_in_unique',
    'page_views_by_locale_logged_in_unique',
    'page_views_by_profile_tab_logged_in_unique',
    'page_views_by_profile_tab_total',
    'page_views_by_referers_logged_in_unique',
    'page_views_by_site_logged_in_unique',
    'page_views_external_referrals',
    'page_views_logged_in_total',
    'page_views_logged_in_unique',
    'page_views_login',
    'page_views_login_unique',
    'page_views_logout',
    'post_activity',
    'post_activity_unique',
    'post_impressions_fan_paid',
    'post_impressions_fan_paid_unique',
  ],
  // November 15, 2025: impressions become views, Page likes become follows.
  'v24.0': [
    'page_fans',
    'page_fans_locale',
    'page_fans_city',
    'page_fans_country',
    'page_fan_adds',
    'page_fan_adds_unique',
    'page_fan_removes',
    'page_fan_removes_unique',
    'page_impressions',
    'page_impressions_paid',
    'page_impressions_viral',
    'page_impressions_nonviral',
    'post_impressions',
    'post_impressions_paid',
    'post_impressions_fan',
    'post_impressions_organic',
    'post_impressions_viral',
    'post_impressions_nonviral',
  ],
  // June 2026: reach becomes viewers, and the 3-second viewer counts go.
  'v25.0': [
    'page_impressions_unique',
    'page_impressions_paid_unique',
    'page_impressions_viral_unique',
    'page_impressions_nonviral_unique',
    'page_posts_impressions',
    'page_posts_impressions_unique',
    'page_posts_impressions_paid',
    'page_posts_impressions_paid_unique',
    'page_posts_impressions_organic_unique',
    'page_posts_served_impressions_organic_unique',
    'page_posts_impressions_viral',
    'page_posts_impressions_viral_unique',
    'page_posts_impressions_nonviral',
    'page_posts_impressions_nonviral_unique',
    'page_video_views_unique',
    'post_impressions_unique',
    'post_impressions_paid_unique',
    'post_impressions_fan_unique',
    'post_impressions_organic_unique',
    'post_impressions_viral_unique',
    'post_impressions_nonviral_unique',
    'post_video_views_unique',
    'post_video_views_organic_unique',
    'post_video_views_paid_unique',
    'total_video_impressions',
    'total_video_impressions_unique',
    'total_video_impressions_paid',
    'total_video_impressions_paid_unique',
    'total_video_impressions_organic',
    'total_video_impressions_organic_unique',
    'total_video_impressions_viral',
    'total_video_impressions_viral_unique',
    'total_video_impressions_fan',
    'total_video_impressions_fan_unique',
    'total_video_impressions_fan_paid',
    'total_video_impressions_fan_paid_unique',
    'total_video_views_unique',
    'total_video_views_organic_unique',
    'total_video_views_paid_unique',
  ],
};

const RETIRED_IN = new Map(
  Object.entries(RETIRED).flatMap(([version, names]) => names.map((name) => [name, version])),
);

/** Stamp Meta's retirements onto a list, keeping any earlier version already recorded. */
function withRetirements(metrics: MetricDefinition[]): MetricDefinition[] {
  return metrics.map((metric) => {
    const version = RETIRED_IN.get(metric.name);
    return version && !metric.deprecatedFrom ? { ...metric, deprecatedFrom: version } : metric;
  });
}

/** The three windows most Page metrics accept. */
const DAILY: MetricPeriod[] = ['day', 'week', 'days_28'];
const DAY_ONLY: MetricPeriod[] = ['day'];
const LIFETIME: MetricPeriod[] = ['lifetime'];

// ---------------------------------------------------------------------------
// Page metrics
// ---------------------------------------------------------------------------

export const PAGE_METRICS: MetricDefinition[] = withRetirements([
  // --- Views and viewers -----------------------------------------------------
  // Meta's replacements for impressions and reach, on every version since
  // November 2025.
  ...group({ level: 'page', category: 'reach', periods: DAILY }, [
    ['page_media_view', 'Times Page content was played or displayed (views).'],
    ['page_total_media_view_unique', 'People who viewed any Page content (viewers).'],
  ]),

  // --- Impressions and reach -------------------------------------------------
  ...group({ level: 'page', category: 'reach', periods: DAILY }, [
    ['page_impressions', 'Times any content from the Page entered a screen.'],
    ['page_impressions_unique', 'People who saw any Page content (reach).'],
    ['page_impressions_paid', 'Impressions from paid promotion.'],
    ['page_impressions_paid_unique', 'People reached through paid promotion.'],
    ['page_impressions_organic', 'Unpaid impressions.'],
    ['page_impressions_organic_unique', 'People reached without paid promotion.'],
    ['page_impressions_organic_v2', 'Unpaid impressions, on Meta’s revised definition.'],
    ['page_impressions_organic_unique_v2', 'People reached unpaid, on Meta’s revised definition.'],
    ['page_impressions_viral', 'Impressions from stories a friend shared about the Page.'],
    ['page_impressions_viral_unique', 'People reached via a friend’s story about the Page.'],
    ['page_impressions_nonviral', 'Impressions not carried by a friend’s story.'],
    ['page_impressions_nonviral_unique', 'People reached other than via a friend’s story.'],
  ]),
  ...group({ level: 'page', category: 'reach', periods: DAILY, breakdown: true }, [
    ['page_impressions_by_story_type', 'Impressions split by the kind of story that carried them.'],
    ['page_impressions_by_story_type_unique', 'Reach split by the kind of story that carried it.'],
    ['page_impressions_by_paid_non_paid', 'Impressions split into paid, unpaid and total.'],
    ['page_impressions_by_paid_non_paid_unique', 'Reach split into paid, unpaid and total.'],
    ['page_impressions_frequency_distribution', 'How many people saw Page content once, twice, and so on.'],
    ['page_impressions_viral_frequency_distribution', 'How often people saw the Page through a friend’s story.'],
  ]),
  ...group({ level: 'page', category: 'demographics', periods: DAILY, breakdown: true }, [
    ['page_impressions_by_age_gender_unique', 'Reach by gender and age band.'],
    ['page_impressions_by_country_unique', 'Reach by country.'],
    ['page_impressions_by_city_unique', 'Reach by city.'],
    ['page_impressions_by_locale_unique', 'Reach by language.'],
  ]),

  // --- Post rollups on the Page ---------------------------------------------
  // How the Page's *posts* performed in aggregate, as opposed to the Page
  // itself. Useful for separating content performance from profile traffic.
  ...group({ level: 'page', category: 'reach', periods: DAILY }, [
    ['page_posts_impressions', 'Times any Page post entered a screen.'],
    ['page_posts_impressions_unique', 'People who saw any Page post.'],
    ['page_posts_impressions_paid', 'Paid impressions of Page posts.'],
    ['page_posts_impressions_paid_unique', 'People reached by Page posts through paid promotion.'],
    ['page_posts_impressions_organic', 'Unpaid impressions of Page posts.'],
    ['page_posts_impressions_organic_unique', 'People reached by Page posts without paid promotion.'],
    ['page_posts_served_impressions_organic_unique', 'People served a Page post organically, whether or not it was seen.'],
    ['page_posts_impressions_viral', 'Impressions of Page posts via a friend’s story.'],
    ['page_posts_impressions_viral_unique', 'People reached by Page posts via a friend’s story.'],
    ['page_posts_impressions_nonviral', 'Impressions of Page posts not carried by a friend’s story.'],
    ['page_posts_impressions_nonviral_unique', 'People reached by Page posts other than via a friend’s story.'],
  ]),
  ...group({ level: 'page', category: 'reach', periods: DAILY, breakdown: true }, [
    ['page_posts_impressions_frequency_distribution', 'How many people saw Page posts once, twice, and so on.'],
  ]),

  // --- Engagement ------------------------------------------------------------
  ...group({ level: 'page', category: 'engagement', periods: DAILY }, [
    ['page_engaged_users', 'People who clicked anywhere on Page content.'],
    ['page_post_engagements', 'Times people engaged with Page posts, by any action.'],
    ['page_consumptions', 'Clicks on Page content.'],
    ['page_consumptions_unique', 'People who clicked on Page content.'],
    ['page_content_activity', 'Stories created about the Page.'],
  ]),
  ...group({ level: 'page', category: 'engagement', periods: DAILY, breakdown: true }, [
    ['page_consumptions_by_consumption_type', 'Content clicks split by what was clicked.'],
    ['page_consumptions_by_consumption_type_unique', 'People clicking Page content, split by what was clicked.'],
    ['page_positive_feedback_by_type', 'Likes, comments, shares and link clicks, split by kind.'],
    ['page_positive_feedback_by_type_unique', 'People giving positive feedback, split by kind.'],
    ['page_content_activity_by_action_type', 'Stories about the Page, split by what was done.'],
    ['page_content_activity_by_action_type_unique', 'People talking about the Page, split by what they did.'],
    ['page_content_activity_by_age_gender_unique', 'People talking about the Page, by gender and age band.'],
    ['page_content_activity_by_city_unique', 'People talking about the Page, by city.'],
    ['page_content_activity_by_country_unique', 'People talking about the Page, by country.'],
    ['page_content_activity_by_locale_unique', 'People talking about the Page, by language.'],
  ]),

  // --- Check-ins -------------------------------------------------------------
  ...group({ level: 'page', category: 'engagement', periods: DAILY }, [
    ['page_places_checkin_total', 'Check-ins at the Page location.'],
    ['page_places_checkin_total_unique', 'People who checked in at the Page location.'],
    ['page_places_checkin_mobile', 'Check-ins made from a mobile device.'],
    ['page_places_checkin_mobile_unique', 'People who checked in from a mobile device.'],
  ]),
  ...group({ level: 'page', category: 'demographics', periods: DAILY, breakdown: true }, [
    ['page_places_checkins_by_age_gender', 'Check-ins by gender and age band.'],
    ['page_places_checkins_by_locale', 'Check-ins by language.'],
    ['page_places_checkins_by_country', 'Check-ins by country.'],
  ]),

  // --- Reactions -------------------------------------------------------------
  ...group({ level: 'page', category: 'engagement', periods: DAILY }, [
    ['page_actions_post_reactions_like_total', 'Like reactions on Page posts.'],
    ['page_actions_post_reactions_love_total', 'Love reactions on Page posts.'],
    ['page_actions_post_reactions_wow_total', 'Wow reactions on Page posts.'],
    ['page_actions_post_reactions_haha_total', 'Haha reactions on Page posts.'],
    ['page_actions_post_reactions_sorry_total', 'Sad reactions on Page posts.'],
    ['page_actions_post_reactions_anger_total', 'Angry reactions on Page posts.'],
  ]),
  ...group({ level: 'page', category: 'engagement', periods: DAY_ONLY, breakdown: true }, [
    ['page_actions_post_reactions_total', 'Reactions on Page posts, broken down by type.'],
  ]),

  // --- Negative feedback -----------------------------------------------------
  ...group({ level: 'page', category: 'negative', periods: DAILY }, [
    ['page_negative_feedback', 'Hides, reports and unlikes.'],
    ['page_negative_feedback_unique', 'People who gave negative feedback.'],
  ]),
  ...group({ level: 'page', category: 'negative', periods: DAILY, breakdown: true }, [
    ['page_negative_feedback_by_type', 'Hides, reports and unlikes, split by kind.'],
    ['page_negative_feedback_by_type_unique', 'People giving negative feedback, split by kind.'],
  ]),

  // --- Audience --------------------------------------------------------------
  ...group({ level: 'page', category: 'audience', periods: LIFETIME }, [
    ['page_fans', 'Total Page likes.'],
  ]),
  ...group({ level: 'page', category: 'demographics', periods: LIFETIME, breakdown: true }, [
    ['page_fans_locale', 'Page likes by language.'],
    ['page_fans_city', 'Page likes by city.'],
    ['page_fans_country', 'Page likes by country.'],
    ['page_fans_gender_age', 'Page likes by gender and age band.'],
    ['page_follows_city', 'Page followers by city.'],
    ['page_follows_country', 'Page followers by country.'],
  ]),
  ...group({ level: 'page', category: 'audience', periods: DAILY }, [
    ['page_fan_adds', 'New Page likes.'],
    ['page_fan_adds_unique', 'People who liked the Page.'],
    ['page_fan_removes', 'Page unlikes.'],
    ['page_fan_removes_unique', 'People who unliked the Page.'],
  ]),
  ...group({ level: 'page', category: 'audience', periods: DAILY, breakdown: true }, [
    ['page_fan_adds_by_paid_non_paid_unique', 'New likes split into paid and unpaid.'],
  ]),
  ...group({ level: 'page', category: 'audience', periods: DAY_ONLY, breakdown: true }, [
    ['page_fans_by_like_source', 'New likes by where the like came from.'],
    ['page_fans_by_like_source_unique', 'People who liked the Page, by where the like came from.'],
    ['page_fans_by_unlike_source_unique', 'People who unliked the Page, by where the unlike came from.'],
    ['page_fans_online', 'Followers online, by hour of day.'],
  ]),
  ...group({ level: 'page', category: 'audience', periods: DAY_ONLY }, [
    ['page_fans_online_per_day', 'Followers online at any point that day.'],
    ['page_follows', 'New followers.'],
    ['page_daily_follows', 'Follows recorded that day.'],
    ['page_daily_follows_unique', 'People who followed the Page.'],
    ['page_daily_unfollows_unique', 'People who unfollowed the Page.'],
  ]),

  // --- Profile traffic -------------------------------------------------------
  ...group({ level: 'page', category: 'profile', periods: DAILY }, [
    ['page_views_total', 'Views of the Page profile.'],
    ['page_views_logged_in_total', 'Profile views by people signed in to Facebook.'],
    ['page_views_logged_in_unique', 'Signed-in people who viewed the Page profile.'],
    ['page_total_actions', 'Clicks on the Page’s contact and action buttons.'],
  ]),
  ...group({ level: 'page', category: 'profile', periods: DAY_ONLY }, [
    ['page_views_logout', 'Profile views by people not signed in to Facebook.'],
  ]),
  ...group({ level: 'page', category: 'profile', periods: DAILY, breakdown: true }, [
    ['page_views_by_profile_tab_total', 'Profile views split by which tab was opened.'],
    ['page_views_by_profile_tab_logged_in_unique', 'Signed-in profile visitors, split by which tab was opened.'],
    ['page_views_by_internal_referer_logged_in_unique', 'Where inside Facebook profile visitors came from.'],
    ['page_views_by_site_logged_in_unique', 'Profile views split by device or surface.'],
    ['page_views_by_age_gender_logged_in_unique', 'Profile views by gender and age band.'],
  ]),
  ...group({ level: 'page', category: 'profile', periods: DAY_ONLY, breakdown: true }, [
    ['page_views_external_referrals', 'External sites that sent traffic to the Page.'],
  ]),
  ...group({ level: 'page', category: 'profile', periods: DAILY, breakdown: true }, [
    ['page_tab_views_login_top_unique', 'Signed-in tab views, by tab.'],
    ['page_tab_views_login_top', 'Signed-in tab views in total, by tab.'],
    ['page_tab_views_logout_top', 'Signed-out tab views, by tab.'],
  ]),

  // --- Action-button clicks --------------------------------------------------
  ...group({ level: 'page', category: 'clicks', periods: DAILY }, [
    ['page_cta_clicks_logged_in_total', 'Clicks on the Page’s call-to-action button.'],
    ['page_cta_clicks_logged_in_unique', 'People who clicked the call-to-action button.'],
    ['page_call_phone_clicks_logged_in_unique', 'People who tapped the Page’s phone number.'],
    ['page_get_directions_clicks_logged_in_unique', 'People who asked for directions to the Page location.'],
    ['page_website_clicks_logged_in_unique', 'People who clicked through to the Page’s website.'],
  ]),
  ...group({ level: 'page', category: 'clicks', periods: DAILY, breakdown: true }, [
    ['page_cta_clicks_by_site_logged_in_unique', 'Call-to-action clicks by device or surface.'],
    ['page_cta_clicks_by_age_gender_logged_in_unique', 'Call-to-action clicks by gender and age band.'],
    ['page_cta_clicks_logged_in_by_city_unique', 'Call-to-action clicks by city.'],
    ['page_cta_clicks_logged_in_by_country_unique', 'Call-to-action clicks by country.'],
    ['page_call_phone_clicks_by_site_logged_in_unique', 'Phone-number taps by device or surface.'],
    ['page_call_phone_clicks_by_age_gender_logged_in_unique', 'Phone-number taps by gender and age band.'],
    ['page_call_phone_clicks_logged_in_by_city_unique', 'Phone-number taps by city.'],
    ['page_call_phone_clicks_logged_in_by_country_unique', 'Phone-number taps by country.'],
    ['page_get_directions_clicks_by_site_logged_in_unique', 'Directions requests by device or surface.'],
    ['page_get_directions_clicks_by_age_gender_logged_in_unique', 'Directions requests by gender and age band.'],
    ['page_get_directions_clicks_logged_in_by_city_unique', 'Directions requests by city.'],
    ['page_get_directions_clicks_logged_in_by_country_unique', 'Directions requests by country.'],
    ['page_website_clicks_by_site_logged_in_unique', 'Website clicks by device or surface.'],
    ['page_website_clicks_by_age_gender_logged_in_unique', 'Website clicks by gender and age band.'],
    ['page_website_clicks_logged_in_by_city_unique', 'Website clicks by city.'],
    ['page_website_clicks_logged_in_by_country_unique', 'Website clicks by country.'],
  ]),

  // --- Video -----------------------------------------------------------------
  ...group({ level: 'page', category: 'video', periods: DAILY }, [
    ['page_video_views', 'Video views of at least 3 seconds.'],
    ['page_video_views_unique', 'People who watched a Page video.'],
    ['page_video_views_paid', 'Paid video views.'],
    ['page_video_views_organic', 'Unpaid video views.'],
    ['page_video_views_autoplayed', 'Views that started automatically.'],
    ['page_video_views_click_to_play', 'Views where the viewer chose to press play.'],
    ['page_video_repeat_views', 'Views by someone who had already watched the video.'],
    ['page_video_complete_views_30s', 'Videos watched to 30 seconds or completion.'],
    ['page_video_complete_views_30s_paid', 'Paid views to 30 seconds or completion.'],
    ['page_video_complete_views_30s_organic', 'Unpaid views to 30 seconds or completion.'],
    ['page_video_complete_views_30s_autoplayed', 'Autoplayed views to 30 seconds or completion.'],
    ['page_video_complete_views_30s_click_to_play', 'Click-to-play views to 30 seconds or completion.'],
    ['page_video_complete_views_30s_unique', 'People who watched to 30 seconds or completion.'],
    ['page_video_complete_views_30s_repeat_views', 'Repeat views to 30 seconds or completion.'],
    ['page_video_views_10s', 'Video views of at least 10 seconds.'],
    ['page_video_views_10s_unique', 'People who watched at least 10 seconds.'],
    ['page_video_views_10s_paid', 'Paid views of at least 10 seconds.'],
    ['page_video_views_10s_organic', 'Unpaid views of at least 10 seconds.'],
    ['page_video_views_10s_autoplayed', 'Autoplayed views of at least 10 seconds.'],
    ['page_video_views_10s_click_to_play', 'Click-to-play views of at least 10 seconds.'],
    ['page_video_views_10s_repeat', 'Repeat views of at least 10 seconds.'],
  ]),
  ...group({ level: 'page', category: 'video', periods: DAILY, breakdown: true }, [
    ['page_video_views_by_paid_non_paid', 'Video views split into paid and unpaid.'],
  ]),
  ...group({ level: 'page', category: 'video', periods: DAY_ONLY }, [
    ['page_video_view_time', 'Total milliseconds of video watched.'],
  ]),
  ...group({ level: 'page', category: 'video', periods: DAY_ONLY, breakdown: true }, [
    ['page_video_views_by_distribution_type', 'Video views split by where they were served.'],
    ['page_video_view_time_by_distribution_type', 'Watch time split by where the video was served.'],
    ['page_video_view_time_by_age_bucket_and_gender', 'Watch time by gender and age band.'],
    ['page_video_view_time_by_region_id', 'Watch time by region.'],
    ['page_video_view_time_by_country_id', 'Watch time by country.'],
  ]),

  // --- Messaging (Page inbox) ------------------------------------------------
  ...group({ level: 'page', category: 'messaging', periods: DAY_ONLY }, [
    ['page_messages_new_conversations_unique', 'Conversations started with the Page.'],
    ['page_messages_active_threads_unique', 'Threads with any activity.'],
    ['page_messages_blocked_conversations_unique', 'Conversations the person blocked.'],
    ['page_messages_reported_conversations_unique', 'Conversations reported as spam or abuse.'],
    ['page_messages_total_messaging_connection', 'People who can be messaged by the Page.'],
  ]),
  ...group({ level: 'page', category: 'messaging', periods: DAY_ONLY, breakdown: true }, [
    ['page_messages_reported_conversations_by_report_type_unique', 'Reported conversations, split by report reason.'],
    ['page_messages_feedback_by_action_unique', 'Message feedback, split by the action taken.'],
  ]),

  // --- Ad-break earnings -----------------------------------------------------
  ...group({ level: 'page', category: 'monetisation', periods: DAY_ONLY, breakdown: true }, [
    ['page_daily_video_ad_break_ad_impressions_by_crosspost_status', 'Ad-break impressions, split by crosspost status.'],
    ['page_daily_video_ad_break_earnings_by_crosspost_status', 'Ad-break earnings, split by crosspost status.'],
    ['page_daily_video_ad_break_cpm_by_crosspost_status', 'Ad-break CPM, split by crosspost status.'],
  ]),

  // --- Legacy ----------------------------------------------------------------
  // Removed in Graph v4.0. Listed because Pages created before the change
  // sometimes still serve them, and because a missing name should be reported
  // as "Meta removed this", not silently omitted from the catalogue.
  ...group({ level: 'page', category: 'engagement', periods: DAILY, deprecatedFrom: 'v4.0' }, [
    ['page_stories', 'Stories created about the Page.'],
    ['page_storytellers', 'People who created a story about the Page.'],
  ]),
  ...group(
    { level: 'page', category: 'engagement', periods: DAILY, breakdown: true, deprecatedFrom: 'v4.0' },
    [
      ['page_stories_by_story_type', 'Stories about the Page, split by kind.'],
      ['page_storytellers_by_story_type', 'People creating stories about the Page, split by kind.'],
      ['page_storytellers_by_age_gender', 'People creating stories about the Page, by gender and age band.'],
      ['page_storytellers_by_country', 'People creating stories about the Page, by country.'],
      ['page_storytellers_by_city', 'People creating stories about the Page, by city.'],
      ['page_storytellers_by_locale', 'People creating stories about the Page, by language.'],
    ],
  ),
  ...group({ level: 'page', category: 'messaging', periods: DAY_ONLY, deprecatedFrom: 'v11.0' }, [
    ['page_daily_messaging_connections_unique', 'People the Page could message that day.'],
  ]),
]);

// ---------------------------------------------------------------------------
// Post metrics
// ---------------------------------------------------------------------------

export const POST_METRICS: MetricDefinition[] = withRetirements([
  // --- Views and viewers -----------------------------------------------------
  ...group({ level: 'post', category: 'reach', periods: LIFETIME }, [
    ['post_media_view', 'Times the post was played or displayed (views).'],
    ['post_total_media_view_unique', 'People who viewed the post (viewers).'],
  ]),

  // --- Impressions and reach -------------------------------------------------
  ...group({ level: 'post', category: 'reach', periods: LIFETIME }, [
    ['post_impressions', 'Times the post entered a screen.'],
    ['post_impressions_unique', 'People who saw the post (reach).'],
    ['post_impressions_paid', 'Impressions from paid promotion.'],
    ['post_impressions_paid_unique', 'People reached through paid promotion.'],
    ['post_impressions_organic', 'Unpaid impressions.'],
    ['post_impressions_organic_unique', 'People reached without paid promotion.'],
    ['post_impressions_viral', 'Impressions via a friend’s story about the post.'],
    ['post_impressions_viral_unique', 'People reached via a friend’s story about the post.'],
    ['post_impressions_nonviral', 'Impressions not carried by a friend’s story.'],
    ['post_impressions_nonviral_unique', 'People reached other than via a friend’s story.'],
    ['post_impressions_fan', 'Impressions among people who like the Page.'],
    ['post_impressions_fan_unique', 'People who like the Page and saw the post.'],
    ['post_impressions_fan_paid', 'Paid impressions among people who like the Page.'],
    ['post_impressions_fan_paid_unique', 'People who like the Page and were reached by paid promotion.'],
  ]),
  ...group({ level: 'post', category: 'reach', periods: LIFETIME, breakdown: true }, [
    ['post_impressions_by_story_type', 'Impressions split by the kind of story that carried them.'],
    ['post_impressions_by_story_type_unique', 'Reach split by the kind of story that carried it.'],
  ]),

  // --- Engagement ------------------------------------------------------------
  ...group({ level: 'post', category: 'engagement', periods: LIFETIME }, [
    ['post_engaged_users', 'People who clicked anywhere on the post.'],
    ['post_engaged_fan', 'People who like the Page and engaged with the post.'],
    ['post_activity', 'Likes, comments and shares on the post.'],
    ['post_activity_unique', 'People who liked, commented on or shared the post.'],
    ['post_reactions_like_total', 'Like reactions.'],
    ['post_reactions_love_total', 'Love reactions.'],
    ['post_reactions_wow_total', 'Wow reactions.'],
    ['post_reactions_haha_total', 'Haha reactions.'],
    ['post_reactions_sorry_total', 'Sad reactions.'],
    ['post_reactions_anger_total', 'Angry reactions.'],
  ]),
  ...group({ level: 'post', category: 'engagement', periods: LIFETIME, breakdown: true }, [
    ['post_activity_by_action_type', 'Post activity split by like, comment and share.'],
    ['post_activity_by_action_type_unique', 'People acting on the post, split by what they did.'],
    ['post_reactions_by_type_total', 'Reactions split by like, love, wow, haha, sorry, anger.'],
  ]),

  // --- Clicks ----------------------------------------------------------------
  ...group({ level: 'post', category: 'clicks', periods: LIFETIME }, [
    ['post_clicks', 'Clicks anywhere on the post.'],
    ['post_clicks_unique', 'People who clicked anywhere on the post.'],
  ]),
  ...group({ level: 'post', category: 'clicks', periods: LIFETIME, breakdown: true }, [
    ['post_clicks_by_type', 'Clicks split by what was clicked.'],
    ['post_clicks_by_type_unique', 'People clicking, split by what they clicked.'],
  ]),

  // --- Negative feedback -----------------------------------------------------
  ...group({ level: 'post', category: 'negative', periods: LIFETIME }, [
    ['post_negative_feedback', 'Hides, reports and unlikes caused by the post.'],
    ['post_negative_feedback_unique', 'People who gave negative feedback on the post.'],
  ]),
  ...group({ level: 'post', category: 'negative', periods: LIFETIME, breakdown: true }, [
    ['post_negative_feedback_by_type', 'Negative feedback split by kind.'],
    ['post_negative_feedback_by_type_unique', 'People giving negative feedback, split by kind.'],
  ]),

  // --- Video -----------------------------------------------------------------
  ...group({ level: 'post', category: 'video', periods: LIFETIME }, [
    ['post_video_views', 'Video views of at least 3 seconds.'],
    ['post_video_views_unique', 'People who watched at least 3 seconds.'],
    ['post_video_views_organic', 'Unpaid video views.'],
    ['post_video_views_organic_unique', 'People who watched without paid promotion.'],
    ['post_video_views_paid', 'Paid video views.'],
    ['post_video_views_paid_unique', 'People who watched through paid promotion.'],
    ['post_video_views_autoplayed', 'Views that started automatically.'],
    ['post_video_views_clicked_to_play', 'Views where the viewer chose to press play.'],
    ['post_video_views_sound_on', 'Views played with sound on.'],
    ['post_video_views_10s', 'Views of at least 10 seconds.'],
    ['post_video_views_10s_unique', 'People who watched at least 10 seconds.'],
    ['post_video_views_10s_organic', 'Unpaid views of at least 10 seconds.'],
    ['post_video_views_10s_paid', 'Paid views of at least 10 seconds.'],
    ['post_video_views_10s_autoplayed', 'Autoplayed views of at least 10 seconds.'],
    ['post_video_views_10s_clicked_to_play', 'Click-to-play views of at least 10 seconds.'],
    ['post_video_views_10s_sound_on', 'Views of at least 10 seconds with sound on.'],
    ['post_video_views_15s', 'Views of at least 15 seconds.'],
    ['post_video_views_60s_excludes_shorter', 'Views of at least 60 seconds, on videos long enough to allow it.'],
    ['post_video_complete_views_organic', 'Unpaid views to completion.'],
    ['post_video_complete_views_organic_unique', 'People who watched to completion without paid promotion.'],
    ['post_video_complete_views_paid', 'Paid views to completion.'],
    ['post_video_complete_views_paid_unique', 'People who watched to completion through paid promotion.'],
    ['post_video_complete_views_30s', 'Views to 30 seconds or completion.'],
    ['post_video_complete_views_30s_unique', 'People who watched to 30 seconds or completion.'],
    ['post_video_complete_views_30s_organic', 'Unpaid views to 30 seconds or completion.'],
    ['post_video_complete_views_30s_paid', 'Paid views to 30 seconds or completion.'],
    ['post_video_complete_views_30s_autoplayed', 'Autoplayed views to 30 seconds or completion.'],
    ['post_video_complete_views_30s_clicked_to_play', 'Click-to-play views to 30 seconds or completion.'],
    ['post_video_avg_time_watched', 'Average milliseconds watched per view.'],
    ['post_video_view_time', 'Total milliseconds watched.'],
    ['post_video_view_time_organic', 'Total milliseconds watched without paid promotion.'],
    ['post_video_length', 'Video length in milliseconds.'],
  ]),
  ...group({ level: 'post', category: 'video', periods: LIFETIME, breakdown: true }, [
    ['post_video_retention_graph', 'Share of viewers still watching at each point of the video.'],
    ['post_video_retention_graph_autoplayed', 'Retention curve for autoplayed views.'],
    ['post_video_retention_graph_clicked_to_play', 'Retention curve for click-to-play views.'],
    ['post_video_social_actions', 'Likes, comments and shares while the video played.'],
    ['post_video_views_by_distribution_type', 'Video views split by where they were served.'],
    ['post_video_view_time_by_distribution_type', 'Watch time split by where the video was served.'],
    ['post_video_view_time_by_age_bucket_and_gender', 'Watch time by gender and age band.'],
    ['post_video_view_time_by_region_id', 'Watch time by region.'],
  ]),
]);

// ---------------------------------------------------------------------------
// Video metrics (the /{video-id}/video_insights edge)
// ---------------------------------------------------------------------------
//
// Distinct from `post_video_*`: those describe one post, these describe the
// video object itself and so aggregate every post and crosspost that carried
// it. For a video shared to three Pages, this is the only place the combined
// figure exists.

export const VIDEO_METRICS: MetricDefinition[] = withRetirements([
  ...group({ level: 'video', category: 'video', periods: LIFETIME }, [
    ['total_video_views', 'Views of at least 3 seconds, across every post of this video.'],
    ['total_video_views_unique', 'People who watched at least 3 seconds.'],
    ['total_video_views_autoplayed', 'Views that started automatically.'],
    ['total_video_views_clicked_to_play', 'Views where the viewer chose to press play.'],
    ['total_video_views_organic', 'Unpaid views.'],
    ['total_video_views_organic_unique', 'People who watched without paid promotion.'],
    ['total_video_views_paid', 'Paid views.'],
    ['total_video_views_paid_unique', 'People who watched through paid promotion.'],
    ['total_video_views_sound_on', 'Views played with sound on.'],
    ['total_video_complete_views', 'Views to completion.'],
    ['total_video_complete_views_unique', 'People who watched to completion.'],
    ['total_video_complete_views_auto_played', 'Autoplayed views to completion.'],
    ['total_video_complete_views_clicked_to_play', 'Click-to-play views to completion.'],
    ['total_video_complete_views_organic', 'Unpaid views to completion.'],
    ['total_video_complete_views_organic_unique', 'People who watched to completion without paid promotion.'],
    ['total_video_complete_views_paid', 'Paid views to completion.'],
    ['total_video_complete_views_paid_unique', 'People who watched to completion through paid promotion.'],
    ['total_video_10s_views', 'Views of at least 10 seconds.'],
    ['total_video_10s_views_unique', 'People who watched at least 10 seconds.'],
    ['total_video_10s_views_auto_played', 'Autoplayed views of at least 10 seconds.'],
    ['total_video_10s_views_clicked_to_play', 'Click-to-play views of at least 10 seconds.'],
    ['total_video_10s_views_organic', 'Unpaid views of at least 10 seconds.'],
    ['total_video_10s_views_paid', 'Paid views of at least 10 seconds.'],
    ['total_video_10s_views_sound_on', 'Views of at least 10 seconds with sound on.'],
    ['total_video_15s_views', 'Views of at least 15 seconds.'],
    ['total_video_30s_views', 'Views of at least 30 seconds.'],
    ['total_video_30s_views_unique', 'People who watched at least 30 seconds.'],
    ['total_video_30s_views_auto_played', 'Autoplayed views of at least 30 seconds.'],
    ['total_video_30s_views_clicked_to_play', 'Click-to-play views of at least 30 seconds.'],
    ['total_video_30s_views_organic', 'Unpaid views of at least 30 seconds.'],
    ['total_video_30s_views_paid', 'Paid views of at least 30 seconds.'],
    ['total_video_60s_excludes_shorter_views', 'Views of at least 60 seconds, on videos long enough to allow it.'],
    ['total_video_avg_time_watched', 'Average milliseconds watched per view.'],
    ['total_video_view_total_time', 'Total milliseconds watched.'],
    ['total_video_view_total_time_organic', 'Total milliseconds watched without paid promotion.'],
    ['total_video_view_total_time_paid', 'Total milliseconds watched through paid promotion.'],
  ]),
  ...group({ level: 'video', category: 'reach', periods: LIFETIME }, [
    ['total_video_impressions', 'Times the video entered a screen.'],
    ['total_video_impressions_unique', 'People who saw the video.'],
    ['total_video_impressions_paid', 'Impressions from paid promotion.'],
    ['total_video_impressions_paid_unique', 'People reached through paid promotion.'],
    ['total_video_impressions_organic', 'Unpaid impressions.'],
    ['total_video_impressions_organic_unique', 'People reached without paid promotion.'],
    ['total_video_impressions_viral', 'Impressions via a friend’s story.'],
    ['total_video_impressions_viral_unique', 'People reached via a friend’s story.'],
    ['total_video_impressions_fan', 'Impressions among people who like the Page.'],
    ['total_video_impressions_fan_unique', 'People who like the Page and saw the video.'],
    ['total_video_impressions_fan_paid', 'Paid impressions among people who like the Page.'],
    ['total_video_impressions_fan_paid_unique', 'People who like the Page and were reached by paid promotion.'],
  ]),
  ...group({ level: 'video', category: 'engagement', periods: LIFETIME, breakdown: true }, [
    ['total_video_stories_by_action_type', 'Stories about the video, split by what was done.'],
    ['total_video_reactions_by_type_total', 'Reactions on the video, split by type.'],
  ]),
  ...group({ level: 'video', category: 'demographics', periods: LIFETIME, breakdown: true }, [
    ['total_video_view_time_by_age_bucket_and_gender', 'Watch time by gender and age band.'],
    ['total_video_view_time_by_region_id', 'Watch time by region.'],
    ['total_video_view_time_by_country_id', 'Watch time by country.'],
  ]),
  ...group({ level: 'video', category: 'video', periods: LIFETIME, breakdown: true }, [
    ['total_video_views_by_distribution_type', 'Views split by where the video was served.'],
    ['total_video_view_time_by_distribution_type', 'Watch time split by where the video was served.'],
    ['total_video_retention_graph', 'Share of viewers still watching at each point.'],
    ['total_video_retention_graph_autoplayed', 'Retention curve for autoplayed views.'],
    ['total_video_retention_graph_clicked_to_play', 'Retention curve for click-to-play views.'],
  ]),
]);

// ---------------------------------------------------------------------------
// Instagram metrics
// ---------------------------------------------------------------------------
//
// Read through the same Facebook Page: an Instagram Business account is
// discovered from `{page-id}?fields=instagram_business_account`, and its
// insights use the same `/insights` shape with a different metric vocabulary.

export const IG_ACCOUNT_METRICS: MetricDefinition[] = [
  ...group({ level: 'ig_account', category: 'reach', periods: DAILY }, [
    ['impressions', 'Times any content from the account entered a screen.'],
    ['reach', 'People who saw any content from the account.'],
    ['views', 'Views of the account’s content, on Meta’s 2024 definition.'],
    ['content_views', 'Views of profile and content surfaces.'],
  ]),
  ...group({ level: 'ig_account', category: 'engagement', periods: DAILY }, [
    ['accounts_engaged', 'Accounts that interacted with the content.'],
    ['total_interactions', 'Likes, comments, saves and shares combined.'],
    ['likes', 'Likes across the account’s content.'],
    ['comments', 'Comments across the account’s content.'],
    ['shares', 'Shares across the account’s content.'],
    ['saves', 'Saves across the account’s content.'],
    ['replies', 'Story replies.'],
  ]),
  ...group({ level: 'ig_account', category: 'profile', periods: DAILY }, [
    ['profile_views', 'Views of the account profile.'],
    ['website_clicks', 'Taps on the profile website link.'],
    ['email_contacts', 'Taps on the email button.'],
    ['phone_call_clicks', 'Taps on the call button.'],
    ['text_message_clicks', 'Taps on the text button.'],
    ['get_directions_clicks', 'Taps on the directions button.'],
  ]),
  ...group({ level: 'ig_account', category: 'profile', periods: DAILY, breakdown: true }, [
    ['profile_links_taps', 'Taps on profile links, split by link type.'],
  ]),
  ...group({ level: 'ig_account', category: 'audience', periods: DAILY }, [
    ['follower_count', 'New followers that day.'],
  ]),
  ...group({ level: 'ig_account', category: 'audience', periods: DAILY, breakdown: true }, [
    ['follows_and_unfollows', 'Follows and unfollows, split by direction.'],
  ]),
  ...group({ level: 'ig_account', category: 'audience', periods: LIFETIME, breakdown: true }, [
    ['online_followers', 'Followers online, by hour of day.'],
  ]),
  ...group({ level: 'ig_account', category: 'demographics', periods: LIFETIME, breakdown: true }, [
    ['audience_city', 'Followers by city.'],
    ['audience_country', 'Followers by country.'],
    ['audience_gender_age', 'Followers by gender and age band.'],
    ['audience_locale', 'Followers by language.'],
    ['follower_demographics', 'Followers by the requested demographic breakdown.'],
    ['engaged_audience_demographics', 'Engaged accounts by the requested demographic breakdown.'],
    ['reached_audience_demographics', 'Reached accounts by the requested demographic breakdown.'],
  ]),
];

export const IG_MEDIA_METRICS: MetricDefinition[] = [
  ...group({ level: 'ig_media', category: 'reach', periods: LIFETIME }, [
    ['impressions', 'Times this media entered a screen.'],
    ['reach', 'People who saw this media.'],
    ['views', 'Views of this media, on Meta’s 2024 definition.'],
  ]),
  ...group({ level: 'ig_media', category: 'engagement', periods: LIFETIME }, [
    ['engagement', 'Likes, comments and saves on this media.'],
    ['total_interactions', 'Every interaction with this media.'],
    ['likes', 'Likes on this media.'],
    ['comments', 'Comments on this media.'],
    ['shares', 'Shares of this media.'],
    ['saved', 'Times this media was saved.'],
    ['replies', 'Replies to this story.'],
    ['follows', 'Accounts that followed after seeing this media.'],
    ['profile_visits', 'Profile visits that came from this media.'],
  ]),
  ...group({ level: 'ig_media', category: 'engagement', periods: LIFETIME, breakdown: true }, [
    ['profile_activity', 'Actions taken on the profile after seeing this media.'],
    ['navigation', 'How viewers left this story frame.'],
  ]),
  ...group({ level: 'ig_media', category: 'video', periods: LIFETIME }, [
    ['video_views', 'Views of this video.'],
    ['plays', 'Times this media started playing.'],
    ['clips_replays_count', 'Replays of this reel.'],
    ['ig_reels_aggregated_all_plays_count', 'Plays and replays of this reel combined.'],
    ['ig_reels_video_view_total_time', 'Total milliseconds this reel was watched.'],
    ['ig_reels_avg_watch_time', 'Average milliseconds watched per play.'],
  ]),
  ...group({ level: 'ig_media', category: 'clicks', periods: LIFETIME }, [
    ['taps_forward', 'Taps to skip to the next story.'],
    ['taps_back', 'Taps to go back to the previous story.'],
    ['exits', 'Times a viewer left the story.'],
  ]),
];

// ---------------------------------------------------------------------------
// Ads Insights
// ---------------------------------------------------------------------------
//
// A different API: `/{ad-account-id}/insights` returns rows of *fields*, not
// name/period/value series, so these are listed as field names with the same
// descriptions treatment. Money fields are in the ad account's currency.

export interface AdFieldDefinition {
  name: string;
  category: 'delivery' | 'cost' | 'engagement' | 'video' | 'conversion' | 'meta';
  description: string;
  /** True when the value is an array of `{ action_type, value }` objects. */
  actionBreakdown?: boolean;
}

function adFields(
  category: AdFieldDefinition['category'],
  rows: Row[],
  actionBreakdown = false,
): AdFieldDefinition[] {
  return rows.map(([name, description]) => ({
    name,
    description,
    category,
    ...(actionBreakdown ? { actionBreakdown: true } : {}),
  }));
}

export const AD_INSIGHT_FIELDS: AdFieldDefinition[] = [
  ...adFields('meta', [
    ['account_id', 'Ad account the row belongs to.'],
    ['account_name', 'Ad account name.'],
    ['account_currency', 'Currency all money figures are in.'],
    ['campaign_id', 'Campaign identifier.'],
    ['campaign_name', 'Campaign name.'],
    ['adset_id', 'Ad set identifier.'],
    ['adset_name', 'Ad set name.'],
    ['ad_id', 'Ad identifier.'],
    ['ad_name', 'Ad name.'],
    ['objective', 'Campaign objective.'],
    ['optimization_goal', 'What delivery was optimised for.'],
    ['buying_type', 'Auction or reserved buying.'],
    ['attribution_setting', 'Attribution window applied to the row.'],
    ['date_start', 'First day covered by the row.'],
    ['date_stop', 'Last day covered by the row.'],
    ['created_time', 'When the object was created.'],
    ['updated_time', 'When the object was last changed.'],
    ['labels', 'Labels applied to the ad.'],
    ['location', 'Location the row covers, when broken down by place.'],
    ['place_page_name', 'Page name for a store-traffic row.'],
    ['age_targeting', 'Age range the ad set targeted.'],
    ['gender_targeting', 'Genders the ad set targeted.'],
  ]),
  ...adFields('delivery', [
    ['impressions', 'Times the ad entered a screen.'],
    ['reach', 'People who saw the ad.'],
    ['frequency', 'Average impressions per person reached.'],
    ['clicks', 'All clicks on the ad.'],
    ['unique_clicks', 'People who clicked the ad.'],
    ['ctr', 'Clicks divided by impressions.'],
    ['unique_ctr', 'People who clicked divided by people reached.'],
    ['inline_link_clicks', 'Clicks on links in the ad.'],
    ['unique_inline_link_clicks', 'People who clicked a link in the ad.'],
    ['inline_link_click_ctr', 'Link clicks divided by impressions.'],
    ['unique_inline_link_click_ctr', 'People who clicked a link divided by people reached.'],
    ['unique_link_clicks_ctr', 'Unique link click-through rate.'],
    ['website_ctr', 'Click-through rate for website destinations.'],
    ['full_view_impressions', 'Impressions where the ad was fully in view.'],
    ['full_view_reach', 'People who saw the ad fully in view.'],
    ['auction_bid', 'Bid entered into the auction.'],
    ['auction_competitiveness', 'How competitive the auction was.'],
    ['auction_max_competitor_bid', 'Highest competing bid.'],
    ['wish_bid', 'Bid the advertiser asked for.'],
    ['quality_ranking', 'Quality against ads competing for the same audience.'],
    ['engagement_rate_ranking', 'Engagement rate against ads competing for the same audience.'],
    ['conversion_rate_ranking', 'Conversion rate against ads competing for the same audience.'],
  ]),
  ...adFields('cost', [
    ['spend', 'Amount spent.'],
    ['social_spend', 'Spend on ads shown with social context.'],
    ['cpc', 'Cost per click.'],
    ['cpm', 'Cost per thousand impressions.'],
    ['cpp', 'Cost per thousand people reached.'],
    ['cost_per_unique_click', 'Cost per person who clicked.'],
    ['cost_per_inline_link_click', 'Cost per link click.'],
    ['cost_per_unique_inline_link_click', 'Cost per person who clicked a link.'],
    ['cost_per_inline_post_engagement', 'Cost per post engagement.'],
    ['cost_per_ad_click', 'Cost per click on the ad itself.'],
    ['cost_per_outbound_click', 'Cost per click leaving Meta.'],
    ['cost_per_unique_outbound_click', 'Cost per person who left Meta.'],
    ['cost_per_thruplay', 'Cost per ThruPlay.'],
    ['cost_per_15_sec_video_view', 'Cost per 15-second video view.'],
    ['cost_per_2_sec_continuous_video_view', 'Cost per 2-second continuous video view.'],
    ['cost_per_estimated_ad_recallers', 'Cost per person estimated to remember the ad.'],
    ['cost_per_one_thousand_ad_impression', 'Cost per thousand ad impressions.'],
    ['cost_per_conversion', 'Cost per conversion.'],
    ['cost_per_unique_conversion', 'Cost per person who converted.'],
    ['cost_per_dda_countby_convs', 'Cost per data-driven attributed conversion.'],
  ]),
  ...adFields(
    'cost',
    [
      ['cost_per_action_type', 'Cost split by the action it bought.'],
      ['cost_per_unique_action_type', 'Cost per person, split by action type.'],
    ],
    true,
  ),
  ...adFields('engagement', [
    ['inline_post_engagement', 'Likes, comments, shares and clicks on the ad’s post.'],
    ['estimated_ad_recall_rate', 'Estimated share of people who would remember the ad.'],
    ['estimated_ad_recallers', 'Estimated people who would remember the ad.'],
    ['canvas_avg_view_percent', 'Average share of an instant experience viewed.'],
    ['canvas_avg_view_time', 'Average seconds an instant experience was viewed.'],
    ['instant_experience_clicks_to_open', 'Clicks that opened an instant experience.'],
    ['instant_experience_clicks_to_start', 'Clicks that started an instant experience.'],
    ['instant_experience_outbound_clicks', 'Clicks leaving an instant experience.'],
    ['qualifying_question_qualify_answer_rate', 'Share of lead-form answers that qualified.'],
  ]),
  ...adFields(
    'engagement',
    [
      ['actions', 'Every action taken, split by action type.'],
      ['unique_actions', 'People who acted, split by action type.'],
      ['action_values', 'Value of actions taken, split by action type.'],
      ['ad_click_actions', 'Clicks on the ad, split by action type.'],
      ['ad_impression_actions', 'Impressions, split by action type.'],
      ['outbound_clicks', 'Clicks leaving Meta, split by action type.'],
      ['unique_outbound_clicks', 'People who left Meta, split by action type.'],
      ['outbound_clicks_ctr', 'Outbound click-through rate, split by action type.'],
      ['unique_outbound_clicks_ctr', 'Unique outbound click-through rate, split by action type.'],
    ],
    true,
  ),
  ...adFields(
    'conversion',
    [
      ['conversions', 'Conversions, split by action type.'],
      ['conversion_values', 'Conversion value, split by action type.'],
      ['dda_countby_convs', 'Data-driven attributed conversions.'],
      ['catalog_segment_actions', 'Catalogue-segment actions, split by action type.'],
      ['catalog_segment_value', 'Catalogue-segment value, split by action type.'],
      ['purchase_roas', 'Return on ad spend from purchases.'],
      ['website_purchase_roas', 'Return on ad spend from website purchases.'],
      ['mobile_app_purchase_roas', 'Return on ad spend from app purchases.'],
      ['converted_product_quantity', 'Units of the converted product.'],
      ['converted_product_value', 'Value of the converted product.'],
    ],
    true,
  ),
  ...adFields(
    'video',
    [
      ['video_play_actions', 'Times the video started playing.'],
      ['video_thruplay_watched_actions', 'ThruPlays: 15 seconds or completion.'],
      ['video_avg_time_watched_actions', 'Average seconds watched.'],
      ['video_time_watched_actions', 'Total seconds watched.'],
      ['video_continuous_2_sec_watched_actions', 'Views of at least 2 continuous seconds.'],
      ['video_15_sec_watched_actions', 'Views of at least 15 seconds.'],
      ['video_30_sec_watched_actions', 'Views of at least 30 seconds.'],
      ['video_p25_watched_actions', 'Views that reached a quarter of the video.'],
      ['video_p50_watched_actions', 'Views that reached half of the video.'],
      ['video_p75_watched_actions', 'Views that reached three quarters of the video.'],
      ['video_p95_watched_actions', 'Views that reached 95% of the video.'],
      ['video_p100_watched_actions', 'Views that reached the end of the video.'],
      ['video_play_curve_actions', 'Share still watching at each second.'],
      ['video_play_retention_graph_actions', 'Retention curve across the whole video.'],
      ['video_play_retention_0_to_15s_actions', 'Retention curve over the first 15 seconds.'],
      ['video_play_retention_20_to_60s_actions', 'Retention curve from 20 to 60 seconds.'],
    ],
    true,
  ),
];

/** Money and rate fields, so the UI knows to format rather than count them. */
export const AD_MONEY_FIELDS = new Set([
  'spend',
  'social_spend',
  'cpc',
  'cpm',
  'cpp',
  'cost_per_unique_click',
  'cost_per_inline_link_click',
  'cost_per_unique_inline_link_click',
  'cost_per_inline_post_engagement',
  'cost_per_ad_click',
  'cost_per_outbound_click',
  'cost_per_unique_outbound_click',
  'cost_per_thruplay',
  'cost_per_15_sec_video_view',
  'cost_per_2_sec_continuous_video_view',
  'cost_per_estimated_ad_recallers',
  'cost_per_one_thousand_ad_impression',
  'cost_per_conversion',
  'cost_per_unique_conversion',
  'cost_per_dda_countby_convs',
]);

/** Fields that are percentages already expressed 0–100. */
export const AD_RATE_FIELDS = new Set([
  'ctr',
  'unique_ctr',
  'inline_link_click_ctr',
  'unique_inline_link_click_ctr',
  'unique_link_clicks_ctr',
  'website_ctr',
  'estimated_ad_recall_rate',
  'canvas_avg_view_percent',
  'qualifying_question_qualify_answer_rate',
]);

/** The default request: everything scalar, since Graph charges per call. */
export const AD_DEFAULT_FIELDS = AD_INSIGHT_FIELDS.filter(
  (field) => field.category !== 'meta' || ['campaign_name', 'adset_name', 'ad_name', 'account_currency'].includes(field.name),
).map((field) => field.name);

// ---------------------------------------------------------------------------
// Object fields (no insights edge, no permissions beyond page access)
// ---------------------------------------------------------------------------

/**
 * Fields readable straight off the Page object — no insights edge, no
 * date range, and no `read_insights` permission required. These are the
 * numbers most likely to work when everything else is restricted.
 */
export const PAGE_PROFILE_FIELDS = [
  'id',
  'name',
  'username',
  'category',
  'fan_count',
  'followers_count',
  'talking_about_count',
  'were_here_count',
  'rating_count',
  'overall_star_rating',
  'new_like_count',
  'link',
  'verification_status',
  'is_published',
] as const;

/** Fields on an Instagram Business account object. */
export const IG_PROFILE_FIELDS = [
  'id',
  'username',
  'name',
  'biography',
  'website',
  'profile_picture_url',
  'followers_count',
  'follows_count',
  'media_count',
] as const;

/** Fields on an Instagram media object. */
export const IG_MEDIA_FIELDS = [
  'id',
  'caption',
  'media_type',
  'media_product_type',
  'media_url',
  'permalink',
  'thumbnail_url',
  'timestamp',
  'like_count',
  'comments_count',
] as const;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export const ALL_METRICS = [
  ...PAGE_METRICS,
  ...POST_METRICS,
  ...VIDEO_METRICS,
  ...IG_ACCOUNT_METRICS,
  ...IG_MEDIA_METRICS,
];

const BY_LEVEL: Record<MetricLevel, MetricDefinition[]> = {
  page: PAGE_METRICS,
  post: POST_METRICS,
  video: VIDEO_METRICS,
  ig_account: IG_ACCOUNT_METRICS,
  ig_media: IG_MEDIA_METRICS,
};

export function metricsFor(level: MetricLevel): MetricDefinition[] {
  return BY_LEVEL[level];
}

/**
 * Look up a definition by name.
 *
 * Instagram reuses bare names like `impressions` and `reach` at both account
 * and media level, so a level can be supplied to disambiguate. Without one the
 * first match wins, which is what the Facebook-only callers want.
 */
export function findMetric(name: string, level?: MetricLevel): MetricDefinition | undefined {
  const pool = level ? BY_LEVEL[level] : ALL_METRICS;
  return pool.find((metric) => metric.name === name);
}

export function findAdField(name: string): AdFieldDefinition | undefined {
  return AD_INSIGHT_FIELDS.find((field) => field.name === name);
}

/** Group definitions by category, for a UI that shows sections. */
export function byCategory(metrics: MetricDefinition[]): Map<MetricCategory, MetricDefinition[]> {
  const grouped = new Map<MetricCategory, MetricDefinition[]>();
  for (const metric of metrics) {
    const bucket = grouped.get(metric.category) ?? [];
    bucket.push(metric);
    grouped.set(metric.category, bucket);
  }
  return grouped;
}

export const CATEGORY_LABELS: Record<MetricCategory, string> = {
  reach: 'Reach and impressions',
  engagement: 'Engagement',
  audience: 'Audience',
  demographics: 'Demographics',
  video: 'Video',
  clicks: 'Clicks',
  negative: 'Negative feedback',
  profile: 'Profile',
  messaging: 'Messaging',
  monetisation: 'Monetisation',
};

/** How many metric names the catalogue covers, per level. Used by the UI. */
export function catalogueSize(): Record<MetricLevel | 'ads', number> {
  return {
    page: PAGE_METRICS.length,
    post: POST_METRICS.length,
    video: VIDEO_METRICS.length,
    ig_account: IG_ACCOUNT_METRICS.length,
    ig_media: IG_MEDIA_METRICS.length,
    ads: AD_INSIGHT_FIELDS.length,
  };
}
