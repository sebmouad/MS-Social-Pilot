import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
const config = vi.hoisted(() => ({ base: 'https://short.example', days: 365 }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'publishing.shortLinkBaseUrl': config.base, 'publishing.shortLinkRetentionDays': config.days, 'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000 })[key] }));
import { preparePublicationLinks, resolveShortLink, countShortLinkRequest } from '../src/modules/publishing/server/short-links';
import { GET, HEAD } from '../src/app/s/[slug]/route';
const input = { workspaceId: 'workspace', postId: 'post', targetId: 'channel', message: 'See https://example.com/a, https://example.com/ab and https://example.com/a.', link: 'https://example.com/a', settings: { utmSource: 'test', utmMedium: null, utmCampaignTemplate: null, shortenerEnabled: true } };
beforeEach(() => {
  vi.clearAllMocks(); config.base = 'https://short.example'; config.days = 365;
  db.$transaction.mockImplementation(work => work(db));
  db.$queryRaw.mockResolvedValue([]); db.$executeRaw.mockResolvedValue(1);
});
describe('publish-time links', () => {
  it('tags then shortens once per original URL, preserving punctuation and overlapping URLs', async () => {
    const out = await preparePublicationLinks(input);
    const inserts = db.$executeRaw.mock.calls;
    expect(inserts).toHaveLength(2);
    expect(inserts[0].slice(1)).toContain('https://example.com/a?utm_source=test');
    expect(inserts[0].slice(1)).toEqual(expect.arrayContaining(['workspace', 'post', 'channel']));
    const slugA = inserts[0][3], slugB = inserts[1][3];
    expect(out.message).toBe(`See https://short.example/s/${slugA}, https://short.example/s/${slugB} and https://short.example/s/${slugA}.`);
    expect(out.link).toBe(`https://short.example/s/${slugA}`);
  });
  it('reuses unexpired workspace/post/destination links under a transaction lock', async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ slug: 'existing' }]);
    const out = await preparePublicationLinks({ ...input, message: '', link: input.link });
    expect(out.link).toBe('https://short.example/s/existing');
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.$queryRaw.mock.calls[0][0].join('')).toContain(')::text');
    const query = db.$queryRaw.mock.calls[1];
    expect(query.slice(1)).toEqual(expect.arrayContaining(['workspace', 'post', 'channel', expect.any(Date)]));
  });
  it('keeps UTM-only behavior with shortening off and performs no storage/config work', async () => {
    const out = await preparePublicationLinks({ ...input, settings: { ...input.settings, shortenerEnabled: false } });
    expect(out.link).toBe('https://example.com/a?utm_source=test');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('publishes plain text without requiring a short-link origin', async () => {
    config.base = '';
    await expect(preparePublicationLinks({ ...input, message: 'Plain text', link: null })).resolves.toEqual({ message: 'Plain text', link: null });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('refuses missing configuration and storage failures before dispatch', async () => {
    config.base = '';
    await expect(preparePublicationLinks(input)).rejects.toMatchObject({ code: 'unavailable' });
    config.base = 'https://short.example'; db.$executeRaw.mockRejectedValue(new Error('storage'));
    await expect(preparePublicationLinks(input)).rejects.toThrow('storage');
  });
  it('does not nest its own links or shorten credential-bearing URLs', async () => {
    const out = await preparePublicationLinks({ ...input, message: 'https://short.example/s/existing https://user:pass@example.com/', link: null });
    expect(out.message).toContain('https://user:pass@example.com/');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});
describe('public redirect', () => {
  const context = { params: Promise.resolve({ slug: 'valid-slug' }) };
  const request = () => new Request('https://short.example/s/valid-slug', { headers: { 'user-agent': 'Mozilla/5.0' } });
  it('redirects directly without caching and atomically increments lifetime clicks', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 'link', targetUrl: 'https://example.com/?utm_source=test' }]);
    const out = await GET(request(), context);
    expect(out.status).toBe(302); expect(out.headers.get('location')).toBe('https://example.com/?utm_source=test');
    expect(out.headers.get('cache-control')).toContain('no-store');
    expect(db.$executeRaw.mock.calls[0][0].join('')).toContain('"clickCount"=sl."clickCount"+1');
  });
  it('does not count HEAD or crawlers', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 'link', targetUrl: 'https://example.com/' }]);
    expect((await HEAD(request(), context)).status).toBe(302);
    expect((await GET(new Request('https://short.example', { headers: { 'user-agent': 'previewbot' } }), context)).status).toBe(302);
    expect(countShortLinkRequest(null)).toBe(false);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects absent/expired/suspended links and invalid slugs without incrementing', async () => {
    expect((await GET(request(), context)).status).toBe(404);
    const sql = db.$queryRaw.mock.calls[0];
    expect(sql[0].join('')).toContain('w."suspendedAt" IS NULL');
    expect(sql.slice(1)).toContainEqual(expect.any(Date));
    await expect(resolveShortLink('../invalid', true)).resolves.toBeNull();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects unsafe stored destinations and concurrent expiry/deletion', async () => {
    for (const targetUrl of ['javascript:alert(1)', 'https://user:pass@example.com/', 'https://example.com/\r\n']) {
      db.$queryRaw.mockResolvedValue([{ id: 'link', targetUrl }]);
      expect((await GET(request(), context)).status).toBe(404);
    }
    db.$queryRaw.mockResolvedValue([{ id: 'link', targetUrl: 'https://example.com/' }]);
    db.$executeRaw.mockResolvedValue(0);
    expect((await GET(request(), context)).status).toBe(404);
  });
  it('reports database failures without exposing internal details', async () => {
    db.$queryRaw.mockRejectedValue(new Error('private database details'));
    const out = await GET(request(), context);
    expect(out.status).toBe(503); expect(await out.text()).not.toContain('private');
  });
});
