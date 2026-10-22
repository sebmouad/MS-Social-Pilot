import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import type { IntegrationsActor } from './contracts';
import { RateLimited, authenticateApiKey, type ApiKeyContext } from './server/tokens';

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
function failure(error: unknown, fallback: string) {
  if (error instanceof RateLimited) return reply({ error: error.message, code: 'rate_limited' }, 429, { 'retry-after': String(error.retryAfterSeconds) });
  const safe = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter valid details.') : error, fallback);
  return reply({ error: safe.error, code: safe.code }, safe.status);
}

/** Session-authenticated entry point: same-origin writes, current workspace, safe failures. Authorization lives in the services. */
export async function handle(request: Request, options: { feature: 'settings/account' | 'settings/mcp'; write?: boolean; success?: number; fallback: string; run: (actor: IntegrationsActor) => Promise<unknown> }) {
  if (options.write && !sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  let actor: IntegrationsActor;
  try { const viewer = await requireViewer({ feature: options.feature, channelScoped: true, ...(options.write ? { write: true } : {}) }); actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId }; }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { return reply(await options.run(actor), options.success ?? 200); } catch (error) { return failure(error, options.fallback); }
}
/** Unauthenticated protocol endpoints (connector registration, code exchange). No cookies are read. */
export async function handlePublic(options: { fallback: string; success?: number; run: () => Promise<unknown> }) {
  try { return reply(await options.run(), options.success ?? 200); } catch (error) { return failure(error, options.fallback); }
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OperationError('invalid_request', 'Enter valid details.');
  return body as Record<string, unknown>;
}
/** JSON or application/x-www-form-urlencoded (the OAuth token endpoint). */
export async function jsonOrFormBody(request: Request): Promise<Record<string, unknown>> {
  if ((request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(await request.text()).entries());
  return jsonBody(request);
}
export function query(request: Request, allowed: readonly string[]): Record<string, string> {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new OperationError('invalid_request', 'Choose valid filters.');
  return Object.fromEntries(params.entries());
}
export const pageParam = (value: string | undefined) => { if (value === undefined) return undefined; if (!/^[1-9]\d{0,4}$/.test(value)) throw new OperationError('invalid_request', 'Choose a valid result page.'); return Number(value); };

/** Key-authenticated entry point for /api/v1. Cookies are never consulted. */
export async function handleKey(request: Request, options: { need?: 'read' | 'write'; success?: number; fallback: string; run: (ctx: ApiKeyContext) => Promise<unknown> }) {
  try { const ctx = await authenticateApiKey(request, options.need ?? 'read'); return reply(await options.run(ctx), options.success ?? 200); }
  catch (error) { return failure(error, options.fallback); }
}
