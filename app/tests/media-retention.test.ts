import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ config: vi.fn(), workspaces: vi.fn(), query: vi.fn(), exec: vi.fn(), attribute: vi.fn(), remove: vi.fn(), sql: [] as string[] }));
vi.mock('@/server/data', () => ({ prisma: { workspace: { findMany: m.workspaces }, $transaction: async (run: (tx: unknown) => unknown) => run({ $queryRaw: m.query, $executeRaw: m.exec }) } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => unknown) => run() }));
vi.mock('../src/modules/media/server/library', () => ({ attributeAssets: m.attribute }));
vi.mock('../src/modules/media/server/store', () => ({ fsMediaStore: { removeStored: m.remove } }));

import { runMediaRetention } from '../src/modules/media/server/retention';
import { MEDIA_CONFIG, mediaRetentionPolicySchema } from '../src/modules/media/config';
import { MEDIA_JOBS, MEDIA_ROOT_KEYS } from '../src/modules/media/manifest';
import { publishingManifest } from '../src/modules/publishing/manifest';

const policy = { enabled: true, unusedDays: 90, batchLimit: 10 };
const row = (id: string, storageKey: string | null = `w1/videos/${id}`) => ({ id, url: `/api/media/${id}`, storageKey, size: 100, kind: 'video' });
const now = new Date('2026-10-22T03:43:00Z');
beforeEach(() => {
  vi.resetAllMocks(); m.sql = [];
  m.config.mockImplementation(async (key: string) => key === 'media.retentionPolicy' ? policy : { 'media.holderScanLimit': 500, 'media.holderExcerptCharacters': 80, 'media.transactionTimeoutMs': 20000, 'media.transactionMaxWaitMs': 5000 }[key]);
  m.workspaces.mockResolvedValue([{ id: 'w1' }]);
  m.exec.mockImplementation(async (s: TemplateStringsArray) => { m.sql.push(s.join('?')); return 1; });
  m.query.mockImplementation(async (s: TemplateStringsArray) => s.join('?').includes('FROM media') ? [row('a'), row('b'), row('c', null)] : []);
  m.attribute.mockImplementation(async (_tx: unknown, _w: string, assets: Array<{ id: string }>) => ({ byAsset: new Map([[assets[0]!.id, assets[0]!.id === 'b' ? [{ postId: 'p1' }] : []]]), truncated: false }));
  m.remove.mockResolvedValue('removed');
});

describe('unused media retention (G7)', () => {
  it('is registered as an off-by-default Root policy with a schedule and a leased job', () => {
    const byKey = new Map(MEDIA_CONFIG.map(entry => [entry.key, entry]));
    expect(byKey.get('media.retentionPolicy')?.defaultValue).toMatchObject({ enabled: false });
    expect(byKey.get('media.retentionSchedule')?.consumption).toBe('active');
    expect(MEDIA_ROOT_KEYS).toEqual(expect.arrayContaining(['media.retentionPolicy', 'media.retentionSchedule']));
    expect(publishingManifest.jobs.some(job => job.name === MEDIA_JOBS[0].name && job.configKey === 'media.retentionSchedule')).toBe(true);
    expect(mediaRetentionPolicySchema.safeParse({ ...policy, unusedDays: 0 }).success).toBe(false);
  });

  it('does nothing while disabled', async () => {
    m.config.mockImplementation(async () => ({ ...policy, enabled: false }));
    expect(await runMediaRetention(now)).toEqual({ examined: 0, removed: 0, kept: 0, failed: 0, bytes: 0 });
    expect(m.workspaces).not.toHaveBeenCalled();
  });

  it('removes only unreferenced old assets, audits each removal and deletes stored files after the record', async () => {
    const result = await runMediaRetention(now);
    expect(result).toEqual({ examined: 3, removed: 2, kept: 1, failed: 0, bytes: 200 });
    expect(m.sql.filter(sql => sql.includes('DELETE FROM media'))).toHaveLength(2);
    expect(m.sql.filter(sql => sql.includes('media.retention.deleted'))).toHaveLength(0); // action is a bound value, not literal SQL
    expect(m.exec.mock.calls.filter(call => call.slice(1).includes('media.retention.deleted'))).toHaveLength(2);
    expect(m.remove).toHaveBeenCalledTimes(1);
    expect(m.remove).toHaveBeenCalledWith('w1', 'w1/videos/a');
    const select = m.query.mock.calls.find(call => (call[0] as TemplateStringsArray).join('?').includes('FROM media'))!;
    expect(select.slice(1)).toContain('w1');
    expect(select.slice(1).some(value => value instanceof Date && value.getTime() === now.getTime() - 90 * 86_400_000)).toBe(true);
  });

  it('keeps an asset when the post scan is inconclusive and counts a failed file removal without losing the record outcome', async () => {
    m.attribute.mockResolvedValue({ byAsset: new Map(), truncated: true });
    expect(await runMediaRetention(now)).toMatchObject({ removed: 0, kept: 3 });
    m.attribute.mockImplementation(async (_tx: unknown, _w: string, assets: Array<{ id: string }>) => ({ byAsset: new Map([[assets[0]!.id, []]]), truncated: false }));
    m.remove.mockRejectedValue(new Error('disk'));
    expect(await runMediaRetention(now)).toMatchObject({ removed: 3, failed: 2 });
  });

  it('isolates a failing workspace', async () => {
    m.workspaces.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    m.query.mockRejectedValueOnce(new Error('lock timeout'));
    const result = await runMediaRetention(now);
    expect(result.failed).toBe(1);
    expect(result.removed).toBe(2);
  });
});
