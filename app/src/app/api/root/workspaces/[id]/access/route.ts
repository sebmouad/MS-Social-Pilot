import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentRootActor } from '@/server/config/access';
import { setRootWorkspaceAccess } from '@/server/root/workspace-access';
import { operationFailure, OperationError } from '@/lib/operation-error';

export const runtime = 'nodejs';
const inputSchema = z.object({ suspended: z.boolean(), confirmation: z.string().min(1) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).origin !== requestOrigin(request)) return reply({ error: 'Cross-origin request denied.' }, 403);
  } catch { return reply({ error: 'Cross-origin request denied.' }, 403); }
  const actor = await currentRootActor();
  if (!actor?.isInstanceOwner) return reply({ error: 'Not found.' }, actor ? 404 : 401);
  try {
    const { id } = await params;
    const input = inputSchema.parse(await request.json());
    const result = await setRootWorkspaceAccess(actor.id, id, input.suspended, input.confirmation);
    return reply({ ok: true, ...result }, 200);
  } catch (error) {
    const failure = operationFailure(error instanceof z.ZodError || error instanceof SyntaxError ? new OperationError('invalid_request', 'Invalid workspace access change.') : error, 'The workspace access change could not be confirmed. Refresh the directory and try again.');
    return reply({ error: failure.error, code: failure.code }, failure.status);
  }
}
