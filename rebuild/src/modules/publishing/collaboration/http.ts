import { requireViewer } from '@/server/context';
import { OperationError, operationFailure } from '@/lib/operation-error';
import type { PublishingActor } from '../server/types';

/** Thin HTTP adapter shared by the collaboration routes: same-origin writes, viewer resolution, safe failures. */
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
type Feature = 'publishing/collaboration' | 'publishing/queue' | 'publishing/posts';

export async function handle(request: Request, options: { feature: Feature; write?: boolean; success?: number; fallback: string; run: (actor: PublishingActor, request: Request) => Promise<unknown> }) {
  if (options.write && !sameOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  if (options.write && new URL(request.url).search) return reply({ error: 'Choose valid details.', code: 'invalid_request' }, 400);
  let actor: PublishingActor;
  try { const viewer = await requireViewer({ feature: options.feature, channelScoped: true, ...(options.write ? { write: true } : {}) }); actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId }; }
  catch { return reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401); }
  try { return reply(await options.run(actor, request), options.success ?? 200); }
  catch (error) { const failure = operationFailure(error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter valid details.') : error, options.fallback); return reply({ error: failure.error, code: failure.code }, failure.status); }
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OperationError('invalid_request', 'Enter valid details.');
  return body as Record<string, unknown>;
}
/** Query parameters: only the allowed keys, each exactly once. */
export function query(request: Request, allowed: readonly string[]): Record<string, string> {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new OperationError('invalid_request', 'Choose valid filters.');
  return Object.fromEntries(params.entries());
}
export function pageParam(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d{0,4}$/.test(value)) throw new OperationError('invalid_request', 'Choose a valid result page.');
  return Number(value);
}
