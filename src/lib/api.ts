import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { ZodError } from 'zod';

import { AuthError, ForbiddenError } from './auth';
import { AppError } from './errors';
import { recordError } from './error-tracking';
import { GraphError } from './facebook/graph';
import { MediaError } from './media';
import { ensureSettings } from './settings';
import { fieldErrors } from './validation';

/**
 * One response shape for the whole API: `{ error, fields?, traceId? }`, so the
 * client only ever has to understand one error format.
 */

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
  /** Facebook's trace id, when the failure came from Graph. */
  traceId?: string;
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra?: Omit<ApiErrorBody, 'error'>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Translate a message key for the current request, falling back to the
 * English text carried on the error if the catalogue lookup fails for any
 * reason. An error response must never itself throw.
 */
export async function translate(key: string, params: Record<string, string | number>, fallback: string): Promise<string> {
  try {
    const [namespace, ...rest] = key.split('.');
    const t = await getTranslations(namespace);
    return t(rest.join('.'), params);
  } catch {
    return fallback;
  }
}

/**
 * Turn a thrown error into a response.
 *
 * Unrecognised errors deliberately return a generic message: an exception from
 * deep in the stack can contain a token or a connection string, and that must
 * not reach the browser. The full error still goes to the server log.
 */
export async function handleApiError(error: unknown): Promise<NextResponse> {
  if (error instanceof ZodError) {
    return fail(await translate('errors.correctFields', {}, 'Please correct the highlighted fields.'), 422, {
      fields: fieldErrors(error),
    });
  }
  if (error instanceof AppError) {
    return fail(await translate(error.key, error.params, error.message), error.status, {
      ...(error.fields ? { fields: error.fields } : {}),
    });
  }
  if (error instanceof AuthError) {
    return fail(await translate('errors.notSignedIn', {}, error.message), 401);
  }
  if (error instanceof ForbiddenError) {
    return fail(await translate('errors.noPermission', {}, error.message), 403);
  }
  if (error instanceof MediaError) {
    return fail(error.message, 415);
  }
  if (error instanceof GraphError) {
    // Facebook's own wording, passed through: it arrives in one language and
    // there is nothing to translate it against.
    const status =
      error.kind === 'auth'
        ? 401
        : error.kind === 'permission'
          ? 403
          : error.kind === 'rate_limit'
            ? 429
            : 400;
    return fail(error.displayMessage, status, { traceId: error.traceId ?? undefined });
  }

  console.error('[api] unhandled error', error);
  await recordError({ source: 'server', error, location: 'api' });
  return fail(await translate('errors.generic', {}, 'Something went wrong. Please try again.'), 500);
}

/**
 * Wrap a route handler so every thrown error becomes a structured response.
 *
 * Also the single place runtime configuration is loaded: every API request goes
 * through here, so `env` reads inside a handler are backed by a fresh-enough
 * snapshot rather than falling through to the environment.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      await ensureSettings();
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
