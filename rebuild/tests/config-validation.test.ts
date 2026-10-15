import { describe, expect, it } from 'vitest';
import { CONFIG_BY_KEY, CONFIG_REGISTRY, CONFIG_SCHEMA_VERSION, safeConfigShape } from '../src/lib/config/registry';
import { configAuditDetail } from '../src/server/config/store';

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
    expect(CONFIG_SCHEMA_VERSION).toBe(20);
    expect(CONFIG_BY_KEY.get('publishing.maxImageAltCharacters')!.schema.safeParse(500).success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.maxImageUploadRequestOverheadBytes')!.schema.safeParse(65536).success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.maxImageUploadBytes')!.schema.parse(26214400)).toBe(26214400);
    expect(CONFIG_BY_KEY.get('publishing.allowedImageMimeTypes')!.schema.safeParse(['image/jpeg', 'image/png']).success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.allowedImageMimeTypes')!.schema.safeParse(['image/svg+xml']).success).toBe(false);
    expect(CONFIG_BY_KEY.get('inbox.messengerReplyWindowHours')!.schema.safeParse(24).success).toBe(true);
    expect(CONFIG_BY_KEY.get('inbox.messengerReplyWindowHours')!.schema.safeParse(25).success).toBe(false);
    expect(CONFIG_BY_KEY.get('inbox.messengerReplyWindowHours')!.consumption).toBe('active');
    expect(CONFIG_BY_KEY.get('analytics.maxRangeDays')!.schema.safeParse(366).success).toBe(true);
    expect(CONFIG_BY_KEY.get('analytics.maxRangeDays')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('auth.passkeyChallengeMinutes')!.schema.safeParse(5).success).toBe(true);
    expect(CONFIG_BY_KEY.get('auth.passkeyChallengeMinutes')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('auth.passkeyOrigin')!.schema.safeParse('https://social.example.test').success).toBe(true);
    expect(CONFIG_BY_KEY.get('auth.passkeyOrigin')!.schema.safeParse('http://localhost:3200').success).toBe(true);
    expect(CONFIG_BY_KEY.get('auth.passkeyOrigin')!.schema.safeParse('http://social.example.test').success).toBe(false);
    expect(CONFIG_BY_KEY.get('auth.passkeyOrigin')!.schema.safeParse('https://social.example.test/path').success).toBe(false);
    expect(CONFIG_BY_KEY.get('data.maxArchiveBytes')!.schema.parse(268435456)).toBe(268435456);
    expect(CONFIG_BY_KEY.get('data.workspaceOperationTimeoutMs')!.schema.safeParse(300000).success).toBe(true);
    expect(CONFIG_BY_KEY.get('data.workspaceOperationLockWaitMs')!.schema.safeParse(30000).success).toBe(true);
    expect(CONFIG_BY_KEY.get('data.purgeRecoverySchedule')!.schema.safeParse('*/7 * * * *').success).toBe(true);
    expect(CONFIG_BY_KEY.get('storage.orphanMediaRetentionDays')!.schema.parse(30)).toBe(30);
    expect(CONFIG_BY_KEY.get('storage.orphanMediaRetentionDays')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('storage.orphanMediaBatchLimit')!.schema.parse(500)).toBe(500);
    expect(CONFIG_BY_KEY.get('storage.orphanMediaBatchLimit')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('storage.orphanMediaCleanupSchedule')!.schema.safeParse('17 3 * * *').success).toBe(true);
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
    expect(CONFIG_BY_KEY.get('sync.maxItemsPerJob')!.schema.safeParse(10000).success).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.maxItemsPerJob')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('sync.workerLeaseMinutes')!.schema.safeParse(5).success).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.workerLeaseMinutes')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('sync.workerHeartbeatSeconds')!.schema.safeParse(30).success).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.workerHeartbeatSeconds')!.schema.safeParse(1).success).toBe(false);
    expect(CONFIG_BY_KEY.get('sync.workerPollSeconds')!.schema.safeParse(5).success).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.workerPollSeconds')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('sync.retryBaseDelayMs')!.schema.safeParse(1000).success).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.retryBaseDelayMs')!.schema.safeParse(50).success).toBe(false);
    expect(CONFIG_BY_KEY.get('sync.retryMaxDelayMs')!.schema.safeParse(60000).success).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.retryMaxDelayMs')!.schema.safeParse(50).success).toBe(false);
    expect(CONFIG_BY_KEY.get('auth.passwordMinLength')!.schema.safeParse(12).success).toBe(true);
    expect(CONFIG_BY_KEY.get('auth.passwordMinLength')!.schema.safeParse(4).success).toBe(false);
    expect(CONFIG_BY_KEY.get('auth.passwordMaxBytes')!.schema.safeParse(800).success).toBe(true);
    expect(CONFIG_BY_KEY.get('auth.passwordMaxBytes')!.schema.safeParse(16).success).toBe(false);
    expect(CONFIG_BY_KEY.get('storage.mediaRoot')!.schema.safeParse('/srv/social-pilot/media').success).toBe(true);
    expect(CONFIG_BY_KEY.get('storage.mediaRoot')!.schema.safeParse('../media').success).toBe(false);
    expect(CONFIG_BY_KEY.get('storage.mediaRoot')!.schema.safeParse('/').success).toBe(false);
  });

  it('audits changes with key, change type, and registry version only', () => {
    expect(configAuditDetail('meta.appSecret', 'secret updated')).toEqual({
      key: 'meta.appSecret', change: 'secret updated', schemaVersion: CONFIG_SCHEMA_VERSION,
    });
  });
});
