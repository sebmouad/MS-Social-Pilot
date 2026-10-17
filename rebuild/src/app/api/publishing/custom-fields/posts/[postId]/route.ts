import { handle, jsonBody } from '@/modules/publishing/collaboration/http';
import { readPostFieldValues, setPostFieldValues } from '@/modules/publishing/collaboration/server/custom-fields';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ postId: string }> };
export async function GET(request: Request, context: Context) { const { postId } = await context.params; return handle(request, { feature: 'publishing/posts', fallback: 'Field values could not be loaded.', run: async actor => readPostFieldValues(actor, postId) }); }
export async function PUT(request: Request, context: Context) {
  const { postId } = await context.params;
  return handle(request, { feature: 'publishing/posts', write: true, fallback: 'Field values could not be saved.', run: async actor => { const value = await jsonBody(request); if (Object.hasOwn(value, 'postId')) throw new OperationError('invalid_request', 'Choose a valid post.'); return setPostFieldValues(actor, { ...value, postId }); } });
}
