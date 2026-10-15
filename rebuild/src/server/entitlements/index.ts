import { PAGES, type FeatureId, type ModuleId } from '@/lib/product';
import { prisma } from '@/server/data';

/** Values read from the existing Root-managed columns. Keep IDs at the boundary
 * as strings: old rows can contain keys unknown to this version of the app. */
export interface EntitlementSource {
  workspace: { id: string; disabledModules: readonly string[]; suspendedAt?: Date | null };
  membership: { userId: string; disabledModules: readonly string[] };
  planFeatures?: readonly string[] | null;
  isInstanceOwner?: boolean;
  installationAvailability?: Readonly<Record<string, boolean>>;
}

export interface Entitlements {
  workspaceId: string;
  modules: Readonly<Record<ModuleId, boolean>>;
  features: Readonly<Record<FeatureId, boolean>>;
  /** Platform availability comes from plan add-ons, not module/feature switches. */
  platformCapabilities: Readonly<Record<string, boolean>>;
}

const MODULE_ROOT_SWITCH: Record<ModuleId, string | null> = {
  home: null,
  publishing: 'schedule',
  inbox: 'analytics',
  analytics: 'analytics',
  ads: 'ads',
  settings: null,
};

/** Map rebuild feature IDs to existing Root feature switches. A null switch
 * means the legacy schema has no feature-level switch for that page. */
const FEATURE_ROOT_SWITCH: Record<FeatureId, string | null> = {
  'home/overview': null,
  'publishing/posts': 'publishing/posts',
  'publishing/calendar': 'publishing/calendar',
  'publishing/queue': 'publishing/queue',
  'publishing/approvals': 'publishing/approvals',
  'inbox/conversations': 'analytics/inbox',
  'analytics/overview': 'analytics/overview',
  'analytics/reports': 'analytics/reports',
  'ads/overview': 'ads/performance',
  'ads/campaigns': 'ads/performance',
  'settings/connections': null,
  'settings/team': 'settings/team',
  'settings/mcp': 'settings/team',
  'settings/account': null,
  'settings/data': null,
  'settings/appearance': null,
};

const MODULE_IDS: readonly ModuleId[] = ['home', 'publishing', 'inbox', 'analytics', 'ads', 'settings'];
const FEATURE_IDS = PAGES.map(({ id }) => id) as readonly FeatureId[];

function isOff(switchKey: string | null, disabled: ReadonlySet<string>): boolean {
  return switchKey !== null && disabled.has(switchKey);
}

function planAllowsFeature(feature: FeatureId, planFeatures: readonly string[] | null | undefined): boolean {
  // Legacy plans without product_v2 retain the pre-modular default. Once a plan
  // opts into product_v2, a page must be explicitly listed on that plan.
  if (!planFeatures?.includes('product_v2')) return true;
  const key = FEATURE_ROOT_SWITCH[feature];
  return key === null || planFeatures.includes(key);
}

/** Resolve root workspace/member switches and plan gates. Unknown catalog IDs
 * are denied by the `canUse*` helpers below; this function only returns known IDs. */
export function resolveEntitlements(source: EntitlementSource): Entitlements {
  const disabled = new Set([...source.workspace.disabledModules, ...source.membership.disabledModules]);
  const suspended = Boolean(source.workspace.suspendedAt) && !source.isInstanceOwner;
  const modules = Object.fromEntries(MODULE_IDS.map((id) => {
    const rootSwitch = MODULE_ROOT_SWITCH[id];
    return [id, !suspended && !isOff(rootSwitch, disabled) && source.installationAvailability?.[`entitlements.modules.${id}`] !== false];
  })) as Record<ModuleId, boolean>;

  const features = Object.fromEntries(FEATURE_IDS.map((id) => {
    const page = PAGES.find((candidate) => candidate.id === id)!;
    const rootSwitch = FEATURE_ROOT_SWITCH[id];
    return [id, modules[page.module] && !isOff(rootSwitch, disabled) && planAllowsFeature(id, source.planFeatures) && source.installationAvailability?.[`entitlements.features.${id}`] !== false];
  })) as Record<FeatureId, boolean>;

  const platformCapabilities = { facebook: true, ...Object.fromEntries((source.planFeatures ?? [])
    .filter((key) => key.startsWith('platform_'))
    .map((key) => [key.slice('platform_'.length), true])) };

  return { workspaceId: source.workspace.id, modules, features, platformCapabilities };
}

export function canUseModule(entitlements: Entitlements, module: string): boolean {
  return MODULE_IDS.includes(module as ModuleId) && entitlements.modules[module as ModuleId] === true;
}

export function canUseFeature(entitlements: Entitlements, feature: string): boolean {
  return FEATURE_IDS.includes(feature as FeatureId) && entitlements.features[feature as FeatureId] === true;
}

export function hasPlatformCapability(entitlements: Entitlements, platform: string): boolean {
  return entitlements.platformCapabilities[platform] === true;
}

export class EntitlementDeniedError extends Error {
  readonly status = 403;
  constructor(readonly kind: 'module' | 'feature', readonly key: string) {
    super(`Access to ${kind} "${key}" is not enabled.`);
    this.name = 'EntitlementDeniedError';
  }
}

export function requireModule(entitlements: Entitlements, module: string): asserts module is ModuleId {
  if (!canUseModule(entitlements, module)) throw new EntitlementDeniedError('module', module);
}

export function requireFeature(entitlements: Entitlements, feature: string): asserts feature is FeatureId {
  if (!canUseFeature(entitlements, feature)) throw new EntitlementDeniedError('feature', feature);
}

/** Load the current member's workspace and subscriber plan from the existing
 * schema. A missing membership returns null; callers must treat it as denied. */
export async function loadEntitlements(userId: string, workspaceId: string): Promise<Entitlements | null> {
  // Raw SQL is intentional here: this rebuild's generated Prisma client can
  // lag the legacy schema during the transition, while the columns below are
  // already present in the deployed legacy tables. Identifiers are static;
  // caller values remain bound parameters.
  const rows = await prisma.$queryRaw<Array<{
    workspaceId: string;
    workspaceDisabled: string[];
    suspendedAt: Date | null;
    memberDisabled: string[];
    planFeatures: string[] | null;
    isInstanceOwner: boolean;
  }>>`
    SELECT w.id AS "workspaceId", w."disabledModules" AS "workspaceDisabled",
           w."suspendedAt", m."disabledModules" AS "memberDisabled",
           p.features AS "planFeatures", u."isInstanceOwner"
    FROM memberships m
    JOIN workspaces w ON w.id = m."workspaceId"
    JOIN users u ON u.id = m."userId"
    LEFT JOIN plans p ON p.id = u."planId"
    WHERE m."userId" = ${userId} AND m."workspaceId" = ${workspaceId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const availabilityRows = await prisma.appSetting.findMany({
    where: { OR: [{ key: { startsWith: 'entitlements.modules.' } }, { key: { startsWith: 'entitlements.features.' } }] },
    select: { key: true, value: true, encrypted: true },
  });
  // Invalid values fail closed. Root's registry validates all new writes.
  const installationAvailability = Object.fromEntries(availabilityRows.map((item) => [item.key, item.encrypted === false && item.value === true]));
  return resolveEntitlements({
    workspace: { id: row.workspaceId, disabledModules: row.workspaceDisabled, suspendedAt: row.suspendedAt },
    membership: { userId, disabledModules: row.memberDisabled },
    planFeatures: row.planFeatures,
    isInstanceOwner: row.isInstanceOwner,
    installationAvailability,
  });
}
