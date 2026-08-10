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
    return base;
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
