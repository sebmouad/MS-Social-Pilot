import { handle, pageParam, query } from '@/modules/integrations/http';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { listDeliveries } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
export const GET = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return handle(request, { fallback: 'Deliveries could not be loaded.', run: async actor => { const q = query(request, ['page']); const page = await listDeliveries(actor, { id, ...(q.page ? { page: pageParam(q.page) } : {}) }); const instants = await workspaceInstantFormatter(actor.workspaceId, /^\s*fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en'); return { ...page, deliveries: page.deliveries.map(delivery => labelInstants(delivery, { createdAt: 'dateTime' }, instants)) }; } }); };
