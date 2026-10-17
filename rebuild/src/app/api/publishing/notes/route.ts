import { handle, jsonBody, pageParam, query } from '@/modules/publishing/collaboration/http';
import { addPostNote, readPostNotes } from '@/modules/publishing/collaboration/server/notes';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { feature: 'publishing/posts', fallback: 'Notes could not be loaded.', run: async actor => { const q = query(request, ['postId', 'page']); return readPostNotes(actor, { postId: q.postId, ...(q.page ? { page: pageParam(q.page) } : {}) }); } });
export const POST = (request: Request) => handle(request, { feature: 'publishing/posts', write: true, success: 201, fallback: 'The note could not be saved.', run: async actor => addPostNote(actor, await jsonBody(request)) });
