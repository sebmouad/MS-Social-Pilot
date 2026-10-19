import { createHash } from 'node:crypto';
import { intersectResourceScope, parseResourceScope } from '@/modules/settings/mcp-access/resource-scope';
import { listWorkspaces, prisma } from '@/server/data';
import { loadEntitlements } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { runtimeConfig } from '@/server/config/store';
import type { ScopedPermissions } from '@/server/permissions';
import type { McpViewer } from './types';

type ApiKeyRow = { id: string; workspaceId: string; createdById: string; readFeatures: string[]; writeFeatures: string[]; resourceScope: unknown };

/** Narrow the owner's current permissions to what the key was issued for; a key never exceeds its owner. */
export function restrictPermissions(permissions: ScopedPermissions, readFeatures: string[], writeFeatures: string[]): ScopedPermissions {
  const reads = new Set(readFeatures);
  const writes = new Set(writeFeatures);
  const features = Object.fromEntries(Object.entries(permissions.features).map(([feature, access]) => [feature, {
    read: access.read && reads.has(feature),
    write: access.write && reads.has(feature) && writes.has(feature),
  }])) as ScopedPermissions['features'];
  const modules = Object.fromEntries(Object.entries(permissions.modules).map(([module, access]) => {
    const childFeatures = Object.entries(features).filter(([feature]) => feature.startsWith(`${module}/`)).map(([, feature]) => feature);
    return [module, { read: access.read && childFeatures.some(feature => feature.read), write: access.write && childFeatures.some(feature => feature.write) }];
  })) as ScopedPermissions['modules'];
  return { ...permissions, features, modules, visibleFeatures: permissions.visibleFeatures.filter(feature => reads.has(feature)), visibleModules: permissions.visibleModules.filter(module => modules[module].read) };
}

export const BEARER_SHAPE = /^Bearer\s+(mcp_[A-Za-z0-9_-]{40,})$/;

/**
 * Workspace viewer for a scoped API key (`mcp_...`), or null. Shared by the MCP endpoint and the REST API:
 * the key's owner, role, plan and channel grants are re-read now, so demotion, disabling, expiry and revocation
 * take effect immediately and the key can only narrow what its owner can do.
 */
export async function authenticateBearerHeader(authorization: string | null): Promise<McpViewer | null> {
  const match = authorization?.match(BEARER_SHAPE);
  if (!match || await runtimeConfig('mcp.enabled') !== true) return null;
  const tokenHash = createHash('sha256').update(match[1]).digest('hex');
  const rows = await prisma.$queryRaw<ApiKeyRow[]>`
    SELECT id, "workspaceId", "createdById", "readFeatures", "writeFeatures", "resourceScope"
    FROM mcp_api_keys
    WHERE "tokenHash" = ${tokenHash} AND "revokedAt" IS NULL AND "expiresAt" > NOW()
    LIMIT 1
  `;
  const key = rows[0];
  if (!key) return null;
  const user = await prisma.user.findUnique({ where: { id: key.createdById }, select: { id: true, disabledAt: true } });
  if (!user || user.disabledAt) return null;
  const membership = (await listWorkspaces(user.id)).find(item => item.workspace.id === key.workspaceId);
  if (!membership) return null;
  const roles: readonly string[] = await runtimeConfig('mcp.authenticatedRoles');
  if (!roles.includes(membership.role)) return null;
  const entitlements = await loadEntitlements(user.id, key.workspaceId, { allowInstallationInspection: false });
  const currentPermissions = await loadPermissions(user.id, key.workspaceId);
  if (!entitlements || !currentPermissions) return null;
  const maxResultItems = await runtimeConfig('mcp.maxResultItems') as number;
  const ceiling = parseResourceScope(key.resourceScope, await runtimeConfig('mcp.keys.maxResourceIds') as number);
  const permissions = restrictPermissions(currentPermissions, key.readFeatures, key.writeFeatures);
  permissions.pageScope = intersectResourceScope(currentPermissions.pageScope, ceiling);
  await prisma.$executeRaw`UPDATE mcp_api_keys SET "lastUsedAt" = NOW() WHERE id = ${key.id}`;
  return { scope: 'workspace', userId: user.id, workspaceId: key.workspaceId, role: membership.role, workspace: membership.workspace, entitlements, permissions, resourceRestricted: ceiling?.mode === 'selected', ...(ceiling?.mode === 'selected' ? { allowedAdAccountIds: ceiling.adAccountIds, adAccountTargetScope: currentPermissions.pageScope } : {}), maxResultItems, apiKeyId: key.id };
}
