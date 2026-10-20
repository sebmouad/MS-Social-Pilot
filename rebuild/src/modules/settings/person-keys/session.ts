import { cookies } from 'next/headers';
import { OperationError } from '@/lib/operation-error';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash } from '@/server/data';

/** Session-only account authority: losing the selected workspace must not prevent key revocation. */
export async function personKeySessionActor() {
  const token = (await cookies()).get(LEGACY_SESSION_COOKIE)?.value;
  const hash = token ? hashLegacySessionToken(token) : null;
  const session = hash ? await getSessionByTokenHash(hash) : null;
  if (!isUsableLegacySession(session, undefined)) throw new OperationError('unauthorized', 'Sign in to continue.');
  return { userId: session.userId };
}
