import { prisma } from '@/server/data';

export function rootDirectoryQuery(input: { q?: string; page?: string }, pageSize: number) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid Root directory page size.');
  const query = (input.q ?? '').trim();
  const parsed = Number(input.page ?? '1');
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) : 1;
  return { query, page, skip: (page - 1) * pageSize, take: pageSize };
}

export async function listRootUsers(input: { q?: string; page?: string }, pageSize: number) {
  const selection = rootDirectoryQuery(input, pageSize);
  const where = selection.query ? { OR: [
    { name: { contains: selection.query, mode: 'insensitive' as const } },
    { email: { contains: selection.query, mode: 'insensitive' as const } },
  ] } : {};
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: selection.skip, take: selection.take,
      select: { id: true, name: true, email: true, isInstanceOwner: true, disabledAt: true, totpEnabledAt: true, createdAt: true,
        _count: { select: { memberships: true, sessions: true, passkeys: true } } } }),
  ]);
  return { ...selection, total, users };
}

export async function listRootWorkspaces(input: { q?: string; page?: string }, pageSize: number) {
  const selection = rootDirectoryQuery(input, pageSize);
  const where = selection.query ? { OR: [
    { name: { contains: selection.query, mode: 'insensitive' as const } },
    { slug: { contains: selection.query, mode: 'insensitive' as const } },
  ] } : {};
  const [total, workspaces] = await Promise.all([
    prisma.workspace.count({ where }),
    prisma.workspace.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: selection.skip, take: selection.take,
      select: { id: true, name: true, slug: true, timezone: true, createdAt: true,
        _count: { select: { memberships: true, targets: true, posts: true, adAccounts: true } },
        dataPurge: { select: { status: true } } } }),
  ]);
  return { ...selection, total, workspaces };
}
