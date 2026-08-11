import {
  settingBoolean,
  settingList,
  settingNumber,
  settingString,
} from './settings';

/**
 * Runtime configuration, read at the point of use.
 *
 * Most of what follows now comes from the settings store rather than the
 * environment directly — the store falls back to the environment and then to a
 * registry default, so an existing `.env` keeps working while anything set on
 * the config screen wins over it. See `src/lib/settings`.
 *
 * What stays purely environmental is what cannot live in the database:
 * `DATABASE_URL` reads the table, `ENCRYPTION_KEY` protects the secrets inside
 * it, and `SESSION_SECRET` cannot be rotated from inside a session.
 *
 * Deliberately not validated eagerly at import time: `next build` imports
 * modules without a populated .env, and failing the build because a runtime
 * secret is absent is unhelpful. Instead each accessor throws a precise,
 * actionable error the first time something genuinely needs the value.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get appUrl(): string {
    // Trailing slashes break OAuth redirect matching, so normalise once here.
    return settingString('app.url').replace(/\/+$/, '');
  },
  get sessionSecret(): string {
    return required('SESSION_SECRET');
  },
  get encryptionKey(): string {
    return required('ENCRYPTION_KEY');
  },
  get facebookAppId(): string {
    return requiredSetting('facebook.appId', 'FACEBOOK_APP_ID');
  },
  get facebookAppSecret(): string {
    return requiredSetting('facebook.appSecret', 'FACEBOOK_APP_SECRET');
  },
  get graphVersion(): string {
    return settingString('facebook.graphVersion');
  },
  /**
   * Base URL for the Graph API. Overridable so tests (and staging setups that
   * front Graph with a recording proxy) can point at something other than the
   * live API. Leave at the default in production.
   */
  get graphBaseUrl(): string {
    return settingString('facebook.graphBaseUrl').replace(/\/+$/, '');
  },
  get facebookScopes(): string[] {
    const base = [...settingList('facebook.scopes')];

    if (env.groupsEnabled) {
      for (const scope of ['publish_to_groups', 'groups_access_member_info']) {
        if (!base.includes(scope)) base.push(scope);
      }
    }

    // Analytics-only extras. Each is opt-in because Meta reviews them
    // separately, and requesting one the app has not been approved for makes
    // the whole consent dialog fail rather than just that permission.
    if (env.messagingEnabled) {
      for (const scope of ['pages_messaging', 'pages_manage_metadata']) {
        if (!base.includes(scope)) base.push(scope);
      }
    }
    if (env.instagramEnabled) {
      for (const scope of ['instagram_basic', 'instagram_manage_insights']) {
        if (!base.includes(scope)) base.push(scope);
      }
    }
    if (env.adsEnabled && !base.includes('ads_read')) base.push('ads_read');

    return base;
  },
  /** Page inbox reads. Off by default: `pages_messaging` needs app review. */
  get messagingEnabled(): boolean {
    return settingBoolean('features.messaging');
  },
  /** Instagram Business analytics. */
  get instagramEnabled(): boolean {
    return settingBoolean('features.instagram');
  },
  /** Ads Insights reads. Read-only — the app never requests ads_management. */
  get adsEnabled(): boolean {
    return settingBoolean('features.ads');
  },
  get groupsEnabled(): boolean {
    return settingBoolean('features.groups');
  },
  get pollSeconds(): number {
    return settingNumber('scheduler.pollSeconds');
  },
  get concurrency(): number {
    return settingNumber('scheduler.concurrency');
  },
  get maxAttempts(): number {
    return settingNumber('scheduler.maxAttempts');
  },

  // --- Email (Resend) ---
  get resendApiKey(): string | null {
    return settingString('email.apiKey') || null;
  },
  get emailFrom(): string {
    return settingString('email.from');
  },

  // --- AI (Claude) ---
  get anthropicApiKey(): string | null {
    return settingString('ai.apiKey') || null;
  },
  get aiModel(): string {
    return settingString('ai.model');
  },
  get aiRateLimitPerHour(): number {
    return settingNumber('ai.rateLimitPerHour');
  },

  // --- Link shortener ---
  /** Bare host, e.g. "go.example.com". Blank means links live under APP_URL. */
  get shortenerDomain(): string | null {
    const value = settingString('links.shortenerDomain');
    return value ? value.replace(/^https?:\/\//, '').replace(/\/+$/, '') : null;
  },
  get shortLinkBase(): string {
    return env.shortenerDomain ? `https://${env.shortenerDomain}` : env.appUrl;
  },

  // --- Worker job intervals ---
  get rssPollMinutes(): number {
    return settingNumber('scheduler.rssPollMinutes');
  },
  get evergreenCheckMinutes(): number {
    return settingNumber('scheduler.evergreenCheckMinutes');
  },
  get tokenExpiryCheckHours(): number {
    return settingNumber('scheduler.tokenExpiryCheckHours');
  },
  get analyticsRefreshHours(): number {
    return settingNumber('analytics.refreshHours');
  },
  /** How often the full Page insights catalogue is captured. */
  get pageInsightsHours(): number {
    return settingNumber('analytics.pageInsightsHours');
  },
  /** Comments, reviews, inbox threads, videos and unscheduled posts. */
  get edgeSyncHours(): number {
    return settingNumber('analytics.edgeSyncHours');
  },
  get instagramSyncHours(): number {
    return settingNumber('analytics.instagramSyncHours');
  },
  get adsSyncHours(): number {
    return settingNumber('analytics.adsSyncHours');
  },

  // --- Analytics batch sizes ---
  get analyticsBatch(): number {
    return settingNumber('analytics.postBatch');
  },
  get commentPostLimit(): number {
    return settingNumber('analytics.commentPostLimit');
  },
  get videoLimit(): number {
    return settingNumber('analytics.videoLimit');
  },
  get edgeWindowDays(): number {
    return settingNumber('analytics.edgeWindowDays');
  },
  get adWindowDays(): number {
    return settingNumber('analytics.adWindowDays');
  },
  get tokenWarningDays(): number {
    return settingNumber('analytics.tokenWarningDays');
  },

  get cronSecret(): string | null {
    return settingString('cron.secret') || null;
  },
  get mediaDir(): string {
    return settingString('media.dir');
  },
  get maxUploadBytes(): number {
    return settingNumber('media.maxUploadMb') * 1024 * 1024;
  },
  get mediaRetainUnusedDays(): number {
    return settingNumber('media.retainUnusedDays');
  },
  get mediaCleanupHours(): number {
    return settingNumber('media.cleanupHours');
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
};

/**
 * A setting with no usable value anywhere.
 *
 * Named after the environment variable as well as the setting, because someone
 * hitting this has either an empty config screen or an empty `.env` and the
 * message has to point at both.
 */
function requiredSetting(key: string, envName: string): string {
  const value = settingString(key);
  if (!value) {
    throw new Error(
      `Missing ${key}. Set it on the configuration screen, or set ${envName} in the environment.`,
    );
  }
  return value;
}

/** Facebook only accepts https redirect URIs outside of localhost. */
export function assertOAuthReady(): void {
  const url = new URL(env.appUrl);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!isLocal && url.protocol !== 'https:') {
    throw new Error(
      `APP_URL must use https outside of localhost (got ${env.appUrl}); Facebook rejects insecure redirect URIs.`,
    );
  }
}
