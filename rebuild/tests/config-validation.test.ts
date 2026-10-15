import { describe, expect, it } from 'vitest';
import { CONFIG_BY_KEY, CONFIG_REGISTRY, CONFIG_SCHEMA_VERSION, safeConfigShape } from '../src/lib/config/registry';

describe('configuration registry', () => {
  it('has unique keys and public metadata never contains secret values', () => {
    const keys = CONFIG_REGISTRY.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    const secret = CONFIG_REGISTRY.find((item) => item.kind === 'secret');
    expect(secret).toBeDefined();
    expect(Object.keys(safeConfigShape().find((item) => item.key === secret!.key)!)).not.toContain('value');
  });

  it('enforces each declared value schema at its boundary', () => {
    expect(CONFIG_BY_KEY.get('meta.graphVersion')!.schema.safeParse('v25.0').success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.graphVersion')!.schema.safeParse('25.0').success).toBe(false);
    expect(CONFIG_BY_KEY.get('meta.appSecret')!.schema.safeParse('x'.repeat(2048)).success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.appSecret')!.schema.safeParse('x'.repeat(2049)).success).toBe(false);
    expect(CONFIG_BY_KEY.get('jobs.enabled')!.schema.safeParse(true).success).toBe(true);
    expect(CONFIG_BY_KEY.get('jobs.enabled')!.schema.safeParse('true').success).toBe(false);
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('').success).toBe(true);
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('ops@example.test').success).toBe(true);
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('not-an-email').success).toBe(false);
  });

  it('covers the operational configuration areas with explicit consumption status', () => {
    expect(CONFIG_SCHEMA_VERSION).toBeGreaterThan(1);
    for (const prefix of ['meta.', 'youtube.', 'linkedin.', 'x.', 'sync.', 'api.', 'entitlements.', 'retention.', 'logging.', 'mcp.', 'theme.']) {
      expect(CONFIG_REGISTRY.some((item) => item.key.startsWith(prefix))).toBe(true);
    }
    expect(CONFIG_REGISTRY.every((item) => ['active', 'configured', 'planned'].includes(item.consumption))).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.analytics.schedule')!.schema.safeParse('15 * * * *').success).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.analytics.schedule')!.schema.safeParse('every hour').success).toBe(false);
    expect(CONFIG_BY_KEY.get('meta.graphBaseUrl')!.schema.safeParse('https://graph.facebook.com').success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.graphBaseUrl')!.schema.safeParse('http://graph.facebook.com').success).toBe(false);
    expect(CONFIG_BY_KEY.get('meta.oauthScopes')!.schema.safeParse(['pages_read_engagement']).success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.oauthScopes')!.schema.safeParse('pages_read_engagement').success).toBe(false);
    expect(CONFIG_BY_KEY.get('meta.oauthRedirectUri')!.schema.safeParse('https://social.example.test/api/oauth/meta/callback').success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.oauthRedirectUri')!.schema.safeParse('http://social.example.test/callback').success).toBe(false);
    expect(CONFIG_BY_KEY.get('meta.adsManageScopes')!.schema.safeParse(['ads_management']).success).toBe(true);
    expect(CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.schema.safeParse(['owner', 'admin']).success).toBe(true);
    expect(CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.schema.safeParse(['root']).success).toBe(false);
    expect(CONFIG_BY_KEY.get('theme.default')!.schema.safeParse('nightfall').success).toBe(true);
    expect(CONFIG_BY_KEY.get('theme.default')!.schema.safeParse('unknown').success).toBe(false);
    expect(CONFIG_BY_KEY.get('mcp.requestsPerMinute')!.schema.safeParse(0).success).toBe(false);
  });
});
