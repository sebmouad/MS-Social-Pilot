import type { McpViewer } from '@/server/mcp/types';
import { installedMcpGroups } from '@/modules/installed-mcp';

/**
 * Reviewed MCP operations that honour a channel/ad-account ceiling. A restricted viewer
 * (an explicit selected-resource credential ceiling intersected with current membership) may use
 * only these. Everything else, including any tool or resource added later, requires an
 * all-resource scope until it is reviewed and listed by its module. Each module declares the
 * classification in its own mcp.ts (`scope`) and passes the ceiling to a service that re-checks it;
 * listing a name without that is a policy defect.
 */
type ScopeSets = { resourceTools: ReadonlySet<string>; workspaceTools: ReadonlySet<string>; resources: ReadonlySet<string> };
let scopeSets: ScopeSets | undefined;
/** The current workspace descriptor is host-owned and carries no resource ceiling. */
const hostResourceScopedResources = ['msp://workspace'];
function sets(): ScopeSets {
  if (scopeSets) return scopeSets;
  const groups = installedMcpGroups();
  scopeSets = {
    resourceTools: new Set(groups.flatMap(group => group.scope.resourceTools ?? [])),
    workspaceTools: new Set(groups.flatMap(group => group.scope.workspaceTools ?? [])),
    resources: new Set([...hostResourceScopedResources, ...groups.flatMap(group => group.scope.resources ?? [])]),
  };
  return scopeSets;
}

/** Pass the ceiling to scoped services; undefined means every authorized resource. */
export function isResourceRestricted(viewer: Pick<McpViewer, 'permissions' | 'apiKeyId' | 'resourceRestricted'>): boolean {
  // A viewer without resolved permissions is not trusted with workspace-wide operations either.
  if (!viewer.permissions) return true;
  // A session's channel restrictions do not remove independently granted workspace features.
  // Authentication marks every real key explicitly; incomplete synthetic identities fail closed.
  if (viewer.resourceRestricted !== undefined) return viewer.resourceRestricted;
  return Boolean(viewer.apiKeyId && viewer.permissions.pageScope.all === false);
}

export type ToolScopeClass = 'resource' | 'workspace' | 'unclassified';
export function classifyTool(name: string): ToolScopeClass {
  return sets().resourceTools.has(name) ? 'resource' : sets().workspaceTools.has(name) ? 'workspace' : 'unclassified';
}

/** Unknown or workspace-wide operations fail closed for restricted viewers. */
export function toolAllowedForScope(viewer: Pick<McpViewer, 'permissions' | 'apiKeyId' | 'resourceRestricted'>, name: string): boolean {
  return !isResourceRestricted(viewer) || sets().resourceTools.has(name);
}

export function resourceAllowedForScope(viewer: Pick<McpViewer, 'permissions' | 'apiKeyId' | 'resourceRestricted'>, uri: string): boolean {
  return !isResourceRestricted(viewer) || sets().resources.has(uri);
}

export const scopeRefusalMessage = 'This operation requires access to all channels and ad accounts.';
