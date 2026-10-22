import { publicWebApp } from '@/modules/settings/web-app/service';
import { offlineDocument } from '@/modules/settings/web-app/documents';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const locale = new URL(request.url).searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  return new Response(offlineDocument(await publicWebApp(), locale), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-language': locale, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", 'x-content-type-options': 'nosniff' } });
}
