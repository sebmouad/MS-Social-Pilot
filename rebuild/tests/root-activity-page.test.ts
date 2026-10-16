import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ requireRootPage: async () => ({ id: 'root' }) }));
vi.mock('../src/server/root/activity', () => ({ listRootActivity: state.list }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'root.activityPageSize' ? 50 : 200 }));
vi.mock('../src/server/root/RootFrame', () => ({ RootFrame: 'main' }));
vi.mock('../src/components/SidebarDock', () => ({ SidebarDock: 'aside' }));
import Page from '../src/app/root/activity/page';
import { OperationError } from '../src/lib/operation-error';
const page = { items: [], filters: { q: '', workspaceId: '', from: '', to: '' }, limit: 50, configuredLimit: 50, searchCharacters: 200, olderCursor: null, newerCursor: null };
beforeEach(() => { vi.clearAllMocks(); state.list.mockResolvedValue(page); });
describe('Root activity work surface', () => {
  it('keeps filters and pagination in the sidebar and renders explicit UTC records', async () => {
    state.list.mockResolvedValue({ ...page, olderCursor: 'older-value', newerCursor: 'newer-value', items: [{ id: 'event-a', action: 'config.changed', createdAt: new Date('2026-10-16T12:00:00Z'), actor: { name: 'Owner', email: 'owner@example.test' }, metadata: ['3 posts'] }] });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'config', limit: '2' }) }));
    expect(html).toMatch(/<aside>[\s\S]*name="q"[\s\S]*name="workspaceId"[\s\S]*name="from"[\s\S]*name="to"[\s\S]*Newer activity[\s\S]*Older activity[\s\S]*<\/aside>/);
    expect(html).toContain('2026-10-16 12:00:00 UTC');
    expect(html).toContain('Showing 1 recorded event.');
    expect(state.list).toHaveBeenCalledWith('root', { q: 'config', limit: 2 });
  });
  it('distinguishes no history, no matches and a page whose records changed', async () => {
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).toContain('No activity recorded');
    state.list.mockResolvedValueOnce({ ...page, filters: { ...page.filters, q: 'missing' } });
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'missing' }) }))).toContain('No activity matches these filters');
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ cursor: 'old-cursor' }) }))).toContain('No activity on this page');
  });
  it('preserves filters with useful invalid/unavailable recovery and no internal error detail', async () => {
    state.list.mockRejectedValueOnce(new OperationError('invalid_request', 'Invalid cursor'));
    const invalid = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: 'root', cursor: 'broken' }) }));
    expect(invalid).toContain('Check activity filters');
    expect(invalid).toContain('value="root"');
    expect(invalid).toContain('Reset to latest activity');
    state.list.mockRejectedValueOnce(new Error('postgres://private-password@host'));
    const failure = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(failure).toContain('Activity is unavailable');
    expect(failure).not.toContain('private-password');
  });
});
