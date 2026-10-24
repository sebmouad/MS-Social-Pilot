import { requestOrigin } from '@/server/request-origin';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { requireViewer } from '@/server/context';
import { AREA_FEATURE, type SharingArea } from '@/modules/sharing/semantics';

export const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...extra } });
export function sameOrigin(request: Request) { const origin = request.headers.get('origin'); if (!origin) return false; try { return new URL(origin).origin === requestOrigin(request); } catch { return false; } }
/** Session actor for one sharing area. The page route only gates entry; the service re-checks everything per call. */
export async function ownerActor(area: SharingArea, write: boolean) {
  try { const viewer = await requireViewer({ feature: AREA_FEATURE[area], ...(write ? { write: true } : {}) }); return { userId: viewer.user.id, workspaceId: viewer.workspaceId }; }
  catch (error) {
    const digest = typeof (error as { digest?: unknown } | null)?.digest === 'string' ? (error as { digest: string }).digest : '';
    if (digest.startsWith('NEXT_REDIRECT')) {
      if (digest.includes('/sign-in')) return null;
      throw new OperationError('forbidden', 'Sharing is unavailable with your current access.');
    }
    throw error;
  }
}
export function failure(error: unknown, fallback: string) {
  const typed = error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter valid details.') : error;
  const result = operationFailure(typed, fallback); return reply({ error: result.error, code: result.code }, result.status);
}
/** Absolute address for a secret path, built from the request's own origin. */
export const absolute = (request: Request, path: string) => new URL(path, requestOrigin(request)).toString();

/** Includes entry-gate failures as well as service failures; never turns an access refusal into a sign-in loop. */
export function withSharingErrors<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try { return await handler(...args); }
    catch (error) { return failure(error, 'The sharing request could not be completed. Please try again.'); }
  };
}
