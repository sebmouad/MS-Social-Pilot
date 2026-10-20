import { requestOrigin } from '@/server/request-origin';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { completePasswordRecovery } from '@/modules/settings/server/account-recovery';
import { hit } from '@/server/rate-limit';
import { clientIp } from '@/server/client-ip';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };
async function readJson(request: Request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 12_288) throw new Error('too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 12_288) { await reader.cancel(); throw new Error('too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).origin !== requestOrigin(request)) return NextResponse.json({ error: 'Request denied.' }, { status: 403, headers }); }
  catch { return NextResponse.json({ error: 'Request denied.' }, { status: 403, headers }); }
  let body: unknown;
  try { body = await readJson(request); } catch { return NextResponse.json({ error: 'Enter a valid recovery link and password.' }, { status: 400, headers }); }
  const parsed = z.object({ token: z.string().length(43), password: z.string().max(4096) }).strict().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid recovery link and password.' }, { status: 400, headers });
  const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex');
  const tokenAttempt = hit(`password-recovery:reset-token:${tokenHash}`, { limit: 5, windowMs: 60 * 60_000 });
  const ip = clientIp(request);
  const ipAttempt = ip ? hit(`password-recovery:reset-client:${createHash('sha256').update(ip).digest('hex')}`, { limit: 30, windowMs: 60 * 60_000 }) : null;
  if (!tokenAttempt.allowed || (ipAttempt && !ipAttempt.allowed)) return NextResponse.json({ error: 'Please wait before trying again.' }, { status: 429, headers });
  try {
    const result = await completePasswordRecovery(parsed.data.token, parsed.data.password);
    return NextResponse.json(result, { headers });
  } catch (error) {
    const safe = error instanceof OperationError ? error : null;
    return NextResponse.json({ error: safe?.message ?? 'Password recovery is temporarily unavailable. Try again later.' }, { status: safe?.code === 'invalid_request' ? 400 : 503, headers });
  }
}
