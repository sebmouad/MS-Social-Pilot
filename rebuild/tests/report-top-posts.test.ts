import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));

import { facebookPostPerformance, readFacebookPostPerformance } from '../src/platforms/facebook/post-performance';
import { renderReport } from '../src/modules/analytics/reports/generation/document';

const row = (id: string, insights: unknown, day = 1) => ({ postId: id, message: id === 'x' ? '=cmd' : `Post ${id}`, publishedAt: new Date(Date.UTC(2026, 9, day)), remoteUrl: 'https://facebook.com/p/' + id, insights, insightsSyncedAt: null });

describe('Facebook post performance', () => {
  it('ranks by reactions + comments + shares and keeps missing measures unknown', () => {
    const p = facebookPostPerformance(row('a', { reactions: 2, comments: null, shares: 3, impressions: 10 }));
    expect(p.rankValue).toBe(5); expect(p.rankLabel).toBe('Engagement');
    expect(p.measures.find(m => m.key === 'comments')!.value).toBeNull();
    expect(facebookPostPerformance(row('b', null)).rankValue).toBeNull();
    expect(facebookPostPerformance({ ...row('c', {}), remoteUrl: 'javascript:alert(1)' }).url).toBeNull();
  });
  it('reads workspace-bound published rows and returns the best first, bounded', async () => {
    db.$queryRaw.mockResolvedValue([row('low', { reactions: 1 }, 3), row('none', null, 4), row('high', { reactions: 9 }, 2)]);
    const out = await readFacebookPostPerformance({ workspaceId: 'w1', targetId: 't1', from: new Date(0), to: new Date(), limit: 2 });
    expect(out.map(p => p.postId)).toEqual(['high', 'low']);
    const sql = db.$queryRaw.mock.calls[0]!.join(' ');
    expect(sql).toContain(`t."workspaceId" =`); expect(sql).toContain(`pt.status = 'published'`);
  });
});

describe('top posts report section', () => {
  const snap = { period: { start: '2026-10-01', end: '2026-10-31' }, allMetrics: [], audience: null, publishing: { published: 1, scheduled: 0, failed: 0 } };
  const bounds = { maxRows: 100, maxBytes: 20000 };
  it('renders ranked posts, escapes text and guards spreadsheet formulas', () => {
    const posts = [facebookPostPerformance(row('a', { reactions: 4 })), facebookPostPerformance({ ...row('x', { reactions: 1 }), message: '=cmd <b>' })];
    const out = renderReport(snap as never, { channelName: 'P', sections: ['topPosts'], generatedAt: new Date(), topPosts: posts }, bounds);
    expect(out.sections).toEqual(['topPosts']); expect(out.notIncluded).toEqual([]);
    expect(out.html).toContain('<h2>Top posts</h2>'); expect(out.html).toContain('&lt;b&gt;'); expect(out.html).toContain('href="https://facebook.com/p/a"');
    expect(out.csv).toContain(`"'=cmd <b>"`);
    expect(out.text).toContain('1. Post a');
  });
  it('says so honestly when nothing is stored', () => {
    const out = renderReport(snap as never, { channelName: 'P', sections: ['topPosts'], generatedAt: new Date(), topPosts: [] }, bounds);
    expect(out.html).toContain('No published posts with stored measures');
  });
});
