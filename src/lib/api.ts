import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { AuthError } from './auth';
import { GraphError } from './facebook/graph';
import { fieldErrors } from './validation';

/**
 * Shared shape for API responses, so the client only has to understand one
 * error format: `{ error: string, fields?: Record<string, string> }`.
 */

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
  /** Facebook's trace id, when the failure came from Graph — quote it in bug reports. */
  traceId?: string;
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra?: Omit<ApiErrorBody, 'error'>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Translate a thrown error into a response.
 *
 * Unrecognised errors deliberately return a generic message: an exception from
 * deep in the stack can contain a token or a connection string, and that must
 * not reach the browser. The full error still goes to the server log.
 */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return fail('Please correct the highlighted fields.', 422, { fields: fieldErrors(error) });
  }
  if (error instanceof AuthError) {
    return fail(error.message, 401);
  }
  if (error instanceof GraphError) {
    const status =
      error.kind === 'auth' ? 401 : error.kind === 'permission' ? 403 : error.kind === 'rate_limit' ? 429 : 400;
    return fail(error.displayMessage, status, { traceId: error.traceId ?? undefined });
  }

  console.error('[api] unhandled error', error);
  return fail('Something went wrong. Please try again.', 500);
}

/** Wrap a route handler so every thrown error becomes a structured response. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleApiError(error);
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ZodError([
      {
        code: 'custom',
        path: ['body'],
        message: 'Expected a JSON request body.',
      },
    ]);
  }
}
