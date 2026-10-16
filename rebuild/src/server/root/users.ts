import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { ROOT_USER_STATUS_OPTIONS, type RootUsersSearch, type RootUsersStatus } from '@/lib/root-users';
export type { RootUsersSearch, RootUsersStatus } from '@/lib/root-users';

/** Private, bounded DTO: no credentials, factor material or session identifiers. */
export async function loadRootUsers(actorId: string, input: RootUsersSearch = {}, resultCap?: number) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
  if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
  const [pageSize, searchMaxCharacters] = await Promise.all([runtimeConfig('root.directoryPageSize'), runtimeConfig('root.userSearchMaxCharacters')]);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['q', 'page', 'status'].includes(key))
    || Object.values(input).some(value => value !== undefined && typeof value !== 'string')) throw new OperationError('invalid_request', 'Choose one value for each user filter.');
  const query = (input.q as string | undefined)?.trim() ?? '';
  const status = (input.status ?? 'all') as RootUsersStatus;
  const requestedPage = input.page === undefined ? 1 : Number(input.page);
  if (query.length > searchMaxCharacters || !ROOT_USER_STATUS_OPTIONS.some(option => option.value === status)
    || input.page !== undefined && !/^\d+$/.test(input.page as string) || !Number.isSafeInteger(requestedPage) || requestedPage < 1
    || resultCap !== undefined && (!Number.isSafeInteger(resultCap) || resultCap < 1)) throw new OperationError('invalid_request', 'Choose valid user filters and page.');
  const take = resultCap === undefined ? pageSize : Math.min(pageSize, resultCap);
  // PostgreSQL LIKE uses these as wildcards even through a bound Prisma value.
  const literal = query.replace(/[\\%_]/g, '\\$&');
  const where = {
    ...(status === 'active' ? { disabledAt: null } : status === 'disabled' ? { disabledAt: { not: null } } : status === 'owners' ? { isInstanceOwner: true } : {}),
    ...(query ? { OR: [{ name: { contains: literal, mode: 'insensitive' as const } }, { email: { contains: literal, mode: 'insensitive' as const } }] } : {}),
  };
  const [total, installationTotal] = await Promise.all([prisma.user.count({ where }), prisma.user.count()]);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / take)));
  const users = await prisma.user.findMany({
    where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * take, take,
    select: { id: true, name: true, email: true, isInstanceOwner: true, disabledAt: true, totpEnabledAt: true, createdAt: true,
      _count: { select: { memberships: true, passkeys: true, sessions: { where: { expiresAt: { gt: new Date() }, pending: null } } } } },
  });
  return { users, total, installationTotal, query, status, page, take, searchMaxCharacters };
}
