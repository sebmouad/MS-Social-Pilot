import { deletePublishingPost, updatePublishingPost } from '@/modules/publishing/server/api-writes';
import { publishingWrite } from '@/modules/publishing/server/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

/** Same input, consent and lifecycle service as MCP update_post / update_draft. */
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return publishingWrite(request, ({ actor, body }) => updatePublishingPost(actor, id, body));
}

/** Returns the durable deletion receipt, including partial or uncertain remote results. */
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  return publishingWrite(request, ({ actor, body }) => deletePublishingPost(actor, id, body),
    { failure: 'The deletion result could not be confirmed. Check its status before trying again.' });
}
