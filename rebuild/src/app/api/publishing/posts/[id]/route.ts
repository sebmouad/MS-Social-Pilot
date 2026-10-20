import { OperationError } from '@/lib/operation-error';
import { deletePost, updatePost } from '@/modules/publishing/server/lifecycle';
import { parsePublishingMedia } from '@/modules/publishing/media-support';
import { publishingWrite, requireBodyConfirmation } from '@/modules/publishing/server/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

/** Replace an unpublished post. Same service and confirmation as MCP `update_post` (UPDATE POST {id}). */
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return publishingWrite(request, async ({ actor, body }) => {
    requireBodyConfirmation(body, `UPDATE POST ${id}`);
    if (!Array.isArray(body.targetIds) || body.targetIds.some(item => typeof item !== 'string')) throw new OperationError('invalid_request', 'targetIds must be an array of destination IDs.');
    await updatePost(actor, { postId: id, message: typeof body.message === 'string' ? body.message : '', firstComment: typeof body.firstComment === 'string' ? body.firstComment : '',
      ...(body.firstCommentDelayMinutes === undefined ? {} : { firstCommentDelayMinutes: body.firstCommentDelayMinutes as number }),
      destinationFormats: body.destinationFormats, targetIds: body.targetIds as string[], link: typeof body.link === 'string' ? body.link : undefined, media: parsePublishingMedia(body.media ?? []) });
    return { postId: id, updated: true };
  });
}

/**
 * Delete a post. body: { deleteRemote: boolean, confirmation: "DELETE POST {id} LOCAL" | "DELETE POST {id} REMOTE" }.
 * The response is the durable per-destination deletion receipt; partial or uncertain remote results are reported, not hidden.
 */
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  return publishingWrite(request, async ({ actor, body }) => {
    if (typeof body.deleteRemote !== 'boolean') throw new OperationError('invalid_request', 'deleteRemote is required.');
    requireBodyConfirmation(body, `DELETE POST ${id} ${body.deleteRemote ? 'REMOTE' : 'LOCAL'}`);
    return deletePost(actor, id, body.deleteRemote);
  }, { failure: 'The deletion result could not be confirmed. Check its status before trying again.' });
}
