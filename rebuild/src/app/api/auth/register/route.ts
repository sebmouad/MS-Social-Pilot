import { NextResponse } from 'next/server';
import { operationFailure } from '@/lib/operation-error';
import { registerAccount, registrationAvailable } from '@/modules/settings/server/registration';
import { hit } from '@/server/rate-limit';
import { clientIp } from '@/server/client-ip';
import { denied, digest, noStore, readPublicJson, sameOrigin } from '../public-request';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return denied();
  const body = await readPublicJson(request, 4096, ['name', 'email', 'password']);
  if (!body) return NextResponse.json({ error: 'Enter your name, email and a password.' }, { status: 400, headers: noStore });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const ip = clientIp(request);
  const address = hit(`registration:address:${digest(email)}`, { limit: 3, windowMs: 60 * 60_000 });
  const client = ip ? hit(`registration:client:${digest(ip)}`, { limit: 10, windowMs: 60 * 60_000 }) : null;
  if (!address.allowed || (client && !client.allowed)) return NextResponse.json({ error: 'Please wait before trying to sign up again.' }, { status: 429, headers: noStore });
  try {
    await registerAccount(body);
    return NextResponse.json({ requested: true, message: 'Check your email for a link to confirm your address and create your workspace.' }, { headers: noStore });
  } catch (error) {
    const failure = operationFailure(error, 'Sign-up is temporarily unavailable. Try again later.');
    return NextResponse.json({ error: failure.error }, { status: failure.status, headers: noStore });
  }
}

/** Public: whether sign-up is offered (open and email working). No other detail. */
export async function GET() {
  return NextResponse.json({ available: await registrationAvailable() }, { headers: noStore });
}
