import { handle, jsonBody } from '@/modules/integrations/http';
import { testWebhook } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return handle(request, { write: true, fallback: 'The test could not be sent.', run: async actor => testWebhook(actor, { ...(await jsonBody(request)), id }) }); };
