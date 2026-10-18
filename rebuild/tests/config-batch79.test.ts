import { beforeEach, describe, expect, it, vi } from 'vitest';
const findMany = vi.hoisted(() => vi.fn());
vi.mock('@/server/data', () => ({ prisma: { appSetting: { findMany } } }));
import { runtimeConfigBatch } from '@/server/config/store';
beforeEach(() => { findMany.mockReset().mockResolvedValue([]); });
describe('Batched non-secret configuration', () => {
  it('reads a deduplicated module policy in one database snapshot', async () => {
    findMany.mockResolvedValue([{ key: 'jobs.enabled', value: false, encrypted: false }]);
    expect(await runtimeConfigBatch(['jobs.enabled','sharing.defaultExpiryDays','jobs.enabled'])).toEqual({ 'jobs.enabled': false, 'sharing.defaultExpiryDays': 30 });
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany.mock.calls[0]![0].where.key.in).toEqual(['jobs.enabled','sharing.defaultExpiryDays']);
  });
  it('refuses secrets and unknown keys before querying the database', async () => {
    await expect(runtimeConfigBatch(['jobs.enabled','meta.appSecret'])).rejects.toThrow('Unknown non-secret');
    await expect(runtimeConfigBatch(['unregistered.setting'])).rejects.toThrow('Unknown non-secret');
    expect(findMany).not.toHaveBeenCalled();
  });
  it('rejects corrupted or incorrectly encrypted values without returning a partial policy', async () => {
    findMany.mockResolvedValue([{ key: 'jobs.enabled', value: 'not a boolean', encrypted: false }]);
    await expect(runtimeConfigBatch(['jobs.enabled','sharing.defaultExpiryDays'])).rejects.toThrow('Stored configuration is invalid');
    findMany.mockResolvedValue([{ key: 'jobs.enabled', value: true, encrypted: true }]);
    await expect(runtimeConfigBatch(['jobs.enabled'])).rejects.toThrow('stored as encrypted');
  });
  it('does not query for an empty policy', async () => {
    expect(await runtimeConfigBatch([])).toEqual({}); expect(findMany).not.toHaveBeenCalled();
  });
});
