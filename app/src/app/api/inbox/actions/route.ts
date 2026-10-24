import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireViewer } from '@/server/context';
import { deleteInboxComment, moderateInboxComment, replyToInbox, setInboxResolved, syncInbox } from '@/modules/inbox/server/actions';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { finishInboxDeletion } from '@/modules/inbox/server/deletion';
import { OperationError, operationFailure } from '@/lib/operation-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync'), targetId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(), locale: z.enum(['en', 'fr']).optional() }).strict(),
  z.object({ action: z.literal('reply'), kind: z.enum(['message', 'comment', 'review']), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), text: z.string().max(2000) }).strict(),
  z.object({ action: z.literal('resolve'), kind: z.enum(['message', 'comment', 'review']), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), resolved: z.boolean() }).strict(),
  z.object({ action: z.literal('delete'), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), confirmation: z.string().max(240) }).strict(),
  z.object({ action: z.literal('finish_delete'), operationId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), confirmation: z.string().max(240) }).strict(),
  z.object({ action: z.literal('moderate'), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), hidden: z.boolean() }).strict(),
]);

const noStore = { 'cache-control': 'no-store' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const unconfirmed = 'The inbox action outcome is unconfirmed. Inspect the current Inbox item and platform before repeating this action.';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let viewer;
  try { viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true }); }
  catch { return reply({ error: 'Not authorized.', code: 'unauthorized' }, 401); }
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new OperationError('invalid_request', 'Inbox actions do not accept URL filters.');
    const input = schema.parse(await request.json());
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    // Local workflow services own their workspace lock. Acquiring it twice on
    // separate connections can wait behind a queued purge's exclusive lock.
    const result = input.action === 'resolve' ? await setInboxResolved(actor, input)
      : input.action === 'delete' ? await deleteInboxComment(actor, input)
      : input.action === 'finish_delete' ? await finishInboxDeletion(actor, input)
      : await withWorkspaceOperation(viewer.workspaceId, async () => input.action === 'sync' ? await syncInbox(actor, input.targetId)
      : input.action === 'reply' ? await replyToInbox(actor, input)
      : await moderateInboxComment(actor, input));
    if (input.action !== 'sync' && (!result || typeof result !== 'object' || (result as { ok?: unknown }).ok !== true)) {
      throw new OperationError('upstream_failure', unconfirmed);
    }
    // The sync time is formatted here in the workspace zone; browsers can carry different time-zone data than Node.
    const syncedAt = input.action === 'sync' && result && typeof result === 'object' ? (result as { syncedAt?: unknown }).syncedAt : undefined;
    const syncedLabel = typeof syncedAt === 'string' && Number.isFinite(Date.parse(syncedAt))
      ? new Intl.DateTimeFormat(input.action === 'sync' && input.locale === 'fr' ? 'fr-FR' : 'en-US', { timeZone: viewer.membership.workspace.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(syncedAt))
      : undefined;
    return reply({ ok: true, ...result, ...(syncedLabel ? { syncedLabel } : {}) });
  } catch (error) {
    const typedError = error instanceof z.ZodError || error instanceof SyntaxError
      ? new OperationError('invalid_request', 'Invalid inbox action.')
      : error;
    const failure = operationFailure(typedError, unconfirmed);
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
