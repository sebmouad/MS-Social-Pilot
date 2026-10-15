import { prisma } from '@/server/data';
import { zonedLocalToDate } from '@/lib/publishing/zoned-time';
import { platformModule } from '@/platforms';
import { countStatus, firstCommentAllowed, formatProblem, textLimit, type ComposeModule } from '@/lib/publishing/compose-rules';
import type { PublishMedia } from '@/platforms/types';
import { createPost, publishPost, schedulePost, submitPostForApproval, updatePost, type PublishingActor } from './lifecycle';

/** What the author wants to happen when they press the composer's main button. */
export type ComposeIntent = 'draft' | 'schedule' | 'publish' | 'approval';
export type ComposeAttachment =
  | { kind: 'none' }
  | { kind: 'keep' }
  | { kind: 'link'; link: string }
  | { kind: 'image'; reference: string; url: string; altText: string }
  | { kind: 'video'; url: string };

export type ComposeInput = {
  postId?: string;
  message: string;
  firstComment: string;
  attachment: ComposeAttachment;
  targetIds: string[];
  intent: ComposeIntent;
  /** `YYYY-MM-DDTHH:mm` on the workspace wall clock; required for `schedule`. */
  scheduledLocal?: string;
  timeZone: string;
};
export type ComposeNotice = 'created' | 'updated' | 'scheduled' | 'published' | 'publish-review' | 'submitted';

/** The post was saved, but the requested follow-up step (publish, schedule, submit) failed. */
export class ComposeFollowUpError extends Error {
  constructor(readonly postId: string, message: string) { super(message); this.name = 'ComposeFollowUpError'; }
}

const INTENTS: readonly ComposeIntent[] = ['draft', 'schedule', 'publish', 'approval'];
const STORED_IMAGE = /^media:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseIntent(value: unknown): ComposeIntent {
  if (typeof value === 'string' && (INTENTS as readonly string[]).includes(value)) return value as ComposeIntent;
  throw new Error('Choose what should happen to this post.');
}

/** Read the attachment the composer submitted. Exactly one format may be present. */
export function parseAttachment(read: (name: string) => string): ComposeAttachment {
  const kind = read('attachmentKind');
  if (kind === '' || kind === 'none') return { kind: 'none' };
  if (kind === 'keep') return { kind: 'keep' };
  if (kind === 'link') {
    const link = read('link').trim();
    if (!link) throw new Error('Enter the link to share.');
    return { kind: 'link', link };
  }
  if (kind === 'video') {
    const url = read('videoUrl').trim();
    if (!url) throw new Error('Enter the video URL.');
    return { kind: 'video', url };
  }
  if (kind === 'image') {
    const reference = read('imageRef').trim();
    const url = read('imageUrl').trim();
    if (reference && url) throw new Error('Choose a library image or an image URL, not both.');
    if (!reference && !url) throw new Error('Choose an image or remove the image attachment.');
    if (reference && !STORED_IMAGE.test(reference)) throw new Error('The selected image could not be attached. Please choose it again.');
    return { kind: 'image', reference, url, altText: read('altText').trim() };
  }
  throw new Error('Choose a valid attachment type.');
}

async function existingAttachments(actor: PublishingActor, postId: string): Promise<{ link: string | null; media: PublishMedia[] }> {
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId: actor.workspaceId }, select: { link: true, media: true } });
  if (!post) throw new Error('This post is unavailable in the current workspace.');
  return { link: post.link, media: Array.isArray(post.media) ? post.media as unknown as PublishMedia[] : [] };
}

function formatOf(resolved: { link: string; media: PublishMedia[] }): 'link' | 'image' | 'video' | null {
  if (resolved.link) return 'link';
  if (resolved.media.some(item => item.kind === 'video')) return 'video';
  if (resolved.media.length) return 'image';
  return null;
}

