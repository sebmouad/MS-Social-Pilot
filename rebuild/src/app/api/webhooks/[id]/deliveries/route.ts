import { handle, pageParam, query } from '@/modules/integrations/http';
import { listDeliveries } from '@/modules/integrations/server/webhooks';
export const dynamic = 'force-dynamic';
export const GET = async (request: Request, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params; return handle(request, { fallback: 'Deliveries could not be loaded.', run: async actor => { const q = query(request, ['page']); return listDeliveries(actor, { id, ...(q.page ? { page: pageParam(q.page) } : {}) }); } }); };
