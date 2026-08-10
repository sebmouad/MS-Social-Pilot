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
