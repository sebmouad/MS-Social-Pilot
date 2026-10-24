import { prisma } from '@/server/data';
import { resolvePermissions, type ScopedPermissions } from './index';

interface PermissionRow {
  role: string;
  allPages: boolean | null;
  workspaceDisabled: string[];
  memberDisabled: string[];
  clientAccess: string[];
  pageIds: string[];
}

/** Load the current user's legacy role and scope. A missing membership denies access. */
export async function loadPermissions(userId: string, workspaceId: string): Promise<ScopedPermissions | null> {
  // The rebuild's generated Prisma client intentionally lags these legacy
  // columns/relations. This read-only query uses the existing database shape.
  const rows = await prisma.$queryRaw<PermissionRow[]>`
    SELECT m.role::text AS role,
           m."allPages" AS "allPages",
           COALESCE(m."disabledModules", ARRAY[]::TEXT[]) AS "memberDisabled",
           COALESCE(w."disabledModules", ARRAY[]::TEXT[]) AS "workspaceDisabled",
           COALESCE(w."clientAccess", ARRAY[]::TEXT[]) AS "clientAccess",
           COALESCE(
             ARRAY_AGG(DISTINCT target.id) FILTER (WHERE target.id IS NOT NULL),
             ARRAY[]::TEXT[]
           ) AS "pageIds"
    FROM memberships m
    JOIN workspaces w ON w.id = m."workspaceId"
    LEFT JOIN member_page_access access ON access."membershipId" = m.id
    LEFT JOIN targets target ON target.id = access."targetId" AND target."workspaceId" = w.id
    WHERE m."userId" = ${userId} AND m."workspaceId" = ${workspaceId}
    GROUP BY m.id, m.role, m."allPages", m."disabledModules", w."disabledModules", w."clientAccess"
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  return resolvePermissions({
    role: row.role,
    allPages: row.allPages === true,
    workspaceDisabledModules: row.workspaceDisabled ?? [],
    memberDisabledModules: row.memberDisabled ?? [],
    clientAccess: row.clientAccess ?? [],
    pageAccess: (row.pageIds ?? []).map((targetId) => ({ targetId })),
  });
}
