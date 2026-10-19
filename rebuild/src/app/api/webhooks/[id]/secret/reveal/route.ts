import { handle, jsonBody } from '@/modules/integrations/http';
import { revealWebhookSecret } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
/** Explicit, confirmed, audited reveal; session-only (no API key or MCP equivalent). */
export const POST = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return handle(request, { write: true, fallback: 'The secret could not be shown.', run: async actor => revealWebhookSecret(actor, { ...(await jsonBody(request)), id }) }); };
