import { isIP } from 'node:net';
import { checkUrlShape, defaultResolver, isNonPublicAddress, type Resolver } from '@/modules/publishing/server/media/network/net-guard';
import { OperationError } from '@/lib/operation-error';
import { signWebhook } from '../contracts';

/**
 * Outbound webhook transport. Everything the network touches is an injected port, so tests never open a socket.
 * Addresses are user-supplied, so every use (create and every send) passes the shared SSRF guard: https only, no
 * credentials, web ports only, no internal names or private addresses, optional operator allowlist, and every
 * resolved address must be public. The default sender is the shared address-pinning transport, which connects only to
 * one of the validated addresses (closing DNS rebinding) and never follows redirects.
 */
export type SendRequest = { url: string; headers: Record<string, string>; body: string; signal: AbortSignal; resolved: readonly string[] };
export type WebhookSender = (request: SendRequest) => Promise<{ status: number }>;
export type WebhookDeps = { resolve: Resolver; send: WebhookSender };
export const defaultSender: WebhookSender = async ({ url, headers, body, signal, resolved }) => {
  const { pinnedFetcher } = await import('@/modules/publishing/server/media/network/pinned-fetch');
  const response = await pinnedFetcher({ url, headers, signal, resolved, method: 'POST', body });
  void response.body?.cancel().catch(() => undefined);
  return { status: response.status };
};
export const defaultWebhookDeps = (): WebhookDeps => ({ resolve: defaultResolver, send: defaultSender });

export class AddressRefused extends OperationError { constructor(message = 'Use a public https:// address that can receive webhooks.') { super('invalid_request', message); this.name = 'AddressRefused'; } }

/** Validate a receiver address and return the public addresses it resolves to. Throws {@link AddressRefused}. */
export async function checkReceiver(raw: string, allowlist: readonly string[], resolve: Resolver): Promise<{ url: URL; resolved: string[] }> {
  let url: URL;
  try { url = checkUrlShape(raw, { allowHttp: false, hostAllowlist: allowlist }); } catch { throw new AddressRefused(); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return { url, resolved: [host] };
  let answers: string[];
  try { answers = await resolve(host); } catch { throw new AddressRefused('That address could not be found. Check it and try again.'); }
  if (!answers.length || answers.some(isNonPublicAddress)) throw new AddressRefused();
  return { url, resolved: answers };
}

export type Outcome = { ok: boolean; status: number | null; error: string | null; retryable: boolean };
/** One signed POST. Failure text is a short fixed phrase, never transport or receiver text. */
export async function sendSigned(input: { url: string; secret: string; deliveryId: string; event: string; body: string; now: Date; timeoutMs: number; allowlist: readonly string[]; deps: WebhookDeps }): Promise<Outcome> {
  let target: { url: URL; resolved: string[] };
  try { target = await checkReceiver(input.url, input.allowlist, input.deps.resolve); }
  catch { return { ok: false, status: null, error: 'Address is not allowed.', retryable: false }; }
  const timestamp = Math.floor(input.now.getTime() / 1000);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const { status } = await input.deps.send({
      url: target.url.toString(), body: input.body, signal: controller.signal, resolved: target.resolved,
      headers: { 'content-type': 'application/json', 'user-agent': 'MS-Social-Pilot-Webhooks/1', 'x-msp-event': input.event, 'x-msp-delivery': input.deliveryId, 'x-msp-timestamp': String(timestamp), 'x-msp-signature': signWebhook(input.secret, timestamp, input.body) },
    });
    if (status >= 200 && status < 300) return { ok: true, status, error: null, retryable: false };
    return { ok: false, status, error: status >= 300 && status < 400 ? `Answered ${status} (redirects are not followed).` : `Answered ${status}.`, retryable: true };
  } catch {
    return { ok: false, status: null, error: controller.signal.aborted ? 'Timed out.' : 'Could not be reached.', retryable: true };
  } finally { clearTimeout(timer); }
}
