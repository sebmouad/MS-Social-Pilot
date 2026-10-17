import { OperationError, operationFailure } from '@/lib/operation-error';
import { exportAdsReport } from '@/modules/ads/server/export';
import { requireViewer } from '@/server/context';

export const dynamic = 'force-dynamic';

const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const KEYS = new Set(['period', 'start', 'end', 'accountId', 'level', 'objectId']);
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,94}\.csv$/;

function parseInput(request: Request) {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some(key => !KEYS.has(key)) || [...KEYS].some(key => params.getAll(key).length > 1)) {
    throw new OperationError('invalid_request', 'Choose one value for each supported Ads export filter.');
  }
  return Object.fromEntries([...KEYS].filter(key => params.has(key)).map(key => [key, params.get(key)!]));
}

export async function GET(request: Request) {
  let viewer;
  try { viewer = await requireViewer({ feature: 'ads/campaigns', channelScoped: true }); }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }

  try {
    const result = await exportAdsReport({
      userId: viewer.user.id,
      workspaceId: viewer.workspaceId,
      ...(viewer.permissions.pageScope.all ? {} : { allowedTargetIds: viewer.permissions.pageScope.ids }),
    }, parseInput(request));
    const actualBytes = Buffer.byteLength(result.csv, 'utf8');
    if (result.format !== 'ms-social-pilot-ads-csv' || result.version !== 1 || !FILE_NAME.test(result.fileName) ||
      !Number.isSafeInteger(result.rowCount) || result.rowCount < 0 || !Number.isSafeInteger(result.byteLength) ||
      result.byteLength <= 0 || actualBytes !== result.byteLength) {
      throw new Error('Invalid Ads export receipt.');
    }
    return new Response(result.csv, { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.fileName}"`,
      'cache-control': 'no-store',
      'x-msp-export-format': 'ads-daily-v1',
      'x-msp-row-count': String(result.rowCount),
      'x-msp-export-bytes': String(result.byteLength),
    } });
  } catch (error) {
    const failure = operationFailure(error, 'The Ads export could not be prepared. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
