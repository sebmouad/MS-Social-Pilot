import { handle, jsonBody, query } from '@/modules/publishing/collaboration/http';
import { assignLabels, readPostLabels } from '@/modules/publishing/collaboration/server/assignments';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { feature: 'publishing/collaboration', fallback: 'Labels could not be loaded.', run: async actor => readPostLabels(actor, query(request, ['postId']).postId) });
export const POST = (request: Request) => handle(request, { feature: 'publishing/collaboration', write: true, fallback: 'Labels could not be changed.', run: async actor => assignLabels(actor, await jsonBody(request)) });
