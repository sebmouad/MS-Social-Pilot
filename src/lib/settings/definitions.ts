import { Locale } from '@prisma/client';

import { PRICE_OVERRIDE_PATTERN, PRICES_CHECKED } from '../ai-prices';
import { languageName } from '../languages';

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
  | 'operator'
  | 'facebook'
  | 'networks'
  | 'features'
  | 'scheduler'
  | 'analytics'
  | 'ai'
  | 'email'
  | 'alerts'
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
  /**
   * Strings, secrets and each entry of a list: the shape a value must have, and what to say when
   * it does not. An empty value is not checked, since clearing is allowed.
   */
  pattern?: { regex: RegExp; message: string };
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
    key: 'auth.openRegistration',
    group: 'general',
    type: 'boolean',
    label: 'Anyone may create an account',
    description: 'When off, only people holding an invitation can register.',
    default: false,
    env: 'OPEN_REGISTRATION',
    hint: 'This app has to be reachable from the internet for Facebook to call back, so an open sign-up form is open to everyone who finds it. The very first account is always allowed, so a fresh installation can be set up.',
  },
  {
    key: 'auth.loginAttempts',
    group: 'general',
    type: 'number',
    label: 'Sign-in attempts allowed',
    description: 'Failed sign-ins permitted for one address, or from one address, per window.',
    default: 10,
    env: 'LOGIN_ATTEMPTS',
    min: 1,
    max: 1000,
    hint: 'Checking a password is deliberately slow, so an unlimited sign-in form is both a way to guess passwords and a cheap way to load the server.',
  },
  {
    key: 'auth.loginWindowMinutes',
    group: 'general',
    type: 'number',
    label: 'Sign-in attempt window',
    description: 'How long failed sign-ins are counted for, in minutes.',
    default: 15,
    env: 'LOGIN_WINDOW_MINUTES',
    min: 1,
    max: 1440,
  },
  {
    key: 'limits.workspaceRequestsPerMinute',
    group: 'general',
    type: 'number',
    label: 'Requests per workspace per minute',
    description: 'Signed-in API calls one workspace may make in a minute, all its members together. 0 means no limit.',
    default: 600,
    min: 0,
    max: 100000,
    hint: 'A brake so one customer cannot slow the server for everyone. Ordinary use stays far below the default; work done by the background worker is not counted.',
  },
  {
    key: 'i18n.defaultLocale',
    group: 'general',
    type: 'select',
    label: 'Default language',
    description: 'The language used before anyone signs in, when the browser asks for neither.',
    default: 'en',
    env: 'DEFAULT_LOCALE',
    options: Object.values(Locale).map((value) => ({ value, label: languageName(value) })),
    hint: 'A signed-in person always sees their own language, and their browser’s preference wins over this. It decides the login and registration screens for a first-time visitor.',
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

  // --- Operator (NEXT_PHASES S2) -------------------------------------------------
  // Who runs this installation, as the Terms, Privacy and Data deletion pages
  // say it. Nothing here is hard-coded in the pages: each operator enters their
  // own, and has the legal wording reviewed for their country.
  {
    key: 'operator.productName',
    group: 'operator',
    type: 'string',
    label: 'Product name',
    description: 'What the legal pages call the service.',
    default: 'MS Social Pilot',
  },
  {
    key: 'operator.name',
    group: 'operator',
    type: 'string',
    label: 'Operator',
    description: 'The company or person that runs this installation and is responsible for the data.',
    default: '',
    hint: 'Shown on the Terms and Privacy pages, which Meta reads during App Review. Until it is set they say "the operator of this installation".',
  },
  {
    key: 'operator.country',
    group: 'operator',
    type: 'string',
    label: 'Operator country',
    description: 'Where the operator is established.',
    default: '',
  },
  {
    key: 'operator.address',
    group: 'operator',
    type: 'string',
    label: 'Operator address',
    description: 'Postal address shown in the privacy policy.',
    default: '',
  },
  {
    key: 'operator.email',
    group: 'operator',
    type: 'string',
    label: 'Contact email',
    description: 'Where users write about their data and these terms.',
    default: '',
    pattern: { regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter an email address.' },
  },
  {
    key: 'operator.governingLaw',
    group: 'operator',
    type: 'string',
    label: 'Governing law',
    description: 'The law the Terms are governed by, as a phrase: "the law of Country A".',
    default: '',
  },
  {
    key: 'operator.dataProtection',
    group: 'operator',
    type: 'string',
    label: 'Data-protection law and authority',
    description: 'The data-protection rules that apply, as a phrase: "the GDPR; the authority is …".',
    default: '',
  },
  {
    key: 'operator.hosting',
    group: 'operator',
    type: 'string',
    label: 'Hosting providers',
    description: 'Who hosts the data on the operator\'s behalf, and where: "Provider A (servers in Country B)".',
    default: '',
  },
  {
    key: 'operator.legalUpdated',
    group: 'operator',
    type: 'string',
    label: 'Legal pages last updated',
    description: 'The date the legal wording last changed, as it should read on the pages.',
    default: '',
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
    // A browser that mistakes the setup form for a sign-in form fills in an
    // email address here, and the password beside it as the secret.
    pattern: {
      regex: /^\d{5,20}$/,
      message: 'The App ID is the number at the top of your Meta app dashboard, not an email address.',
    },
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
    pattern: {
      regex: /^[0-9a-f]{32}$/i,
      message:
        'An app secret is 32 letters and digits, from App settings → Basic in the Meta dashboard. Check that a saved password was not filled in instead.',
    },
  },
  {
    key: 'facebook.graphVersion',
    group: 'facebook',
    type: 'string',
    label: 'Graph API version',
    description: 'The pinned version every request is made against.',
    // v26.0 is the latest version. Nothing this app calls changed incompatibly
    // since v21.0 except Page ratings, retired from v22.0; those are read on
    // v21.0 explicitly until it expires (see pageRatingsAvailable).
    default: 'v26.0',
    env: 'FACEBOOK_GRAPH_VERSION',
    hint: 'Pin it deliberately. Meta ships breaking changes between versions and supports each for about two years. Metric retirements apply to every version at once, whichever is pinned.',
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
    key: 'facebook.requestTimeoutSeconds',
    group: 'facebook',
    type: 'number',
    label: 'Graph request timeout',
    description: 'How long an ordinary Graph call may take before it is abandoned, in seconds.',
    default: 60,
    env: 'GRAPH_TIMEOUT_SECONDS',
    min: 5,
    max: 600,
  },
  {
    key: 'facebook.uploadTimeoutSeconds',
    group: 'facebook',
    type: 'number',
    label: 'Media upload timeout',
    description: 'How long sending one photo or video to Facebook may take, in seconds.',
    default: 300,
    env: 'GRAPH_UPLOAD_TIMEOUT_SECONDS',
    min: 30,
    max: 3600,
    hint: 'Sending a file is not a request that answers in a moment. A minute is enough for a photo and not for a video, and a timeout that is too short looks like a network failure and retries for ever.',
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
      // Visitors' comments on the Page's posts: Meta requires it alongside
      // pages_manage_engagement, which moderates them.
      'pages_read_user_content',
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
    description: 'Shows Groups in the UI. Meta removed the Groups API on 22 April 2024, so no Group can be published to; leave this off.',
    default: false,
    env: 'FACEBOOK_ENABLE_GROUPS',
    hint: 'publish_to_groups no longer exists on any API version and is never requested, whatever this says: asking for it would fail every login.',
  },
  {
    key: 'features.messaging',
    group: 'features',
    type: 'boolean',
    label: 'Page inbox',
    description:
      'Adds pages_messaging and pages_manage_metadata, and enables the Inbox tab, where threads can be read and answered.',
    default: false,
    env: 'FACEBOOK_ENABLE_MESSAGING',
  },
  {
    key: 'features.instagram',
    group: 'features',
    type: 'boolean',
    label: 'Instagram',
    description:
      'Adds the Instagram scopes, schedules the Instagram job, and offers linked accounts as publishing destinations.',
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
    key: 'scheduler.nativeReconcileMinutes',
    group: 'scheduler',
    type: 'number',
    label: 'Native schedule check',
    description:
      'How often Facebook is asked whether the posts it is holding have gone out yet, in minutes. Only affects posts scheduled inside Facebook.',
    default: 15,
    env: 'NATIVE_RECONCILE_MINUTES',
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


  // --- Other networks ---------------------------------------------------------
  {
    key: 'networks.telegram',
    group: 'networks',
    type: 'boolean',
    label: 'Telegram switched on',
    description: 'Off hides Telegram from Connections and stops new Telegram channels from being connected. Channels already connected keep their posts.',
    default: true,
  },
  {
    key: 'networks.bluesky',
    group: 'networks',
    type: 'boolean',
    label: 'Bluesky switched on',
    description: 'Off hides Bluesky from Connections and stops new Bluesky accounts from being connected. Accounts already connected keep their posts.',
    default: true,
  },
  {
    key: 'networks.mastodon',
    group: 'networks',
    type: 'boolean',
    label: 'Mastodon switched on',
    description: 'Off hides Mastodon from Connections and stops new Mastodon accounts from being connected. Accounts already connected keep their posts.',
    default: true,
  },
  {
    key: 'networks.linkedin',
    group: 'networks',
    type: 'boolean',
    label: 'LinkedIn switched on',
    description: 'Off hides LinkedIn from Connections and stops new LinkedIn accounts from being connected. Accounts already connected keep their posts.',
    default: true,
  },
  {
    key: 'networks.threads',
    group: 'networks',
    type: 'boolean',
    label: 'Threads switched on',
    description: 'Off hides Threads from Connections and stops new Threads accounts from being connected. Accounts already connected keep their posts.',
    default: true,
  },
  {
    key: 'networks.x',
    group: 'networks',
    type: 'boolean',
    label: 'X switched on',
    description: 'Off hides X from Connections and stops new X accounts from being connected. Accounts already connected keep their posts.',
    default: true,
  },
  {
    key: 'networks.pinterest',
    group: 'networks',
    type: 'boolean',
    label: 'Pinterest switched on',
    description: 'Off hides Pinterest from Connections and stops new Pinterest accounts from being connected. Accounts already connected keep their posts.',
    default: true,
  },
  // Bluesky and Mastodon need nothing here: Bluesky signs in with an app
  // password, and each Mastodon server registers the app on the fly.
  {
    key: 'linkedin.clientId',
    group: 'networks',
    type: 'string',
    label: 'LinkedIn Client ID',
    description: 'From a LinkedIn developer app with "Share on LinkedIn" (and, for company Pages, the Community Management API). Blank hides LinkedIn from Connections.',
    default: '',
    env: 'LINKEDIN_CLIENT_ID',
  },
  {
    key: 'linkedin.clientSecret',
    group: 'networks',
    type: 'secret',
    label: 'LinkedIn Client secret',
    description: 'Kept encrypted. Shown once when saved.',
    default: '',
    env: 'LINKEDIN_CLIENT_SECRET',
  },
  {
    key: 'threads.clientId',
    group: 'networks',
    type: 'string',
    label: 'Threads App ID',
    description: 'The Threads use case of a Meta app (it can be the same app as Facebook). Blank hides Threads from Connections.',
    default: '',
    env: 'THREADS_CLIENT_ID',
  },
  {
    key: 'threads.clientSecret',
    group: 'networks',
    type: 'secret',
    label: 'Threads App secret',
    description: 'Kept encrypted. Shown once when saved.',
    default: '',
    env: 'THREADS_CLIENT_SECRET',
  },
  {
    key: 'x.clientId',
    group: 'networks',
    type: 'string',
    label: 'X (Twitter) Client ID',
    description: 'OAuth 2.0 credentials of an X developer app with read and write permission. Blank hides X (Twitter) from Connections.',
    default: '',
    env: 'X_CLIENT_ID',
  },
  {
    key: 'x.clientSecret',
    group: 'networks',
    type: 'secret',
    label: 'X (Twitter) Client secret',
    description: 'Kept encrypted. Shown once when saved.',
    default: '',
    env: 'X_CLIENT_SECRET',
  },
  {
    key: 'pinterest.clientId',
    group: 'networks',
    type: 'string',
    label: 'Pinterest App ID',
    description: 'A Pinterest developer app with boards:read and pins:write. Blank hides Pinterest from Connections.',
    default: '',
    env: 'PINTEREST_CLIENT_ID',
  },
  {
    key: 'pinterest.clientSecret',
    group: 'networks',
    type: 'secret',
    label: 'Pinterest App secret',
    description: 'Kept encrypted. Shown once when saved.',
    default: '',
    env: 'PINTEREST_CLIENT_SECRET',
  },
  // --- Security --------------------------------------------------------------
  {
    key: 'security.twoStep',
    group: 'general',
    type: 'select',
    label: 'Two-step sign-in required for',
    description: 'Admins = root and the owners and admins of workspaces with a connected profile. Everyone else may still turn it on for themselves.',
    default: 'admins',
    env: 'SECURITY_TWO_STEP',
    options: [
      { value: 'admins', label: 'Root and admins (recommended)' },
      { value: 'everyone', label: 'Everyone' },
      { value: 'off', label: 'Nobody (optional for all)' },
    ],
    hint: 'Applies from each person’s next sign-in. Someone required to use it sets it up right after their password.',
  },
  // --- AI --------------------------------------------------------------------
  {
    key: 'ai.provider',
    group: 'ai',
    type: 'select',
    label: 'AI provider',
    description: 'Automatic uses the first provider below that has a key: Anthropic, then OpenAI, then Gemini.',
    default: 'auto',
    env: 'AI_PROVIDER',
    options: [
      { value: 'auto', label: 'Automatic' },
      { value: 'anthropic', label: 'Anthropic (Claude)' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'gemini', label: 'Google Gemini' },
    ],
  },
  {
    key: 'ai.apiKey',
    group: 'ai',
    type: 'secret',
    label: 'Anthropic API key',
    description: 'Kept encrypted. From console.anthropic.com.',
    default: '',
    env: 'ANTHROPIC_API_KEY',
  },
  {
    key: 'ai.openaiKey',
    group: 'ai',
    type: 'secret',
    label: 'OpenAI API key',
    description: 'Kept encrypted. From platform.openai.com.',
    default: '',
    env: 'OPENAI_API_KEY',
  },
  {
    key: 'ai.geminiKey',
    group: 'ai',
    type: 'secret',
    label: 'Google Gemini API key',
    description: 'Kept encrypted. From aistudio.google.com.',
    default: '',
    env: 'GEMINI_API_KEY',
  },
  {
    key: 'ai.model',
    group: 'ai',
    type: 'string',
    label: 'Model',
    // No list in the code: the choices are fetched from the provider with the
    // key above (src/lib/ai-models.ts). Blank means the newest model listed.
    description: 'Which model writes. Blank uses the first model the provider lists (the newest, where it says so).',
    default: '',
    env: 'AI_MODEL',
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
  {
    key: 'ai.monthlyBudgetUsd',
    group: 'ai',
    type: 'number',
    label: 'Monthly budget (USD)',
    description: 'AI help stops for every workspace once this calendar month\'s spend reaches it. 0 means no budget.',
    default: 0,
    env: 'AI_MONTHLY_BUDGET_USD',
    min: 0,
    max: 1000000,
    hint: 'Spend is worked out from each model\'s price. Generations with a model whose price is unknown are not counted: add their price below.',
  },
  {
    key: 'ai.priceOverrides',
    group: 'ai',
    type: 'list',
    label: 'Model prices',
    description: `Add or correct a model's price in US dollars per million tokens, as model=input/output (e.g. my-model=2/10). Wins over the built-in prices, checked ${PRICES_CHECKED}.`,
    default: [],
    env: 'AI_PRICE_OVERRIDES',
    pattern: { regex: PRICE_OVERRIDE_PATTERN, message: 'Write each price as model=input/output, e.g. my-model=2/10.' },
  },

  // --- Alerts ----------------------------------------------------------------
  {
    key: 'alerts.email',
    group: 'alerts',
    type: 'string',
    label: 'Alert email address',
    description: 'Who is told when the worker stops, publishing fails, a profile disconnects, the disk fills, a backup fails or Meta’s call limit is near. Blank sends to root’s own address.',
    default: '',
    env: 'ALERTS_EMAIL',
  },
  {
    key: 'alerts.telegramBotToken',
    group: 'alerts',
    type: 'secret',
    label: 'Telegram bot token',
    description: 'Optional, with the chat id below: the same alerts in a Telegram chat. Kept encrypted.',
    default: '',
    env: 'ALERTS_TELEGRAM_BOT_TOKEN',
  },
  {
    key: 'alerts.telegramChatId',
    group: 'alerts',
    type: 'string',
    label: 'Telegram chat id',
    description: 'The chat the bot writes to (a number; negative for a group).',
    default: '',
    env: 'ALERTS_TELEGRAM_CHAT_ID',
  },
  {
    key: 'alerts.publishFailures',
    group: 'alerts',
    type: 'number',
    label: 'Failed publications per hour',
    description: 'Alert when at least this many publications fail within an hour, across every workspace.',
    default: 5,
    env: 'ALERTS_PUBLISH_FAILURES',
    min: 1,
    max: 1000,
  },
  {
    key: 'alerts.diskPercent',
    group: 'alerts',
    type: 'number',
    label: 'Disk use (%)',
    description: 'Alert when the server’s disk is fuller than this.',
    default: 85,
    env: 'ALERTS_DISK_PERCENT',
    min: 50,
    max: 99,
  },
  // --- Email -----------------------------------------------------------------
  {
    key: 'email.provider',
    group: 'email',
    type: 'select',
    label: 'Send email with',
    description: 'Automatic uses SMTP (e.g. Gmail) when an SMTP password is set, otherwise Resend.',
    default: 'auto',
    env: 'EMAIL_PROVIDER',
    options: [
      { value: 'auto', label: 'Automatic' },
      { value: 'smtp', label: 'SMTP (Gmail, Outlook, any mail server)' },
      { value: 'resend', label: 'Resend' },
    ],
  },
  {
    key: 'email.smtpHost',
    group: 'email',
    type: 'string',
    label: 'SMTP server',
    description: 'Gmail: smtp.gmail.com.',
    default: 'smtp.gmail.com',
    env: 'SMTP_HOST',
  },
  {
    key: 'email.smtpPort',
    group: 'email',
    type: 'number',
    label: 'SMTP port',
    description: '465 uses SSL (Gmail). 587 uses STARTTLS.',
    default: 465,
    env: 'SMTP_PORT',
    min: 1,
    max: 65535,
  },
  {
    key: 'email.smtpUser',
    group: 'email',
    type: 'string',
    label: 'SMTP user',
    description: 'For Gmail, your full Gmail address.',
    default: '',
    env: 'SMTP_USER',
  },
  {
    key: 'email.smtpPassword',
    group: 'email',
    type: 'secret',
    label: 'SMTP password',
    description: 'Kept encrypted. For Gmail, an app password (Google account → Security → App passwords; needs 2-Step Verification), not your Google password.',
    default: '',
    env: 'SMTP_PASSWORD',
  },
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
    hint: 'With Gmail, use your Gmail address (or a "Send mail as" alias): Gmail replaces any other sender. Resend sends only from a verified domain.',
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
  operator: 'Operator and legal pages',
  facebook: 'Facebook connection',
  networks: 'Other social networks',
  features: 'Feature switches',
  scheduler: 'Publishing',
  analytics: 'Analytics',
  ai: 'AI captions',
  email: 'Email',
  alerts: 'Alerts when something breaks',
  links: 'Link shortener',
  media: 'Media uploads',
  retention: 'Data retention',
};

/** The order groups appear on the config screen. */
export const GROUP_ORDER: SettingGroup[] = [
  'general',
  'operator',
  'facebook',
  'networks',
  'features',
  'scheduler',
  'analytics',
  'ai',
  'email',
  'alerts',
  'links',
  'media',
  'retention',
];
