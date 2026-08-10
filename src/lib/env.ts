/**
 * Environment access with validation at the point of use.
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

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}".`);
  }
  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export const env = {
  get appUrl(): string {
    // Trailing slashes break OAuth redirect matching, so normalise once here.
    return optional('APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
  },
  get sessionSecret(): string {
    return required('SESSION_SECRET');
  },
  get encryptionKey(): string {
    return required('ENCRYPTION_KEY');
  },
  get facebookAppId(): string {
    return required('FACEBOOK_APP_ID');
  },
  get facebookAppSecret(): string {
    return required('FACEBOOK_APP_SECRET');
  },
  get graphVersion(): string {
    return optional('FACEBOOK_GRAPH_VERSION', 'v21.0');
  },
  /**
   * Base URL for the Graph API. Overridable so tests (and staging setups that
   * front Graph with a recording proxy) can point at something other than the
   * live API. Leave unset in production.
   */
  get graphBaseUrl(): string {
    return optional('FACEBOOK_GRAPH_BASE_URL', 'https://graph.facebook.com').replace(/\/+$/, '');
  },
  get facebookScopes(): string[] {
    const base = optional(
      'FACEBOOK_SCOPES',
      'pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement,read_insights,business_management',
    )
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);

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
    return boolean('FACEBOOK_ENABLE_MESSAGING', false);
  },
  /** Instagram Business analytics. */
  get instagramEnabled(): boolean {
    return boolean('FACEBOOK_ENABLE_INSTAGRAM', false);
  },
  /** Ads Insights reads. Read-only — the app never requests ads_management. */
  get adsEnabled(): boolean {
    return boolean('FACEBOOK_ENABLE_ADS', false);
  },
  get groupsEnabled(): boolean {
    return boolean('FACEBOOK_ENABLE_GROUPS', false);
  },
  get pollSeconds(): number {
    return Math.max(5, integer('SCHEDULER_POLL_SECONDS', 30));
  },
  get concurrency(): number {
    return Math.max(1, integer('SCHEDULER_CONCURRENCY', 4));
  },
  get maxAttempts(): number {
    return Math.max(1, integer('SCHEDULER_MAX_ATTEMPTS', 5));
  },
  // --- Email (Resend) ---
  get resendApiKey(): string | null {
    return process.env.RESEND_API_KEY || null;
  },
  get emailFrom(): string {
    return optional('EMAIL_FROM', 'MS Social Pilot <onboarding@resend.dev>');
  },

  // --- AI (Claude) ---
  get anthropicApiKey(): string | null {
    return process.env.ANTHROPIC_API_KEY || null;
  },
  get aiModel(): string {
    return optional('AI_MODEL', 'claude-sonnet-5');
  },
  get aiRateLimitPerHour(): number {
    return Math.max(1, integer('AI_RATE_LIMIT_PER_HOUR', 100));
  },

  // --- Link shortener ---
  /** Bare host, e.g. "go.example.com". Blank means links live under APP_URL. */
  get shortenerDomain(): string | null {
    const value = process.env.SHORTENER_DOMAIN;
    return value ? value.replace(/^https?:\/\//, '').replace(/\/+$/, '') : null;
  },
  get shortLinkBase(): string {
    return env.shortenerDomain ? `https://${env.shortenerDomain}` : env.appUrl;
  },

  // --- Worker job intervals ---
  get rssPollMinutes(): number {
    return Math.max(1, integer('RSS_POLL_MINUTES', 15));
  },
  get evergreenCheckMinutes(): number {
    return Math.max(1, integer('EVERGREEN_CHECK_MINUTES', 60));
  },
  get tokenExpiryCheckHours(): number {
    return Math.max(1, integer('TOKEN_EXPIRY_CHECK_HOURS', 24));
  },
  get analyticsRefreshHours(): number {
    return Math.max(1, integer('ANALYTICS_REFRESH_HOURS', 6));
  },
  /** How often the full Page insights catalogue is captured. */
  get pageInsightsHours(): number {
    return Math.max(1, integer('PAGE_INSIGHTS_HOURS', 12));
  },
  /** Comments, reviews, inbox threads, videos and unscheduled posts. */
  get edgeSyncHours(): number {
    return Math.max(1, integer('EDGE_SYNC_HOURS', 4));
  },
  get instagramSyncHours(): number {
    return Math.max(1, integer('INSTAGRAM_SYNC_HOURS', 12));
  },
  get adsSyncHours(): number {
    return Math.max(1, integer('ADS_SYNC_HOURS', 12));
  },

  get cronSecret(): string | null {
    const value = process.env.CRON_SECRET;
    return value ? value : null;
  },
  get mediaDir(): string {
    return optional('MEDIA_DIR', './media');
  },
  get maxUploadBytes(): number {
    return integer('MAX_UPLOAD_MB', 25) * 1024 * 1024;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
};

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
