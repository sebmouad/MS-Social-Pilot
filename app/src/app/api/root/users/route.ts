import { currentRootActor } from '@/server/config/access';
import { loadRootUsers } from '@/server/root/users';
import { operationFailure } from '@/lib/operation-error';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request) {
  try {
    const actor = await currentRootActor();
    if (!actor?.isInstanceOwner) return reply({ error: 'Not found.' }, actor ? 404 : 401);
    const query = new URL(request.url).searchParams;
    const filter = (key: string) => { const values = query.getAll(key); return values.length > 1 ? values : values[0]; };
    return reply(await loadRootUsers(actor.id, { q: filter('q'), status: filter('status'), page: filter('page') }));
  } catch (error) {
    const safe = operationFailure(error, 'The user directory could not be loaded. Please try again.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}
