import { NextResponse } from 'next/server';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { requestOrigin } from '@/server/request-origin';
import { getRetentionStatus, runRetentionNow, type RetentionActor } from './retention';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const actorOf = (viewer: { user: { id: string }; workspaceId: string }): RetentionActor => ({ userId: viewer.user.id, workspaceId: viewer.workspaceId });
const localeOf = (request: Request): 'en' | 'fr' => (request.headers.get('accept-language') ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';

/** Session entry points for old-records cleanup. The entry gate only refuses early; the service repeats every check. */
export async function retentionGet(request: Request) {
  try {
    const viewer = await requireViewer({ module: 'settings', feature: 'settings/data' });
    return reply(await getRetentionStatus(actorOf(viewer), new Date(), localeOf(request)));
  } catch (error) {
    const failure = operationFailure(error, 'The cleanup status could not be loaded.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

export async function retentionPost(request: Request) {
  const origin = request.headers.get('origin');
  try {
    if (!origin || new URL(origin).origin !== requestOrigin(request)) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const viewer = await requireViewer({ module: 'settings', feature: 'settings/data', write: true });
    const input: unknown = await request.json().catch(() => ({}));
    return reply(await runRetentionNow(actorOf(viewer), input, new Date(), localeOf(request)));
  } catch (error) {
    const failure = operationFailure(error, 'Old records could not be removed.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
