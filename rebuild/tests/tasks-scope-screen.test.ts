import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ viewer: vi.fn(), list: vi.fn(), scope: vi.fn(), copy: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/modules/shell/server/scope', () => ({ pageChannelScope: state.scope }));
vi.mock('@/modules/tasks/server/tasks', () => ({ listTasks: state.list }));
vi.mock('@/modules/tasks/server/copy', () => ({ loadCustomerCopy: state.copy }));
vi.mock('@/modules/tasks/ui/TaskBoard', () => ({ TaskBoard: () => null }));
import TasksPage from '@/modules/tasks/ui/TasksScreen';
import { customerCopy } from '@/modules/tasks/ui/copy';

const page = { tasks: [], assignees: [], assigneesHasMore: false, canCreate: true, limits: {}, today: '2026-10-20', summary: { todo: 0, doing: 0, done: 0, overdue: 0 }, hasMore: false, offset: 0, pageSize: 20, scopeHiddenUnlinked: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w', permissions: { pageScope: { all: true } } });
  state.copy.mockResolvedValue(customerCopy);
  state.list.mockResolvedValue(page);
  state.scope.mockResolvedValue({ ids: [], dropped: 0, source: 'none', channels: [] });
});

describe('Tasks channel scope', () => {
  it('accepts the shared channel parameter and narrows through the service', async () => {
    state.scope.mockResolvedValue({ ids: ['c1'], dropped: 0, source: 'url', channels: [] });
    state.list.mockResolvedValue({ ...page, scopeHiddenUnlinked: 2 });
    const html = renderToStaticMarkup(await TasksPage({ searchParams: Promise.resolve({ channel: 'c1' }) }));
    expect(state.list).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, expect.objectContaining({ channelIds: ['c1'], offset: 0 }));
    expect(html).toContain('Showing only tasks linked to the selected channels.');
    expect(html).toContain('2 tasks without a linked post are hidden by the channel scope.');
  });
  it('shows no notice without a scope', async () => {
    const html = renderToStaticMarkup(await TasksPage({ searchParams: Promise.resolve({}) }));
    expect(state.list).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w' }, expect.not.objectContaining({ channelIds: expect.anything() }));
    expect(html).not.toContain('Showing only tasks linked to the selected channels.');
  });
});
