import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { getURLFromRedirectError } from 'next/dist/client/components/redirect';
import { OperationError } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { failure, paramsObject, reply } from '@/modules/analytics/http';
import { readAdObjects } from '@/modules/analytics/ad-objects/service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer({ feature: 'analytics/ads', channelScoped: true });
    const input = paramsObject(request.url);
    if (input.locale === undefined && request.headers.get('accept-language')?.startsWith('fr')) input.locale = 'fr';
    const result = await readAdObjects({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, input);
    if (result.csv !== null) return new Response(result.csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="ad-object-analysis.csv"', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
    return reply(result);
  } catch (error) {
    if (isRedirectError(error)) {
      const signIn = getURLFromRedirectError(error) === '/sign-in';
      return failure(new OperationError(signIn ? 'unauthorized' : 'forbidden', signIn ? 'Sign in to view Analytics. / Connectez-vous pour consulter les statistiques.' : 'Analytics access is unavailable. / L’accès aux statistiques est indisponible.'), '');
    }
    return failure(error, 'Ad-object analysis could not be loaded. / Impossible de charger l’analyse publicitaire.'); }
}
