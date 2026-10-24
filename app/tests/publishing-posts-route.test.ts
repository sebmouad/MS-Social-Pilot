import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), read: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/publishing/server/read', () => ({ readPublishingPostPage: state.read }));

import { GET } from '../src/app/api/publishing/posts/route';
import { OperationError } from '../src/lib/operation-error';

const viewer = { user: { id: 'user-a' }, workspaceId: 'workspace-a' };
const request = (query = '') => new Request(`http://localhost/api/publishing/posts${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer.mockResolvedValue(viewer);
  state.read.mockResolvedValue({ posts: [], total: 0, page: 1, pages: 1, channelUnavailable: false });
});

describe('Publishing posts HTTP read', () => {
  it('requires the current channel-scoped Publishing grant and returns no-store errors', async () => {
    state.viewer.mockRejectedValueOnce(new Error('private auth detail'));
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' });
    expect(state.viewer).toHaveBeenCalledWith({ feature: 'publishing/posts', channelScoped: true });
    expect(state.read).not.toHaveBeenCalled();
  });

  it('strictly rejects unknown, repeated, and malformed page query values before reading', async () => {
    for (const query of ['?extra=x', '?page=1&page=2', '?status=draft&status=published', '?channel=a&channel=b', '?q=a&q=b', '?page=0', '?page=01', '?page=1.5']) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
      expect(response.headers.get('cache-control'), query).toBe('no-store');
    }
    expect(state.read).not.toHaveBeenCalled();
  });

  it('forwards parsed filters with the authenticated workspace identity and ignores spoofed identity fields', async () => {
    const response = await GET(request('?page=3&status=partially_failed&channel=channel-a'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.read).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, { page: 3, status: 'partially_failed', channelId: 'channel-a' });
    expect((await response.json()).page).toBe(1);
  });

  it('preserves typed service failures and masks unexpected infrastructure details', async () => {
    state.read.mockRejectedValueOnce(new OperationError('forbidden', 'This channel is outside your current access.'));
    const denied = await GET(request('?channel=restricted'));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'This channel is outside your current access.', code: 'forbidden' });

    state.read.mockRejectedValueOnce(new Error('postgres://private-password@db access_token=private-token'));
    const failed = await GET(request());
    expect(failed.status).toBe(502);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await failed.json())).not.toMatch(/private-password|private-token|postgres:/);
  });

  it('passes literal search to the shared scoped reader without modifying its characters', async () => {
    const q = '100%_\\ Seasonal';
    const response = await GET(request(`?q=${encodeURIComponent(q)}&channel=channel-a`));
    expect(response.status).toBe(200);
    expect(state.read).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, { q, status: undefined, channelId: 'channel-a' });
    state.read.mockRejectedValueOnce(new OperationError('invalid_request', 'Search is too long. Shorten it and try again.'));
    const denied = await GET(request('?q=too-long'));
    expect(denied.status).toBe(400);
    expect(denied.headers.get('cache-control')).toBe('no-store');
    expect((await denied.json()).error).toContain('Shorten');
  });
});
