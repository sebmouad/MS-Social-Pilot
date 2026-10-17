import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), export: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/modules/publishing/server/export', () => ({ exportPublishingPosts: mocks.export }));

import { GET } from '../src/app/api/publishing/posts/export/route';
import { OperationError } from '../src/lib/operation-error';

const viewer = { user: { id: 'user-a' }, workspaceId: 'workspace-a' };
const result = { format: 'ms-social-pilot-posts-csv', version: 1, csv: 'id,message\r\np-1,Hello\r\n', fileName: 'posts.csv',
  postCount: 1, byteLength: Buffer.byteLength('id,message\r\np-1,Hello\r\n'), generatedAt: '2026-10-17T12:00:00.000Z', filters: { q: 'hello' }, channelUnavailable: false };
const request = (query = '') => new Request(`http://localhost/api/publishing/posts/export${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue(viewer);
  mocks.export.mockResolvedValue(result);
});

describe('Publishing posts CSV export HTTP', () => {
  it('requires channel-scoped Publishing read access and returns a fixed-name UTF-8 attachment', async () => {
    const response = await GET(request('?q=hello&status=published&channel=channel-a'));
    expect(mocks.viewer).toHaveBeenCalledWith({ feature: 'publishing/posts', channelScoped: true });
    expect(mocks.export).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, { q: 'hello', status: 'published', channelId: 'channel-a' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="posts.csv"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-msp-export-format')).toBe('posts-v1');
    expect(response.headers.get('x-msp-post-count')).toBe('1');
    expect(response.headers.get('x-msp-export-bytes')).toBe(String(result.byteLength));
    expect(await response.text()).toBe(result.csv);
  });

  it('rejects unknown and duplicate query parameters before calling the service', async () => {
    for (const query of ['?workspaceId=other', '?q=a&q=b', '?channel=one&channel=two']) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ code: 'invalid_request' });
    }
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('returns a safe 401 when viewer authorization fails', async () => {
    mocks.viewer.mockRejectedValueOnce(new Error('private session details'));
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' });
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('preserves typed service failures and masks unexpected details', async () => {
    mocks.export.mockRejectedValueOnce(new OperationError('invalid_request', 'Narrow your filters and try again.'));
    const bounded = await GET(request());
    expect(bounded.status).toBe(400);
    expect(await bounded.json()).toEqual({ error: 'Narrow your filters and try again.', code: 'invalid_request' });

    mocks.export.mockRejectedValueOnce(new Error('postgres://private-password@db token=secret'));
    const failed = await GET(request());
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toMatch(/private-password|secret|postgres:/);
  });
});
