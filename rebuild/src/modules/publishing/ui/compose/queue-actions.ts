'use server';

import { revalidatePath } from 'next/cache';
import { requireViewer } from '@/server/context';
import { previewQueueTimes, createQueuedPost, QueueAfterSaveError } from '@/modules/publishing/server/queue-compose';
import { updatePost, schedulePost } from '@/modules/publishing/server/lifecycle';
import { parsePublishingMedia } from '@/modules/publishing/media-support';
import { parseFirstCommentDelay } from '@/modules/publishing/first-comment-delay';
import { runtimeConfig } from '@/server/config/store';
import { wallTimeToInstant } from '@/lib/calendar-dates';
import type { ComposerActionState as BaseState } from '@/modules/publishing/ui/posts/actions';
import { queueCopy } from './queue-copy';

export type QueueComposerState = BaseState & {
  values: BaseState['values'] & { draftPostId?: string };
  queued?: { scheduledAt: string; status: 'scheduled' | 'pending_approval' };
};
export type QueuePreviewState =
  | { status: 'ready'; scheduledAt: string; channels: Array<{ targetId: string; nextAt: string | null }> }
  | { status: 'full'; channels: Array<{ targetId: string; nextAt: string | null }> }
  | { status: 'error'; message: string };

export async function previewQueueAction(targetIds: string[]): Promise<QueuePreviewState> {
  try {
    const viewer = await requireViewer({ feature: 'publishing/queue', channelScoped: true });
    const preview = await previewQueueTimes(actor(viewer), targetIds);
    const channels = preview.channels.map(channel => ({ targetId: channel.targetId, nextAt: channel.nextAt?.toISOString() ?? null }));
    return preview.scheduledAt ? { status: 'ready', scheduledAt: preview.scheduledAt.toISOString(), channels } : { status: 'full', channels };
  } catch {
    return { status: 'error', message: queueCopy.en.unavailable };
  }
}

/** Queue creation and recovery use the same lifecycle/queue services as HTTP and MCP. */
export async function saveQueueComposerAction(previous: QueueComposerState, data: FormData): Promise<QueueComposerState> {
  const field = (key: string) => typeof data.get(key) === 'string' ? String(data.get(key)) : '';
  const copy = queueCopy[field('queueLocale') === 'fr' ? 'fr' : 'en'];
  const values = { ...previous.values, ...Object.fromEntries([...data.entries()].filter(([, value]) => typeof value === 'string')), targetIds: data.getAll('targetIds').filter((id): id is string => typeof id === 'string') };
  // Recovery still goes through updatePost and its current whole-post authorization.
  const draftPostId = previous.values.draftPostId;
  try {
    const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true, write: true });
    const input = {
      message: field('message'), firstComment: field('firstComment'), labelId: field('labelId') || null,
      firstCommentDelayMinutes: parseFirstCommentDelay(field('firstCommentDelayMinutes'), Number(await runtimeConfig('publishing.maxFirstCommentDelayMinutes'))),
      link: field('link'), media: parsePublishingMedia(JSON.parse(field('mediaJson') || '[]')),
      destinationFormats: JSON.parse(field('destinationFormatsJson') || '{}'), targetIds: values.targetIds,
    };
    let receipt: Awaited<ReturnType<typeof createQueuedPost>> | undefined;
    if (field('intent') === 'queue') receipt = await createQueuedPost(actor(viewer), input, draftPostId);
    else if (draftPostId && ['draft', 'schedule'].includes(field('intent'))) {
      await updatePost(actor(viewer), { ...input, postId: draftPostId });
      if (field('intent') === 'schedule') {
        const at = wallTimeToInstant(field('scheduleDate'), field('scheduleTime'), viewer.membership.workspace.timezone);
        if (!at.ok) throw new Error('schedule');
        await schedulePost(actor(viewer), draftPostId, at.instant);
      }
    } else throw new Error('intent');
    refresh();
    return { status: 'success', destination: '/publishing/posts?notice=' + (field('intent') === 'draft' ? 'created' : 'scheduled'), values, ...(receipt ? { queued: { scheduledAt: receipt.scheduledAt.toISOString(), status: receipt.status === 'pending_approval' ? 'pending_approval' as const : 'scheduled' as const } } : {}) };
  } catch (error) {
    if (error instanceof QueueAfterSaveError) {
      refresh();
      return { status: 'error', message: copy.savedDraft, values: { ...values, draftPostId: error.draftPostId } };
    }
    return { status: 'error', message: copy.saveFailed, values: { ...values, ...(draftPostId ? { draftPostId } : {}) } };
  }
}

function actor(viewer: Awaited<ReturnType<typeof requireViewer>>) {
  return { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }) };
}
function refresh() {
  try { for (const path of ['/publishing/posts', '/publishing/calendar', '/publishing/queue', '/publishing/approvals']) revalidatePath(path); }
  catch { /* A confirmed write remains successful even if cache refresh fails. */ }
}
