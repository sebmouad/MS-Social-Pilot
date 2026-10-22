import { handle, jsonBody } from '@/modules/integrations/http';
import { redeliverWebhook } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
/** Send this delivery again. The webhook id in the path is part of the address; the delivery is always resolved inside the caller's workspace. */
export const POST = async (request: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) => { const { deliveryId } = await params; return handle(request, { feature: 'settings/mcp', write: true, fallback: 'The delivery could not be sent again.', run: async actor => redeliverWebhook(actor, { ...(await jsonBody(request)), id: deliveryId }) }); };
