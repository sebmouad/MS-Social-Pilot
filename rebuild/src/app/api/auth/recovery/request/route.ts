import { requestOrigin } from '@/server/request-origin';
import { createHash } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { requestPasswordRecovery } from '@/modules/settings/server/account-recovery';
import { hit } from '@/server/rate-limit';
import { clientIp } from '@/server/client-ip';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function readJson(request: Request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 2048) throw new Error('too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); throw new Error('too_large'); }
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
  try { body = await readJson(request); } catch { return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400, headers }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'email')) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400, headers });
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== 'string' || email.length > 320) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400, headers });
  const normalized = email.trim().toLowerCase();
  const addrAttempt = hit(`password-recovery:address:${digest(normalized)}`, { limit: 5, windowMs: 60 * 60_000 });
  const ip = clientIp(request);
  const ipAttempt = ip ? hit(`password-recovery:client:${digest(ip)}`, { limit: 20, windowMs: 60 * 60_000 }) : null;
  if (!addrAttempt.allowed || (ipAttempt && !ipAttempt.allowed)) return NextResponse.json({ error: 'Please wait before requesting another recovery email.' }, { status: 429, headers });
  // Return the same fast response for known and unknown addresses. Next keeps
  // the request context alive while the bounded recovery/mail work completes.
  after(async () => { try { await requestPasswordRecovery(normalized); } catch { /* no account or transport details in a public response */ } });
  return NextResponse.json({ requested: true, message: 'If an active account matches that address, a recovery link will be sent.' }, { headers });
}
