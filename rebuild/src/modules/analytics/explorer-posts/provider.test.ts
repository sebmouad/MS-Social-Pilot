import { beforeEach, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: query } }));
import { facebookPostPerformance, readFacebookPostPerformance } from '@/platforms/facebook/post-performance';
beforeEach(() => query.mockReset().mockResolvedValue([]));
it('retains additional stored numeric measures and leaves absent values unknown', () => {
  const result = facebookPostPerformance({ postId: 'p', message: 'Post', publishedAt: null, remoteUrl: null, insightsSyncedAt: null, insights: { impressions: 0, views_total: 50, comments: 'unknown', reactions: -1 } });
  expect(result.measures.find(m => m.key === 'views_total')?.value).toBe(50);
  expect(result.measures.find(m => m.key === 'impressions')?.value).toBe(0);
  expect(result.measures.find(m => m.key === 'comments')?.value).toBeNull();
  expect(result.measures.find(m => m.key === 'reach')?.labelFr).toBe('Portée');
});
it('sorts the complete stored population in SQL and binds offset, measure key and resource scope', async () => {
  await readFacebookPostPerformance({ workspaceId: 'w', targetId: 't', from: new Date('2026-01-01'), to: new Date('2026-02-01'), limit: 3001, offset: 2001, sort: 'reach', direction: 'asc' });
  const sql = query.mock.calls[0][0];
  expect(sql.text).toContain('ASC NULLS LAST'); expect(sql.text).not.toContain('LIMIT 2000');
  expect(sql.values).toEqual(expect.arrayContaining(['reach', 'w', 't', 3001, 2001]));
  expect(sql.text).toContain("= 'number' THEN CASE WHEN");
});
