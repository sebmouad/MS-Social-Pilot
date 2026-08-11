import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { parseSignedRequest } from '@/lib/facebook/oauth';
import { ensureSettings } from '@/lib/settings';

/**
 * Data deletion request callback — required by Meta for app review.
 *
 * Facebook expects a JSON body containing a status URL the user can visit and
 * a confirmation code. We delete the connection and its stored tokens
 * synchronously, then report the request as complete.
 *
 * Published-post records are intentionally kept: they are the workspace
 * owner's business records about their own Pages, not personal data belonging
 * to the Facebook user who authorised the app. Adjust to taste for your
 * jurisdiction — this is the decision worth reviewing with counsel.
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
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
    }

    const confirmationCode = randomUUID();

    const accounts = await prisma.socialAccount.findMany({
      where: { provider: 'facebook', providerUserId: payload.user_id },
      select: { id: true, workspaceId: true },
    });

    for (const account of accounts) {
      const targets = await prisma.target.findMany({
        where: { socialAccountId: account.id },
        select: { id: true },
      });
      const targetIds = targets.map((target) => target.id);

      await prisma.$transaction([
        prisma.target.updateMany({
          where: { id: { in: targetIds } },
          data: {
            accessToken: null,
            enabled: false,
            canPublish: false,
            publishBlocker: 'Removed at the request of the Facebook user.',
          },
        }),
        prisma.postTarget.updateMany({
          where: { targetId: { in: targetIds }, status: { in: ['pending', 'processing', 'scheduled_remote'] } },
          data: { status: 'cancelled', errorMessage: 'Cancelled by a Facebook data deletion request.' },
        }),
        prisma.socialAccount.delete({ where: { id: account.id } }),
        prisma.activityLog.create({
          data: {
            workspaceId: account.workspaceId,
            action: 'account.data_deletion',
            detail: JSON.stringify({ confirmationCode, facebookUserId: payload.user_id }),
          },
        }),
      ]);
    }

    return NextResponse.json({
      url: `${env.appUrl}/data-deletion?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  } catch (error) {
    console.error('[facebook/data-deletion]', error);
    return NextResponse.json({ error: 'Could not process the deletion request.' }, { status: 500 });
  }
}
