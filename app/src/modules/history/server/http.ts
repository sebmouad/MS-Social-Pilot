import { NextResponse } from 'next/server';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { HISTORY_FEATURE_ID, type HistoryActor } from '../semantics';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

function numberParam(query: URLSearchParams, key: string) {
  const value = query.get(key);
  if (value === null) return {};
  if (!/^\d{1,9}$/.test(value)) throw new OperationError('invalid_request', 'Choose valid history filters.');
  return { [key]: Number(value) };
}

/** Strict query parsing shared by both history routes: unknown or repeated parameters are refused, never ignored. */
export function historyQuery(request: Request, allowed: readonly string[]) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length > 1)) throw new OperationError('invalid_request', 'Choose valid history filters.');
  const problems = query.get('problemsOnly');
  if (problems !== null && problems !== 'true' && problems !== 'false') throw new OperationError('invalid_request', 'Choose valid history filters.');
  return { ...(query.get('q') ? { q: query.get('q') as string } : {}), ...numberParam(query, 'offset'), ...numberParam(query, 'limit'), ...(problems !== null ? { problemsOnly: problems === 'true' } : {}) };
}

/**
 * Session entry point for the History reads. The entry gate (feature + role) only refuses early; the service repeats
 * the full authorization. Failures map to safe operation errors, never raw text.
 */
export async function historyGet(request: Request, allowed: readonly string[], run: (actor: HistoryActor, filters: ReturnType<typeof historyQuery>) => Promise<unknown>) {
  try {
    const viewer = await requireViewer({ module: 'settings', feature: HISTORY_FEATURE_ID });
    return reply(await run({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, historyQuery(request, allowed)));
  } catch (error) {
    const failure = operationFailure(error, 'History could not be loaded. Please try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
