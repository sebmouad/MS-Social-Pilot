import { requestOrigin } from '@/server/request-origin';
import { readBoundedJson, RequestBodyTooLarge } from '@/server/http/body';
import { sharingLimits } from '@/modules/sharing/server/limits';
import { clientIp } from '@/server/client-ip';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { submitDecision } from '@/modules/sharing/server/public';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' };
const json = (body: unknown, status: number) => Response.json(body, { status, headers });

/** Unauthenticated client answer. The token is the credential; every unresolvable link answers the same 404. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).origin !== requestOrigin(request)) return json({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); } catch { return json({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403); }
  try {
    const { token } = await context.params;
    const body = await readBoundedJson(request, (await sharingLimits()).decisionBodyMaxBytes!);
    const result = await submitDecision(token, clientIp(request), body);
    if (!result.ok) return result.reason === 'rate_limited' ? json({ error: 'Too many requests. Try again in a few minutes.', code: 'rate_limited' }, 429) : json({ error: 'This link is not available.', code: 'not_found' }, 404);
    return json(result.value, 201);
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return json({ error: error.message, code: 'invalid_request' }, 413);
    const typed = error instanceof SyntaxError ? new OperationError('invalid_request', 'Enter your name and a valid answer.') : error;
    const failure = operationFailure(typed, 'Your answer could not be sent. Try again.');
    return json({ error: failure.error, code: failure.code }, failure.status);
  }
}
