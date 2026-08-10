/**
 * The Graph API insights catalogue.
 *
 * Meta churns these metrics hard — a batch was removed in v22 (April 2025) and
 * more are deprecated each version. Two consequences shape this file:
 *
 * 1. **Nothing here is assumed to work.** The catalogue is a list of things
 *    worth *asking for*. `probeMetrics` in analytics.ts finds out which ones
 *    this app, on this Graph version, with these permissions, actually gets —
 *    and the UI shows that rather than a guess.
 *
 * 2. **`deprecatedFrom` is advisory.** It records the version Meta announced
 *    removal in, so a metric that stops returning data has an explanation
 *    instead of looking like a bug.
 *
 * Reference: developers.facebook.com/docs/graph-api/reference/insights
 */

export type MetricLevel = 'page' | 'post';

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
  | 'profile';

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

// ---------------------------------------------------------------------------
// Page metrics
// ---------------------------------------------------------------------------

export const PAGE_METRICS: MetricDefinition[] = [
  // --- Reach and impressions ---
  {
    name: 'page_impressions',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Times any content from the Page entered a screen.',
  },
  {
    name: 'page_impressions_unique',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'People who saw any Page content (reach).',
  },
  {
    name: 'page_impressions_organic_v2',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Unpaid impressions.',
  },
  {
    name: 'page_impressions_paid',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Impressions from paid promotion.',
  },
  {
    name: 'page_impressions_viral',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Impressions from stories a friend shared about the Page.',
  },

  // --- Engagement ---
  {
    name: 'page_post_engagements',
    level: 'page',
    category: 'engagement',
    periods: ['day', 'week', 'days_28'],
    description: 'Times people engaged with Page posts, by any action.',
  },
  {
    name: 'page_engaged_users',
    level: 'page',
    category: 'engagement',
    periods: ['day', 'week', 'days_28'],
    description: 'People who clicked anywhere on Page content.',
  },
  {
    name: 'page_consumptions',
    level: 'page',
    category: 'engagement',
    periods: ['day', 'week', 'days_28'],
    description: 'Clicks on Page content.',
  },
  {
    name: 'page_actions_post_reactions_total',
    level: 'page',
    category: 'engagement',
    periods: ['day'],
    description: 'Reactions on Page posts, broken down by type.',
    breakdown: true,
  },
  {
    name: 'page_places_checkin_total',
    level: 'page',
    category: 'engagement',
    periods: ['day', 'week', 'days_28'],
    description: 'Check-ins at the Page location.',
  },

  // --- Audience ---
  {
    name: 'page_fans',
    level: 'page',
    category: 'audience',
    periods: ['lifetime'],
    description: 'Total Page likes.',
  },
  {
    name: 'page_fan_adds',
    level: 'page',
    category: 'audience',
    periods: ['day', 'week', 'days_28'],
    description: 'New Page likes.',
  },
  {
    name: 'page_fan_removes',
    level: 'page',
    category: 'audience',
    periods: ['day', 'week', 'days_28'],
    description: 'Page unlikes.',
  },
  {
    name: 'page_follows',
    level: 'page',
    category: 'audience',
    periods: ['day'],
    description: 'New followers.',
  },
  {
    name: 'page_daily_follows_unique',
    level: 'page',
    category: 'audience',
    periods: ['day'],
    description: 'People who followed the Page.',
  },
  {
    name: 'page_daily_unfollows_unique',
    level: 'page',
    category: 'audience',
    periods: ['day'],
    description: 'People who unfollowed the Page.',
  },
  {
    name: 'page_views_total',
    level: 'page',
    category: 'profile',
    periods: ['day', 'week', 'days_28'],
    description: 'Views of the Page profile.',
  },

  // --- Demographics (breakdowns, lifetime only) ---
  {
    name: 'page_fans_country',
    level: 'page',
    category: 'demographics',
    periods: ['lifetime'],
    description: 'Page likes by country.',
    breakdown: true,
  },
  {
    name: 'page_fans_city',
    level: 'page',
    category: 'demographics',
    periods: ['lifetime'],
    description: 'Page likes by city.',
    breakdown: true,
  },
  {
    name: 'page_fans_locale',
    level: 'page',
    category: 'demographics',
    periods: ['lifetime'],
    description: 'Page likes by language.',
    breakdown: true,
  },
  {
    name: 'page_fans_gender_age',
    level: 'page',
    category: 'demographics',
    periods: ['lifetime'],
    description: 'Page likes by gender and age band.',
    breakdown: true,
  },
  {
    name: 'page_impressions_by_age_gender_unique',
    level: 'page',
    category: 'demographics',
    periods: ['day', 'week', 'days_28'],
    description: 'Reach by gender and age band.',
    breakdown: true,
  },
  {
    name: 'page_impressions_by_country_unique',
    level: 'page',
    category: 'demographics',
    periods: ['day', 'week', 'days_28'],
    description: 'Reach by country.',
    breakdown: true,
  },
  {
    name: 'page_impressions_by_city_unique',
    level: 'page',
    category: 'demographics',
    periods: ['day', 'week', 'days_28'],
    description: 'Reach by city.',
    breakdown: true,
  },

  // --- Video ---
  {
    name: 'page_video_views',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Video views of at least 3 seconds.',
  },
  {
    name: 'page_video_views_organic',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Unpaid video views.',
  },
  {
    name: 'page_video_views_paid',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Paid video views.',
  },
  {
    name: 'page_video_complete_views_30s',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Videos watched to 30 seconds or completion.',
  },
  {
    name: 'page_video_view_time',
    level: 'page',
    category: 'video',
    periods: ['day'],
    description: 'Total milliseconds of video watched.',
  },

  // --- Negative feedback ---
  {
    name: 'page_negative_feedback',
    level: 'page',
    category: 'negative',
    periods: ['day', 'week', 'days_28'],
    description: 'Hides, reports and unlikes.',
  },
  {
    name: 'page_negative_feedback_unique',
    level: 'page',
    category: 'negative',
    periods: ['day', 'week', 'days_28'],
    description: 'People who gave negative feedback.',
  },

  // --- Post-level rollups on the Page ---
  // How the Page's *posts* performed in aggregate, as opposed to the Page
  // itself. Useful for separating content performance from profile traffic.
  {
    name: 'page_posts_impressions',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Times any Page post entered a screen.',
  },
  {
    name: 'page_posts_impressions_unique',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'People who saw any Page post.',
  },
  {
    name: 'page_posts_impressions_organic',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Unpaid impressions of Page posts.',
  },
  {
    name: 'page_posts_impressions_paid',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Paid impressions of Page posts.',
  },
  {
    name: 'page_posts_impressions_viral',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Impressions of Page posts via a friend’s story.',
  },
  {
    name: 'page_posts_impressions_frequency_distribution',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'How many people saw Page posts once, twice, and so on.',
    breakdown: true,
  },
  {
    name: 'page_impressions_by_story_type',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Impressions split by the kind of story that carried them.',
    breakdown: true,
  },
  {
    name: 'page_impressions_by_paid_non_paid_unique',
    level: 'page',
    category: 'reach',
    periods: ['day', 'week', 'days_28'],
    description: 'Reach split into paid, unpaid and total.',
    breakdown: true,
  },

  // --- Profile traffic and the call-to-action button ---
  {
    name: 'page_views_by_profile_tab_total',
    level: 'page',
    category: 'profile',
    periods: ['day', 'week', 'days_28'],
    description: 'Profile views split by which tab was opened.',
    breakdown: true,
  },
  {
    name: 'page_views_by_internal_referer_logged_in_unique',
    level: 'page',
    category: 'profile',
    periods: ['day', 'week', 'days_28'],
    description: 'Where inside Facebook profile visitors came from.',
    breakdown: true,
  },
  {
    name: 'page_views_external_referrals',
    level: 'page',
    category: 'profile',
    periods: ['day'],
    description: 'External sites that sent traffic to the Page.',
    breakdown: true,
  },
  {
    name: 'page_total_actions',
    level: 'page',
    category: 'profile',
    periods: ['day', 'week', 'days_28'],
    description: 'Clicks on the Page’s contact and action buttons.',
  },
  {
    name: 'page_cta_clicks_logged_in_total',
    level: 'page',
    category: 'clicks',
    periods: ['day', 'week', 'days_28'],
    description: 'Clicks on the Page’s call-to-action button.',
  },
  {
    name: 'page_website_clicks_logged_in_unique',
    level: 'page',
    category: 'clicks',
    periods: ['day', 'week', 'days_28'],
    description: 'People who clicked through to the Page’s website.',
  },
  {
    name: 'page_call_phone_clicks_logged_in_unique',
    level: 'page',
    category: 'clicks',
    periods: ['day', 'week', 'days_28'],
    description: 'People who tapped the Page’s phone number.',
  },
  {
    name: 'page_get_directions_clicks_logged_in_unique',
    level: 'page',
    category: 'clicks',
    periods: ['day', 'week', 'days_28'],
    description: 'People who asked for directions to the Page location.',
  },

  // --- When the audience is around ---
  // The scheduling signal: which hours the Page's own followers are online.
  {
    name: 'page_fans_online',
    level: 'page',
    category: 'audience',
    periods: ['day'],
    description: 'Followers online, by hour of day.',
    breakdown: true,
  },
  {
    name: 'page_fans_online_per_day',
    level: 'page',
    category: 'audience',
    periods: ['day'],
    description: 'Followers online at any point that day.',
  },
  {
    name: 'page_fan_adds_by_paid_non_paid_unique',
    level: 'page',
    category: 'audience',
    periods: ['day', 'week', 'days_28'],
    description: 'New likes split into paid and unpaid.',
    breakdown: true,
  },

  // --- Feedback, positive and negative ---
  {
    name: 'page_positive_feedback_by_type',
    level: 'page',
    category: 'engagement',
    periods: ['day', 'week', 'days_28'],
    description: 'Likes, comments, shares and link clicks, split by kind.',
    breakdown: true,
  },
  {
    name: 'page_negative_feedback_by_type',
    level: 'page',
    category: 'negative',
    periods: ['day', 'week', 'days_28'],
    description: 'Hides, reports and unlikes, split by kind.',
    breakdown: true,
  },
  {
    name: 'page_content_activity_by_action_type_unique',
    level: 'page',
    category: 'engagement',
    periods: ['day', 'week', 'days_28'],
    description: 'People talking about the Page, split by what they did.',
    breakdown: true,
  },

  // --- Video depth ---
  {
    name: 'page_video_views_10s',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Video views of at least 10 seconds.',
  },
  {
    name: 'page_video_repeat_views',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Views by someone who had already watched the video.',
  },
  {
    name: 'page_video_views_click_to_play',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Views where the viewer chose to press play.',
  },
  {
    name: 'page_video_views_autoplay',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Views that started automatically.',
  },
  {
    name: 'page_video_views_by_paid_non_paid',
    level: 'page',
    category: 'video',
    periods: ['day', 'week', 'days_28'],
    description: 'Video views split into paid and unpaid.',
    breakdown: true,
  },
];

