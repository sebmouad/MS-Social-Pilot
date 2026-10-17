import { handle, jsonBody, query } from '@/modules/publishing/collaboration/http';
import { readQueueSlots, replaceQueueSlots } from '@/modules/publishing/collaboration/server/queue-slots';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { feature: 'publishing/queue', fallback: 'Queue times could not be loaded.', run: async actor => { const q = query(request, ['targetId']); return readQueueSlots(actor, q.targetId ? { targetId: q.targetId } : {}); } });
export const PUT = (request: Request) => handle(request, { feature: 'publishing/queue', write: true, fallback: 'Queue times could not be saved.', run: async actor => replaceQueueSlots(actor, await jsonBody(request)) });
