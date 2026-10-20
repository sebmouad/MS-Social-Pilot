import { cookies } from 'next/headers';
import { hashLegacySessionToken, isUsableLegacySession, LEGACY_SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import type { AccountActor } from './account';

export async function accountSessionActor(userId: string, workspaceId: string): Promise<AccountActor> {
  const token = (await cookies()).get(LEGACY_SESSION_COOKIE)?.value;
  const sessionTokenHash = token ? hashLegacySessionToken(token) : null;
  if (!sessionTokenHash || !isUsableLegacySession(await getSessionByTokenHash(sessionTokenHash), userId)) throw new OperationError('unauthorized', 'Sign in to continue.');
  return { userId, workspaceId, sessionTokenHash };
}
