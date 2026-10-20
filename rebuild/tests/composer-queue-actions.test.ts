import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ viewer: vi.fn(), create: vi.fn(), update: vi.fn(), schedule: vi.fn(), refresh: vi.fn(), preview: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: h.refresh }));
vi.mock('@/server/context', () => ({ requireViewer: h.viewer }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 10080 }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ updatePost: h.update, schedulePost: h.schedule }));
vi.mock('@/modules/publishing/server/queue-compose', () => ({
  createQueuedPost: h.create, previewQueueTimes: h.preview,
  QueueAfterSaveError: class extends Error { constructor(readonly draftPostId: string, readonly cause: unknown) { super('queue'); } },
}));
import { QueueAfterSaveError } from '@/modules/publishing/server/queue-compose';
import { saveQueueComposerAction, previewQueueAction } from '@/modules/publishing/ui/compose/queue-actions';
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ intent: 'queue', message: 'Retain me', firstComment: 'Comment', firstCommentDelayMinutes: '17', mediaJson: '[]', destinationFormatsJson: '{"t1":"standard"}', targetIds: 't1' })) data.set(key, value);
  return data;
};
beforeEach(() => {
  vi.clearAllMocks();
  h.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1', permissions: { pageScope: { all: false, ids: ['t1'] } }, membership: { workspace: { timezone: 'UTC' } } });
  h.create.mockResolvedValue({ postId: 'p1', scheduledAt: new Date('2026-10-23T10:00:00Z'), status: 'pending_approval' });
});
it('passes ordered media, formats, first-comment delay and current scope to the shared service', async () => {
  const result = await saveQueueComposerAction({ status: 'idle', values: {} }, form());
  expect(h.create).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', allowedTargetIds: ['t1'] }, expect.objectContaining({ destinationFormats: { t1: 'standard' }, firstCommentDelayMinutes: 17, targetIds: ['t1'] }), undefined);
  expect(result.status).toBe('success');
  expect(result.queued?.status).toBe('pending_approval');
});
it('retains draft identity and input, then reuses the draft for queue retry', async () => {
  h.create.mockRejectedValueOnce(new QueueAfterSaveError('p1', new Error('private raw error')));
  const failure = await saveQueueComposerAction({ status: 'idle', values: {} }, form());
  expect(failure.values).toMatchObject({ draftPostId: 'p1', message: 'Retain me', firstCommentDelayMinutes: '17' });
  expect(failure.message).not.toContain('private raw error');
  await saveQueueComposerAction(failure, form());
  expect(h.create.mock.calls[1]![2]).toBe('p1');
});
it('can save the retained draft instead of making another post', async () => {
  const data = form(); data.set('intent', 'draft');
  expect((await saveQueueComposerAction({ status: 'error', values: { draftPostId: 'p1' } }, data)).status).toBe('success');
  expect(h.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ postId: 'p1' }));
  expect(h.create).not.toHaveBeenCalled();
});
it('preserves successful placement if cache refresh fails', async () => {
  h.refresh.mockImplementationOnce(() => { throw new Error('cache'); });
  expect((await saveQueueComposerAction({ status: 'idle', values: {} }, form())).status).toBe('success');
});
it('fails safely in French without discarding input when current authorization fails', async () => {
  h.viewer.mockRejectedValue(new Error('private permission detail'));
  const data = form(); data.set('queueLocale', 'fr');
  const result = await saveQueueComposerAction({ status: 'idle', values: {} }, data);
  expect(result.status).toBe('error'); expect(result.message).toContain('Vérifiez');
  expect(result.values.message).toBe('Retain me'); expect(h.create).not.toHaveBeenCalled();
});
it('serializes unavailable channel times as null and keeps raw preview errors private', async () => {
  h.preview.mockResolvedValue({ scheduledAt: null, channels: [{ targetId: 't1', nextAt: null }] });
  expect(await previewQueueAction(['t1'])).toEqual({ status: 'full', channels: [{ targetId: 't1', nextAt: null }] });
  h.preview.mockRejectedValue(new Error('private SQL'));
  expect((await previewQueueAction(['t1'])).status).toBe('error');
  expect(JSON.stringify(await previewQueueAction(['t1']))).not.toContain('private SQL');
});
