import { handle, jsonBody } from '@/modules/integrations/http';
import { createWebhook, listWebhooks } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { fallback: 'Webhooks could not be loaded.', run: actor => listWebhooks(actor) });
export const POST = (request: Request) => handle(request, { write: true, success: 201, fallback: 'The webhook could not be created.', run: async actor => createWebhook(actor, await jsonBody(request)) });
