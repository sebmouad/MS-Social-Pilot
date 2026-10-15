import { adsMetric, channelMetric, humanizeMetricKey, type MetricDefinition } from '../metrics';

/**
 * The Facebook module's metric catalogue: Page insights, linked Instagram
 * professional account insights and ad account measures, in plain language.
 * Meaning follows the provider documentation; retirement dates follow the
 * provider's published change log (stored history under a retired name is real
 * data, so the name stays here with its explanation).
 */

const NOV_2025 = '2025-11-15';
const JUL_2026 = '2026-07-29';
const APR_2025 = '2025-04-21';

const c = channelMetric;

export const FACEBOOK_METRICS: readonly MetricDefinition[] = [
  // Audience
  c('page_follows', 'Followers', 'People who follow the Page, as of each day.', 'people', 'latest', 'audience', { headline: true }),
  c('page_daily_follows', 'New follows', 'Times someone followed the Page each day.', 'count', 'sum', 'audience'),
  c('page_daily_follows_unique', 'New followers', 'People who followed the Page each day.', 'people', 'sum', 'audience', { headline: true }),
  c('page_daily_unfollows_unique', 'Lost followers', 'People who stopped following the Page each day.', 'people', 'sum', 'audience', { lowerIsBetter: true }),
  c('page_fans', 'Page likes', 'People who like the Page, as of each day.', 'people', 'latest', 'audience', { retired: { on: NOV_2025, replacedBy: 'page_follows' } }),
  c('page_fan_adds', 'New Page likes', 'Times someone liked the Page.', 'count', 'sum', 'audience', { retired: { on: NOV_2025, replacedBy: 'page_daily_follows_unique' } }),
  c('page_fan_adds_unique', 'People who liked the Page', 'People who liked the Page each day.', 'people', 'sum', 'audience', { retired: { on: NOV_2025, replacedBy: 'page_daily_follows_unique' } }),
  c('page_fan_removes', 'Page unlikes', 'Times someone stopped liking the Page.', 'count', 'sum', 'audience', { retired: { on: NOV_2025, replacedBy: 'page_daily_unfollows_unique' } }),
  c('page_fan_removes_unique', 'People who unliked the Page', 'People who stopped liking the Page each day.', 'people', 'sum', 'audience', { retired: { on: NOV_2025, replacedBy: 'page_daily_unfollows_unique' } }),
  c('page_follows_country', 'Followers by country', 'Where followers are, by country.', 'people', 'latest', 'audience', { breakdown: true }),
  c('page_follows_city', 'Followers by city', 'Where followers are, by city.', 'people', 'latest', 'audience', { breakdown: true }),
  c('page_follows_locale', 'Followers by language', 'Followers by their language setting.', 'people', 'latest', 'audience', { breakdown: true }),
  c('page_fans_country', 'Page likes by country', 'Where people who like the Page are, by country.', 'people', 'latest', 'audience', { breakdown: true, retired: { on: NOV_2025, replacedBy: 'page_follows_country' } }),
  c('page_fans_city', 'Page likes by city', 'Where people who like the Page are, by city.', 'people', 'latest', 'audience', { breakdown: true, retired: { on: NOV_2025, replacedBy: 'page_follows_city' } }),
  c('page_fans_locale', 'Page likes by language', 'People who like the Page, by language setting.', 'people', 'latest', 'audience', { breakdown: true, retired: { on: NOV_2025, replacedBy: 'page_follows_locale' } }),
  c('page_fans_gender_age', 'Page likes by gender and age', 'People who like the Page, by gender and age band.', 'people', 'latest', 'audience', { breakdown: true, retired: { on: NOV_2025 } }),
  c('page_fans_online_per_day', 'Followers online', 'Followers who were online at any point that day.', 'people', 'unique', 'audience'),

  // Reach and views
  c('page_media_view', 'Views', 'Times the Page’s content was played or shown.', 'count', 'sum', 'reach', { headline: true }),
  c('page_total_media_view_unique', 'Viewers', 'People who viewed the Page’s content.', 'people', 'unique', 'reach', { headline: true }),
  c('page_impressions', 'Impressions', 'Times any Page content appeared on a screen.', 'count', 'sum', 'reach', { retired: { on: NOV_2025, replacedBy: 'page_media_view' } }),
  c('page_impressions_paid', 'Paid impressions', 'Impressions from paid promotion.', 'count', 'sum', 'reach', { retired: { on: NOV_2025, replacedBy: 'page_media_view' } }),
  c('page_impressions_organic', 'Unpaid impressions', 'Impressions that were not paid for.', 'count', 'sum', 'reach', { retired: { on: NOV_2025, replacedBy: 'page_media_view' } }),
  c('page_impressions_viral', 'Impressions through friends', 'Impressions carried by a friend’s story about the Page.', 'count', 'sum', 'reach', { retired: { on: NOV_2025 } }),
  c('page_impressions_nonviral', 'Impressions not through friends', 'Impressions not carried by a friend’s story.', 'count', 'sum', 'reach', { retired: { on: NOV_2025 } }),
  c('page_impressions_unique', 'People reached', 'People who saw any Page content.', 'people', 'unique', 'reach', { retired: { on: JUL_2026, replacedBy: 'page_total_media_view_unique' } }),
  c('page_impressions_paid_unique', 'People reached by paid promotion', 'People reached through paid promotion.', 'people', 'unique', 'reach', { retired: { on: JUL_2026, replacedBy: 'page_media_view' } }),
  c('page_impressions_organic_unique', 'People reached without paid promotion', 'People who saw Page content without paid promotion.', 'people', 'unique', 'reach', { retired: { on: JUL_2026, replacedBy: 'page_total_media_view_unique' } }),
  c('page_impressions_viral_unique', 'People reached through friends', 'People reached via a friend’s story about the Page.', 'people', 'unique', 'reach', { retired: { on: JUL_2026 } }),
  c('page_impressions_nonviral_unique', 'People reached not through friends', 'People reached other than via a friend’s story.', 'people', 'unique', 'reach', { retired: { on: JUL_2026 } }),
  c('page_posts_impressions', 'Post impressions', 'Times any Page post appeared on a screen.', 'count', 'sum', 'reach', { retired: { on: JUL_2026, replacedBy: 'page_media_view' } }),
  c('page_posts_impressions_unique', 'People who saw posts', 'People who saw any Page post.', 'people', 'unique', 'reach', { retired: { on: JUL_2026, replacedBy: 'page_total_media_view_unique' } }),
  c('page_posts_impressions_paid', 'Paid post impressions', 'Paid impressions of Page posts.', 'count', 'sum', 'reach', { retired: { on: JUL_2026 } }),
  c('page_posts_impressions_organic', 'Unpaid post impressions', 'Unpaid impressions of Page posts.', 'count', 'sum', 'reach', { retired: { on: JUL_2026 } }),
  c('page_posts_impressions_organic_unique', 'People reached by posts without paid promotion', 'People who saw Page posts without paid promotion.', 'people', 'unique', 'reach', { retired: { on: JUL_2026 } }),
  c('page_posts_impressions_paid_unique', 'People reached by paid posts', 'People reached by Page posts through paid promotion.', 'people', 'unique', 'reach', { retired: { on: JUL_2026 } }),

  // Engagement
  c('page_post_engagements', 'Post engagements', 'Times people reacted to, commented on, shared or clicked Page posts.', 'count', 'sum', 'engagement', { headline: true }),
  c('page_engaged_users', 'People who engaged', 'People who clicked anything on Page content.', 'people', 'unique', 'engagement'),
  c('page_consumptions', 'Content clicks', 'Clicks on Page content.', 'count', 'sum', 'engagement'),
  c('page_consumptions_unique', 'People who clicked content', 'People who clicked on Page content.', 'people', 'unique', 'engagement'),
  c('page_actions_post_reactions_total', 'Reactions by type', 'Reactions on Page posts, split by type.', 'count', 'sum', 'engagement', { breakdown: true }),
  c('page_actions_post_reactions_like_total', 'Like reactions', 'Like reactions on Page posts.', 'count', 'sum', 'engagement'),
  c('page_actions_post_reactions_love_total', 'Love reactions', 'Love reactions on Page posts.', 'count', 'sum', 'engagement'),
  c('page_actions_post_reactions_wow_total', 'Wow reactions', 'Wow reactions on Page posts.', 'count', 'sum', 'engagement'),
  c('page_actions_post_reactions_haha_total', 'Haha reactions', 'Haha reactions on Page posts.', 'count', 'sum', 'engagement'),
  c('page_actions_post_reactions_sorry_total', 'Sad reactions', 'Sad reactions on Page posts.', 'count', 'sum', 'engagement'),
  c('page_actions_post_reactions_anger_total', 'Angry reactions', 'Angry reactions on Page posts.', 'count', 'sum', 'engagement'),
  c('page_positive_feedback_by_type', 'Positive feedback by type', 'Likes, comments, shares and link clicks, split by kind.', 'count', 'sum', 'engagement', { breakdown: true }),
  c('page_negative_feedback', 'Negative feedback', 'Times people hid, reported or unliked Page content.', 'count', 'sum', 'engagement', { lowerIsBetter: true }),
  c('page_negative_feedback_unique', 'People giving negative feedback', 'People who hid, reported or unliked Page content.', 'people', 'unique', 'engagement', { lowerIsBetter: true }),
  c('page_negative_feedback_by_type', 'Negative feedback by type', 'Hides, reports and unlikes, split by kind.', 'count', 'sum', 'engagement', { breakdown: true }),
  c('page_content_activity', 'Stories about the Page', 'Stories people created about the Page.', 'count', 'sum', 'engagement'),
  c('page_places_checkin_total', 'Check-ins', 'Check-ins at the Page location.', 'count', 'sum', 'engagement'),

  // Profile activity
  c('page_views_total', 'Page views', 'Times the Page profile was viewed.', 'count', 'sum', 'profile', { headline: true }),
  c('page_views_logged_in_total', 'Signed-in Page views', 'Profile views by signed-in people.', 'count', 'sum', 'profile'),
  c('page_views_logged_in_unique', 'Signed-in visitors', 'Signed-in people who viewed the Page profile.', 'people', 'unique', 'profile'),
  c('page_total_actions', 'Contact button clicks', 'Clicks on the Page’s contact and action buttons.', 'count', 'sum', 'profile'),
  c('page_cta_clicks_logged_in_total', 'Call-to-action clicks', 'Clicks on the Page’s call-to-action button.', 'count', 'sum', 'profile'),
  c('page_website_clicks_logged_in_unique', 'People who clicked the website', 'People who clicked through to the Page’s website.', 'people', 'unique', 'profile'),
  c('page_call_phone_clicks_logged_in_unique', 'People who tapped the phone number', 'People who tapped the Page’s phone number.', 'people', 'unique', 'profile'),
  c('page_get_directions_clicks_logged_in_unique', 'People who asked for directions', 'People who asked for directions to the Page location.', 'people', 'unique', 'profile'),

  // Video
  c('page_video_views', 'Video views', 'Times a Page video was watched for at least 3 seconds.', 'count', 'sum', 'video', { headline: true }),
  c('page_video_views_unique', 'People who watched videos', 'People who watched a Page video.', 'people', 'unique', 'video', { retired: { on: JUL_2026 } }),
  c('page_video_views_paid', 'Paid video views', 'Video views from paid promotion.', 'count', 'sum', 'video'),
  c('page_video_views_organic', 'Unpaid video views', 'Video views that were not paid for.', 'count', 'sum', 'video'),
  c('page_video_views_10s', 'Video views of 10 seconds', 'Times a Page video was watched for at least 10 seconds.', 'count', 'sum', 'video'),
  c('page_video_complete_views_30s', 'Video views of 30 seconds', 'Times a Page video was watched for 30 seconds or to the end.', 'count', 'sum', 'video'),
  c('page_video_view_time', 'Video watch time', 'Total time people spent watching Page videos.', 'duration', 'sum', 'video', { valueScale: 0.001 }),

  // Messages
  c('page_messages_new_conversations_unique', 'New conversations', 'Conversations people started with the Page.', 'count', 'sum', 'messaging'),
  c('page_messages_active_threads_unique', 'Active conversations', 'Conversations with any activity that day.', 'count', 'unique', 'messaging'),
  c('page_messages_total_messaging_connection', 'People you can message', 'People the Page can currently message.', 'people', 'latest', 'messaging'),

  // Linked Instagram professional account
  c('follower_count', 'New followers', 'People who started following the account each day.', 'people', 'sum', 'audience', { headline: true }),
  c('views', 'Views', 'Times the account’s content was played or shown.', 'count', 'sum', 'reach', { headline: true }),
  c('reach', 'People reached', 'People who saw the account’s content.', 'people', 'unique', 'reach', { headline: true }),
  c('impressions', 'Impressions', 'Times the account’s content appeared on a screen.', 'count', 'sum', 'reach', { retired: { on: APR_2025, replacedBy: 'views' } }),
  c('profile_views', 'Profile views', 'Times the account profile was viewed.', 'count', 'sum', 'profile'),
  c('website_clicks', 'Website clicks', 'Taps on the website link in the profile.', 'count', 'sum', 'profile'),
  c('accounts_engaged', 'Accounts engaged', 'People who interacted with the account’s content.', 'people', 'unique', 'engagement'),
  c('total_interactions', 'Interactions', 'Likes, comments, saves and shares on the account’s content.', 'count', 'sum', 'engagement', { headline: true }),
  c('likes', 'Likes', 'Likes on the account’s content.', 'count', 'sum', 'engagement'),
  c('comments', 'Comments', 'Comments on the account’s content.', 'count', 'sum', 'engagement'),
  c('shares', 'Shares', 'Times the account’s content was shared.', 'count', 'sum', 'engagement'),
  c('saves', 'Saves', 'Times the account’s content was saved.', 'count', 'sum', 'engagement'),
  c('replies', 'Story replies', 'Replies to the account’s stories.', 'count', 'sum', 'engagement'),
  c('follows_and_unfollows', 'Follows and unfollows', 'New and lost followers, split by kind.', 'people', 'sum', 'audience', { breakdown: true }),
  c('online_followers', 'Followers online by hour', 'When followers are online, by hour of day.', 'people', 'latest', 'audience', { breakdown: true }),

  // Advertising
  adsMetric('spend', 'Ad spend', 'Money spent on ads. Each currency is reported separately.', 'currency', 'sum', { headline: true, neutral: true }),
  adsMetric('impressions', 'Ad impressions', 'Times ads appeared on a screen.', 'count', 'sum', { headline: true }),
  adsMetric('clicks', 'Ad clicks', 'Clicks on ads.', 'count', 'sum', { headline: true }),
  adsMetric('reach', 'People reached by ads', 'People who saw ads. People can be counted on several days.', 'people', 'unique'),
  adsMetric('ctr', 'Click-through rate', 'Share of ad impressions that led to a click.', 'rate', 'rate', { headline: true, rate: { numerator: 'clicks', denominator: 'impressions', scale: 100, style: 'percent' } }),
  adsMetric('cpc', 'Cost per click', 'Average spend for each click.', 'currency', 'rate', { lowerIsBetter: true, rate: { numerator: 'spend', denominator: 'clicks', style: 'money' } }),
  adsMetric('cpm', 'Cost per 1,000 impressions', 'Average spend for every 1,000 times ads appeared.', 'currency', 'rate', { lowerIsBetter: true, rate: { numerator: 'spend', denominator: 'impressions', scale: 1000, style: 'money' } }),
  adsMetric('cpp', 'Cost per person reached', 'Average spend for each person who saw ads.', 'currency', 'rate', { lowerIsBetter: true, rate: { numerator: 'spend', denominator: 'reach', style: 'money' } }),
  adsMetric('frequency', 'Frequency', 'Average number of times each person saw ads.', 'rate', 'rate', { rate: { numerator: 'impressions', denominator: 'reach', style: 'multiple' } }),
];

