import { handleKey, jsonBody } from '@/modules/integrations/http';
import { REST_WEBHOOK_FEATURE, restListHooks, restSubscribe } from '@/modules/integrations/server/rest';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleKey(request, { need: { feature: REST_WEBHOOK_FEATURE }, fallback: 'The request could not be completed.', run: ctx => restListHooks(ctx) });
export const POST = (request: Request) => handleKey(request, { need: { feature: REST_WEBHOOK_FEATURE, write: true }, success: 201, fallback: 'The subscription could not be created.', run: async ctx => restSubscribe(ctx, await jsonBody(request)) });
