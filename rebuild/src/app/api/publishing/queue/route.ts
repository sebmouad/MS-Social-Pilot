import { handle, jsonBody } from '@/modules/publishing/collaboration/http';
import { queuePostRequest } from '@/server/publishing/queue';
export const dynamic = 'force-dynamic';

export const POST = (request: Request) => handle(request, {
  feature: 'publishing/queue', write: true, fallback: 'The post could not be added to the queue.',
  run: async actor => queuePostRequest(actor, await jsonBody(request)),
});
