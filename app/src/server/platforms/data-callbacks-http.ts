import { NextResponse } from 'next/server';
import { clientIp } from '@/server/client-ip';
import { hit } from '@/server/rate-limit';
import { runtimeConfig } from '@/server/config/store';
import { requestOrigin } from '@/server/request-origin';
import { platformDataCallbacks } from './registry';

/** Route of the public status page (`src/app/data-deletion`); a route, not an operational setting. */
export const DATA_DELETION_STATUS_PATH = '/data-deletion';
const headers ={ 'cache-control': 'no-store' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

/**
 * Shared transport for provider-signed removal callbacks. The provider authenticates by signature, not by
 * a session, so the module verifies it; this layer only parses the form body, limits callers and answers
 * in the shape Meta expects (a status URL plus confirmation code for deletion requests).
 */
export async function handleDataCallback(request: Request, provider: string, kind: 'deauthorize' | 'dataDeletion'): Promise<NextResponse> {
  const callbacks = platformDataCallbacks(provider);
  if (!callbacks) return reply({ error: 'Not found.' }, 404);
  const limit = await runtimeConfig('security.apiRequestsPerMinute').catch(() => 120) as number;
  const address = clientIp(request) ?? 'unknown';
  if (!hit(`platform-callback:${provider}:${address}`, { limit, windowMs: 60_000 }).allowed) return reply({ error: 'Too many requests.' }, 429);
  let signedRequest: string | null = null;
  try { signedRequest = new URLSearchParams(await request.text()).get('signed_request'); } catch { /* answered below */ }
  if (!signedRequest || signedRequest.length > 8192) return reply({ error: 'Missing signed_request.' }, 400);
  try {
    const result = await callbacks[kind](signedRequest);
    if (!result.ok) return reply({ error: 'Invalid signature.' }, 401);
    if (kind === 'deauthorize') return reply({ ok: true });
    const code = result.confirmationCode ?? '';
    return reply({ url: `${requestOrigin(request)}${DATA_DELETION_STATUS_PATH}?code=${encodeURIComponent(code)}`, confirmation_code: code });
  } catch (error) {
    console.error(`[${provider}/${kind}]`, error instanceof Error ? error.message : 'failed');
    // Deauthorize answers 200 so the provider does not disable the callback over a transient fault.
    return kind === 'deauthorize' ? reply({ ok: false }) : reply({ error: 'Could not process the deletion request.' }, 500);
  }
}
