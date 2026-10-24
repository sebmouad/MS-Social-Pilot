import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as unknown[], query: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: state.query } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 2 }));
vi.mock('@/platforms/instagram/locale', () => ({ instagramLocale: async () => 'fr' }));
vi.mock('@/platforms/instagram/runtime', async () => ({ configuredInstagramPolicy: async () => (await import('@/platforms/instagram/config')).INSTAGRAM_POLICY_DEFAULTS }));
import { instagramPublicationRecovery } from '@/platforms/instagram/container-recovery';
import { installedPublicationRecovery } from '@/server/platforms/publication-recovery';
beforeEach(() => { vi.clearAllMocks(); state.rows = []; state.query.mockImplementation(async () => state.rows); });
const tx = { $queryRaw: state.query } as unknown as Parameters<typeof instagramPublicationRecovery.assertOutcome>[0];
describe('Instagram child receipt recovery constraints', () => {
  it('allows only the exact recorded final media identity', async () => {
    state.rows = [{ state: 'recorded', remoteId: 'actual' }];
    await expect(instagramPublicationRecovery.assertOutcome(tx, 'workspace', 'op', 'PUBLISHED', 'actual')).resolves.toBeUndefined();
    await expect(instagramPublicationRecovery.assertOutcome(tx, 'workspace', 'op', 'PUBLISHED', 'other')).rejects.toMatchObject({ code: 'conflict' });
    await expect(instagramPublicationRecovery.assertOutcome(tx, 'workspace', 'op', 'ABSENT')).rejects.toMatchObject({ code: 'conflict' });
  });
  it('keeps unknown publish dispatches held without treating failed lookups as absence', async () => {
    state.rows = [{ state: 'started', remoteId: null }];
    await expect(instagramPublicationRecovery.assertOutcome(tx, 'workspace', 'op', 'ABSENT')).rejects.toMatchObject({ code: 'conflict' });
    await expect(instagramPublicationRecovery.assertOutcome(tx, 'workspace', 'op', 'PUBLISHED', 'guessed')).rejects.toMatchObject({ code: 'conflict' });
    await expect(instagramPublicationRecovery.assertSettled(tx, 'workspace', ['target'])).rejects.toMatchObject({ code: 'conflict' });
  });
  it('scopes child evidence through the parent tenant and operation', async () => {
    await instagramPublicationRecovery.assertOutcome(tx, 'workspace', 'op', 'ABSENT');
    expect(state.query.mock.calls[0]!.slice(1)).toEqual(['workspace', 'op']);
    expect(state.query.mock.calls[0]![0].join('')).toContain("a.provider='instagram'");
  });
  it('is installed in the shared publication-recovery registry', () => {
    expect(installedPublicationRecovery('instagram')).toBe(instagramPublicationRecovery);
    expect(installedPublicationRecovery('facebook')).toBeDefined();
    expect(installedPublicationRecovery('tiktok')).toBeUndefined();
  });
  it('caps content-free private evidence using runtime bounds and bilingual Root copy', async () => {
    state.rows = ['a', 'b', 'c'].map(id => ({ id, operationId: 'op', phase: 'container', state: 'recorded', remoteId: id, createdAt: new Date('2026-10-21') }));
    const result = await instagramPublicationRecovery.readEvidence();
    expect(result.items).toHaveLength(2); expect(result.truncated).toBe(true);
    expect(result.title).toBe('Preuves de publication Instagram');
    expect(result.items[0]).not.toHaveProperty('accessToken');
  });
});
