import { requestOrigin } from '@/server/request-origin';
import type { AnalyticsFeature } from '@/modules/analytics/server/access';
import { operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';

export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin'); if (!origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
export async function viewerActor(feature: AnalyticsFeature, write: boolean) {
  try { const viewer = await requireViewer({ feature, channelScoped: true, ...(write ? { write: true } : {}) }); return { userId: viewer.user.id, workspaceId: viewer.workspaceId }; }
  catch { return null; }
}
export const unauthorized = () => reply({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' }, 401);
export function failure(error: unknown, fallback: string) {
  if (error instanceof SyntaxError) return reply({ error: 'Enter valid details.', code: 'invalid_request' }, 400);
  const result = operationFailure(error, fallback);
  return reply({ error: result.error, code: result.code }, result.status);
}
export function paramsObject(url: string): Record<string, unknown> {
  const params = new URL(url).searchParams; const out: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) { const values = params.getAll(key); out[key] = values.length > 1 ? values : values[0]; }
  return out;
}
export function pageParam(url: string): { ok: true; input: { page?: number } } | { ok: false } {
  const params = new URL(url).searchParams; const page = params.get('page');
  if ([...params.keys()].some(key => key !== 'page') || (page !== null && !/^[1-9]\d{0,3}$/.test(page))) return { ok: false };
  return { ok: true, input: page ? { page: Number(page) } : {} };
}
