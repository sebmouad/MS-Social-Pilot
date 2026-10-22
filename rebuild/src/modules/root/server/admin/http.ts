import { requestOrigin } from '@/server/request-origin';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { currentRootActor } from '@/server/config/access';

const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  try { return Boolean(origin) && new URL(origin!).origin === requestOrigin(request); } catch { return false; }
}

/**
 * Shared wrapper for private Root routes. Authority comes only from the signed-in
 * browser session of an installation owner (API keys are not read here), writes
 * must be same-origin, and failures map to safe operation errors.
 */
export function rootRoute<Ctx = unknown>(options: { write?: boolean }, handler: (request: Request, actorId: string, context: Ctx) => Promise<unknown>) {
  return async (request: Request, context: Ctx) => {
    if (options.write && !sameOrigin(request)) return json({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
    try {
      if (options.write && new URL(request.url).searchParams.size) throw new OperationError('invalid_request', 'This action does not accept URL parameters.');
      const actor = await currentRootActor();
      if (!actor?.isInstanceOwner) return json({ error: 'Not found.' }, actor ? 404 : 401);
      const result = await handler(request, actor.id, context);
      return result instanceof Response ? result : json({ ok: true, ...(result as object) });
    } catch (error) {
      const typed = error instanceof z.ZodError || error instanceof SyntaxError ? new OperationError('invalid_request', 'Check the request and try again.') : error;
      const failure = operationFailure(typed, 'The change could not be confirmed. Check the current state before repeating it.');
      return json({ error: failure.error, code: failure.code }, failure.status);
    }
  };
}

/**
 * Strict query parsing: a repeated parameter or one outside `allowed` is rejected
 * instead of silently keeping one value.
 */
export function searchParamsObject(request: Request, allowed: readonly string[] = []): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (!allowed.includes(key) || Object.prototype.hasOwnProperty.call(result, key)) throw new OperationError('invalid_request', 'Check the request and try again.');
    result[key] = value;
  }
  return result;
}
export const readBody = (request: Request) => request.json() as Promise<unknown>;

/** Strict server-page query parsing; invalid repeated values must not broaden a read. */
export function pageSearchParamsObject(params: Record<string, unknown>, allowed: readonly string[]) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (!allowed.includes(key) || typeof value !== 'string') throw new OperationError('invalid_request', 'Choose valid filters and try again.');
    if (value !== '') result[key] = value;
  }
  return result;
}
