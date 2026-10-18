import { PAGES, type FeatureId, type ModuleId } from '@/lib/product';

export type PermissionAction = 'read' | 'write';
export type Permission = Readonly<Record<PermissionAction, boolean>>;
export type ScopedPageAccess = { all: true } | { all: false; ids: readonly string[] };
export type PermissionModule = Extract<ModuleId, 'publishing' | 'inbox' | 'analytics' | 'ads' | 'settings'>;

export interface PermissionSource {
  role: string;
  workspaceDisabledModules: readonly string[];
  memberDisabledModules: readonly string[];
  clientAccess: readonly string[];
  allPages: boolean;
  pageAccess: readonly { targetId: string }[];
}

export interface ScopedPermissions {
  modules: Readonly<Record<PermissionModule, Permission>>;
  features: Readonly<Record<FeatureId, Permission>>;
  pageScope: ScopedPageAccess;
  /** Product feature IDs visible to this member, in product navigation order. */
  visibleFeatures: readonly FeatureId[];
  /** Modules with at least one visible feature, in product navigation order. */
  visibleModules: readonly PermissionModule[];
}

const DENIED: Permission = { read: false, write: false };
const MODULES: readonly PermissionModule[] = ['publishing', 'inbox', 'analytics', 'ads', 'settings'];

const FEATURE_MODULE_SWITCH: Record<FeatureId, string | null> = {
  'home/overview': null,
  'publishing/posts': 'publishing/posts',
  'publishing/calendar': 'publishing/calendar',
  'publishing/queue': 'publishing/queue',
  'publishing/approvals': 'publishing/approvals',
  'publishing/media': null,
  'publishing/collaboration': 'publishing/posts',
  'publishing/labels': 'publishing/posts',
  'publishing/templates': 'publishing/templates',
  'inbox/conversations': 'analytics/inbox',
  'analytics/overview': 'analytics/overview',
  'analytics/explorer': 'analytics/overview',
  'analytics/demographics': 'analytics/overview',
  'analytics/compare': 'analytics/overview',
  'analytics/pins': 'analytics/overview',
  'analytics/reports': 'analytics/overview',
  'ads/overview': 'ads/performance',
  'ads/compare': 'ads/performance',
  'ads/objects': 'ads/performance',
  'ads/campaigns': 'ads/performance',
  'settings/connections': null,
  'settings/team': 'settings/team',
  'settings/workspace': 'settings/team',
  'settings/mcp': 'settings/team',
  'settings/account': null,
  'settings/data': null,
  'settings/appearance': null,
};

const MODULE_ROOT_SWITCH: Record<PermissionModule, string | null> = {
  publishing: 'schedule',
  inbox: 'analytics',
  analytics: 'analytics',
  ads: 'ads',
  settings: null,
};

function roleFeatureAccess(role: string, feature: FeatureId, clientAccess: ReadonlySet<string>): Permission {
  if (role === 'owner' || role === 'admin') return { read: true, write: true };

  if (role === 'client') {
    if (feature === 'publishing/posts' || feature === 'publishing/calendar' || feature === 'publishing/approvals') {
      return { read: true, write: feature === 'publishing/approvals' };
    }
    if (feature === 'analytics/overview' || feature === 'analytics/explorer' || feature === 'analytics/reports' || feature === 'analytics/demographics' || feature === 'analytics/compare' || feature === 'analytics/pins') {
      return { read: clientAccess.has('analytics'), write: false };
    }
    if (feature === 'inbox/conversations') return { read: clientAccess.has('inbox'), write: false };
    if (feature === 'settings/account') return { read: true, write: true };
    return DENIED;
  }

  if (role === 'viewer') {
    if (feature === 'settings/team' || feature === 'settings/workspace' || feature === 'settings/mcp' || feature === 'settings/connections') return DENIED;
    return { read: true, write: false };
  }

  if (role === 'editor') {
    if (feature === 'settings/team' || feature === 'settings/workspace' || feature === 'settings/mcp') return DENIED;
    if (feature === 'settings/connections') return { read: true, write: false };
    return {
      read: true,
      write: feature.startsWith('publishing/') || feature === 'inbox/conversations' || feature.startsWith('analytics/'),
    };
  }

  if (role === 'contributor') {
    if (feature === 'settings/team' || feature === 'settings/workspace' || feature === 'settings/mcp') return DENIED;
    if (feature === 'settings/connections') return { read: true, write: false };
    return {
      read: true,
      // Existing routes still apply authorship and operation-specific checks.
      write: feature.startsWith('publishing/') || feature === 'inbox/conversations',
    };
  }

  return DENIED;
}

function permissionForFeature(source: PermissionSource, feature: FeatureId, disabled: ReadonlySet<string>, clientAccess: ReadonlySet<string>): Permission {
  const page = PAGES.find((candidate) => candidate.id === feature);
  if (!page) return DENIED;
  const module = page.module as PermissionModule;
  const rootModuleSwitch = MODULE_ROOT_SWITCH[module];
  const featureSwitch = FEATURE_MODULE_SWITCH[feature];
  if ((rootModuleSwitch && disabled.has(rootModuleSwitch)) || (featureSwitch && disabled.has(featureSwitch))) return DENIED;

  return roleFeatureAccess(source.role, feature, clientAccess);
}

/**
 * Resolve role, legacy Root switches, client grants, and channel scope in one
 * framework-free value. Unknown roles and feature IDs are denied by default.
 */
export function resolvePermissions(source: PermissionSource): ScopedPermissions {
  const disabled = new Set([...source.workspaceDisabledModules, ...source.memberDisabledModules]);
  const clientAccess = new Set(source.clientAccess);
  const features = Object.fromEntries(PAGES.map(({ id }) => [
    id,
    permissionForFeature(source, id, disabled, clientAccess),
  ])) as Record<FeatureId, Permission>;

  const modules = Object.fromEntries(MODULES.map((module) => {
    const children = PAGES.filter((page) => page.module === module);
    return [module, {
      read: children.some(({ id }) => features[id].read),
      write: children.some(({ id }) => features[id].write),
    }];
  })) as Record<PermissionModule, Permission>;

  const pageScope: ScopedPageAccess = source.allPages || source.role === 'owner' || source.role === 'admin'
    ? { all: true }
    : { all: false, ids: [...new Set(source.pageAccess.map(({ targetId }) => targetId).filter(Boolean))] };

  const visibleFeatures = PAGES.filter(({ id }) => features[id].read).map(({ id }) => id);
  const visibleModules = MODULES.filter((module) => modules[module].read);
  return { modules, features, pageScope, visibleFeatures, visibleModules };
}

export function canAccessModule(permissions: ScopedPermissions, module: string, action: PermissionAction = 'read'): boolean {
  return MODULES.includes(module as PermissionModule) && permissions.modules[module as PermissionModule]?.[action] === true;
}

export function canAccessFeature(permissions: ScopedPermissions, feature: string, action: PermissionAction = 'read'): boolean {
  return Object.hasOwn(permissions.features, feature) && permissions.features[feature as FeatureId]?.[action] === true;
}

/** A limited member is denied any channel not explicitly listed. */
export function canAccessPage(permissions: ScopedPermissions, targetId: string): boolean {
  if (!targetId) return false;
  return permissions.pageScope.all || permissions.pageScope.ids.includes(targetId);
}

/** Keep only features the member may read, preserving the caller's catalog order. */
export function authorizedFeatures<T extends { id: string }>(permissions: ScopedPermissions, features: readonly T[]): T[] {
  return features.filter(({ id }) => canAccessFeature(permissions, id, 'read'));
}
