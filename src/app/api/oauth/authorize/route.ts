import { NextResponse } from 'next/server';

import { route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { findClient, issueCode } from '@/lib/oauth';

/**
 * The consent screen's answer. The client and redirect are checked again here:
 * the form is only a convenience, this is what decides.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? '');
  const client = await findClient(field('client_id'));
  const redirectUri = field('redirect_uri');
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Unknown client or redirect.' }, { status: 400 });
  }
  const back = new URL(redirectUri);
  if (field('state')) back.searchParams.set('state', field('state'));
  if (field('decision') !== 'allow') {
    back.searchParams.set('error', 'access_denied');
    return NextResponse.redirect(back, 303);
  }
  const challenge = field('code_challenge');
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    back.searchParams.set('error', 'invalid_request');
    return NextResponse.redirect(back, 303);
  }
  const code = await issueCode({
    clientId: client.id,
    userId: auth.user.id,
    workspaceId: auth.workspace.id,
    redirectUri,
    codeChallenge: challenge,
    scope: field('scope') === 'write' ? 'write' : 'read',
  });
  back.searchParams.set('code', code);
  return NextResponse.redirect(back, 303);
});
