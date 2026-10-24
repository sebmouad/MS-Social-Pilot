import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ one: vi.fn(), many: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { appSetting: { findUnique: db.one, findMany: db.many } } }));
import { CONFIG_BY_KEY, safeConfigShape } from '../src/lib/config/registry';
import { ROOT_CONFIG_COPY } from '../src/lib/config/root-config-copy';
import { runtimeConfig, runtimeConfigBatch } from '../src/server/config/store';

beforeEach(() => { vi.resetAllMocks(); db.one.mockResolvedValue(null); db.many.mockResolvedValue([]); });

describe('shared operational settings', () => {
  it('keeps the moved defaults and validates numeric values before runtime consumption', async () => {
    const defaults = {
      'sync.workerDrainPollMs': 250, 'sync.workerLeaseRenewalDivisor': 3,
      'logging.workerErrorMaxCharacters': 2000, 'logging.workerSummaryMaxCharacters': 2000,
      'logging.purgeErrorMaxCharacters': 1000, 'root.jobHealthLookbackMinutes': 1440,
      'root.configSearchMaxCharacters': 2000, 'data.postPageMaxItems': 100,
      'data.insightDefaultDays': 30, 'data.audienceCandidateLimit': 20,
      'data.connectionSelectionMaxItems': 250, 'root.errorNameMaxCharacters': 200,
      'root.errorLocationMaxCharacters': 300, 'root.errorReleaseMaxCharacters': 64,
    };
    expect(await runtimeConfigBatch(Object.keys(defaults))).toEqual(defaults);
    for (const key of Object.keys(defaults)) {
      expect(safeConfigShape().find(item => item.key === key)).toMatchObject({ owner: { kind: 'shared' }, consumption: 'active' });
      for (const invalid of [0, -1, 1.5, '3', null]) expect(CONFIG_BY_KEY.get(key)!.schema.safeParse(invalid).success).toBe(false);
    }
    db.one.mockResolvedValueOnce({ value: 7, encrypted: false });
    expect(await runtimeConfig('root.errorNameMaxCharacters')).toBe(7);
    db.one.mockResolvedValueOnce({ value: -1, encrypted: false });
    await expect(runtimeConfig('root.errorNameMaxCharacters')).rejects.toThrow('Stored configuration is invalid');
  });
  it('requires the complete typed plain-text operator catalog and returns stored overrides', async () => {
    const schema = CONFIG_BY_KEY.get('root.configCopy')!.schema;
    expect(schema.safeParse(ROOT_CONFIG_COPY).success).toBe(true);
    expect(schema.safeParse({ ...ROOT_CONFIG_COPY, save: '' }).success).toBe(false);
    expect(schema.safeParse({ ...ROOT_CONFIG_COPY, unexpected: 'value' }).success).toBe(false);
    const missing = { ...ROOT_CONFIG_COPY } as Record<string, string>; delete missing.find;
    expect(schema.safeParse(missing).success).toBe(false);
    const configured = { ...ROOT_CONFIG_COPY, find: 'Find an installation setting' };
    db.one.mockResolvedValueOnce({ value: configured, encrypted: false });
    expect(await runtimeConfig('root.configCopy')).toEqual(configured);
  });
});
