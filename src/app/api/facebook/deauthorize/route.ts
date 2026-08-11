import { NextResponse } from 'next/server';

import { invalidateAccountsForFacebookUser } from '@/lib/accounts';
import { parseSignedRequest } from '@/lib/facebook/oauth';
import { ensureSettings } from '@/lib/settings';

/**
 * Deauthorize callback.
 *
 * Facebook calls this when a user removes the app from their Facebook
 * settings. Every token we hold for them is already dead at that point, so the
 * connections are flagged immediately — otherwise the failure only surfaces
 * the next time a scheduled post tries to publish.
 *
 * Configure the URL in the Meta app dashboard under
 * Facebook Login → Settings → Deauthorize callback URL.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Meta calls this directly, so there is no session handler ahead of it to
    // have loaded the settings snapshot — and the very next thing needed is the
    // app secret, which lives in the settings store. Without this, an install
    // configured on the config screen rather than through the environment
    // rejects Meta's callbacks outright.
    await ensureSettings();

    const form = await request.formData();
    const signedRequest = form.get('signed_request');

    if (typeof signedRequest !== 'string') {
      return NextResponse.json({ error: 'Missing signed_request.' }, { status: 400 });
    }

    const payload = parseSignedRequest(signedRequest);
    if (!payload?.user_id) {
      // A bad signature means it did not come from Facebook.
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
    }

    const count = await invalidateAccountsForFacebookUser(
      payload.user_id,
      'The Facebook user removed this app, so its access tokens were revoked.',
    );

    return NextResponse.json({ ok: true, invalidated: count });
  } catch (error) {
    console.error('[facebook/deauthorize]', error);
    // Returning 200 keeps Facebook from disabling the callback over a
    // transient fault on our side; the error is recorded in our logs.
    return NextResponse.json({ ok: false });
  }
}
