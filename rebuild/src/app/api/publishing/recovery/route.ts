import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { z } from 'zod';
import { adoptLegacyPublication, finishPublicationProjection, getPublicationStatus, recordPublicationOutcome } from '@/modules/publishing/server/publication';

import { syncPublicationStatus } from '@/modules/publishing/server/status';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const actor = (viewer: Awaited<ReturnType<typeof requireViewer>>) => ({ userId: viewer.user.id, workspaceId: viewer.workspaceId });

async function viewer() {
  try { return await requireViewer({ feature: 'publishing/posts', channelScoped: true }); }
  catch { throw new OperationError('unauthorized', 'Sign in to an authorized workspace.'); }
}

function failure(error: unknown, fallback: string) {
  const safe = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter a valid publication recovery request.') : error, fallback);
  return reply({ error: safe.error, code: safe.code }, safe.status);
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.size !== 1 || !params.has('postId') || params.getAll('postId').length !== 1 || !params.get('postId')) throw new OperationError('invalid_request', 'Choose one valid post.');
    const current = await viewer();
    return reply(await getPublicationStatus(actor(current), { postId: params.get('postId')! }));
  } catch (error) { return failure(error, 'Publication history could not be loaded.'); }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    let sameOrigin = false;
    try { sameOrigin = Boolean(origin && new URL(origin).origin === new URL(request.url).origin); } catch { /* Invalid Origin is denied below. */ }
    if (!sameOrigin) throw new OperationError('forbidden', 'Cross-origin request denied.');
    const current = await viewer();
    const input = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.action !== 'string') throw new OperationError('invalid_request', 'Enter a valid publication recovery request.');
    const who = actor(current);
    if (input.action === 'sync') {
      const parsed = z.object({ action: z.literal('sync'), postId: z.string().min(1) }).strict().safeParse(input);
      if (!parsed.success) throw new OperationError('invalid_request', 'Choose one valid post for a status check.');
      return reply(await syncPublicationStatus(who, parsed.data.postId));
    }
    if (input.action === 'record') {
      const parsed = z.object({ action: z.literal('record'), postId: z.string().min(1), operationId: z.string().min(1), outcome: z.enum(['PUBLISHED', 'ABSENT']), remotePostId: z.string().optional(), remoteUrl: z.string().optional(), confirmation: z.string(), verifiedExternally: z.literal(true) }).strict().safeParse(input);
      if (!parsed.success) throw new OperationError('invalid_request', 'Enter a valid externally checked publication outcome.');
      return reply(await recordPublicationOutcome(who, parsed.data));
    }
    if (input.action === 'finish') {
      const parsed = z.object({ action: z.literal('finish'), postId: z.string().min(1), operationId: z.string().min(1), confirmation: z.string() }).strict().safeParse(input);
      if (!parsed.success) throw new OperationError('invalid_request', 'Enter a valid local recovery request.');
      return reply(await finishPublicationProjection(who, parsed.data));
    }
    if (input.action === 'adopt') {
      const parsed = z.object({ action: z.literal('adopt'), postId: z.string().min(1), postTargetId: z.string().min(1), confirmation: z.string() }).strict().safeParse(input);
      if (!parsed.success) throw new OperationError('invalid_request', 'Enter a valid legacy recovery request.');
      return reply(await adoptLegacyPublication(who, parsed.data));
    }
    throw new OperationError('invalid_request', 'Choose a supported publication recovery action.');
  } catch (error) { return failure(error, 'The publication outcome could not be saved. Check its current status before repeating the action.'); }
}
