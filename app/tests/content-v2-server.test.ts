import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  readQuery: vi.fn(), count: vi.fn(), channels: vi.fn(), scope: vi.fn(), allowed: new Set<string>(),
}));
vi.mock('../src/modules/publishing/server/read-query', () => ({ publishingPostReadQuery: h.readQuery }));
vi.mock('../src/server/data', () => ({ prisma: { post: { count: h.count } } }));
vi.mock('../src/modules/shell/server/channels', () => ({ shellChannels: h.channels }));
vi.mock('../src/modules/shell/server/chrome', async () => {
  const { SHELL_COPY, SHELL_POLICY } = await import('../src/modules/shell/copy');
  return { shellChrome: async () => ({ copy: SHELL_COPY.en, policy: SHELL_POLICY, locale: 'en' }) };
});
vi.mock('../src/server/context', () => ({ requestChannelScope: h.scope }));
vi.mock('../src/server/entitlements', () => ({ canUseFeature: (_entitlements: unknown, id: string) => h.allowed.has(id) }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: (_permissions: unknown, id: string) => h.allowed.has(id) }));
vi.mock('../src/modules/publishing/server/content-copy', async () => {
  const { contentCopyDefaults, contentPolicyDefaults, resolveContentCopy } = await import('../src/modules/publishing/ui/content-copy');
  return { loadContent: async () => ({ copy: resolveContentCopy(contentCopyDefaults as never, 'en'), policy: contentPolicyDefaults, locale: 'en' }) };
});

import { pendingApprovalCount } from '../src/modules/publishing/server/approvals-badge';
import { pageChannelScope } from '../src/modules/shell/server/scope';
import { LibraryHeader } from '../src/modules/publishing/ui/library/LibraryHeader';
import { QueueSent } from '../src/modules/publishing/ui/queue/QueueSent';
import { publishingCopyDefaults, resolvePublishingCopy } from '../src/modules/publishing/ui/kit/copy';

beforeEach(() => { vi.clearAllMocks(); h.allowed = new Set(); });

describe('Approvals tab badge', () => {
  it('counts the posts the Approvals list itself would show', async () => {
    h.readQuery.mockResolvedValue({ where: { AND: ['scoped'] } });
    h.count.mockResolvedValue(4);
    await expect(pendingApprovalCount({ userId: 'u', workspaceId: 'w' })).resolves.toBe(4);
    expect(h.readQuery).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, { status: 'pending_approval' }, 'publishing/approvals');
    expect(h.count).toHaveBeenCalledWith({ where: { AND: ['scoped'] } });
  });
  it('shows no badge, instead of failing the page, when the read is refused or errors', async () => {
    h.readQuery.mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
    await expect(pendingApprovalCount({ userId: 'u', workspaceId: 'w' })).resolves.toBe(0);
    expect(h.count).not.toHaveBeenCalled();
    h.readQuery.mockResolvedValue({ where: {} });
    h.count.mockRejectedValue(new Error('database down'));
    await expect(pendingApprovalCount({ userId: 'u', workspaceId: 'w' })).resolves.toBe(0);
  });
});

describe('page channel scope', () => {
  const viewer = (all: boolean) => ({ workspaceId: 'w1', permissions: { pageScope: all ? { all: true as const } : { all: false as const, ids: ['c1'] } } });
  it('reduces the URL or remembered scope to the channels the member can see and passes the member limit to the list', async () => {
    h.channels.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    h.scope.mockResolvedValue({ ids: ['c1'], dropped: 1, source: 'url' });
    const result = await pageChannelScope(viewer(false), { channel: 'c1,zzz' });
    expect(h.channels).toHaveBeenCalledWith('w1', ['c1'], expect.any(Number));
    expect(h.scope).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1' }), { channel: 'c1,zzz' }, ['c1', 'c2'], 'sp_scope_');
    expect(result).toMatchObject({ ids: ['c1'], dropped: 1, source: 'url' });
    expect(result.channels).toHaveLength(2);
  });
  it('lists every channel for a member without a channel limit', async () => {
    h.channels.mockResolvedValue([]);
    h.scope.mockResolvedValue({ ids: [], dropped: 0, source: 'none' });
    await pageChannelScope(viewer(true), {});
    expect(h.channels).toHaveBeenCalledWith('w1', undefined, expect.any(Number));
  });
});

describe('Library header', () => {
  const viewer = { entitlements: {}, permissions: {} } as never;
  const html = async (active: 'media' | 'templates' | 'labels' | 'fields') => renderToStaticMarkup(await LibraryHeader({ active, viewer }) as never);
  it('offers only the sections the viewer can use, always keeping the current one, and marks it', async () => {
    h.allowed = new Set(['publishing/media', 'publishing/templates']);
    const markup = await html('media');
    expect(markup).toContain('>Library<');
    expect(markup).toContain('href="/content/library"');
    expect(markup).toContain('href="/content/library/templates"');
    expect(markup).not.toContain('href="/content/library/labels"');
    expect(markup).not.toContain('href="/content/feeds"');
    expect(markup).toMatch(/href="\/content\/library"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/content\/library"/);
  });
  it('keeps a section reachable when it is the one being viewed, and describes it', async () => {
    h.allowed = new Set(['publishing/media']);
    const markup = await html('labels');
    expect(markup).toContain('href="/content/library/labels"');
    expect(markup).toContain('About Labels');
    // A lone section needs no tab row.
    h.allowed = new Set();
    expect(await html('labels')).not.toContain('ui-tabs');
  });
});

describe('Queue sent block', () => {
  const en = resolvePublishingCopy(publishingCopyDefaults).en;
  const copy = { title: en.queueSentTitle, body: en.queueSentBody, reviewSent: en.queueReviewSent, reviewFailed: en.queueReviewFailed };
  const show = (published: number, failed: number) => renderToStaticMarkup(createElement(QueueSent, {
    copy, published, failed, sentHref: '/content?status=published&channel=c1', failedHref: '/content?status=failed&channel=c1',
  }));
  it('separates sent and failed posts from the up-next queue and keeps the channel scope in both links', () => {
    const markup = show(4, 1);
    expect(markup).toContain('>Sent</h2>');
    expect(markup).toContain('stay under Posts');
    expect(markup).toContain('href="/content?status=published&amp;channel=c1"');
    expect(markup).toContain('href="/content?status=failed&amp;channel=c1"');
    expect(markup).toContain('Review sent posts');
    expect(markup).toContain('Review failed posts');
  });
  it('hides the failed link when nothing failed, and the whole block when nothing went out', () => {
    const sentOnly = show(2, 0);
    expect(sentOnly).toContain('Review sent posts');
    expect(sentOnly).not.toContain('Review failed posts');
    expect(show(0, 0)).toBe('');
  });
});
