import { NextResponse } from 'next/server';
import { currentRootActor } from '@/server/config/access';
import { exportRootActivity } from '@/server/root/audit-export';
import { rootActivitySearchParams } from '@/lib/root-activity';
import { operationFailure } from '@/lib/operation-error';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  try {
    const actor = await currentRootActor();
    if (!actor?.isInstanceOwner) return NextResponse.json({ error: 'Not found.' }, { status: actor ? 404 : 401, headers });
    const params = new URL(request.url).searchParams;
    const input: Record<string, string | string[]> = Object.create(null);
    for (const key of new Set(params.keys())) input[key] = params.getAll(key).length === 1 ? params.get(key)! : params.getAll(key);
    const result = await exportRootActivity(actor.id, rootActivitySearchParams(input));
    return new Response(result.csv, { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${result.filename}"` } });
  } catch (error) {
    const failure = operationFailure(error, 'Audit export could not be prepared. Please try again.');
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers });
  }
}
