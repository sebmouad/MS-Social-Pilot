import { currentRootActor } from '@/server/config/access';
import { readRootApiUsage } from '@/modules/root/server/api-usage';
import { OperationError, operationFailure } from '@/lib/operation-error';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
/** Installation-owner read of provider-reported API usage; optional providerId and locale filters only. */
export async function GET(request: Request) {
  try {
    const actor = await currentRootActor();
    if (!actor) throw new OperationError('unauthorized', 'Sign in to continue.');
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'providerId' && key !== 'locale')) throw new OperationError('invalid_request', 'Only providerId and locale are accepted.');
    const locale = params.get('locale') === 'fr' ? 'fr' : 'en';
    return reply(await readRootApiUsage(actor.id, { providerId: params.get('providerId') ?? undefined, locale }));
  } catch (error) { const safe = operationFailure(error, 'API usage could not be loaded.'); return reply({ error: safe.error, code: safe.code }, safe.status); }
}
