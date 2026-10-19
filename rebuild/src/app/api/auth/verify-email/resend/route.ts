import { after, NextResponse } from 'next/server';
import { resendVerification } from '@/modules/settings/server/registration';
import { hit } from '@/server/rate-limit';
import { clientIp } from '@/server/client-ip';
import { denied, digest, noStore, readPublicJson, sameOrigin } from '../../public-request';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return denied();
  const body = await readPublicJson(request, 1024, ['email']);
  const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 320) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400, headers: noStore });
  const ip = clientIp(request);
  const address = hit(`verify-resend:address:${digest(email)}`, { limit: 3, windowMs: 60 * 60_000 });
  const client = ip ? hit(`verify-resend:client:${digest(ip)}`, { limit: 20, windowMs: 60 * 60_000 }) : null;
  if (!address.allowed || (client && !client.allowed)) return NextResponse.json({ error: 'Please wait before requesting another email.' }, { status: 429, headers: noStore });
  after(async () => { try { await resendVerification(email); } catch { /* generic */ } });
  return NextResponse.json({ requested: true, message: 'If an unconfirmed account matches that address, a new link will be sent.' }, { headers: noStore });
}
