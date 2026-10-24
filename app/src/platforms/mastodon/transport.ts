import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { isPublicAddress } from '@/server/platforms/provider-http';

/** Internet-routable unicast only; mapped IPv6 is always refused, including hexadecimal encodings. */
export function isMastodonPublicAddress(address: string): boolean {
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address) && isPublicAddress(address);
  if (isIP(address) !== 4 || !isPublicAddress(address)) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 192 && (b === 0 || b === 2) || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0);
}
import type { MastodonSafeTransport } from './adapter';

/** Resolve once, reject private answers, pin the TLS connection, refuse redirects and cap bytes. */
export function mastodonTransport(maxBytes: number): MastodonSafeTransport {
  return async (raw, init) => {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid server');
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(item => !isMastodonPublicAddress(item.address))) throw new Error('Invalid server');
    const address = addresses[0]!;
    // Request performs standards-compliant multipart serialization without sending it.
    const prepared = new Request(url, init);
    const body = init.body ? Buffer.from(await prepared.arrayBuffer()) : undefined;
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(init.timeoutMs)]) : AbortSignal.timeout(init.timeoutMs);
    return new Promise((resolve, reject) => {
      const req = request(url, { method: init.method, headers: Object.fromEntries(prepared.headers), signal, agent: false,
        lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => options?.all ? callback(null, [{ address: address.address, family: isIP(address.address) }]) : callback(null, address.address, isIP(address.address))) as never,
      }, response => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); reject(new Error('Server request failed')); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) { response.destroy(new Error('Response too large')); return; } chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid server response')); } });
      });
      req.on('error', reject); req.end(body);
    });
  };
}
