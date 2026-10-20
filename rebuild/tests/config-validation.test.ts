import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_BY_KEY, CONFIG_REGISTRY, CONFIG_SCHEMA_VERSION, safeConfigShape } from '../src/lib/config/registry';
import { configAuditDetail } from '../src/server/config/store';
import { publishingManifest } from '../src/modules/publishing/manifest';

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
    expect(CONFIG_BY_KEY.get('meta.submittedStatusCursor')!.schema.safeParse('').success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.submittedStatusCursor')!.schema.safeParse('["2026-10-19T00:00:00.000Z","operation-id"]').success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.submittedStatusCursor')!.schema.safeParse('x'.repeat(4097)).success).toBe(false);
    expect(safeConfigShape().find(setting => setting.key === 'meta.submittedStatusCursor')).toMatchObject({ kind: 'text', defaultValue: '', consumption: 'active', group: 'Facebook · Publishing recovery' });
    expect(CONFIG_BY_KEY.get('meta.appSecret')!.schema.safeParse('x'.repeat(2048)).success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.appSecret')!.schema.safeParse('x'.repeat(2049)).success).toBe(false);
    expect(CONFIG_BY_KEY.get('jobs.enabled')!.schema.safeParse(true).success).toBe(true);
    expect(CONFIG_BY_KEY.get('jobs.enabled')!.schema.safeParse('true').success).toBe(false);
    for (const key of ['publishing.automation.recycleSchedule', 'publishing.automation.mixSchedule']) {
      expect(safeConfigShape().find(setting => setting.key === key)).toMatchObject({ consumption: 'active', owner: { kind: 'product', id: 'publishing' } });
      expect(CONFIG_BY_KEY.get(key)!.schema.safeParse('*/15 * * * *').success).toBe(true);
      expect(CONFIG_BY_KEY.get(key)!.schema.safeParse('not a cron').success).toBe(false);
    }
    for (const key of ['publishing.automation.recycleCursor', 'publishing.automation.mixCursor']) {
      expect(safeConfigShape().find(setting => setting.key === key)).toMatchObject({ kind: 'text', defaultValue: '', consumption: 'active', owner: { kind: 'product', id: 'publishing' } });
      expect(publishingManifest.rootSettingKeys).toContain(key);
      expect(CONFIG_BY_KEY.get(key)!.schema.safeParse('').success).toBe(true);
      expect(CONFIG_BY_KEY.get(key)!.schema.safeParse('workspace:01_post-2').success).toBe(true);
      for (const invalid of ['has spaces', 'bad/id', 'x'.repeat(81)]) expect(CONFIG_BY_KEY.get(key)!.schema.safeParse(invalid).success).toBe(false);
    }
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('').success).toBe(true);
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('ops@example.test').success).toBe(true);
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('not-an-email').success).toBe(false);
  });

  it('covers the operational configuration areas with explicit consumption status', () => {
    expect(CONFIG_SCHEMA_VERSION).toBe(97);
    expect(safeConfigShape().find(setting => setting.key === 'settings.teamDefaultRole')).toMatchObject({ defaultValue: 'contributor', consumption: 'active', owner: { kind: 'product', id: 'settings' } });
    expect(safeConfigShape().find(setting => setting.key === 'settings.teamDefaultAllChannels')).toMatchObject({ defaultValue: false, consumption: 'active', owner: { kind: 'product', id: 'settings' } });
    expect(CONFIG_BY_KEY.get('settings.teamDefaultRole')!.schema.safeParse('owner').success).toBe(false);
    for (const key of ['settings.teamMaxMembers', 'settings.teamMaxChannels', 'settings.teamOperationTimeoutMs', 'settings.teamOperationMaxWaitMs']) {
      expect(safeConfigShape().find(setting => setting.key === key)).toMatchObject({ consumption: 'active', owner: { kind: 'product', id: 'settings' } });
      expect(CONFIG_BY_KEY.get(key)!.schema.safeParse(0).success).toBe(false);
    }
    expect(CONFIG_BY_KEY.get('jobs.workspaceOwnerPolicy')!.schema.safeParse('any_active_owner').success).toBe(true);
    expect(CONFIG_BY_KEY.get('jobs.workspaceOwnerPolicy')!.schema.safeParse('all_active_owners').success).toBe(true);
    expect(CONFIG_BY_KEY.get('jobs.workspaceOwnerPolicy')!.schema.safeParse('root_bypass').success).toBe(false);
    expect(CONFIG_BY_KEY.get('jobs.workspaceOwnerPolicy')).toMatchObject({ defaultValue: 'any_active_owner', consumption: 'active' });
    expect(CONFIG_BY_KEY.get('jobs.workspaceOwnerLimit')!.schema.safeParse(1001).success).toBe(false);
    expect(CONFIG_BY_KEY.get('jobs.workspaceOwnerLimit')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('jobs.workspaceOwnerLimit')).toMatchObject({ defaultValue: 100, consumption: 'active' });
    for (const key of ['meta.pageAnalyticsLookbackDays', 'meta.adsAnalyticsLookbackDays']) {
      const setting = CONFIG_BY_KEY.get(key)!;
      expect(setting.schema.safeParse(1).success).toBe(true);
      expect(setting.schema.safeParse(366).success).toBe(true);
      expect(setting.schema.safeParse(367).success).toBe(false);
      expect(setting.schema.safeParse(0).success).toBe(false);
      expect(setting).toMatchObject({ consumption: 'active', owner: { kind: 'platform', id: 'facebook' } });
    }
    expect(CONFIG_BY_KEY.get('meta.pageInsightReadScopes')!.schema.safeParse([]).success).toBe(false);
    expect(CONFIG_BY_KEY.get('meta.pageInsightReadScopes')).toMatchObject({ consumption: 'active', owner: { kind: 'platform', id: 'facebook' } });
    expect(safeConfigShape().find(setting => setting.key === 'ads.reportingFilters')).toMatchObject({ kind: 'json', consumption: 'active', owner: { kind: 'product', id: 'ads' } });
    for (const [key, value, maximum] of [['ads.reportPageSize', 25, 100], ['ads.reportMaxRows', 20000, 100000]] as const) {
      expect(CONFIG_BY_KEY.get(key)).toMatchObject({ defaultValue: value, consumption: 'active' });
      expect(CONFIG_BY_KEY.get(key)!.schema.safeParse(0).success).toBe(false);
      expect(CONFIG_BY_KEY.get(key)!.schema.safeParse(maximum + 1).success).toBe(false);
      expect(safeConfigShape().find(setting => setting.key === key)?.owner).toEqual({ kind: 'product', id: 'ads' });
    }
    for (const [key, value, maximum] of [['ads.detailMaxBytes', 1048576, 10485760], ['ads.exportMaxBytes', 10485760, 52428800]] as const) {
      const setting = CONFIG_BY_KEY.get(key)!;
      expect(setting).toMatchObject({ defaultValue: value, consumption: 'active' });
      expect(safeConfigShape().find(item => item.key === key)?.owner).toEqual({ kind: 'product', id: 'ads' });
      for (const invalid of [1023, maximum + 1, 2048.5, '2048']) expect(setting.schema.safeParse(invalid).success).toBe(false);
      expect(setting.schema.safeParse(maximum).success).toBe(true);
    }
    const filename = CONFIG_BY_KEY.get('ads.exportFileName')!;
    expect(filename).toMatchObject({ defaultValue: 'ads-report.csv', consumption: 'active' });
    expect(safeConfigShape().find(item => item.key === filename.key)?.owner).toEqual({ kind: 'product', id: 'ads' });
    expect(filename.schema.safeParse('Daily report-1.csv').success).toBe(true);
    for (const invalid of ['../report.csv', '/report.csv', 'report.csv\r\nInjected: yes', 'report.xlsx', '=report.csv', 'x'.repeat(101) + '.csv']) expect(filename.schema.safeParse(invalid).success).toBe(false);
    expect(CONFIG_BY_KEY.get('meta.manualMediaAttestationEnabled')).toMatchObject({ defaultValue: false, consumption: 'active', owner: { kind: 'platform', id: 'facebook' } });
    expect(CONFIG_BY_KEY.get('meta.manualMediaCleanupEnabled')).toMatchObject({ defaultValue: false, consumption: 'active', owner: { kind: 'platform', id: 'facebook' } });
    for (const key of ['meta.mediaReadScopes', 'meta.mediaDeleteScopes']) {
      expect(CONFIG_BY_KEY.get(key)?.schema.safeParse([]).success).toBe(false);
      expect(CONFIG_BY_KEY.get(key)?.schema.safeParse(['approved_permission']).success).toBe(true);
    }
    const appSecretProof = CONFIG_BY_KEY.get('meta.appSecretProofEnabled')!;
    expect(appSecretProof).toMatchObject({ kind: 'boolean', defaultValue: true, consumption: 'active', owner: { kind: 'platform', id: 'facebook' } });
    expect(appSecretProof.schema.safeParse(false).success).toBe(true);
    expect(appSecretProof.schema.safeParse('true').success).toBe(false);
    expect(appSecretProof.group).toBe('Facebook · API credentials');
    for (const [key, value, minimum, maximum] of [
      ['publishing.searchMaxCharacters', 200, 1, 2000],
      ['publishing.exportMaxPosts', 5000, 1, 50000],
      ['publishing.exportMaxBytes', 10485760, 1024, 52428800],
      ['publishing.exportBatchSize', 100, 1, 1000],
    ] as const) {
      const setting = CONFIG_BY_KEY.get(key)!;
      expect(setting.defaultValue).toBe(value);
      expect(setting.consumption).toBe('active');
      expect(setting.schema.safeParse(minimum).success).toBe(true);
      expect(setting.schema.safeParse(maximum).success).toBe(true);
      expect(setting.schema.safeParse(maximum + 1).success).toBe(false);
      expect(setting.schema.safeParse(minimum - 1).success).toBe(false);
      expect(setting.group).toMatch(/^Publishing · (Reads|Export)$/);
    }
    for (const [key, value, maximum] of [
      ['publishing.publicationHistoryLimit', 100, 1000],
      ['publishing.postPageSize', 50, 100],
      ['publishing.readMaxItems', 200, 1000],
      ['publishing.calendarMaxRangeDays', 70, 366],
    ] as const) {
      const setting = CONFIG_BY_KEY.get(key)!;
      expect(setting.defaultValue).toBe(value);
      expect(setting.consumption).toBe('active');
      expect(setting.schema.safeParse(key === 'publishing.calendarMaxRangeDays' ? 50 : 1).success).toBe(true);
      expect(setting.schema.safeParse(maximum).success).toBe(true);
      expect(setting.schema.safeParse(maximum + 1).success).toBe(false);
      expect(setting.schema.safeParse(0).success).toBe(false);
    }
    expect(CONFIG_BY_KEY.get('publishing.publicationUrlMaxCharacters')!.defaultValue).toBe(2048);
    expect(CONFIG_BY_KEY.get('publishing.publicationUrlMaxCharacters')!.schema.safeParse(2049).success).toBe(false);
    expect(CONFIG_BY_KEY.get('publishing.deletionHistoryLimit')!.defaultValue).toBe(20);
    expect(CONFIG_BY_KEY.get('publishing.deletionHistoryLimit')!.schema.safeParse(100).success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.deletionHistoryLimit')!.schema.safeParse(101).success).toBe(false);
    expect(CONFIG_BY_KEY.get('publishing.deletionMaxAliases')!.defaultValue).toBe(1000);
    expect(CONFIG_BY_KEY.get('publishing.deletionMaxAliases')!.schema.safeParse(10000).success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.deletionMaxAliases')!.schema.safeParse(10001).success).toBe(false);
    for (const [key, value] of [['root.userSearchMaxCharacters', 200], ['root.accountOperationTimeoutMs', 15000], ['root.accountOperationLockWaitMs', 5000]] as const) {
      expect(CONFIG_BY_KEY.get(key)!.defaultValue).toBe(value);
      expect(CONFIG_BY_KEY.get(key)!.consumption).toBe('active');
      expect(CONFIG_BY_KEY.get(key)!.schema.safeParse(0).success).toBe(false);
    }
    expect(CONFIG_BY_KEY.get('root.activityPageSize')!.defaultValue).toBe(50);
    expect(CONFIG_BY_KEY.get('root.activitySearchMaxCharacters')!.defaultValue).toBe(200);
    expect(CONFIG_BY_KEY.get('root.activitySearchMaxCharacters')!.consumption).toBe('active');
    expect(CONFIG_BY_KEY.get('root.activitySearchMaxCharacters')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('root.activitySearchMaxCharacters')!.schema.safeParse(2001).success).toBe(false);
    expect(CONFIG_BY_KEY.get('root.activityCursorMaxCharacters')!.defaultValue).toBe(4096);
    expect(CONFIG_BY_KEY.get('root.activityCursorMaxCharacters')!.consumption).toBe('active');
    expect(CONFIG_BY_KEY.get('root.activityCursorMaxCharacters')!.schema.safeParse(511).success).toBe(false);
    expect(CONFIG_BY_KEY.get('root.activityCursorMaxCharacters')!.schema.safeParse(65537).success).toBe(false);
    expect(CONFIG_BY_KEY.get('root.activityPageSize')!.consumption).toBe('active');
    expect(CONFIG_BY_KEY.get('root.activityPageSize')!.schema.safeParse(1).success).toBe(true);
    expect(CONFIG_BY_KEY.get('root.activityPageSize')!.schema.safeParse(1000).success).toBe(true);
    expect(CONFIG_BY_KEY.get('root.activityPageSize')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('root.activityPageSize')!.schema.safeParse(1001).success).toBe(false);
    expect(CONFIG_BY_KEY.get('connections.statusLabels')!.schema.safeParse({ connected: 'Connected', expired: 'Reconnect needed', revoked: 'Reconnect needed' }).success).toBe(true);
    expect(CONFIG_BY_KEY.get('connections.statusLabels')!.schema.safeParse({ connected: ' ', expired: 'Expired' }).success).toBe(false);
    expect(CONFIG_BY_KEY.get('publishing.maxImageAltCharacters')!.schema.safeParse(500).success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.maxImageUploadRequestOverheadBytes')!.schema.safeParse(65536).success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.maxImageUploadBytes')!.schema.parse(26214400)).toBe(26214400);
    expect(CONFIG_BY_KEY.get('publishing.allowedImageMimeTypes')!.schema.safeParse(['image/jpeg', 'image/png']).success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.allowedImageMimeTypes')!.schema.safeParse(['image/svg+xml']).success).toBe(false);
    expect(CONFIG_BY_KEY.get('inbox.messengerReplyWindowHours')!.schema.safeParse(24).success).toBe(true);
    expect(CONFIG_BY_KEY.get('inbox.messengerReplyWindowHours')!.schema.safeParse(25).success).toBe(false);
    expect(CONFIG_BY_KEY.get('inbox.messengerReplyWindowHours')!.consumption).toBe('active');
    for (const [key, value] of [['analytics.defaultRangeDays', 30], ['analytics.metricPageSize', 12], ['analytics.detailPageSize', 50], ['analytics.chartPoints', 28], ['analytics.searchMaxLength', 200]] as const) {
      expect(CONFIG_BY_KEY.get(key)?.defaultValue).toBe(value);
      expect(CONFIG_BY_KEY.get(key)?.consumption).toBe('active');
      expect(CONFIG_BY_KEY.get(key)?.schema.safeParse(0).success).toBe(false);
    }
    for (const [key, value] of [['publishing.operationTimeoutMs', 60000], ['publishing.operationMaxWaitMs', 2000], ['publishing.transactionTimeoutMs', 15000], ['publishing.transactionMaxWaitMs', 5000], ['publishing.maxTargetsPerOperation', 5000], ['publishing.identifierMaxCharacters', 200]] as const) {
      expect(CONFIG_BY_KEY.get(key)?.defaultValue).toBe(value);
      expect(CONFIG_BY_KEY.get(key)?.consumption).toBe('active');
      expect(CONFIG_BY_KEY.get(key)?.schema.safeParse(0).success).toBe(false);
    }
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
    expect(CONFIG_BY_KEY.get('storage.mediaLibraryBatchLimit')!.schema.parse(100)).toBe(100);
    expect(CONFIG_BY_KEY.get('storage.mediaLibraryBatchLimit')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('storage.orphanMediaCleanupSchedule')!.schema.safeParse('17 3 * * *').success).toBe(true);
    for (const key of ['publishing.templatePageSize', 'publishing.templateMaxPerWorkspace', 'publishing.templateSearchMaxCharacters', 'publishing.templateNameMaxCharacters', 'publishing.templateCategoryMaxCharacters', 'publishing.templateBodyMaxCharacters', 'publishing.templateHashtagsMaxCharacters', 'publishing.templateFirstCommentMaxCharacters', 'publishing.templateTransactionTimeoutMs', 'publishing.templateTransactionMaxWaitMs', 'inbox.noteMaxCharacters', 'inbox.noteHistoryLimit', 'inbox.savedReplyPageLimit', 'inbox.savedReplyNameMaxCharacters', 'inbox.savedReplyBodyMaxCharacters', 'inbox.productivityAssigneeLimit']) expect(CONFIG_BY_KEY.has(key as never)).toBe(true);
    for (const prefix of ['meta.', 'sync.', 'api.', 'entitlements.', 'retention.', 'logging.', 'mcp.', 'theme.', 'notifications.']) {
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
    expect(CONFIG_BY_KEY.get('theme.default')!.schema.safeParse('clean').success).toBe(true);
    expect(CONFIG_BY_KEY.get('theme.default')!.schema.safeParse('unknown').success).toBe(false);
    expect(CONFIG_BY_KEY.get('mcp.requestsPerMinute')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('sync.maxItemsPerJob')!.schema.safeParse(10000).success).toBe(true);
    expect(CONFIG_BY_KEY.get('sync.maxItemsPerJob')!.schema.safeParse(0).success).toBe(false);
    expect(CONFIG_BY_KEY.get('publishing.defaultScheduleTime')!.schema.safeParse('16:30').success).toBe(true);
    expect(CONFIG_BY_KEY.get('publishing.defaultScheduleTime')!.schema.safeParse('25:00').success).toBe(false);
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

  it('declares the Ads management policy as a Root-managed boolean that defaults off', () => {
    const definition = CONFIG_BY_KEY.get('ads.managementEnabled');
    expect(definition).toMatchObject({ kind: 'boolean', defaultValue: false, consumption: 'active' });
    expect(definition!.schema.safeParse(true).success).toBe(true);
    expect(definition!.schema.safeParse('true').success).toBe(false);
  });

  it('registers every literal runtime setting read in application source', () => {
    const source = fileURLToPath(new URL('../src', import.meta.url));
    const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : []);
    const missing = files(source).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/runtime(Config|Secret)\(\s*['"]([^'"]+)['"]/g)].flatMap(match => {
      const definition = CONFIG_BY_KEY.get(match[2]);
      return !definition || (match[1] === 'Secret') !== (definition.kind === 'secret') ? [`${file}: ${match[2]}`] : [];
    }));
    expect(missing).toEqual([]);
  });

  it('omits configuration placeholders for uninstalled providers', () => {
    expect(CONFIG_BY_KEY.has('x.oauthScopes')).toBe(false);
  });

  it('audits changes with key, change type, and registry version only', () => {
    expect(configAuditDetail('meta.appSecret', 'secret updated')).toEqual({
      key: 'meta.appSecret', change: 'secret updated', schemaVersion: CONFIG_SCHEMA_VERSION,
    });
  });
});
