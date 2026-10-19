import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

/** Shared guards for public account routes: same-origin, bounded JSON body, exact keys. */
export const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  try { return Boolean(origin) && new URL(origin!).origin === new URL(request.url).origin; } catch { return false; }
}
export async function readPublicJson(request: Request, maxBytes: number, keys: readonly string[]): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) return null;
    return body as Record<string, unknown>;
  } catch { return null; }
}
export const denied = () => NextResponse.json({ error: 'Request denied.' }, { status: 403, headers: noStore });