/** Work out the lifecycle attachments for the chosen format. */
export async function resolveAttachments(actor: PublishingActor, postId: string | undefined, attachment: ComposeAttachment): Promise<{ link: string; media: PublishMedia[] }> {
  switch (attachment.kind) {
    case 'none': return { link: '', media: [] };
    case 'link': return { link: attachment.link, media: [] };
    case 'video': return { link: '', media: [{ kind: 'video', url: attachment.url }] };
    case 'image': return { link: '', media: [{ kind: 'image', url: attachment.reference || attachment.url, ...(attachment.altText ? { altText: attachment.altText } : {}) }] };
    case 'keep': {
      if (!postId) return { link: '', media: [] };
      const existing = await existingAttachments(actor, postId);
      return { link: existing.link ?? '', media: existing.media };
    }
  }
}

/** Enforce each chosen platform's own text, format and first-comment rules. */
async function assertPlatformRules(actor: PublishingActor, input: ComposeInput, format: 'link' | 'image' | 'video' | null) {
  if (!input.targetIds.length) return;
  const rows = await prisma.target.findMany({ where: { id: { in: input.targetIds }, workspaceId: actor.workspaceId }, select: { socialAccount: { select: { provider: true } } } });
  const selected: ComposeModule[] = [];
  for (const row of rows) {
    const module = row.socialAccount?.provider ? platformModule(row.socialAccount.provider) : undefined;
    if (module?.publishing && !selected.some(item => item.id === module.id)) selected.push({ id: module.id, name: module.name, mark: module.mark, traits: module.publishing });
  }
  const limit = textLimit(selected, Number.MAX_SAFE_INTEGER);
  if (countStatus(input.message.trim(), limit).over) throw new Error(`Post text is longer than the ${limit.toLocaleString()} characters the selected channels accept.`);
  if (input.firstComment.trim() && !firstCommentAllowed(selected)) throw new Error('One of the selected channels cannot add a first comment. Remove it or change the channels.');
  const problem = formatProblem(format, selected);
  if (problem) throw new Error(problem);
}

/**
 * Save a post from the composer and carry out the requested step. The post is
 * always saved first; if publishing, scheduling, or submitting then fails, a
 * `ComposeFollowUpError` carries the saved post's ID so the author can retry
 * without creating a duplicate. All permission, scope, entitlement and platform
 * checks stay in the lifecycle functions called here.
 */
export async function composePost(actor: PublishingActor, input: ComposeInput, now = new Date()): Promise<{ postId: string; notice: ComposeNotice }> {
  if (input.intent !== 'draft' && !input.targetIds.length) throw new Error('Choose at least one channel before publishing, scheduling, or submitting this post.');
  let scheduledAt: Date | null = null;
  if (input.intent === 'schedule') {
    scheduledAt = input.scheduledLocal ? zonedLocalToDate(input.scheduledLocal, input.timeZone) : null;
    if (!scheduledAt) throw new Error('Choose a valid publishing date and time.');
    if (scheduledAt.getTime() <= now.getTime()) throw new Error('Choose a future publishing time.');
  }
  const attachments = await resolveAttachments(actor, input.postId, input.attachment);
  await assertPlatformRules(actor, input, formatOf(attachments));
  const fields = { message: input.message, firstComment: input.firstComment, targetIds: input.targetIds, link: attachments.link, media: attachments.media };
  let postId: string;
  if (input.postId) {
    await updatePost(actor, { postId: input.postId, ...fields });
    postId = input.postId;
  } else {
    postId = (await createPost(actor, fields)).id;
  }
  const saved: ComposeNotice = input.postId ? 'updated' : 'created';
  if (input.intent === 'draft') return { postId, notice: saved };
  try {
    if (input.intent === 'schedule') { await schedulePost(actor, postId, scheduledAt!); return { postId, notice: 'scheduled' }; }
    if (input.intent === 'approval') { await submitPostForApproval(actor, postId); return { postId, notice: 'submitted' }; }
    const result = await publishPost(actor, postId);
    return { postId, notice: result.needsReconciliation || result.failed ? 'publish-review' : 'published' };
  } catch (error) {
    throw new ComposeFollowUpError(postId, error instanceof Error ? error.message : 'The post was saved, but the next step could not be completed.');
  }
}
