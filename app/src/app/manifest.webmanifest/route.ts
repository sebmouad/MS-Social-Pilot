import { publicWebApp } from '@/modules/settings/web-app/service';
import { webAppManifest } from '@/modules/settings/web-app/documents';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const policy = await publicWebApp();
  if (!policy.enabled) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  const locale = new URL(request.url).searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  return Response.json(webAppManifest(policy, locale), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' } });
}
