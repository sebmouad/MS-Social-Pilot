import { afterEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv } from './helpers/database';

/** What the live tests on a real Page turned up, held in place. */

afterEach(() => vi.unstubAllGlobals());

describe('reactions on a post', () => {
  it('count every kind, not only the thumbs-up', async () => {
    setTestEnv();
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        asked.push(String(url));
        return new Response(
          JSON.stringify({
            reactions: { summary: { total_count: 78 } },
            likes: { summary: { total_count: 64 } },
            comments: { summary: { total_count: 4 } },
            shares: { count: 9 },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const { fetchPostEngagement } = await import('../src/lib/facebook/analytics');
    const result = await fetchPostEngagement('page_post', 'token');
    expect(result.reactions).toBe(78);
    expect(decodeURIComponent(asked[0]!)).toContain('reactions.summary(total_count)');
  });
});

describe('a confirmation question', () => {
  it('splits a long one into a headline and what follows', async () => {
    const { splitQuestion } = await import('../src/components/ConfirmProvider');
    expect(splitQuestion({ title: 'Cancel this post? Anything already scheduled inside Facebook will be deleted there too.' })).toMatchObject({
      title: 'Cancel this post?',
      body: 'Anything already scheduled inside Facebook will be deleted there too.',
    });
    expect(splitQuestion({ title: 'Delete it?' })).toEqual({ title: 'Delete it?' });
  });
});
