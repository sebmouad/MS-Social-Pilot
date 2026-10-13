/**
 * Root's connections screen: every channel of every workspace, grouped by the
 * platform it publishes to. Plain module (no Prisma) so it can be unit-tested
 * and shared with client components.
 */

export const PLATFORM_ORDER = [
  'facebook',
  'instagram',
  'bluesky',
  'mastodon',
  'linkedin',
  'threads',
  'x',
  'pinterest',
  'telegram',
  'youtube',
  'tiktok',
] as const;

export type Platform = (typeof PLATFORM_ORDER)[number];

/** Facebook Pages and Groups share a platform; every other channel type is its own. */
export function platformOf(type: string): Platform | string {
  if (type === 'page' || type === 'group') return 'facebook';
  return type;
}

export type ConnectionStatus = 'ok' | 'paused' | 'blocked' | 'reconnect';

/** The one-word state of a channel, worst first. */
export function connectionStatus(row: {
  accountInvalid: boolean;
  orphan: boolean;
  enabled: boolean;
  canPublish: boolean;
}): ConnectionStatus {
  if (row.accountInvalid || row.orphan) return 'reconnect';
  if (!row.canPublish) return 'blocked';
  if (!row.enabled) return 'paused';
  return 'ok';
}

const STATUS_RANK: Record<ConnectionStatus, number> = { reconnect: 0, blocked: 1, paused: 2, ok: 3 };

export interface PlatformGroup<T> {
  platform: string;
  rows: T[];
  problems: number;
}

/**
 * Group rows by platform in a fixed order (unknown platforms last, by name),
 * problems first inside each group, then by workspace and channel name.
 */
export function groupByPlatform<T extends { type: string; status: ConnectionStatus; workspaceName: string; name: string }>(
  rows: T[],
): Array<PlatformGroup<T>> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const platform = platformOf(row.type);
    const list = groups.get(platform) ?? [];
    list.push(row);
    groups.set(platform, list);
  }
  const rank = (platform: string) => {
    const index = (PLATFORM_ORDER as readonly string[]).indexOf(platform);
    return index === -1 ? PLATFORM_ORDER.length : index;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([platform, list]) => ({
      platform,
      rows: [...list].sort(
        (a, b) =>
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          a.workspaceName.localeCompare(b.workspaceName) ||
          a.name.localeCompare(b.name),
      ),
      problems: list.filter((row) => row.status === 'reconnect' || row.status === 'blocked').length,
    }));
}
