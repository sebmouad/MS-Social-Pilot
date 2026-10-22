import { handle, jsonBody } from '@/modules/integrations/http';
import { rotateWebhookSecret } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return handle(request, { feature: 'settings/mcp', write: true, fallback: 'The secret could not be replaced.', run: async actor => rotateWebhookSecret(actor, { ...(await jsonBody(request)), id }) }); };
