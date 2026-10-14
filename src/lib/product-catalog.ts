/** Stable product identifiers shared by Root plans, navigation and route access. */
export const PRODUCT_FEATURES = [
  { key: 'publishing/posts', module: 'schedule', paths: ['/posts', '/compose', '/templates', '/design', '/api/posts', '/api/v1/posts'], requires: [] },
  { key: 'publishing/calendar', module: 'schedule', paths: ['/calendar'], requires: ['publishing/posts'] },
  { key: 'publishing/queue', module: 'schedule', paths: ['/queue', '/feeds', '/api/queue', '/api/queue-slots', '/api/feeds'], requires: ['publishing/posts'] },
  { key: 'publishing/approvals', module: 'schedule', paths: ['/approvals', '/api/approvals'], requires: ['publishing/posts'] },
  { key: 'analytics/overview', module: 'analytics', paths: ['/analytics', '/api/analytics'], requires: [] },
  { key: 'analytics/reports', module: 'analytics', paths: ['/reports', '/api/reports', '/api/report-schedules', '/api/report-templates'], requires: ['analytics/overview'] },
  { key: 'analytics/inbox', module: 'analytics', paths: ['/inbox', '/api/inbox'], requires: [] },
  { key: 'ads/performance', module: 'ads', paths: ['/ads', '/api/ads'], requires: [] },
  { key: 'settings/team', module: null, paths: ['/settings/team', '/api/team', '/api/invitations'], requires: [] },
  { key: 'settings/sharing', module: null, paths: ['/settings/sharing', '/api/share-links'], requires: [] },
  { key: 'settings/media', module: null, paths: ['/settings/media', '/api/media'], requires: [] },
] as const;

export type ProductFeature = (typeof PRODUCT_FEATURES)[number]['key'];
export const PRODUCT_FEATURE_KEYS: ProductFeature[] = PRODUCT_FEATURES.map((feature) => feature.key);

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Most-specific prefix wins, so Reports is separate from Analytics overview. */
export function productFeatureOfPath(path: string): ProductFeature | null {
  if (/^\/api\/posts\/[^/]+\/approv(?:e|al)(?:\/|$)/.test(path)) return 'publishing/approvals';
  const paths = PRODUCT_FEATURES.flatMap((feature) => feature.paths.map((prefix) => ({ key: feature.key, prefix })));
  return paths.filter((entry) => matches(path, entry.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]?.key ?? null;
}

/** A disabled parent removes dependent features as well. */
export function enabledProductFeatures(disabled: readonly string[], planFeatures?: readonly string[]): ProductFeature[] {
  const modularPlan = planFeatures?.includes('product_v2') ?? false;
  const allowed = new Set(PRODUCT_FEATURE_KEYS.filter((key) => !disabled.includes(key) && (!modularPlan || planFeatures?.includes(key))));
  return PRODUCT_FEATURES.filter((feature) => allowed.has(feature.key) && feature.requires.every((key) => allowed.has(key))).map((feature) => feature.key);
}

export const PLATFORM_ADDONS = [
  'instagram', 'bluesky', 'mastodon', 'linkedin', 'threads', 'x',
  'pinterest', 'telegram', 'youtube', 'tiktok',
] as const;

export type PlatformAddon = (typeof PLATFORM_ADDONS)[number];
export type PlatformFeature = `platform_${PlatformAddon}`;

export function platformFeature(platform: PlatformAddon): PlatformFeature {
  return `platform_${platform}`;
}

export const PLAN_FEATURES = [
  'clients', 'whiteLabel', 'api', 'product_v2',
  ...PRODUCT_FEATURE_KEYS,
  ...PLATFORM_ADDONS.map(platformFeature),
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];
