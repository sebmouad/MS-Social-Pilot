import { handle, jsonBody, query } from '@/modules/publishing/collaboration/http';
import { readRecycle, setRecycle } from '@/modules/publishing/collaboration/server/recycle';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { feature: 'publishing/posts', fallback: 'Repeat settings could not be loaded.', run: async actor => readRecycle(actor, { postId: query(request, ['postId']).postId }) });
export const PUT = (request: Request) => handle(request, { feature: 'publishing/posts', write: true, fallback: 'Repeat settings could not be saved.', run: async actor => setRecycle(actor, await jsonBody(request)) });
