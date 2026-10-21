import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostsTable } from '../src/modules/analytics/ui/posts/PostsTable';

const measures = Array.from({ length: 17 }, (_, index) => ({ key: `m${index}`, label: `Measure ${index}` }));
const rows = [{ key: 'a:1', text: 'Launch', url: null, channelName: 'Page A', publishedAt: '2026-10-05T14:30:00.000Z', measuredAt: '2026-10-06T08:00:00.000Z', measures: { ...Object.fromEntries(measures.map(m => [m.key, null])), m3: 12, m5: 0 } }];

describe('post explorer table', () => {
  const html = renderToStaticMarkup(createElement(PostsTable, { rows, measures, locale: 'en' }));
  it('offers only measures with a stored value on the page and shows no all-dash columns', () => {
    expect(html).toContain('Measure 3'); expect(html).toContain('Measure 5');
    for (const unused of [0, 1, 2, 4, 6, 16]) expect(html).not.toContain(`Measure ${unused}<`);
  });
  it('shows human-readable dates, never ISO text', () => {
    expect(html).not.toContain('>2026-10-05T14:30');
    expect(html).toMatch(/Oct (5|6), 2026/); expect(html).not.toContain(' UTC');
    expect(html).toContain('dateTime="2026-10-05T14:30:00.000Z"');
  });
});
