import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), config: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
import { readTopPostContent, reportUrl, type ReportTopPost } from '../src/modules/analytics/reports/server/top-post-content';
import { TOP_POST_CONTENT_DEFAULTS, TOP_POST_CONTENT_POLICY_SCHEMA } from '../src/modules/analytics/reports/config';
import { renderReport } from '../src/modules/analytics/reports/generation/document';
import { reportDocumentCopyDefaults } from '../src/modules/analytics/reports/generation/copy';
const period = { start: '2026-10-01', end: '2026-10-02' };
const ranked = { postId: 'p1', text: 'generic', publishedAt: new Date('2026-10-01T10:00Z'), url: 'https://social.example/post', measures: [], rankValue: 4, rankLabel: 'Engagement', measuredAt: null };
const stored = { postId: 'p1', text: '=destination <script>\nSecond line', media: [{ kind: 'image', url: 'https://cdn.example/image.jpg', storageKey: 'PRIVATE' }, { kind: 'video', url: 'https://cdn.example/video.mp4' }], link: 'https://article.example/', articleTitle: 'Article <b>', articleDescription: 'Description' };
beforeEach(() => { vi.clearAllMocks(); mocks.config.mockImplementation(async key => key === 'app.publicOrigin' ? 'https://app.example' : TOP_POST_CONTENT_DEFAULTS); mocks.query.mockResolvedValue([stored]); });
describe('scoped ranked post content', () => {
  it('keeps destination text, attachment order and article metadata without private storage fields', async () => {
    const out = await readTopPostContent('w', 'c', period, [ranked]);
    expect(out[0].text).toBe(stored.text);
    expect(out[0].content).toMatchObject({ text: stored.text, media: [{ kind: 'image', url: 'https://cdn.example/image.jpg' }, { kind: 'video', url: 'https://cdn.example/video.mp4' }], articleTitle: 'Article <b>', link: 'https://article.example/' });
    expect(JSON.stringify(out)).not.toContain('PRIVATE');
    const [sql, ...args] = mocks.query.mock.calls[0]; const text = sql.join('?');
    for (const clause of ['pt."messageOverride"', 'pt."skipMedia"', 'p."workspaceId" =', 'pt."targetId" =', 't."workspaceId" = p."workspaceId"', "pt.status = 'published'", 'pt."publishedAt" >=', 'pt."publishedAt" <', 'ANY(', 'WITH ORDINALITY', 'LIMIT']) expect(text).toContain(clause);
    expect(args).toContain('w'); expect(args).toContain('c'); expect(args).toContainEqual(['p1']); expect(args).toContainEqual(new Date('2026-10-03T00:00Z'));
  });
  it('maps local image references to the Root-configured authenticated media URL and discloses inaccessible references', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    mocks.query.mockResolvedValue([{ ...stored, media: [{ kind: 'image', url: `media:${id}` }] }]);
    expect((await readTopPostContent('w', 'c', period, [ranked]))[0].content!.media[0].url).toBe(`https://app.example/api/media/${id}`);
    mocks.config.mockImplementation(async key => key === 'app.publicOrigin' ? '' : TOP_POST_CONTENT_DEFAULTS);
    const missing = (await readTopPostContent('w', 'c', period, [ranked]))[0].content!;
    expect(missing.media).toEqual([]); expect(missing.shortened).toBe(true);
  });
  it('drops destinations no longer published or present; never falls back to adapter text', async () => {
    mocks.query.mockResolvedValue([]);
    expect(await readTopPostContent('w', 'c', period, [ranked])).toEqual([]);
  });
  it('uses Root bounds, discloses content cuts, removes unsafe URLs and ignores unknown attachment types', async () => {
    mocks.config.mockResolvedValue({ ...TOP_POST_CONTENT_DEFAULTS, textCharacters: 120, mediaPerPost: 1, previewCharacters: 20 });
    mocks.query.mockResolvedValue([{ ...stored, text: 'x'.repeat(121), articleTitle: 'a'.repeat(21), media: [{ kind: 'image', url: 'javascript:alert(1)' }, { kind: 'video', url: 'https://cdn.example/v' }], link: 'https://user:password@article.example' }]);
    const out = await readTopPostContent('w', 'c', period, [{ ...ranked, url: 'data:text/html,hi' }]);
    expect(out[0].content).toMatchObject({ shortened: true, media: [], link: null, text: 'x'.repeat(119) + '…', articleTitle: 'a'.repeat(19) + '…' }); expect(out[0].url).toBeNull();
    expect(TOP_POST_CONTENT_POLICY_SCHEMA.safeParse({ ...TOP_POST_CONTENT_DEFAULTS, posts: 0 }).success).toBe(false);
    mocks.config.mockResolvedValue({ posts: 0 }); mocks.query.mockClear();
    await expect(readTopPostContent('w', 'c', period, [ranked])).rejects.toThrow(); expect(mocks.query).not.toHaveBeenCalled();
  });
  it('clips whole Unicode characters within the configured content ceiling', async () => {
    mocks.config.mockImplementation(async key => key === 'app.publicOrigin' ? '' : { ...TOP_POST_CONTENT_DEFAULTS, textCharacters: 120 });
    mocks.query.mockResolvedValue([{ ...stored, text: '😀'.repeat(121) }]);
    const text = (await readTopPostContent('w', 'c', period, [ranked]))[0].content!.text;
    expect([...text]).toHaveLength(120); expect(text).toBe('😀'.repeat(119) + '…'); expect(text).not.toContain('�');
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', '//host/path', 'https://user:pass@host/', 'data:image/png,hi'])('refuses unsafe URL %s', value => expect(reportUrl(value)).toBeNull());
});
describe('shared report artifacts', () => {
  const snapshot = { period, allMetrics: [], audience: null, publishing: { published: 1, scheduled: 0, failed: 0 } };
  const render = (posts: ReportTopPost[], locale: 'en' | 'fr', maxRows = 100, maxBytes = 30000, sections: Array<'topPosts' | 'audience'> = ['topPosts']) => renderReport(snapshot as never, { channelName: 'C', sections, generatedAt: new Date(0), topPosts: posts }, { maxRows, maxBytes }, reportDocumentCopyDefaults[locale], locale);
  it.each(['en', 'fr'] as const)('exposes all three content capabilities through CSV/JSON/HTML/text in %s', async locale => {
    const out = render(await readTopPostContent('w', 'c', period, [ranked]), locale);
    expect(out.csv).toContain("'=destination"); expect(out.html).toContain('&lt;script&gt;'); expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('<details>'); expect(out.html).toContain('<img loading="lazy" referrerpolicy="no-referrer"'); expect(out.html).toContain('https://cdn.example/image.jpg'); expect(out.html).toContain('https://article.example/');
    expect(out.text).toContain(stored.text); expect(out.text).toContain('Description');
    expect(out.html).toContain(locale === 'fr' ? 'Contenu de la publication' : 'Post content');
    const records = JSON.parse(out.json!).records;
    expect(records.map((r: { record_type: string }) => r.record_type)).toEqual(expect.arrayContaining(['top_post_content', 'top_post_media', 'top_post_link']));
    expect(out.truncated).toBe(false);
  });
  it('allows Root to disable embedded image previews while retaining attachment links', async () => {
    mocks.config.mockImplementation(async key => key === 'app.publicOrigin' ? '' : { ...TOP_POST_CONTENT_DEFAULTS, imagePreviews: false });
    const out = render(await readTopPostContent('w', 'c', period, [ranked]), 'en');
    expect(out.html).not.toContain('<img '); expect(out.html).toContain('https://cdn.example/image.jpg');
  });
  it('respects byte/record ceilings, discloses content clipping and excludes unselected sections', async () => {
    const posts = await readTopPostContent('w', 'c', period, [ranked]); posts[0].content!.shortened = true;
    const out = render(posts, 'en', 2, 1500);
    expect(out.rowCount).toBeLessThanOrEqual(2); expect(JSON.parse(out.json!).records.length).toBeLessThanOrEqual(2);
    for (const value of [out.csv, out.json!, out.html, out.text]) expect(Buffer.byteLength(value)).toBeLessThanOrEqual(1500);
    expect(out.truncated).toBe(true); expect(JSON.parse(out.json!).truncated).toBe(true);
    const omitted = render(posts, 'en', 100, 30000, ['audience']); expect(omitted.html).not.toContain('destination'); expect(omitted.csv).not.toContain('top_post_content');
  });
});
