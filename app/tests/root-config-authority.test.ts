import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ actor: vi.fn(), upsert: vi.fn(), clear: vi.fn(), audit: vi.fn(), read: vi.fn() }));
vi.mock('@/server/data', () => {
  const db = { user: { findUnique: h.actor }, appSetting: { upsert: h.upsert, deleteMany: h.clear }, $queryRaw: vi.fn(), $executeRaw: h.audit };
  return { prisma: { ...db, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) } };
});
vi.mock('@/server/config/store', () => ({ readConfig: h.read }));
import { readRootConfig, saveRootConfig } from '@/modules/root/server/configuration';
beforeEach(() => { vi.clearAllMocks(); h.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null }); h.read.mockResolvedValue([]); });
it.each([null, { isInstanceOwner: false, disabledAt: null }, { isInstanceOwner: true, disabledAt: new Date() }])('refuses reads and writes by a stale or unauthorized actor: %j', async actor => {
  h.actor.mockResolvedValue(actor);
  await expect(readRootConfig('actor')).rejects.toMatchObject({ code: 'forbidden' });
  await expect(saveRootConfig({ key: 'root.workspaceNameMaxCharacters', value: 100, confirmation: 'SET ROOT CONFIG root.workspaceNameMaxCharacters' }, 'actor')).rejects.toMatchObject({ code: 'forbidden' });
  expect(h.upsert).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled();
});
it('requires exact confirmation in the shared writer', async () => {
  await expect(saveRootConfig({ key: 'root.workspaceNameMaxCharacters', value: 100 }, 'root')).rejects.toMatchObject({ code: 'invalid_request' });
  expect(h.upsert).not.toHaveBeenCalled();
});
it('saves confirmed values and value-free audit together', async () => {
  await saveRootConfig({ key: 'root.workspaceNameMaxCharacters', value: 100, confirmation: 'SET ROOT CONFIG root.workspaceNameMaxCharacters' }, 'root');
  expect(h.upsert).toHaveBeenCalledOnce(); expect(h.audit).toHaveBeenCalledOnce();
});
it('returns the availability inventory alongside masked settings for every caller', async () => {
  expect(await readRootConfig('root')).toMatchObject({ values: [], definitions: expect.any(Array), availability: { modules: expect.any(Array), features: expect.any(Array) } });
});
it('requires the clear-secret phrase for secret removal', async () => {
  await expect(saveRootConfig({ key: 'root.workspaceNameMaxCharacters', clear: true, confirmation: 'CLEAR ROOT SECRET root.workspaceNameMaxCharacters' }, 'root')).rejects.toMatchObject({ code: 'invalid_request' });
  expect(h.clear).not.toHaveBeenCalled();
});

it('rechecks actor authority within the save transaction', async () => {
  h.actor.mockResolvedValueOnce({ isInstanceOwner: true, disabledAt: null }).mockResolvedValue({ isInstanceOwner: false, disabledAt: null });
  await expect(saveRootConfig({ key: 'root.workspaceNameMaxCharacters', value: 100, confirmation: 'SET ROOT CONFIG root.workspaceNameMaxCharacters' }, 'root')).rejects.toMatchObject({ code: 'forbidden' });
  expect(h.upsert).not.toHaveBeenCalled(); expect(h.audit).not.toHaveBeenCalled();
});
it('clears a secret only with the exact clear action', async () => {
  await expect(saveRootConfig({ key: 'meta.appSecret', clear: true, confirmation: 'SET ROOT CONFIG meta.appSecret' }, 'root')).rejects.toMatchObject({ code: 'invalid_request' });
  expect(h.clear).not.toHaveBeenCalled();
  await saveRootConfig({ key: 'meta.appSecret', clear: true, confirmation: 'CLEAR ROOT SECRET meta.appSecret' }, 'root');
  expect(h.clear).toHaveBeenCalledWith({ where: { key: 'meta.appSecret' } }); expect(h.audit).toHaveBeenCalledOnce();
});

it('persists the migrated Facebook history policy and exclusions with its Root audit', async () => {
  const { FACEBOOK_HISTORY_CONFIG } = await import('@/platforms/facebook/config');
  const definition = FACEBOOK_HISTORY_CONFIG[0];
  const input = { ...definition.defaultValue, metrics: ['custom_metric'], excludedMetrics: ['post_video_views', 'future_metric'] };
  await saveRootConfig({ key: definition.key, value: input, confirmation: `SET ROOT CONFIG ${definition.key}` }, 'root');
  const saved = h.upsert.mock.calls[0][0];
  expect(saved.create.value.metrics).toContain('custom_metric');
  expect(saved.create.value.metrics).toContain('post_clicks');
  expect(saved.create.value.metrics).not.toContain('post_video_views');
  expect(saved.create.value.excludedMetrics).toEqual(['post_video_views', 'future_metric']);
  expect(saved.update.value).toEqual(saved.create.value);
  expect(h.audit).toHaveBeenCalledOnce();
  expect(h.audit.mock.calls[0][0].join('')).toContain('config.changed');
  expect(h.audit.mock.calls[0]).toContainEqual(expect.stringContaining('"key":"meta.postHistoryPolicy"'));
  expect(input.metrics).toEqual(['custom_metric']);
});
