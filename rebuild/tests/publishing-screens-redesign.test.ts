import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AvatarStack, EmptyPanel, FilterChips, ModuleHeader, ScheduleBadge } from '@/modules/publishing/ui/kit/kit';
import { ChannelsCell, PostCell, StatusCell } from '@/modules/publishing/ui/posts/PostTableCells';
import { PageHeading } from '@/modules/publishing/ui/publishing-ui';

const target = (id: string, name: string, status = 'published') => ({ status, target: { id, name, pictureUrl: null as string | null } });
const row = (overrides: Record<string, unknown> = {}) => ({
  message: 'Launch day', link: null, media: [{ kind: 'image', url: 'https://cdn.example.test/a.jpg', altText: 'Cover' }, { kind: 'image', url: 'https://cdn.example.test/b.jpg' }],
  status: 'scheduled', scheduledAt: new Date('2026-10-21T10:00:00Z'), publishedAt: null, targets: [target('c1', 'Studio', 'scheduled')], ...overrides,
}) as Parameters<typeof PostCell>[0]['post'];

describe('publishing screen kit', () => {
  it('renders the module header with its icon chip, module token and actions', () => {
    const html = renderToStaticMarkup(createElement(PageHeading, { title: 'Posts', description: 'Review delivery.', href: '/publishing/posts', summary: '3 posts', actions: createElement('a', { href: '/publishing/compose' }, 'New post') }));
    expect(html).toContain('data-module="publishing"');
    expect(html).toContain('<h1>Posts</h1>');
    expect(html).toContain('3 posts');
    expect(html).toContain('New post');
    expect(html).toContain('<svg');
  });

  it('renders an empty panel with one next action', () => {
    const html = renderToStaticMarkup(createElement(EmptyPanel, { title: 'No posts yet', action: createElement('a', { href: '/publishing/compose' }, 'New post') }, 'Write your first post.'));
    expect(html).toContain('No posts yet');
    expect(html).toContain('Write your first post.');
    expect(html).toContain('href="/publishing/compose"');
  });

  it('explains who sends a scheduled post in both languages', () => {
    const app = renderToStaticMarkup(createElement(ScheduleBadge, { mode: 'application' }));
    const remote = renderToStaticMarkup(createElement(ScheduleBadge, { mode: 'remote', locale: 'fr' }));
    expect(app).toContain('>App<');
    expect(app).toContain('Sent by this app');
    expect(remote).toContain('>Plateforme<');
    expect(remote).toContain('publiée là-bas');
    expect(renderToStaticMarkup(createElement(ScheduleBadge, { mode: 'remote', platformName: 'Example' }))).toContain('>Example<');
  });

  it('removes one filter at a time with the shared chips and offers a reset', () => {
    const html = renderToStaticMarkup(createElement(FilterChips, { resetHref: '/publishing/posts', chips: [{ key: 'status', label: 'Status', value: 'Failed', removeHref: '/publishing/posts?q=a' }] }));
    expect(html).toContain('ui-filter-chip');
    expect(html).toContain('aria-label="Remove filter: Status Failed"');
    expect(html).toContain('Reset filters');
    expect(renderToStaticMarkup(createElement(FilterChips, { resetHref: '/x', chips: [] }))).not.toContain('Reset');
  });

  it('stacks channel avatars with a counter and readable names', () => {
    const channels = ['A one', 'B two', 'C three', 'D four', 'E five'].map((name, index) => ({ id: `c${index}`, name }));
    const html = renderToStaticMarkup(createElement(AvatarStack, { channels, max: 3 }));
    expect(html).toContain('+2');
    expect(html).toContain('A one, B two, C three');
    expect(renderToStaticMarkup(createElement(AvatarStack, { channels: [], locale: 'fr' }))).toContain('Aucune destination');
  });

  it('renders a module header without an icon href', () => {
    expect(renderToStaticMarkup(createElement(ModuleHeader, { module: 'inbox', title: 'Inbox' }))).toContain('data-module="inbox"');
  });
});

describe('posts table cells', () => {
  it('shows a thumbnail, summary and attachment count', () => {
    const html = renderToStaticMarkup(createElement(PostCell, { post: row() }));
    expect(html).toContain('src="https://cdn.example.test/a.jpg"');
    expect(html).toContain('Launch day');
    expect(html).toContain('+1');
    expect(html).toContain('2 media');
  });

  it('never renders an unsafe thumbnail address', () => {
    const html = renderToStaticMarkup(createElement(PostCell, { post: row({ media: [{ kind: 'image', url: 'javascript:alert(1)' }] }) }));
    expect(html).not.toContain('javascript:');
  });

  it('badges app scheduling versus platform-held scheduling', () => {
    expect(renderToStaticMarkup(createElement(StatusCell, { post: row() }))).toContain('>App<');
    const held = row({ targets: [target('c1', 'Studio', 'scheduled_remote')] });
    expect(renderToStaticMarkup(createElement(StatusCell, { post: held }))).toContain('>Platform<');
  });

  it('summarises per-destination outcomes and flags failures', () => {
    const mixed = row({ status: 'partially_failed', scheduledAt: null, targets: [target('c1', 'Studio'), target('c2', 'Shop', 'failed')] });
    const html = renderToStaticMarkup(createElement(StatusCell, { post: mixed }));
    expect(html).toContain('1/2');
    expect(html).toContain('Needs attention');
    expect(html).not.toContain('>App<');
  });

  it('lists distinct channels once', () => {
    const dup = row({ targets: [target('c1', 'Studio'), target('c1', 'Studio')] });
    expect(renderToStaticMarkup(createElement(ChannelsCell, { post: dup }))).not.toContain('+');
  });
});
