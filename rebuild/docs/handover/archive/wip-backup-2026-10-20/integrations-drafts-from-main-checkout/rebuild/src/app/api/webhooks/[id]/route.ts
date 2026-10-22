import { handle, jsonBody } from '@/modules/integrations/http';
import { deleteWebhook, updateWebhook } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
export const PATCH = async (request: Request, { params }: Ctx) => { const { id } = await params; return handle(request, { feature: 'settings/mcp', write: true, fallback: 'The webhook could not be updated.', run: async actor => updateWebhook(actor, { ...(await jsonBody(request)), id }) }); };
export const DELETE = async (request: Request, { params }: Ctx) => { const { id } = await params; return handle(request, { feature: 'settings/mcp', write: true, fallback: 'The webhook could not be deleted.', run: async actor => deleteWebhook(actor, { ...(await jsonBody(request)), id }) }); };
