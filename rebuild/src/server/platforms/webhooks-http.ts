import { NextResponse } from 'next/server';
import { OperationError } from '@/lib/operation-error';
import { clientIp } from '@/server/client-ip';
import { hit } from '@/server/rate-limit';
import { runtimeConfig } from '@/server/config/store';
import { platformWebhooks } from './registry';

/**
 * Shared transport for provider-owned inbound webhooks. The provider
 * authenticates by its own handshake token and request signature, never by a
 * session; the module verifies both, and this layer only parses, rate-limits
 * and answers. Deliveries always end in 2xx once verified so the provider does
 * not retry work that already converged.
 */
const headers = { 'cache-control': 'no-store' };

async function throttled(provider: string, request: Request): Promise<boolean> {
  const limit = await runtimeConfig('security.apiRequestsPerMinute').catch(() => 120) as number;
  const address = clientIp(request) ?? 'unknown';
  return !hit(`platform-webhook:${provider}:${address}`, { limit, windowMs: 60_000 }).allowed;
}

/** Provider endpoint-verification handshake (Meta's hub.mode challenge). */
export async function handleWebhookVerification(request: Request, provider: string): Promise<NextResponse> {
  const webhooks = platformWebhooks(provider);
  if (!webhooks) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers });
  if (await throttled(provider, request)) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers });
  const query = new URL(request.url).searchParams;
  const result = await webhooks.verifySubscription({
    mode: query.get('hub.mode'), token: query.get('hub.verify_token'), challenge: query.get('hub.challenge'),
  });
  if (!result.ok || !result.challenge) return NextResponse.json({ error: 'Verification refused.' }, { status: 403, headers });
  return new NextResponse(result.challenge, { status: 200, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
}

/** Signed event delivery. Verified events are ingested idempotently by the module. */
export async function handleWebhookDelivery(request: Request, provider: string): Promise<NextResponse> {
  const webhooks = platformWebhooks(provider);
  if (!webhooks) return NextResponse.json({ error: 'Not found.' }, { status: 404, headers });
  if (await throttled(provider, request)) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers });
  try {
    const summary = await webhooks.ingest(await request.text(), request.headers.get('x-hub-signature-256'));
    return NextResponse.json({ ok: true, ...summary }, { status: 200, headers });
  } catch (error) {
    if (error instanceof OperationError && error.code === 'unauthorized') return NextResponse.json({ error: 'Invalid signature.' }, { status: 401, headers });
    if (error instanceof OperationError && error.code === 'invalid_request') return NextResponse.json({ error: 'Invalid webhook payload.' }, { status: 400, headers });
    if (error instanceof OperationError && error.code === 'unavailable') return NextResponse.json({ error: 'Webhook reception is not configured.' }, { status: 503, headers });
    console.error(`[${provider}/webhooks]`, error instanceof Error ? error.message : 'failed');
    return NextResponse.json({ error: 'Could not process the webhook delivery.' }, { status: 500, headers });
  }
}
