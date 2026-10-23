import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { instantFormatter } from '../src/server/instant-labels';
import { PostsTable } from '../src/modules/analytics/ui/posts/PostsTable';
import { postsTableRows } from '../src/modules/analytics/ui/posts/rows';

const measures = [{ key: 'views', label: 'Views' }];
const item = (postId: string) => ({
  channelId: 'a', channelName: 'Page A', postId, text: `Post ${postId}`, url: `https://provider.example/${postId}`,
  publishedAt: new Date('2026-10-05T14:30:00.000Z'), measuredAt: null, measures: [{ key: 'views', value: 12 }],
});
const instants = instantFormatter('UTC', 'en');

describe('explorer internal post links', () => {
  it('adds postHref only for mapped rows', () => {
    const rows = postsTableRows([item('r1'), item('r9')], instants, new Map([[JSON.stringify(['a', 'r1']), 'p1']]));
    expect(rows[0].postHref).toBe('/content/post/p1');
    expect(rows[1].postHref).toBeUndefined();
    expect(postsTableRows([item('r1')], instants)[0].postHref).toBeUndefined();
  });

  it('renders the internal link in English and French', () => {
    const rows = postsTableRows([item('r1'), item('r9')], instants, new Map([[JSON.stringify(['a', 'r1']), 'p1']]));
    const en = renderToStaticMarkup(createElement(PostsTable, { rows, measures, locale: 'en' }));
    expect(en).toContain('href="/content/post/p1"');
    expect(en).toContain('>Open in Posts<');
    expect(en.match(/Open in Posts/g)).toHaveLength(1);
    const fr = renderToStaticMarkup(createElement(PostsTable, { rows, measures, locale: 'fr' }));
    expect(fr).toContain('>Ouvrir dans Publications<');
  });

  it('keeps the external provider link alongside', () => {
    const rows = postsTableRows([item('r1')], instants, new Map([[JSON.stringify(['a', 'r1']), 'p1']]));
    const html = renderToStaticMarkup(createElement(PostsTable, { rows, measures, locale: 'en' }));
    expect(html).toContain('href="https://provider.example/r1"');
    expect(html).toContain('target="_blank"');
  });
});
