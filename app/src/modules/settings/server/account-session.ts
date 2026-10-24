import { cookies } from 'next/headers';
import { hashSessionToken, isUsableSession, SESSION_COOKIE } from '@/server/auth';
import { getSessionByTokenHash } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import type { AccountActor } from './account';

export async function accountSessionActor(userId: string, workspaceId: string): Promise<AccountActor> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const sessionTokenHash = token ? hashSessionToken(token) : null;
  if (!sessionTokenHash || !isUsableSession(await getSessionByTokenHash(sessionTokenHash), userId)) throw new OperationError('unauthorized', 'Sign in to continue.');
  return { userId, workspaceId, sessionTokenHash };
}
