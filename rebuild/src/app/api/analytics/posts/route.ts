import { requireViewer } from '@/server/context';
import { failure, paramsObject, reply } from '@/modules/analytics/http';
import { readPosts, exportPosts } from '@/modules/analytics/explorer-posts/service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'analytics/posts', channelScoped: true });
    const input = paramsObject(request.url); const csv = input.format === 'csv'; delete input.format;
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    if (csv) return new Response(await exportPosts(actor, input, request.headers.get('accept-language')?.startsWith('fr') ? 'fr' : 'en'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="post-analytics.csv"', 'cache-control': 'no-store' } });
    return reply(await readPosts(actor, input));
  } catch (error) { return failure(error, 'Post analytics could not be loaded. / Impossible de charger les statistiques.'); }
}
