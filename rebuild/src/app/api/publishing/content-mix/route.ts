import { handle, jsonBody } from '@/modules/publishing/collaboration/http';
import { readContentMix, saveContentMix } from '@/modules/publishing/collaboration/server/content-mix';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { feature: 'publishing/queue', fallback: 'The content mix could not be loaded.', run: async actor => readContentMix(actor) });
export const PUT = (request: Request) => handle(request, { feature: 'publishing/queue', write: true, fallback: 'The content mix could not be saved.', run: async actor => saveContentMix(actor, await jsonBody(request)) });