const ACTION_NAMES: Record<string, string> = {
  link_click: 'Link clicks', post_engagement: 'Post engagements', page_engagement: 'Page engagements', landing_page_view: 'Landing page views',
  lead: 'Leads', purchase: 'Purchases', omni_purchase: 'Purchases', video_view: 'Video views', comment: 'Comments', post_reaction: 'Reactions', like: 'Likes',
  onsite_conversion: 'On-site conversions', offsite_conversion: 'Off-site conversions', post: 'Shares', photo_view: 'Photo views',
};

/** Describes stored names the catalogue does not list: ad actions and unlisted channel metrics. */
export function inferFacebookMetric(scope: 'channel' | 'ads', key: string): MetricDefinition | undefined {
  if (scope === 'ads') {
    const [group, action] = key.split(':');
    if (action && (group === 'actions' || group === 'action_values')) {
      const label = ACTION_NAMES[action] ?? humanizeMetricKey(action);
      return group === 'actions'
        ? adsMetric(key, label, `Results attributed to ads: ${label.toLowerCase()}.`, 'count', 'sum')
        : adsMetric(key, `${label} value`, `Value of ${label.toLowerCase()} attributed to ads, in the account currency.`, 'currency', 'sum');
    }
    return undefined;
  }
  const breakdown = /country|city|locale|gender_age|age_gender|source|_by_|demographics/.test(key);
  const unique = /_unique$/.test(key);
  return c(key, humanizeMetricKey(key), 'A measure stored for this channel.', unique ? 'people' : 'count', breakdown ? 'latest' : unique ? 'unique' : 'sum', 'engagement', breakdown ? { breakdown: true } : {});
}
