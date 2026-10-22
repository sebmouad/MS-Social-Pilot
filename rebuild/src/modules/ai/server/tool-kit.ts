import { z } from 'zod';
import { operationFailure, OperationError, type OperationErrorCode } from '@/lib/operation-error';
import { requestOrigin } from '@/server/request-origin';
import { requireViewer } from '@/server/context';
import { configOrDefault } from '@/server/config/config-or-default';

/** Safe customer sentences for every failure a composer tool can return, English and French. */
export const toolErrorCopySchema = z.object({ invalid_request: z.string().min(1), unauthorized: z.string().min(1), forbidden: z.string().min(1), not_found: z.string().min(1), unavailable: z.string().min(1), reconnect_required: z.string().min(1), conflict: z.string().min(1), upstream_failure: z.string().min(1) });
export type ToolErrorCopy = z.infer<typeof toolErrorCopySchema>;
export type Locale = 'en' | 'fr';
export const localeOf = (header: string | null | undefined): Locale => /^fr\b/i.test(header ?? '') ? 'fr' : 'en';

/** Throw the catalog sentence for a code; services never build messages from provider or transport text. */
export const toolFailure = (copy: ToolErrorCopy, code: OperationErrorCode) => new OperationError(code, copy[code]);

/** Run a service, translating anything unexpected into the catalog's upstream-failure sentence. */
export async function guarded<T>(copy: ToolErrorCopy, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof OperationError) throw error;
    throw toolFailure(copy, 'upstream_failure');
  }
}

/** Catalog for a locale; a missing or invalid Root value falls back to the registered default. */
export async function catalogFor<S extends z.ZodType<{ en: Record<string, unknown>; fr: Record<string, unknown> }>>(key: string, schema: S, locale: Locale): Promise<z.infer<S>['en']> {
  const catalog = await configOrDefault(key, schema);
  return catalog[locale];
}

export type ToolViewerActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] };

/**
 * One thin REST entry for an authenticated, same-origin JSON tool. Every domain decision
 * (authorization, scope, confirmation, audit) stays in the service the handler calls.
 */
export async function toolRoute(request: Request, options: {
  module: string; feature: string; errorCopy: (locale: Locale) => Promise<ToolErrorCopy>;
  /** GET input from the query string; omit for POST-only tools. */
  query?: (params: URLSearchParams) => unknown;
  run: (actor: ToolViewerActor, input: unknown, locale: Locale) => Promise<unknown>;
}): Promise<Response> {
  const locale = localeOf(request.headers.get('accept-language'));
  const copy = await options.errorCopy(locale);
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
  try {
    const isGet = request.method === 'GET';
    if (!isGet) {
      const origin = request.headers.get('origin');
      if (!origin || new URL(origin).origin !== requestOrigin(request)) return reply({ error: copy.forbidden, code: 'forbidden' }, 403);
    }
    const viewer = await requireViewer({ module: options.module, feature: options.feature, channelScoped: true, ...(isGet ? {} : { write: true }) });
    const scope = viewer.permissions.pageScope;
    const actor: ToolViewerActor = { userId: viewer.user.id, workspaceId: viewer.workspaceId, ...(scope.all ? {} : { allowedTargetIds: scope.ids }) };
    let input: unknown;
    if (isGet) {
      if (!options.query) return reply({ error: copy.invalid_request, code: 'invalid_request' }, 405);
      input = options.query(new URL(request.url).searchParams);
    } else {
      try { input = await request.json(); } catch { return reply({ error: copy.invalid_request, code: 'invalid_request' }, 400); }
    }
    return reply(await options.run(actor, input, locale));
  } catch (error) {
    const failure = operationFailure(error, copy.upstream_failure);
    // Services throw catalog sentences; anything else (guards, redirects) gets the catalog text for its code.
    const message = error instanceof OperationError && error.message !== error.code ? failure.error : copy[failure.code as keyof ToolErrorCopy] ?? failure.error;
    return reply({ error: message, code: failure.code }, failure.status);
  }
}

/** Query-string reader: only the named single-valued keys are accepted. */
export function singleParams(params: URLSearchParams, allowed: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new OperationError('invalid_request', 'invalid_request');
    out[key] = params.get(key)!;
  }
  return out;
}
