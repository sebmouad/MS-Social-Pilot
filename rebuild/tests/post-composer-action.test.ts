import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  requireViewer: vi.fn(),
  canAccessFeature: vi.fn(),
  withWorkspaceOperation: vi.fn(),
  createPost: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../src/server/context', () => ({ requireViewer: deps.requireViewer }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: deps.canAccessFeature }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: deps.withWorkspaceOperation }));
vi.mock('../src/server/publishing/lifecycle', () => ({
  createPost: deps.createPost,
  cancelScheduledPost: vi.fn(), deletePost: vi.fn(), importPostsCsv: vi.fn(), publishPost: vi.fn(),
  reviewPost: vi.fn(), schedulePost: vi.fn(), submitPostForApproval: vi.fn(), syncPostStatus: vi.fn(), updatePost: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: deps.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: deps.redirect }));

import { createPostWithRecoveryAction } from '../src/app/publishing/posts/actions';

const viewer = {
  user: { id: 'user-1' }, workspaceId: 'workspace-1',
  permissions: { pageScope: { all: true, ids: [] } },
  membership: { workspace: { timezone: 'UTC' } },
};

function formData(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.requireViewer.mockResolvedValue(viewer);
  deps.canAccessFeature.mockReturnValue(true);
  deps.withWorkspaceOperation.mockImplementation((_workspaceId, operation) => operation());
  deps.createPost.mockResolvedValue({ id: 'post-1' });
  deps.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); });
});

describe('recoverable post composer action', () => {
  it('returns field values and a safe message after a recoverable creation failure', async () => {
    deps.createPost.mockRejectedValue(new Error('Provider token decrypt failed at Root setup'));
    const data = formData({
      intent: 'draft', message: 'A saved draft', firstComment: 'Follow up', link: 'https://example.test',
      targetIds: ['target-a'], scheduleDate: '', scheduleTime: '',
    });

    const result = await createPostWithRecoveryAction({ status: 'idle', values: {} }, data);

    expect(result.status).toBe('error');
    expect(result.message).toMatch(/could not save this post/i);
    expect(result.message).not.toMatch(/token|Root setup|decrypt/i);
    expect(result.values).toMatchObject({ message: 'A saved draft', firstComment: 'Follow up', link: 'https://example.test', targetIds: ['target-a'] });
  });

  it('creates a draft without requiring schedule fields', async () => {
    const data = formData({ intent: 'draft', message: 'Draft without a date', targetIds: [] });

    await expect(createPostWithRecoveryAction({ status: 'idle', values: {} }, data)).rejects.toThrow('redirect:/publishing/posts?notice=created');

    expect(deps.createPost).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-1' }), expect.objectContaining({
      message: 'Draft without a date', targetIds: [], scheduledAt: undefined,
    }));
  });

  it('passes the complete ordered mediaJson list to shared authoring', async () => {
    const mediaJson = JSON.stringify([
      { kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000', altText: 'Cover' },
      { kind: 'image', url: 'https://cdn.test/second.jpg' },
    ]);
    const data = formData({ intent: 'draft', message: 'Album draft', mediaJson, targetIds: [] });

    await expect(createPostWithRecoveryAction({ status: 'idle', values: {} }, data)).rejects.toThrow('redirect:/publishing/posts?notice=created');

    expect(deps.createPost).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      message: 'Album draft', link: '', media: [
        { kind: 'image', url: 'media:123e4567-e89b-42d3-a456-426614174000', altText: 'Cover' },
        { kind: 'image', url: 'https://cdn.test/second.jpg' },
      ],
    }));
  });

  it('preserves the complete serialized media list after recoverable save failure', async () => {
    const mediaJson = JSON.stringify([{ kind: 'image', url: 'https://cdn.test/one.jpg', altText: 'One' }]);
    const data = formData({ intent: 'draft', message: 'Retain media', mediaJson, targetIds: [] });
    deps.createPost.mockRejectedValue(new Error('temporary save failure'));

    const result = await createPostWithRecoveryAction({ status: 'idle', values: {} }, data);

    expect(result.values.mediaJson).toBe(mediaJson);
  });

  it('rejects malformed mediaJson and mixed legacy fields before calling authoring', async () => {
    const malformed = await createPostWithRecoveryAction({ status: 'idle', values: {} }, formData({
      intent: 'draft', message: 'Reject malformed', mediaJson: JSON.stringify([{ kind: 'image', url: 'https://cdn.test/a.jpg', clientId: 'ui-only' }]), targetIds: [],
    }));
    expect(malformed.status).toBe('error');
    expect(deps.createPost).not.toHaveBeenCalled();

    const both = await createPostWithRecoveryAction({ status: 'idle', values: {} }, formData({
      intent: 'draft', message: 'Reject legacy mix', mediaJson: '[]', imageUrl: 'https://cdn.test/a.jpg', targetIds: [],
    }));
    expect(both.status).toBe('error');
    expect(deps.createPost).not.toHaveBeenCalled();
  });
});
