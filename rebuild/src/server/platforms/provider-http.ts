import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PlatformApiError } from '@/platforms/errors';

/**
 * Platform-neutral HTTP helpers for modules that talk to a plain JSON/OAuth API.
 * Nothing here knows a provider: modules pass URLs, limits and customer-safe
 * messages from their own Root policy.
 */
export class ProviderHttpError extends PlatformApiError {
  constructor(message: string, readonly outcome: 'rejected' | 'uncertain', retryable = false, readonly status?: number) {
    super(message, retryable);
    this.name = 'ProviderHttpError';
  }
}

export type ProviderMessages = { unavailable: string; permission: string; uncertain: string };
export type ProviderResponse = { status: number; headers: Headers; json: Record<string, unknown> };

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const object = record;

/**
 * One request with a timeout. `committing` marks a call after which the provider may already hold the
 * effect (an upload, a publish): a lost answer is then uncertain and must never be sent again automatically.
 */
export async function providerRequest(input: {
  fetch?: typeof fetch; url: string; method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; headers?: Record<string, string>;
  body?: BodyInit | null; timeoutMs: number; signal?: AbortSignal; messages: ProviderMessages; committing?: boolean;
  /** Empty or non-JSON success bodies (DELETE, PUT) are accepted when true. */
  allowEmpty?: boolean;
}): Promise<ProviderResponse> {
  const { messages } = input;
  if (input.signal?.aborted) throw new ProviderHttpError(messages.unavailable, 'rejected');
  const timeout = AbortSignal.timeout(input.timeoutMs);
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(input.url, {
      method: input.method ?? 'GET', headers: input.headers, body: input.body ?? undefined, redirect: 'error',
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
    });
  } catch {
    throw input.committing ? new ProviderHttpError(messages.uncertain, 'uncertain', false) : new ProviderHttpError(messages.unavailable, 'rejected', true);
  }
  const text = await response.text().catch(() => '');
  let json: Record<string, unknown> = {};
  if (text) { try { json = record(JSON.parse(text)); } catch { /* handled below */ } }
  if (!response.ok) {
    const auth = response.status === 401 || response.status === 403;
    throw new ProviderHttpError(auth ? messages.permission : messages.unavailable, 'rejected', response.status === 429 || response.status >= 500, response.status);
  }
  if (!text && !input.allowEmpty) throw new ProviderHttpError(input.committing ? messages.uncertain : messages.unavailable, input.committing ? 'uncertain' : 'rejected');
  if (text && !Object.keys(json).length && !input.allowEmpty) throw new ProviderHttpError(input.committing ? messages.uncertain : messages.unavailable, input.committing ? 'uncertain' : 'rejected');
  return { status: response.status, headers: response.headers, json };
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1' || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || /^f[cd]/.test(lower)) return false;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPublicAddress(mapped[1]!) : true;
  }
  return false;
}

/**
 * Download customer media the provider requires as bytes. Only https, no credentials, no redirects,
 * a public address and a hard size ceiling; the caller supplies the ceiling from Root policy.
 */
export async function fetchPublicMedia(input: {
  url: string; maxBytes: number; timeoutMs: number; signal?: AbortSignal; fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>; messages: { invalid: string; tooLarge: string; unavailable: string };
}): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let url: URL;
  try { url = new URL(input.url); } catch { throw new ProviderHttpError(input.messages.invalid, 'rejected'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new ProviderHttpError(input.messages.invalid, 'rejected');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await (input.resolve ?? (async name => (await lookup(name, { all: true })).map(item => item.address)))(host).catch(() => [] as string[]);
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new ProviderHttpError(input.messages.invalid, 'rejected');
  const timeout = AbortSignal.timeout(input.timeoutMs);
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(url, { redirect: 'error', signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout });
  } catch { throw new ProviderHttpError(input.messages.unavailable, 'rejected', true); }
  if (!response.ok || !response.body) throw new ProviderHttpError(input.messages.unavailable, 'rejected', response.status >= 500);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > input.maxBytes) throw new ProviderHttpError(input.messages.tooLarge, 'rejected');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > input.maxBytes) { await reader.cancel().catch(() => undefined); throw new ProviderHttpError(input.messages.tooLarge, 'rejected'); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    throw new ProviderHttpError(input.messages.unavailable, 'rejected', true);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!total) throw new ProviderHttpError(input.messages.invalid, 'rejected');
  return { bytes, mimeType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() };
}
