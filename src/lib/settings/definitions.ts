/**
 * The registry of everything an operator can change without a redeploy.
 *
 * One definition per setting: its type, its default, the environment variable
 * it falls back to, and enough description that the config screen explains
 * itself. Adding a tunable means adding a row here — the API, the form and the
 * validation are all generated from it, so a setting cannot exist in the code
 * and be missing from the screen.
 *
 * Three things are deliberately *not* here, because they cannot be:
 *
 * - `DATABASE_URL` — needed to read this table.
 * - `ENCRYPTION_KEY` — protects the secrets stored in this table.
 * - `SESSION_SECRET` — rotating it from inside a session would end it.
 *
 * Everything else, including the Facebook app credentials, is editable at
 * runtime so a new installation never has to be configured by hand-editing a
 * file on the server.
 */

export type SettingType = 'string' | 'secret' | 'number' | 'boolean' | 'select' | 'list';

export type SettingGroup =
  | 'general'
  | 'facebook'
  | 'features'
  | 'scheduler'
  | 'analytics'
  | 'ai'
  | 'email'
  | 'links'
  | 'media'
  | 'retention';

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  type: SettingType;
  label: string;
  description: string;
  /** Used when neither the database nor the environment supplies a value. */
  default: string | number | boolean | string[];
  /** The variable checked before falling back to the default. */
  env?: string;
  /** Numbers only. Both bounds are enforced on write and clamped on read. */
  min?: number;
  max?: number;
  /** `select` only. */
  options?: Array<{ value: string; label: string }>;
  /** Shown under the field: what changing this actually affects. */
  hint?: string;
  /**
   * True when the change lands on the worker rather than on the next request.
   *
   * The worker re-reads configuration on each pass of its one-second loop, so
   * this is seconds rather than a restart — but a job already mid-run finishes
   * on the old value, which is worth saying on a field like a poll interval.
   */
  workerRestart?: boolean;
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // --- General ---------------------------------------------------------------
  {
    key: 'app.url',
    group: 'general',
    type: 'string',
    label: 'Application URL',
    description: 'The public address of this installation.',
    default: 'http://localhost:3000',
    env: 'APP_URL',
    hint: 'Used for OAuth redirects and every link in an email. Facebook rejects a redirect that is not https outside localhost.',
  },
  {
    key: 'cron.secret',
    group: 'general',
    type: 'secret',
    label: 'Cron secret',
    description: 'Bearer token required by the /api/cron/tick endpoint.',
    default: '',
    env: 'CRON_SECRET',
    hint: 'Leave blank to disable the HTTP trigger entirely and run the worker as a process.',
  },

  // --- Facebook --------------------------------------------------------------
  {
    key: 'facebook.appId',
    group: 'facebook',
    type: 'string',
    label: 'App ID',
    description: 'The Meta app this installation authenticates against.',
    default: '',
    env: 'FACEBOOK_APP_ID',
  },
  {
    key: 'facebook.appSecret',
    group: 'facebook',
    type: 'secret',
    label: 'App secret',
    description: 'Signs every Graph call as `appsecret_proof`.',
    default: '',
    env: 'FACEBOOK_APP_SECRET',
    hint: 'Changing this invalidates nothing, but every call fails until it matches the app.',
  },
  {
    key: 'facebook.graphVersion',
    group: 'facebook',
    type: 'string',
    label: 'Graph API version',
    description: 'The pinned version every request is made against.',
    default: 'v21.0',
    env: 'FACEBOOK_GRAPH_VERSION',
    hint: 'Pin it deliberately. Meta ships breaking changes between versions and supports each for about two years.',
  },
  {
    key: 'facebook.graphBaseUrl',
    group: 'facebook',
    type: 'string',
    label: 'Graph API base URL',
    description: 'Where Graph requests are sent.',
    default: 'https://graph.facebook.com',
    env: 'FACEBOOK_GRAPH_BASE_URL',
    hint: 'Only change this to point at a stub or a recording proxy. Leave it alone in production.',
  },
  {
    key: 'facebook.scopes',
    group: 'facebook',
    type: 'list',
    label: 'Permissions requested',
    description: 'The scopes asked for during login.',
    default: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'pages_manage_engagement',
      'read_insights',
      'business_management',
    ],
    env: 'FACEBOOK_SCOPES',
    hint: 'The feature switches below add their own scopes on top of these. Asking for a permission the app has not been approved for fails the whole consent dialog, not just that permission.',
  },

  // --- Feature switches ------------------------------------------------------
  {
    key: 'features.groups',
    group: 'features',
    type: 'boolean',
    label: 'Group publishing',
    description: 'Adds publish_to_groups and groups_access_member_info, and shows Groups in the UI.',
    default: false,
    env: 'FACEBOOK_ENABLE_GROUPS',
    hint: 'Meta restricted the Groups API in April 2024: this needs separate approval and the app installed in each group.',
  },
  {
    key: 'features.messaging',
    group: 'features',
    type: 'boolean',
    label: 'Page inbox',
    description: 'Adds pages_messaging and pages_manage_metadata, and enables the Inbox tab.',
    default: false,
    env: 'FACEBOOK_ENABLE_MESSAGING',
  },
  {
    key: 'features.instagram',
    group: 'features',
    type: 'boolean',
    label: 'Instagram analytics',
    description: 'Adds instagram_basic and instagram_manage_insights, and schedules the Instagram job.',
    default: false,
    env: 'FACEBOOK_ENABLE_INSTAGRAM',
    workerRestart: true,
  },
  {
    key: 'features.ads',
    group: 'features',
    type: 'boolean',
    label: 'Ad spend',
    description: 'Adds ads_read and schedules the advertising job. Read-only; ads_management is never requested.',
    default: false,
    env: 'FACEBOOK_ENABLE_ADS',
    workerRestart: true,
  },

  // --- Scheduler -------------------------------------------------------------
  {
    key: 'scheduler.pollSeconds',
    group: 'scheduler',
    type: 'number',
    label: 'Publish check interval',
    description: 'How often the worker looks for posts that are due, in seconds.',
    default: 30,
    env: 'SCHEDULER_POLL_SECONDS',
    min: 5,
    max: 3600,
    workerRestart: true,
  },
  {
    key: 'scheduler.concurrency',
    group: 'scheduler',
    type: 'number',
    label: 'Publish concurrency',
    description: 'How many destinations are published to at once.',
    default: 4,
    env: 'SCHEDULER_CONCURRENCY',
    min: 1,
    max: 32,
    hint: 'Raising this spends the app rate limit faster. Facebook throttles per app and per page.',
  },
  {
    key: 'scheduler.maxAttempts',
    group: 'scheduler',
    type: 'number',
    label: 'Maximum attempts',
    description: 'How many times a failing destination is retried before it is given up on.',
    default: 5,
    env: 'SCHEDULER_MAX_ATTEMPTS',
    min: 1,
    max: 20,
  },
  {
    key: 'scheduler.staleLockMinutes',
    group: 'scheduler',
    type: 'number',
    label: 'Abandoned lock timeout',
    description:
      'How long a destination may stay mid-publish before another worker takes it back, in minutes.',
    default: 15,
    env: 'SCHEDULER_STALE_LOCK_MINUTES',
    min: 1,
    max: 720,
    hint: 'Set this above the slowest publish you expect. Large video uploads legitimately hold a destination for several minutes, and reclaiming one that is still uploading can post it twice.',
  },
  {
    key: 'scheduler.rssPollMinutes',
    group: 'scheduler',
    type: 'number',
    label: 'RSS poll interval',
    description: 'How often feeds are checked, in minutes.',
    default: 15,
    env: 'RSS_POLL_MINUTES',
    min: 1,
    max: 1440,
    workerRestart: true,
  },
  {
    key: 'scheduler.evergreenCheckMinutes',
    group: 'scheduler',
    type: 'number',
    label: 'Evergreen check interval',
    description: 'How often recycled posts are re-queued, in minutes.',
    default: 60,
    env: 'EVERGREEN_CHECK_MINUTES',
    min: 1,
    max: 1440,
    workerRestart: true,
  },
  {
    key: 'scheduler.tokenExpiryCheckHours',
    group: 'scheduler',
    type: 'number',
    label: 'Token expiry check',
    description: 'How often connected accounts are checked for tokens about to die, in hours.',
    default: 24,
    env: 'TOKEN_EXPIRY_CHECK_HOURS',
    min: 1,
    max: 168,
    workerRestart: true,
  },

  {
    key: 'scheduler.bulkRowLimit',
    group: 'scheduler',
    type: 'number',
    label: 'Bulk upload row limit',
    description: 'How many rows one CSV upload may schedule.',
    default: 500,
    env: 'BULK_ROW_LIMIT',
    min: 1,
    max: 5000,
    hint: 'Each row can scrape its link for a preview card, so a very large file makes one request that runs for minutes. Raise it only if the deployment has no request timeout.',
  },

  // --- Analytics -------------------------------------------------------------
  {
    key: 'analytics.refreshHours',
    group: 'analytics',
    type: 'number',
    label: 'Post analytics refresh',
    description: 'How often published posts have their numbers refreshed, in hours.',
    default: 6,
    env: 'ANALYTICS_REFRESH_HOURS',
    min: 1,
    max: 168,
    workerRestart: true,
  },
  {
    key: 'analytics.pageInsightsHours',
    group: 'analytics',
    type: 'number',
    label: 'Page insights capture',
    description: 'How often the full Page catalogue is captured, in hours.',
    default: 12,
    env: 'PAGE_INSIGHTS_HOURS',
    min: 1,
    max: 168,
    workerRestart: true,
  },
  {
    key: 'analytics.edgeSyncHours',
    group: 'analytics',
    type: 'number',
    label: 'Comments and reviews sync',
    description: 'How often comments, ratings, inbox threads, videos and outside posts are pulled, in hours.',
    default: 4,
    env: 'EDGE_SYNC_HOURS',
    min: 1,
    max: 168,
    workerRestart: true,
  },
  {
    key: 'analytics.instagramSyncHours',
    group: 'analytics',
    type: 'number',
    label: 'Instagram sync',
    description: 'How often Instagram accounts are refreshed, in hours.',
    default: 12,
    env: 'INSTAGRAM_SYNC_HOURS',
    min: 1,
    max: 168,
    workerRestart: true,
  },
  {
    key: 'analytics.adsSyncHours',
    group: 'analytics',
    type: 'number',
    label: 'Ad spend sync',
    description: 'How often ad accounts are refreshed, in hours.',
    default: 12,
    env: 'ADS_SYNC_HOURS',
    min: 1,
    max: 168,
    workerRestart: true,
  },
  {
    key: 'analytics.postBatch',
    group: 'analytics',
    type: 'number',
    label: 'Posts refreshed per pass',
    description: 'How many published destinations one analytics pass refreshes, stalest first.',
    default: 50,
    min: 1,
    max: 500,
    hint: 'These counters move slowly. Refreshing everything every pass spends the rate limit for no benefit.',
  },
  {
    key: 'analytics.commentPostLimit',
    group: 'analytics',
    type: 'number',
    label: 'Posts checked for comments',
    description: 'How many recent posts per Page have their comments refreshed each pass.',
    default: 25,
    min: 1,
    max: 200,
  },
  {
    key: 'analytics.videoLimit',
    group: 'analytics',
    type: 'number',
    label: 'Videos read per pass',
    description: 'How many videos per Page have the video catalogue read each pass.',
    default: 10,
    min: 1,
    max: 100,
  },
  {
    key: 'analytics.edgeWindowDays',
    group: 'analytics',
    type: 'number',
    label: 'Outside-post window',
    description: 'How far back posts published outside this app are looked for, in days.',
    default: 30,
    min: 1,
    max: 365,
  },
  {
    key: 'analytics.adWindowDays',
    group: 'analytics',
    type: 'number',
    label: 'Ad spend window',
    description: 'How much history one ad sync pulls, in days.',
    default: 90,
    min: 1,
    max: 365,
    hint: 'Facebook keeps 37 months, but daily rows at four levels add up quickly.',
  },
  {
    key: 'analytics.tokenWarningDays',
    group: 'analytics',
    type: 'number',
    label: 'Token expiry warning',
    description: 'How many days before a token dies the warning email is sent.',
    default: 7,
    min: 1,
    max: 60,
  },

  // --- AI --------------------------------------------------------------------
  {
    key: 'ai.apiKey',
    group: 'ai',
    type: 'secret',
    label: 'Anthropic API key',
    description: 'Enables caption generation. Blank turns the feature off.',
    default: '',
    env: 'ANTHROPIC_API_KEY',
  },
  {
    key: 'ai.model',
    group: 'ai',
    type: 'select',
    label: 'Model',
    description: 'Which Claude model writes captions.',
    default: 'claude-sonnet-5',
    env: 'AI_MODEL',
    options: [
      { value: 'claude-opus-5', label: 'Opus — highest quality, highest cost' },
      { value: 'claude-sonnet-5', label: 'Sonnet — balanced' },
      { value: 'claude-haiku-4-5-20251001', label: 'Haiku — fastest, cheapest' },
    ],
  },
  {
    key: 'ai.rateLimitPerHour',
    group: 'ai',
    type: 'number',
    label: 'Requests per hour',
    description: 'Per workspace, so one client cannot spend the whole budget.',
    default: 100,
    env: 'AI_RATE_LIMIT_PER_HOUR',
    min: 1,
    max: 10000,
  },

  // --- Email -----------------------------------------------------------------
  {
    key: 'email.apiKey',
    group: 'email',
    type: 'secret',
    label: 'Resend API key',
    description: 'Blank means email is logged but never sent.',
    default: '',
    env: 'RESEND_API_KEY',
  },
  {
    key: 'email.from',
    group: 'email',
    type: 'string',
    label: 'From address',
    description: 'The sender on every invitation and alert.',
    default: 'MS Social Pilot <onboarding@resend.dev>',
    env: 'EMAIL_FROM',
    hint: 'Resend will not send to arbitrary addresses until the sending domain is verified.',
  },

  // --- Links -----------------------------------------------------------------
  {
    key: 'links.shortenerDomain',
    group: 'links',
    type: 'string',
    label: 'Short link domain',
    description: 'Bare host for shortened links, e.g. go.example.com.',
    default: '',
    env: 'SHORTENER_DOMAIN',
    hint: 'Blank puts short links under the application URL. Point the DNS at this installation before setting it.',
  },

  // --- Retention -------------------------------------------------------------
  {
    key: 'retention.activityDays',
    group: 'retention',
    type: 'number',
    label: 'Activity log',
    description: 'Days the audit trail of publishes, syncs and setting changes is kept.',
    default: 180,
    min: 7,
    max: 3650,
  },
  {
    key: 'retention.emailDays',
    group: 'retention',
    type: 'number',
    label: 'Email log',
    description: 'Days the record of sent invitations and alerts is kept.',
    default: 180,
    min: 7,
    max: 3650,
  },
  {
    key: 'retention.clickDays',
    group: 'retention',
    type: 'number',
    label: 'Short link clicks',
    description: 'Days individual click records are kept.',
    default: 365,
    min: 7,
    max: 3650,
    hint: 'The total on each link is stored separately and is never pruned — this only affects the day-by-day breakdown.',
  },
  {
    key: 'retention.aiDays',
    group: 'retention',
    type: 'number',
    label: 'AI generations',
    description: 'Days caption requests and their token counts are kept.',
    default: 365,
    min: 7,
    max: 3650,
    hint: 'This is the spend audit trail. "Why was the bill that size" is a question asked months later.',
  },
  {
    key: 'retention.sweepHours',
    group: 'retention',
    type: 'number',
    label: 'Housekeeping interval',
    description: 'How often old records and unused uploads are swept, in hours.',
    default: 24,
    min: 1,
    max: 168,
    workerRestart: true,
  },

  // --- Media -----------------------------------------------------------------
  {
    key: 'media.dir',
    group: 'media',
    type: 'string',
    label: 'Media directory',
    description: 'Where uploads are written on disk.',
    default: './media',
    env: 'MEDIA_DIR',
    workerRestart: true,
  },
  {
    key: 'media.workspaceQuotaMb',
    group: 'media',
    type: 'number',
    label: 'Storage per client',
    description: 'Total megabytes of media one workspace may hold.',
    default: 2048,
    min: 1,
    max: 1_048_576,
    hint: 'Uploading is not a privileged action — contributors draft posts, so they upload too. This is what bounds the disk instead of a role check.',
  },
  {
    key: 'media.retainUnusedDays',
    group: 'media',
    type: 'number',
    label: 'Delete unused uploads after',
    description: 'Days an upload that was never attached to a post is kept.',
    default: 30,
    min: 1,
    max: 3650,
    hint: 'Files referenced by any post are kept for good, whatever its status. This only removes uploads nobody ever used.',
    workerRestart: true,
  },
  {
    key: 'media.maxUploadMb',
    group: 'media',
    type: 'number',
    label: 'Maximum upload size',
    description: 'Largest single file, in megabytes.',
    default: 25,
    env: 'MAX_UPLOAD_MB',
    min: 1,
    max: 1024,
  },
];

export const SETTINGS_BY_KEY = new Map(SETTING_DEFINITIONS.map((entry) => [entry.key, entry]));

export const GROUP_LABELS: Record<SettingGroup, string> = {
  general: 'General',
  facebook: 'Facebook connection',
  features: 'Feature switches',
  scheduler: 'Publishing',
  analytics: 'Analytics',
  ai: 'AI captions',
  email: 'Email',
  links: 'Link shortener',
  media: 'Media uploads',
  retention: 'Data retention',
};

/** The order groups appear on the config screen. */
export const GROUP_ORDER: SettingGroup[] = [
  'general',
  'facebook',
  'features',
  'scheduler',
  'analytics',
  'ai',
  'email',
  'links',
  'media',
  'retention',
];
