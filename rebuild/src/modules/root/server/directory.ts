import { prisma } from '@/server/data';
import { assertRootActor, invalid } from '@/modules/root/server/admin/authz';
import { runtimeConfig } from '@/server/config/store';
import { rootResultLimit } from '@/modules/root/server/admin/policy';

export function rootDirectoryQuery(input: { q?: string; page?: string }, pageSize: number) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid Root directory page size.');
  const query = (input.q ?? '').trim();
  const parsed = Number(input.page ?? '1');
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) : 1;
  return { query, page, skip: (page - 1) * pageSize, take: pageSize };
}

export async function listRootWorkspaces(actorId: string, input: { q?: string; page?: string }, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const [configuredSize, searchMax, pageMax] = await Promise.all([runtimeConfig('root.directoryPageSize'), runtimeConfig('root.admin.searchMaxCharacters'), runtimeConfig('root.pageMaxNumber')]);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['q', 'page'].includes(key)) || input.q !== undefined && (typeof input.q !== 'string' || input.q.length > searchMax) || input.page !== undefined && (typeof input.page !== 'string' || !Number.isSafeInteger(Number(input.page)) || Number(input.page) < 1 || Number(input.page) > pageMax)) throw invalid('Choose a valid workspace query and page.');
  const pageSize = rootResultLimit(configuredSize, resultCap);
  let selection = rootDirectoryQuery(input, pageSize);
  const where = selection.query ? { OR: [
    { name: { contains: selection.query, mode: 'insensitive' as const } },
    { slug: { contains: selection.query, mode: 'insensitive' as const } },
  ] } : {};
  const total = await prisma.workspace.count({ where });
  selection = rootDirectoryQuery({ ...input, page: String(Math.min(selection.page, Math.max(1, Math.ceil(total / pageSize)))) }, pageSize);
  const workspaces = await prisma.workspace.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: selection.skip, take: selection.take,
      select: { id: true, name: true, slug: true, timezone: true, createdAt: true,
        _count: { select: { memberships: true, targets: true, posts: true, adAccounts: true } },
        dataPurge: { select: { status: true } } } });
  const ids = workspaces.map(workspace => workspace.id);
  const access = ids.length ? await prisma.$queryRaw<Array<{ id: string; suspendedAt: Date | null }>>`SELECT id, "suspendedAt" FROM workspaces WHERE id = ANY(${ids}::text[])` : [];
  const suspendedById = new Map(access.map(row => [row.id, row.suspendedAt]));
  return { ...selection, total, workspaces: workspaces.map(workspace => ({ ...workspace, suspendedAt: suspendedById.get(workspace.id) ?? null })) };
}
