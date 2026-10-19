import { handleKey } from '@/modules/integrations/http';
import { REST_WEBHOOK_FEATURE, restUnsubscribe } from '@/modules/integrations/server/rest';
export const dynamic = 'force-dynamic';
export const DELETE = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return handleKey(request, { need: { feature: REST_WEBHOOK_FEATURE, write: true }, fallback: 'The request could not be completed.', run: ctx => restUnsubscribe(ctx, { id }) }); };
