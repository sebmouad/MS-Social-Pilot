import { NextResponse } from 'next/server';
import { operationFailure } from '@/lib/operation-error';
import { verifyEmail } from '@/modules/settings/server/registration';
import { hit } from '@/server/rate-limit';
import { clientIp } from '@/server/client-ip';
import { denied, digest, noStore, readPublicJson, sameOrigin } from '../public-request';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return denied();
  const body = await readPublicJson(request, 512, ['token']);
  if (!body) return NextResponse.json({ error: 'This confirmation link is invalid or has expired. Request a new one.' }, { status: 400, headers: noStore });
  const ip = clientIp(request);
  if (ip && !hit(`verify-email:client:${digest(ip)}`, { limit: 30, windowMs: 60 * 60_000 }).allowed) return NextResponse.json({ error: 'Please wait before trying again.' }, { status: 429, headers: noStore });
  try { return NextResponse.json(await verifyEmail(body.token), { headers: noStore }); }
  catch (error) {
    const failure = operationFailure(error, 'Your email could not be confirmed. Try again later.');
    return NextResponse.json({ error: failure.error }, { status: failure.status, headers: noStore });
  }
}
