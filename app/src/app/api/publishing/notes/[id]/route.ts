import { handle, jsonBody } from '@/modules/publishing/collaboration/http';
import { deletePostNote } from '@/modules/publishing/collaboration/server/notes';
import { OperationError } from '@/lib/operation-error';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  return handle(request, { feature: 'publishing/collaboration', write: true, fallback: 'The note could not be deleted.', run: async actor => { const value = await jsonBody(request); if (Object.hasOwn(value, 'noteId')) throw new OperationError('invalid_request', 'Choose a valid note.'); return deletePostNote(actor, { ...value, noteId: id }); } });
}
