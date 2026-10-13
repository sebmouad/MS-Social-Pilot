import { NextResponse } from 'next/server';

import { exchangeCode, OAuthError } from '@/lib/oauth';

/** The token endpoint: a code and its PKCE verifier in, an API key out. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const field = (name: string) => String(form?.get(name) ?? '');
  const headers = { 'cache-control': 'no-store' };
  try {
    if (field('grant_type') !== 'authorization_code') throw new OAuthError('unsupported_grant_type', 'Only authorization_code is supported.');
    if (!field('code') || !field('client_id') || !field('redirect_uri') || !field('code_verifier')) {
      throw new OAuthError('invalid_request', 'code, client_id, redirect_uri and code_verifier are required.');
    }
    const token = await exchangeCode({ code: field('code'), clientId: field('client_id'), redirectUri: field('redirect_uri'), verifier: field('code_verifier') });
    return NextResponse.json(token, { headers });
  } catch (error) {
    if (error instanceof OAuthError) return NextResponse.json({ error: error.code, error_description: error.message }, { status: 400, headers });
    return NextResponse.json({ error: 'invalid_request', error_description: error instanceof Error ? error.message : 'Something went wrong.' }, { status: 400, headers });
  }
}
