import { describe, expect, it, vi } from 'vitest';
import { createFacebookEngine } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';
import { discoveryIncomplete } from '../src/modules/inbox/server/sync-bounds';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: [], adInsightFields: ['spend'], maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false,
};
const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
const next = (path: string, extra = '') => `https://graph.facebook.test/v99.0/${path}?after=${extra || 'cursor'}`;
const message = (id: string, at: string) => ({ id, message: `text ${id}`, created_time: at, from: { id: 'visitor-1', name: 'Visitor' } });
const comment = (id: string, parent: string | null, at: string, replies = 0, from = 'visitor-1') => ({ id, message: `text ${id}`, created_time: at, from: { id: from, name: from }, ...(parent ? { parent: { id: parent } } : {}), like_count: 0, comment_count: replies, is_hidden: false });

describe('Facebook inbox discovery', () => {
  it('follows message paging inside a conversation within the Root page bound', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/p1/conversations')) return json({ data: [{ id: 'c1', updated_time: '2026-01-03T00:00:00Z', message_count: 4, messages: { data: [message('m1', '2026-01-03T00:00:00Z')], paging: { next: next('c1/messages', 'one') } } }] });
      if (url.includes('after=one')) return json({ data: [message('m2', '2026-01-02T00:00:00Z')], paging: { next: next('c1/messages', 'two') } });
      if (url.includes('after=two')) return json({ data: [message('m3', '2026-01-01T00:00:00Z'), message('m1', '2026-01-03T00:00:00Z')] });
      return json({ data: [] });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);

    const complete = await engine.listInbox('token', 'p1', { messagePages: 3 });
    expect(complete[0].messages.map(item => item.id)).toEqual(['m1', 'm2', 'm3']);
    expect(complete.incomplete).toBeUndefined();

    const bounded = await engine.listInbox('token', 'p1', { messagePages: 1 });
    expect(bounded[0].messages.map(item => item.id)).toEqual(['m1', 'm2']);
    expect(bounded.incomplete).toBe(true);
    expect(discoveryIncomplete(bounded)).toBe(true);

    // Without a bound the first page is kept exactly as before.
    expect((await engine.listInbox('token', 'p1'))[0].messages.map(item => item.id)).toEqual(['m1']);
  });

  it('stops conversation paging at the Root bound instead of failing the sync', async () => {
    let served = 0;
    const fetcher = vi.fn(async () => {
      const page = ++served;
      return json({ data: [{ id: `c${page}`, updated_time: '2026-01-01T00:00:00Z', message_count: 0, messages: { data: [] } }], paging: { next: next('p1/conversations', `cursor${page}`) } });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    const bounded = await engine.listInbox('token', 'p1', { conversationPages: 2 });
    expect(bounded.map(item => item.id)).toEqual(['c1', 'c2']);
    expect(bounded.incomplete).toBe(true);
    // The strict legacy listing still refuses an unbounded walk past the configured Graph page limit.
    await expect(engine.listInbox('token', 'p1')).rejects.toThrow(/page limit/);
  });

  it('reads a reply thread directly when the stream lists fewer replies than counted, including replies to the Page’s own reply', async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      seen.push(url.pathname);
      if (url.pathname.endsWith('/post-1/comments')) return json({ data: [comment('top', null, '2026-01-01T00:00:00Z', 2), comment('page-reply', 'top', '2026-01-01T01:00:00Z', 1, 'page-1')] });
      if (url.pathname.endsWith('/top/comments')) return json({ data: [comment('page-reply', 'top', '2026-01-01T01:00:00Z', 1, 'page-1'), comment('visitor-reply', 'top', '2026-01-01T02:00:00Z', 0)] });
      if (url.pathname.endsWith('/page-reply/comments')) return json({ data: [comment('visitor-to-page', null, '2026-01-01T03:00:00Z', 0)] });
      return json({ data: [] });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);

    const comments = await engine.listComments('token', 'post-1', { replyExpansions: 5 });
    expect(comments.map(item => [item.id, item.parentId]).sort()).toEqual([['page-reply', 'top'], ['top', null], ['visitor-reply', 'top'], ['visitor-to-page', 'page-reply']]);
    expect(comments.incomplete).toBeUndefined();
    expect(seen.filter(path => path.endsWith('/comments')).length).toBe(3);

    // A thread whose count already matches is not read again, and a zero budget keeps the single listing.
    seen.length = 0;
    expect(await engine.listComments('token', 'post-1')).toHaveLength(2);
    expect(seen).toHaveLength(1);
  });

  it('reports incomplete discovery when the expansion budget runs out or an edge read fails', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/post-1/comments')) return json({ data: [comment('a', null, '2026-01-01T00:00:00Z', 1), comment('b', null, '2026-01-02T00:00:00Z', 1)] });
      if (url.pathname.endsWith('/b/comments')) return json({ data: [comment('b-reply', 'b', '2026-01-02T01:00:00Z')] });
      return json({ error: { message: 'Unsupported get request', code: 100 } });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);

    const limited = await engine.listComments('token', 'post-1', { replyExpansions: 1 });
    expect(limited.map(item => item.id).sort()).toEqual(['a', 'b', 'b-reply']);
    expect(limited.incomplete).toBe(true);

    const failing = await engine.listComments('token', 'post-1', { replyExpansions: 5 });
    expect(failing.map(item => item.id).sort()).toEqual(['a', 'b', 'b-reply']);
    expect(failing.incomplete).toBe(true);
  });

  it('rethrows cancellation instead of reporting a partial thread', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/post-1/comments')) return json({ data: [comment('a', null, '2026-01-01T00:00:00Z', 1)] });
      controller.abort();
      return json({ data: [] });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher, controller.signal);
    await expect(engine.listComments('token', 'post-1', { replyExpansions: 5 })).rejects.toThrow();
  });

  it('treats absent reads as complete', () => {
    expect(discoveryIncomplete()).toBe(false);
    expect(discoveryIncomplete(undefined, [] as { incomplete?: boolean }[] & { incomplete?: boolean })).toBe(false);
  });
});
