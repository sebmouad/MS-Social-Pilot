import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { synchronousPolicy } from './synchronous-policy';
import { cookies } from 'next/headers';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from './auth';
import { prisma } from './data';
import { runtimeConfig } from './config/store';
import { decryptSecret, encryptSecret } from './secret-crypto';

const INVITATION_COOKIE = 'msp_join';
const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
const tokenValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= synchronousPolicy('auth.invitationTokenMaxCharacters') && !/[\u0000-\u001f\u007f]/.test(value);

type InvitationCookiePayload = { token: string; expiresAt: number };
function decodePayload(envelope: string, now = Date.now()): InvitationCookiePayload | null {
  try {
    const payload: unknown = JSON.parse(decryptSecret(envelope));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const data = payload as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'expiresAt,token' || !tokenValid(data.token) || typeof data.expiresAt !== 'number' || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now) return null;
    return { token: data.token, expiresAt: data.expiresAt };
  } catch { return null; }
}

export async function readInvitationToken(): Promise<string | null> {
  const value = (await cookies()).get(INVITATION_COOKIE)?.value;
  return value ? decodePayload(value)?.token ?? null : null;
}

export async function rememberInvitationToken(rawToken: string, expiresAt: Date): Promise<void> {
  if (!tokenValid(rawToken) || !(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error('Invitation continuation is invalid or expired.');
  const configuredMinutes = await runtimeConfig('settings.invitationSessionMinutes') as number;
  if (!CONFIG_BY_KEY.get('settings.invitationSessionMinutes')?.schema.safeParse(configuredMinutes).success) throw new Error('Invitation continuation policy is unavailable.');
  const boundedExpiry = Math.min(expiresAt.getTime(), Date.now() + configuredMinutes * 60_000);
  const maxAge = Math.floor((boundedExpiry - Date.now()) / 1000);
  if (maxAge < 1) throw new Error('Invitation continuation is expired.');
  const value = encryptSecret(JSON.stringify({ token: rawToken, expiresAt: boundedExpiry } satisfies InvitationCookiePayload));
  (await cookies()).set(INVITATION_COOKIE, value, { ...COOKIE_OPTIONS, maxAge, expires: new Date(boundedExpiry) });
}

export async function clearInvitationToken(): Promise<void> {
  (await cookies()).set(INVITATION_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0, expires: new Date(0) });
}

export async function postAuthenticationPath(): Promise<'/join' | '/home'> {
  return await readInvitationToken() ? '/join' : '/home';
}

export type InvitationAccount = { id: string; email: string; sessionId: string; totpEnabled: boolean; hasPasskey: boolean; isInstanceOwner: boolean };

/** Returns account details only for the current, unexpired, fully verified legacy session. */
export async function signedInInvitationAccount(): Promise<InvitationAccount | null> {
  const token = (await cookies()).get(LEGACY_SESSION_COOKIE)?.value;
  const tokenHash = token ? hashLegacySessionToken(token) : null;
  if (!tokenHash) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true, userId: true, tokenHash: true, expiresAt: true, pending: true,
      user: { select: { id: true, email: true, disabledAt: true, totpEnabledAt: true, isInstanceOwner: true, _count: { select: { passkeys: true } } } },
    },
  });
  if (!isUsableLegacySession(session, undefined)) return null;
  return {
    id: session.user.id, email: session.user.email, sessionId: session.id,
    totpEnabled: Boolean(session.user.totpEnabledAt), hasPasskey: session.user._count.passkeys > 0,
    isInstanceOwner: session.user.isInstanceOwner,
  };
}

/** Change the current full session into a short password-verified setup step. */
export async function beginInvitationEnrollment(): Promise<void> {
  const account = await signedInInvitationAccount();
  if (!account || account.totpEnabled || account.hasPasskey) throw new Error('A verified account without a second factor is required.');
  const token = (await cookies()).get(LEGACY_SESSION_COOKIE)?.value;
  const tokenHash = token ? hashLegacySessionToken(token) : null;
  if (!tokenHash) throw new Error('Your sign-in has expired.');
  const pendingMinutes = await runtimeConfig('auth.pendingMinutes') as number;
  if (!CONFIG_BY_KEY.get('auth.pendingMinutes')?.schema.safeParse(pendingMinutes).success) throw new Error('Two-step policy is unavailable.');
  const expiresAt = new Date(Date.now() + pendingMinutes * 60_000);
  const result = await prisma.session.updateMany({
    where: { id: account.sessionId, tokenHash, pending: null, expiresAt: { gt: new Date() } },
    data: { pending: 'enroll', challenge: null, expiresAt },
  });
  if (result.count !== 1) throw new Error('Your sign-in has expired.');
  (await cookies()).set(LEGACY_SESSION_COOKIE, token!, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: pendingMinutes * 60, expires: expiresAt });
}
