import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), duplicate: vi.fn(), revalidate: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/publishing/server/duplicate', () => ({ duplicatePost: state.duplicate }));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));

import { POST } from '../src/app/api/publishing/duplicate/route';
import { OperationError } from '../src/lib/operation-error';

const viewer = { user: { id: 'user-a' }, workspaceId: 'workspace-a' };
const validInput = { postId: 'source-post', requestId: '123e4567-e89b-42d3-a456-426614174000', confirmation: 'DUPLICATE POST source-post' };
const request = (body: string, origin = 'http://localhost') => new Request('http://localhost/api/publishing/duplicate', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer.mockResolvedValue(viewer);
  state.duplicate.mockResolvedValue({ sourcePostId: 'source-post', postId: 'new-post', draftCreated: true, replayed: false });
});

describe('Publishing post duplication HTTP', () => {
  it('denies cross-origin writes before checking the viewer', async () => {
    const response = await POST(request(JSON.stringify(validInput), 'https://attacker.example'));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Cross-origin request denied.', code: 'forbidden' });
    expect(state.viewer).not.toHaveBeenCalled();
    expect(state.duplicate).not.toHaveBeenCalled();
  });

  it('requires a channel-scoped Publishing write grant and returns the new receipt with 201', async () => {
    const response = await POST(request(JSON.stringify({ ...validInput, workspaceId: 'spoofed', userId: 'spoofed' })));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.viewer).toHaveBeenCalledWith({ feature: 'publishing/posts', channelScoped: true, write: true });
    expect(state.duplicate).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, { ...validInput, workspaceId: 'spoofed', userId: 'spoofed' });
    expect(await response.json()).toEqual({ sourcePostId: 'source-post', postId: 'new-post', draftCreated: true, replayed: false });
  });

  it('returns replayed receipts with 200', async () => {
    state.duplicate.mockResolvedValueOnce({ sourcePostId: 'source-post', postId: 'new-post', draftCreated: true, replayed: true });
    const response = await POST(request(JSON.stringify(validInput)));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('preserves typed failures and masks unexpected service details', async () => {
    state.duplicate.mockRejectedValueOnce(new OperationError('forbidden', 'This post is outside your current access.'));
    const denied = await POST(request(JSON.stringify(validInput)));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('cache-control')).toBe('no-store');
    expect(await denied.json()).toEqual({ error: 'This post is outside your current access.', code: 'forbidden' });

    state.duplicate.mockRejectedValueOnce(new Error('postgres://private-password@db access_token=private-token'));
    const failed = await POST(request(JSON.stringify(validInput)));
    expect(failed.status).toBe(502);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await failed.json())).not.toMatch(/private-password|private-token|postgres:/);
  });

  it('maps malformed JSON to a safe 400 response', async () => {
    const response = await POST(request('{invalid'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Enter a valid post duplication request.', code: 'invalid_request' });
    expect(state.duplicate).not.toHaveBeenCalled();
  });

  it('returns the committed receipt even when one or more cache revalidations fail', async () => {
    state.revalidate.mockImplementation(path => { if (path === '/content/calendar') throw new Error('cache unavailable'); });
    const response = await POST(request(JSON.stringify(validInput)));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ sourcePostId: 'source-post', postId: 'new-post', draftCreated: true, replayed: false });
    expect(state.revalidate).toHaveBeenCalledWith('/content');
    expect(state.revalidate).toHaveBeenCalledWith('/content/calendar');
    expect(state.revalidate).toHaveBeenCalledWith('/content/queue');
    expect(state.revalidate).toHaveBeenCalledWith('/content/approvals');
  });
});
