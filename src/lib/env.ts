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
 * actionable error the first time something genuinely needs the value — and
 * `validateEnv` below runs the same checks once at server start, from
 * `src/instrumentation.ts`, so a production server with a bad secret refuses
 * to boot instead of failing the first visitor.
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

/** Permissions Meta has removed outright; asking for one fails the login. */
const RETIRED_SCOPES = new Set(['publish_to_groups', 'groups_access_member_info']);

/**
 * The shortest session secret accepted in production.
 *
 * It signs every session cookie, so it has to be long enough that a signature
 * cannot be brute-forced. Development and the test suites keep short
 * throwaway values, which is why this is enforced only in production.
 */
export const MIN_SESSION_SECRET_LENGTH = 32;

function sessionSecret(): string {
  const value = required('SESSION_SECRET');
  if (process.env.NODE_ENV === 'production' && value.trim().length < MIN_SESSION_SECRET_LENGTH) {
    // Length only, never the value: this message ends up in container logs.
    throw new Error(
      `SESSION_SECRET is ${value.trim().length} characters; production needs at least ` +
        `${MIN_SESSION_SECRET_LENGTH}. Generate one with: openssl rand -base64 32`,
    );
  }
  return value;
}

/**
 * Check the environment-only values once, at startup.
 *
 * Only the three that cannot come from the settings store: everything else has
 * a default or is set on the configuration screen, so its absence is not a
 * reason to refuse to start. Throws on the first problem, with a message that
 * names the variable and how to fix it.
 */
export function validateEnv(): void {
  required('DATABASE_URL');
  sessionSecret();
  required('ENCRYPTION_KEY');
}

