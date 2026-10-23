// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { inboxListRows } from '../src/modules/inbox/ui/InboxListRows';
import { InboxSelectionProvider } from '../src/modules/inbox/ui/InboxSelection';
import { inboxCustomerCopy } from '../src/modules/inbox/customer-copy';

const abilities = new Map([['t1', { write: true, resolve: true, hide: true, remove: true }]]);
const item = (over: Record<string, unknown> = {}) => ({
  key: 'comment:c1', kind: 'comment', id: 'c1', author: 'Jane', preview: 'Great post!',
  time: new Date('2026-10-19T10:00:00Z'), target: { id: 't1', name: 'Page', provider: 'facebook' },
  unread: 0, needsReply: false, resolved: false, hidden: false,
  context: 'Our launch announcement text', sentiment: null, ...over,
});
const page = (items: Array<Record<string, unknown>>) => ({ items, timeZone: 'UTC', cursor: null }) as never;
const html = (items: Array<Record<string, unknown>>, locale: 'en' | 'fr' = 'en', canOpenPosts = false) => {
  const rows = inboxListRows(page(items), abilities as never, {}, undefined, locale, inboxCustomerCopy, 140, canOpenPosts);
  const selectables = rows.flatMap(row => row.selectable ? [row.selectable] : []);
  return renderToStaticMarkup(createElement(InboxSelectionProvider, { pageItems: selectables, children: createElement('ul', null, rows.map(row => row.content)) }));
};

describe('inbox comment rows', () => {
  it('shows the origin post excerpt under the comment', () => {
    const out = html([item()]);
    expect(out).toContain('On your post');
    expect(out).toContain('Our launch announcement');
  });
  it('shows the origin post excerpt in French', () => {
    const out = html([item()], 'fr');
    expect(out).toContain('Sur votre publication');
  });
  it('falls back to a no-text line when the comment has no text', () => {
    const out = html([item({ preview: '' })]);
    expect(out).toContain('No text in this comment.');
  });
  it('shows no origin line for messages', () => {
    const out = html([item({ key: 'message:m1', kind: 'message', id: 'm1', context: null })]);
    expect(out).not.toContain('On your post');
  });
  it('links the origin post outside the thread anchor for post readers', () => {
    const out = html([item({ postId: 'p1' })], 'en', true);
    expect(out).toContain('href="/content/post/p1"');
    expect(out).toContain('>Open post<');
    expect(out).toMatch(/<\/a><a[^>]*content\/post\/p1/);
  });
  it('shows the origin link in French', () => {
    const out = html([item({ postId: 'p1' })], 'fr', true);
    expect(out).toContain('>Ouvrir la publication<');
  });
  it('shows no origin link without a post, without access, or for messages', () => {
    expect(html([item({ postId: null })], 'en', true)).not.toContain('content/post');
    expect(html([item({ postId: 'p1' })])).not.toContain('content/post');
    expect(html([item({ key: 'message:m1', kind: 'message', id: 'm1', context: null, postId: 'p1' })], 'en', true)).not.toContain('content/post');
  });
});
