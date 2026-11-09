import { receiveGithubDelivery } from '@/modules/root/server/updates/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GitHub push webhook: signature-checked; a push to the deployed branch is recorded for the server updater. */
export async function POST(request: Request) {
  try { return await receiveGithubDelivery(request); }
  catch { return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
}
