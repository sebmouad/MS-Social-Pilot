import { handle, jsonBody, pageParam, query } from '@/modules/publishing/collaboration/http';
import { readPostVersions, requestVersionRestore } from '@/modules/publishing/collaboration/server/versions';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { feature: 'publishing/posts', fallback: 'Versions could not be loaded.', run: async actor => { const q = query(request, ['postId', 'page']); return readPostVersions(actor, { postId: q.postId, ...(q.page ? { page: pageParam(q.page) } : {}) }); } });
export const POST = (request: Request) => handle(request, { feature: 'publishing/posts', write: true, fallback: 'The version could not be restored.', run: async actor => requestVersionRestore(actor, await jsonBody(request)) });