// ---------------------------------------------------------------------------
// Post metrics
// ---------------------------------------------------------------------------

export const POST_METRICS: MetricDefinition[] = [
  {
    name: 'post_impressions',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'Times the post entered a screen.',
  },
  {
    name: 'post_impressions_unique',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'People who saw the post (reach).',
  },
  {
    name: 'post_impressions_organic',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'Unpaid impressions.',
  },
  {
    name: 'post_impressions_paid',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'Impressions from paid promotion.',
  },
  {
    name: 'post_impressions_viral',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'Impressions via a friend’s story about the post.',
  },
  {
    name: 'post_impressions_fan',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'Impressions among people who like the Page.',
  },
  {
    name: 'post_engaged_users',
    level: 'post',
    category: 'engagement',
    periods: ['lifetime'],
    description: 'People who clicked anywhere on the post.',
  },
  {
    name: 'post_reactions_by_type_total',
    level: 'post',
    category: 'engagement',
    periods: ['lifetime'],
    description: 'Reactions split by like, love, wow, haha, sorry, anger.',
    breakdown: true,
  },
  {
    name: 'post_clicks',
    level: 'post',
    category: 'clicks',
    periods: ['lifetime'],
    description: 'Clicks anywhere on the post.',
  },
  {
    name: 'post_clicks_by_type',
    level: 'post',
    category: 'clicks',
    periods: ['lifetime'],
    description: 'Clicks split by what was clicked.',
    breakdown: true,
  },
  {
    name: 'post_negative_feedback',
    level: 'post',
    category: 'negative',
    periods: ['lifetime'],
    description: 'Hides, reports and unlikes caused by the post.',
  },
  {
    name: 'post_negative_feedback_by_type',
    level: 'post',
    category: 'negative',
    periods: ['lifetime'],
    description: 'Negative feedback split by kind.',
    breakdown: true,
  },
  {
    name: 'post_video_views',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Video views of at least 3 seconds.',
  },
  {
    name: 'post_video_views_organic',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Unpaid video views.',
  },
  {
    name: 'post_video_views_paid',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Paid video views.',
  },
  {
    name: 'post_video_avg_time_watched',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Average milliseconds watched per view.',
  },
  {
    name: 'post_video_complete_views_organic',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Unpaid views to completion.',
  },
  {
    name: 'post_video_view_time',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Total milliseconds watched.',
  },

  // --- Reach variants: the unique counterparts of the totals above ---
  {
    name: 'post_impressions_organic_unique',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'People reached without paid promotion.',
  },
  {
    name: 'post_impressions_paid_unique',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'People reached through paid promotion.',
  },
  {
    name: 'post_impressions_fan_unique',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'People who like the Page and saw the post.',
  },
  {
    name: 'post_impressions_viral_unique',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'People reached via a friend’s story about the post.',
  },
  {
    name: 'post_impressions_nonviral',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'Impressions not carried by a friend’s story.',
  },
  {
    name: 'post_impressions_by_story_type',
    level: 'post',
    category: 'reach',
    periods: ['lifetime'],
    description: 'Impressions split by the kind of story that carried them.',
    breakdown: true,
  },

  // --- Activity: what people did, as opposed to how many saw it ---
  {
    name: 'post_activity',
    level: 'post',
    category: 'engagement',
    periods: ['lifetime'],
    description: 'Likes, comments and shares on the post.',
  },
  {
    name: 'post_activity_unique',
    level: 'post',
    category: 'engagement',
    periods: ['lifetime'],
    description: 'People who liked, commented on or shared the post.',
  },
  {
    name: 'post_activity_by_action_type',
    level: 'post',
    category: 'engagement',
    periods: ['lifetime'],
    description: 'Post activity split by like, comment and share.',
    breakdown: true,
  },
  {
    name: 'post_engaged_fan',
    level: 'post',
    category: 'engagement',
    periods: ['lifetime'],
    description: 'People who like the Page and engaged with the post.',
  },

  // --- Video depth ---
  {
    name: 'post_video_views_organic_unique',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'People who watched without paid promotion.',
  },
  {
    name: 'post_video_views_paid_unique',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'People who watched through paid promotion.',
  },
  {
    name: 'post_video_views_10s',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Views of at least 10 seconds.',
  },
  {
    name: 'post_video_views_15s',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Views of at least 15 seconds.',
  },
  {
    name: 'post_video_views_60s_excludes_shorter',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Views of at least 60 seconds, on videos long enough to allow it.',
  },
  {
    name: 'post_video_views_sound_on',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Views played with sound on.',
  },
  {
    name: 'post_video_complete_views_30s_organic',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Unpaid views to 30 seconds or completion.',
  },
  {
    name: 'post_video_complete_views_30s_paid',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Paid views to 30 seconds or completion.',
  },
  {
    name: 'post_video_retention_graph',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Share of viewers still watching at each point of the video.',
    breakdown: true,
  },
  {
    name: 'post_video_length',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Video length in milliseconds.',
  },
  {
    name: 'post_video_social_actions',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Likes, comments and shares while the video played.',
    breakdown: true,
  },
  {
    name: 'post_video_views_by_distribution_type',
    level: 'post',
    category: 'video',
    periods: ['lifetime'],
    description: 'Video views split by where they were served.',
    breakdown: true,
  },
];

export const ALL_METRICS = [...PAGE_METRICS, ...POST_METRICS];

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
  'link',
  'verification_status',
  'is_published',
] as const;

export function metricsFor(level: MetricLevel): MetricDefinition[] {
  return level === 'page' ? PAGE_METRICS : POST_METRICS;
}

export function findMetric(name: string): MetricDefinition | undefined {
  return ALL_METRICS.find((metric) => metric.name === name);
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
};
