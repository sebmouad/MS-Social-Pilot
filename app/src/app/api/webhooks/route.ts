import { handle, jsonBody } from '@/modules/integrations/http';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { createWebhook, listWebhooks } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handle(request, { fallback: 'Webhooks could not be loaded.', run: async actor => { const list = await listWebhooks(actor); if (!list.available) return list; const instants = await workspaceInstantFormatter(actor.workspaceId, /^\s*fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en'); return { ...list, webhooks: list.webhooks.map(hook => labelInstants(hook, { lastSentAt: 'dateTime' }, instants)) }; } });
export const POST = (request: Request) => handle(request, { write: true, success: 201, fallback: 'The webhook could not be created.', run: async actor => createWebhook(actor, await jsonBody(request)) });
