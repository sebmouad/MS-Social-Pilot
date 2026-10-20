import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async () => 10080) }));
vi.mock('../src/modules/publishing/server/lifecycle', () => ({ createPost: mocks.createPost, updatePost: mocks.updatePost, schedulePost: vi.fn() }));
vi.mock('../src/modules/publishing/server/queue-compose', () => ({ previewQueueTimes: vi.fn(), createQueuedPost: vi.fn(), QueueAfterSaveError: class extends Error {} }));

import { autosaveDraftAction } from '../src/modules/publishing/ui/compose/queue-actions';

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'user-1' }, workspaceId: 'workspace-1', permissions: { pageScope: { all: false, ids: ['channel-1'] } } });
  mocks.createPost.mockResolvedValue({ id: 'draft-1' });
  mocks.updatePost.mockResolvedValue(undefined);
});

describe('composer background draft save', () => {
  it('creates a draft with the member write authority and channel scope', async () => {
    const result = await autosaveDraftAction(null, form({ message: 'Hello', firstComment: 'Follow up', firstCommentDelayMinutes: '15', link: '', mediaJson: '[]', destinationFormatsJson: '{"channel-1":"feed"}', targetIds: ['channel-1'] }));
    expect(result).toMatchObject({ status: 'saved', draftPostId: 'draft-1' });
    expect(mocks.viewer).toHaveBeenCalledWith({ feature: 'publishing/posts', channelScoped: true, write: true });
    expect(mocks.createPost).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'workspace-1', allowedTargetIds: ['channel-1'] }, expect.objectContaining({ message: 'Hello', firstComment: 'Follow up', firstCommentDelayMinutes: 15, targetIds: ['channel-1'], destinationFormats: { 'channel-1': 'feed' }, media: [] }));
    // A draft never carries a schedule: autosave cannot publish or queue anything.
    expect(mocks.createPost.mock.calls[0]![1]).not.toHaveProperty('scheduledAt');
  });

  it('updates the same draft on later saves instead of creating another', async () => {
    const result = await autosaveDraftAction('draft-1', form({ message: 'Hello again', mediaJson: '[]' }));
    expect(result).toMatchObject({ status: 'saved', draftPostId: 'draft-1' });
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(mocks.updatePost).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ postId: 'draft-1', message: 'Hello again' }));
  });

  it('skips a post with no text, link or media', async () => {
    expect(await autosaveDraftAction(null, form({ message: '   ', firstComment: 'Only a comment', mediaJson: '[]' }))).toEqual({ status: 'skipped' });
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('rejects a malformed draft id before touching the service', async () => {
    expect(await autosaveDraftAction('../etc', form({ message: 'Hello' }))).toEqual({ status: 'error' });
    expect(mocks.updatePost).not.toHaveBeenCalled();
  });

  it.each([
    ['the viewer is not allowed to write', () => mocks.viewer.mockRejectedValueOnce(new Error('forbidden'))],
    ['the service refuses the post', () => mocks.createPost.mockRejectedValueOnce(new Error('destination unavailable'))],
  ])('reports a safe error when %s', async (_name, arrange) => {
    arrange();
    const result = await autosaveDraftAction(null, form({ message: 'Hello' }));
    expect(result).toEqual({ status: 'error' });
    expect(JSON.stringify(result)).not.toContain('unavailable');
  });
});
