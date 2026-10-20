import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { rootUserConfirmationSchema, rootUserIdSchema, type RootUserAction } from '@/lib/root-user-controls';
import { currentRootActor } from '@/server/config/access';
import { resetRootUserTwoStep, revokeRootUserSessions, setRootUserDisabled } from '@/server/root/user-controls';

export const runtime = 'nodejs';
const schema = z.object({ disabled: z.boolean(), confirmation: rootUserConfirmationSchema }).strict();
const recoverySchema = z.object({ action: z.enum(['sign-out', 'reset-two-step']), confirmation: rootUserConfirmationSchema }).strict();
const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  try { return Boolean(origin) && new URL(origin!).origin === requestOrigin(request); } catch { return false; }
}

function mutationError(error: unknown) {
  const typedError = error instanceof z.ZodError || error instanceof SyntaxError
    ? new OperationError('invalid_request', 'Invalid account change.')
    : error;
  const failure = operationFailure(typedError, 'The account change could not be confirmed. Check the account’s current state before repeating this action.');
  return json({ error: failure.error, code: failure.code }, failure.status);
}

async function authorizeRoot() {
  const actor = await currentRootActor();
  if (!actor?.isInstanceOwner) return { actor: null, response: json({ error: 'Not found.' }, actor ? 404 : 401) };
  return { actor, response: null };
}

async function userIdFrom(params: Promise<{ id: string }>) {
  const { id } = await params;
  const result = rootUserIdSchema.safeParse(id);
  if (!result.success) throw new OperationError('invalid_request', 'Invalid user.');
  return result.data;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  try {
    const auth = await authorizeRoot();
    if (auth.response) return auth.response;
    const id = await userIdFrom(params);
    const input = schema.parse(await request.json());
    const action: RootUserAction = input.disabled ? 'disable' : 'enable';
    const result = await setRootUserDisabled(auth.actor!.id, id, input.disabled, input.confirmation);
    return json({ ok: true, userId: id, action, ...result });
  } catch (error) { return mutationError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  try {
    const auth = await authorizeRoot();
    if (auth.response) return auth.response;
    const id = await userIdFrom(params);
    const input = recoverySchema.parse(await request.json());
    const action: RootUserAction = input.action;
    const result = action === 'sign-out'
      ? await revokeRootUserSessions(auth.actor!.id, id, input.confirmation)
      : await resetRootUserTwoStep(auth.actor!.id, id, input.confirmation);
    return json({ ok: true, userId: id, action, ...result });
  } catch (error) { return mutationError(error); }
}
