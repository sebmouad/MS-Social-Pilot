import { publicWebApp } from '@/modules/settings/web-app/service';
import { serviceWorkerDocument } from '@/modules/settings/web-app/documents';
export const dynamic = 'force-dynamic';
export async function GET() {
  return new Response(serviceWorkerDocument(await publicWebApp()), { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', 'service-worker-allowed': '/', 'x-content-type-options': 'nosniff' } });
}