export const env = {
  get appUrl(): string {
    // Trailing slashes break OAuth redirect matching, so normalise once here.
    return settingString('app.url').replace(/\/+$/, '');
  },
  get sessionSecret(): string {
    return sessionSecret();
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
  /** How long an ordinary Graph call may take. */
  get graphTimeoutMs(): number {
    return settingNumber('facebook.requestTimeoutSeconds') * 1000;
  },
  /** How long sending one file to Facebook may take. */
  get graphUploadTimeoutMs(): number {
    return settingNumber('facebook.uploadTimeoutSeconds') * 1000;
  },
  get facebookScopes(): string[] {
    // Never the Groups scopes, whatever the Groups switch says. Meta removed
    // `publish_to_groups` and `groups_access_member_info` from every API version
    // on 22 April 2024, and a scope that does not exist fails the whole consent
    // dialog: turning the switch on used to stop anybody connecting at all. A
    // stray one in a hand-written scope list is dropped for the same reason.
    const base = settingList('facebook.scopes').filter((scope) => !RETIRED_SCOPES.has(scope));

    // Analytics-only extras. Each is opt-in because Meta reviews them
    // separately, and requesting one the app has not been approved for makes
    // the whole consent dialog fail rather than just that permission.
    if (env.messagingEnabled) {
      for (const scope of ['pages_messaging', 'pages_manage_metadata']) {
        if (!base.includes(scope)) base.push(scope);
      }
    }
    if (env.instagramEnabled) {
      // `instagram_content_publish` is asked for alongside the read scopes:
      // Facebook grants what it has been approved for and silently omits the
      // rest, so asking costs nothing and not asking means a workspace whose
      // review came through still cannot publish until it reconnects.
      for (const scope of [
        'instagram_basic',
        'instagram_manage_insights',
        'instagram_content_publish',
      ]) {
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
  /** How long a destination may sit mid-publish before it is taken back. */
  get staleLockMinutes(): number {
    return settingNumber('scheduler.staleLockMinutes');
  },
  /** How many rows one CSV upload may schedule. */
  get bulkRowLimit(): number {
    return settingNumber('scheduler.bulkRowLimit');
  },

  // --- Email (SMTP or Resend) ---
  // --- Other networks ---
  get linkedinClientId(): string {
    return settingString('linkedin.clientId');
  },
  get linkedinClientSecret(): string {
    return settingString('linkedin.clientSecret');
  },
  get threadsClientId(): string {
    return settingString('threads.clientId');
  },
  get threadsClientSecret(): string {
    return settingString('threads.clientSecret');
  },
  get xClientId(): string {
    return settingString('x.clientId');
  },
  get xClientSecret(): string {
    return settingString('x.clientSecret');
  },
  get youtubeClientId(): string {
    return settingString('youtube.clientId');
  },
  get youtubeClientSecret(): string {
    return settingString('youtube.clientSecret');
  },
  get pinterestClientId(): string {
    return settingString('pinterest.clientId');
  },
  get pinterestClientSecret(): string {
    return settingString('pinterest.clientSecret');
  },
  get resendApiKey(): string | null {
    return settingString('email.apiKey') || null;
  },
  get emailFrom(): string {
    return settingString('email.from');
  },
  get emailProvider(): string {
    return settingString('email.provider');
  },
  get smtpHost(): string {
    return settingString('email.smtpHost');
  },
  get smtpPort(): number {
    return settingNumber('email.smtpPort');
  },
  get smtpUser(): string {
    return settingString('email.smtpUser');
  },
  get smtpPassword(): string | null {
    return settingString('email.smtpPassword') || null;
  },

  // --- AI (Claude) ---
  get anthropicApiKey(): string | null {
    return settingString('ai.apiKey') || null;
  },
  get aiModel(): string {
    return settingString('ai.model');
  },
  get aiProvider(): string {
    return settingString('ai.provider');
  },
  get openaiApiKey(): string | null {
    return settingString('ai.openaiKey') || null;
  },
  get geminiApiKey(): string | null {
    return settingString('ai.geminiKey') || null;
  },
  get aiRateLimitPerHour(): number {
    return settingNumber('ai.rateLimitPerHour');
  },
  get alertsEmail(): string {
    return settingString('alerts.email');
  },
  get alertsTelegramBotToken(): string | null {
    return settingString('alerts.telegramBotToken') || null;
  },
  get alertsTelegramChatId(): string {
    return settingString('alerts.telegramChatId');
  },
  get alertsPublishFailures(): number {
    return settingNumber('alerts.publishFailures');
  },
  get alertsDiskPercent(): number {
    return settingNumber('alerts.diskPercent');
  },
  /** Who must use two-step sign-in: admins (default), everyone, or off. */
  get twoStepPolicy(): string {
    return settingString('security.twoStep');
  },
  get aiMonthlyBudgetUsd(): number {
    return settingNumber('ai.monthlyBudgetUsd');
  },
  get aiPriceOverrides(): string[] {
    return settingList('ai.priceOverrides');
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
  get nativeReconcileMinutes(): number {
    return settingNumber('scheduler.nativeReconcileMinutes');
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

  /** Failed sign-ins allowed per address, and per client, in one window. */
  get workspaceRequestsPerMinute(): number {
    return settingNumber('limits.workspaceRequestsPerMinute');
  },
  get loginAttempts(): number {
    return settingNumber('auth.loginAttempts');
  },
  get loginWindowMs(): number {
    return settingNumber('auth.loginWindowMinutes') * 60 * 1000;
  },
  /** Whether a stranger may create an account. Invitations always may. */
  get openRegistration(): boolean {
    return settingBoolean('auth.openRegistration');
  },
  /** Language for a visitor who has not signed in and whose browser is silent. */
  get defaultLocale(): string {
    return settingString('i18n.defaultLocale');
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
  get mediaQuotaBytes(): number {
    return settingNumber('media.workspaceQuotaMb') * 1024 * 1024;
  },
  get mediaRetainUnusedDays(): number {
    return settingNumber('media.retainUnusedDays');
  },
  get housekeepingHours(): number {
    return settingNumber('retention.sweepHours');
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
