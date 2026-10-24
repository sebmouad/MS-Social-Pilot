import { OperationError, operationFailure } from '@/lib/operation-error';
import { readAdsDailyRows } from '@/modules/ads/server/report-read';
import { requireViewer } from '@/server/context';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const KEYS = new Set(['period', 'start', 'end', 'accountId', 'level', 'objectId', 'offset', 'limit']);
const LEVELS = new Set(['account', 'campaign', 'adset', 'ad']);

function parseInput(request: Request) {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some(key => !KEYS.has(key)) || [...KEYS].some(key => params.getAll(key).length > 1)) {
    throw new OperationError('invalid_request', 'Choose one value for each supported Ads report filter.');
  }
  const input: Record<string, string | number> = {};
  for (const key of ['period', 'start', 'end', 'accountId', 'level', 'objectId'] as const) {
    if (params.has(key)) input[key] = params.get(key)!;
  }
  if (params.has('level') && !LEVELS.has(params.get('level')!)) throw new OperationError('invalid_request', 'Choose one valid Ads report level.');
  for (const [key, minimum] of [['offset', 0], ['limit', 1]] as const) {
    if (!params.has(key)) continue;
    const raw = params.get(key)!;
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new OperationError('invalid_request', `Choose a valid Ads report ${key}.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) throw new OperationError('invalid_request', `Choose a valid Ads report ${key}.`);
    input[key] = value;
  }
  return input;
}

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }

  try {
    const input = parseInput(request);
    const result = await readAdsDailyRows({
      userId: viewer.user.id,
      workspaceId: viewer.workspaceId,
      ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }),
    }, input);
    return reply(result, 200);
  } catch (error) {
    const failure = operationFailure(error, 'The Ads report could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
