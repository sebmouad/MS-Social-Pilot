import { synchronousPolicy, withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { assertRootActor, lockWorkspaceOwners, conflict, invalid } from './authz';
import { writeRootAudit } from './audit';
import { rootResultLimit, legacySetting, rootTransaction } from './policy';
import { roleChangeSchema, roleConfirmation, WORKSPACE_ROLES } from './shared';

type PrivilegeRow = { membershipId: string; workspaceId: string; workspace: string; userId: string; name: string; email: string; role: string; allPages: boolean; pageCount: number; isRoot: boolean; disabled: boolean; suspended: boolean; lastSession: Date | null };

const filterSchema = z.object({ q: z.string().trim().optional(), role: z.enum(WORKSPACE_ROLES).optional(), workspaceId: z.string().min(1).refine(withinSynchronousLimit('root.identifierMaxCharacters')).optional(), page: z.coerce.number().int().min(1).refine(value => value <= synchronousPolicy('root.pageMaxNumber')).optional() }).strict();
const like = (value: string) => `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;

async function query(filters: z.infer<typeof filterSchema>, limit: number, offset: number) {
  const q = filters.q ? like(filters.q) : null;
  const role = filters.role ?? null;
  const workspaceId = filters.workspaceId ?? null;
  const rows = await prisma.$queryRaw<Array<PrivilegeRow & { total: number }>>`SELECT m.id AS "membershipId", w.id AS "workspaceId", w.name AS workspace, u.id AS "userId", u.name, u.email, m.role::text AS role, m."allPages", (SELECT COUNT(*)::int FROM member_page_access a WHERE a."membershipId" = m.id) AS "pageCount", u."isInstanceOwner" AS "isRoot", (u."disabledAt" IS NOT NULL) AS disabled, (w."suspendedAt" IS NOT NULL) AS suspended, (SELECT MAX(s."createdAt") FROM sessions s WHERE s."userId" = u.id) AS "lastSession", COUNT(*) OVER()::int AS total FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE (${q}::text IS NULL OR u.email ILIKE ${q} ESCAPE '\\' OR u.name ILIKE ${q} ESCAPE '\\' OR w.name ILIKE ${q} ESCAPE '\\') AND (${role}::text IS NULL OR m.role::text = ${role}) AND (${workspaceId}::text IS NULL OR w.id = ${workspaceId}) ORDER BY w.name, u.email, m.id LIMIT ${limit} OFFSET ${offset}`;
  return rows;
}

const view = (row: PrivilegeRow) => ({
  membershipId: row.membershipId, workspaceId: row.workspaceId, workspace: row.workspace, userId: row.userId, name: row.name, email: row.email, role: row.role, root: row.isRoot, disabled: row.disabled, workspaceSuspended: row.suspended,
  // Owners and admins always reach every channel regardless of the stored flag.
  channels: row.role === 'owner' || row.role === 'admin' || row.allPages ? 'all' as const : row.pageCount,
  latestSessionStartedAt: row.lastSession ? row.lastSession.toISOString() : null,
});

/** Paged member/role/channel-scope audit across every workspace. Read only. */
export async function listRootPrivileges(actorId: string, input: unknown = {}, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const parsed = filterSchema.safeParse(input);
  const max = await legacySetting('root.legacy.searchMaxCharacters');
  if (!parsed.success || (parsed.data.q?.length ?? 0) > max) throw invalid('Use a shorter search and a valid role.');
  const size = rootResultLimit(await legacySetting('root.legacy.privilegePageSize'), resultCap);
  const page = parsed.data.page ?? 1;
  const rows = await query(parsed.data, size, (page - 1) * size);
  const [maxRows, maxBytes] = await Promise.all([legacySetting('root.legacy.privilegeExportMaxRows'), legacySetting('root.legacy.privilegeExportMaxBytes')]);
  return { items: rows.map(view), page, pageSize: size, total: rows[0]?.total ?? 0, limits: { searchMaxCharacters: max, exportMaxRows: maxRows, exportMaxBytes: maxBytes } };
}

/** Spreadsheet-safe cell: neutralize formula prefixes and quote. */
function cell(value: string | number | boolean | null) {
  const text = value === null ? '' : String(value);
  const safe = /^\s*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV of the filtered audit. Complete or refused under Root byte and row bounds. */
export async function exportRootPrivileges(actorId: string, input: unknown = {}, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const parsed = filterSchema.omit({ page: true }).safeParse(input);
  const searchLimit = await legacySetting('root.legacy.searchMaxCharacters');
  if (!parsed.success || (parsed.data.q?.length ?? 0) > searchLimit) throw invalid('Use a valid role filter and shorter search.');
  const cap = rootResultLimit(await legacySetting('root.legacy.privilegeExportMaxRows'), resultCap);
  const rows = await query(parsed.data, cap, 0);
  const total = rows[0]?.total ?? 0;
  if (total > rows.length) throw invalid('The complete export exceeds the current row limit. Narrow the filters or raise the Root export limit.');
  const header = ['workspace', 'name', 'email', 'role', 'root', 'disabled', 'channels', 'latest_session_started'];
  const lines = [header, ...rows.map(view).map(row => [row.workspace, row.name, row.email, row.role, row.root ? 'yes' : 'no', row.disabled ? 'yes' : 'no', String(row.channels), row.latestSessionStartedAt ?? ''])];
  const csv = lines.map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
  const bytes = Buffer.byteLength(csv, 'utf8');
  if (bytes > await legacySetting('root.legacy.privilegeExportMaxBytes')) throw invalid('The complete export exceeds the byte limit. Narrow the filters or raise the Root export limit.');
  return { csv, bytes, rows: rows.length, total, truncated: false };
}

/** Change a member's role in one workspace. Exact confirmation, last-owner protection, atomic with audit. */
export async function changeRootMemberRole(actorId: string, input: unknown) {
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) throw invalid('Choose a member, a role and the exact confirmation.');
  const { membershipId, role, confirmation } = parsed.data;
  return rootTransaction(async tx => {
    await assertRootActor(tx, actorId);
    const found = await tx.$queryRaw<Array<{ id: string; userId: string; workspaceId: string; role: string; email: string }>>`SELECT m.id, m."userId", m."workspaceId", m.role::text AS role, u.email FROM memberships m JOIN users u ON u.id = m."userId" WHERE m.id = ${membershipId}`;
    const member = found[0];
    if (!member) throw new OperationError('not_found', 'Member not found.');
    // Serialize role changes per workspace, then re-read under the lock.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces WHERE id = ${member.workspaceId} FOR UPDATE`;
    if (!locked[0]) throw new OperationError('not_found', 'Workspace not found.');
    const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: member.workspaceId }, select: { status: true } });
    if (purge && purge.status !== 'completed') throw conflict('Workspace data deletion is in progress.');
    await lockWorkspaceOwners(tx, actorId, member.workspaceId, [member.userId]);
    const current = (await tx.$queryRaw<Array<{ role: string }>>`SELECT role::text AS role FROM memberships WHERE id = ${membershipId} AND "workspaceId" = ${member.workspaceId} FOR UPDATE`)[0];
    if (!current) throw new OperationError('not_found', 'Member not found.');
    if (confirmation !== roleConfirmation(member.email, member.workspaceId, role)) throw invalid('Enter the exact confirmation shown.');
    if (current.role === role) return { changed: false, membershipId, role };
    const target = await tx.user.findUnique({ where: { id: member.userId }, select: { disabledAt: true } });
    if (!target) throw new OperationError('not_found', 'Account not found.');
    if (role === 'owner' && target.disabledAt) throw conflict('A disabled account cannot be made an owner.');
    if (current.role === 'owner' && !target.disabledAt) {
      const owners = await tx.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${member.workspaceId} AND m.role::text = 'owner' AND u."disabledAt" IS NULL`;
      if ((owners[0]?.count ?? 0) <= 1) throw conflict('A workspace needs an active owner. Transfer ownership instead.');
    }
    const updated = await tx.$executeRaw`UPDATE memberships SET role = ${role}::"WorkspaceRole", "allPages" = CASE WHEN ${role} IN ('owner', 'admin') THEN true ELSE "allPages" END WHERE id = ${membershipId} AND "workspaceId" = ${member.workspaceId}`;
    if (updated !== 1) throw conflict('The member changed. Reload and try again.');
    await writeRootAudit(tx, actorId, 'root.member_role_changed', { membershipId, workspaceId: member.workspaceId, userId: member.userId, from: current.role, to: role });
    return { changed: true, membershipId, role, previousRole: current.role };
  });
}
