import { synchronousPolicy, withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { requestOrigin } from '@/server/request-origin';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { acceptTeamInvitation, previewTeamInvitation, registerTeamInvitation } from '@/modules/settings/server/invitations';
import { beginInvitationEnrollment, clearInvitationToken, readInvitationToken, rememberInvitationToken, signedInInvitationAccount } from './invitation-session';
import { runtimeConfig } from './config/store';
import { authRateLimit } from './auth-flow';
import { needsTwoStepEnrollment } from './auth-policy';
import { clientIp } from './client-ip';
import { hit } from './rate-limit';

export type InvitationHttpAction = 'preview' | 'accept' | 'register' | 'enroll';
const schemas = {
  preview: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).strict(),
  accept: z.object({ confirmation: z.string().refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict(),
  enroll: z.object({ confirmation: z.string().refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict(),
  register: z.object({ name: z.string().trim().min(1).refine(withinSynchronousLimit('settings.accountNameMaxLength')), password: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= synchronousPolicy('auth.passwordMaxBytes')), confirmation: z.string().refine(withinSynchronousLimit('root.confirmationMaxCharacters')) }).strict(),
};
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
export async function handleInvitationHttp(request: Request, action: InvitationHttpAction) {
  if (request.headers.get('origin') !== requestOrigin(request)) return reply({ error: 'Cross-origin request denied.', code: 'forbidden' }, 403);
  try {
    const limits = await authRateLimit();
    if (!hit(`rebuild-invitation:${action}:${clientIp(request) ?? 'unidentified'}`, limits).allowed) return reply({ error: 'Too many attempts. Try again later.', code: 'rate_limited' }, 429);
    let input: unknown;
    try { input = await request.json(); } catch { throw new OperationError('invalid_request', 'Invalid invitation details.'); }
    const checked = schemas[action].safeParse(input);
    if (!checked.success) throw new OperationError('invalid_request', 'Check the invitation details and try again.');
    const supplied = action === 'preview' ? (checked.data as { token?: string }).token : undefined;
    const token = supplied ?? await readInvitationToken();
    if (!token) throw new OperationError('not_found', 'Open the invitation link from your email to continue.');
    if (!hit(`rebuild-invitation-token:${action}:${createHash('sha256').update(token).digest('hex')}`, limits).allowed) return reply({ error: 'Too many attempts. Try again later.', code: 'rate_limited' }, 429);
    const invitation = await previewTeamInvitation(token);
    if (action === 'register') {
      const details = checked.data as { name: string; password: string; confirmation: string };
      const result = await registerTeamInvitation({ ...details, token });
      await clearInvitationToken();
      return reply({ ok: true, ...result, next: '/sign-in' });
    }
    const account = await signedInInvitationAccount();
    const needsEnrollment = account ? needsTwoStepEnrollment(await runtimeConfig('security.twoStep'), account.isInstanceOwner, [invitation.role]) && !account.totpEnabled && !account.hasPasskey : false;
    if (action === 'preview') {
      if (supplied) await rememberInvitationToken(token, new Date(invitation.expiresAt));
      return reply({ ...invitation, signedInEmail: account?.email ?? null, needsEnrollment });
    }
    if (!account) throw new OperationError('unauthorized', 'Sign in and finish verification before accepting the invitation.');
    if (account.email.toLowerCase() !== invitation.email.toLowerCase()) throw new OperationError('forbidden', 'Sign in with the email address this invitation was sent to.');
    const confirmation = (checked.data as { confirmation: string }).confirmation;
    if (action === 'enroll') {
      if (!needsEnrollment || confirmation !== `ENROLL FOR INVITATION ${invitation.id}`) throw new OperationError('invalid_request', 'Check the verification request and try again.');
      await beginInvitationEnrollment();
      return reply({ ok: true, next: '/two-step/enroll' });
    }
    const result = await acceptTeamInvitation(token, account.id, confirmation);
    await clearInvitationToken();
    (await cookies()).set('sp_workspace', result.workspaceId, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    return reply({ ok: true, ...result, next: '/home' });
  } catch (error) {
    const safe = operationFailure(error, 'The invitation operation could not be confirmed. Check your account before trying again.');
    return reply({ error: safe.error, code: safe.code }, safe.status);
  }
}
