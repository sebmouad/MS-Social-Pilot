import { handleKey } from '@/modules/integrations/http';
import { restUnsubscribe } from '@/modules/integrations/server/rest';
export const dynamic = 'force-dynamic';
export const DELETE = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return handleKey(request, { need: 'write', fallback: 'The subscription could not be removed.', run: ctx => restUnsubscribe(ctx, { id }) }); };
