import { NextResponse } from 'next/server';
import { currentRootActor } from '@/server/config/access';
import { listRootActivity } from '@/server/root/activity';
import { rootActivitySearchParams, type RootActivitySearch } from '@/lib/root-activity';
import { operationFailure } from '@/lib/operation-error';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const reply = (payload: unknown, status: number) => NextResponse.json(payload, { status, headers: { 'cache-control': 'no-store' } });
  try {
    const actor = await currentRootActor();
    if (!actor?.isInstanceOwner) return reply({ error: 'Not found.' }, actor ? 404 : 401);
    const params = new URL(request.url).searchParams;
    const search: RootActivitySearch = Object.create(null);
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      search[key] = values.length === 1 ? values[0] : values;
    }
    return reply(await listRootActivity(actor.id, rootActivitySearchParams(search)), 200);
  } catch (error) {
    const failure = operationFailure(error, 'Activity could not be read. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
