/** Manage tabs for /ads/manage. Pure URL helpers; the page and its tests share them. */
export const MANAGE_LEVELS = ['campaign', 'adset', 'ad', 'creative'] as const;
export type ManageLevel = (typeof MANAGE_LEVELS)[number];
export type ManageDirectoryLevel = 'campaign' | 'adset' | 'ad';

/** `adgroup` stays accepted as a friendly alias; anything unknown falls back to campaigns. */
export function parseManageLevel(raw: unknown): ManageLevel {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'adgroup') return 'adset';
  return (MANAGE_LEVELS as readonly unknown[]).includes(value) ? (value as ManageLevel) : 'campaign';
}

export function isManageDirectoryLevel(level: ManageLevel): level is ManageDirectoryLevel {
  return level === 'campaign' || level === 'adset' || level === 'ad';
}

const TAB_PARAMS = ['period', 'since', 'until', 'account', 'q', 'parentId'] as const;

/** Tab links keep the report and search state, restart paging, and drop a parent filter where it cannot apply. */
export function manageTabHref(values: Record<string, string | undefined>, level: ManageLevel): string {
  const params = new URLSearchParams();
  for (const key of TAB_PARAMS) {
    const value = values[key];
    if (value === undefined || value === '') continue;
    if (key === 'parentId' && (level === 'campaign' || level === 'creative')) continue;
    params.set(key, value);
  }
  params.set('level', level);
  const query = params.toString();
  return query ? `/ads/manage?${query}` : '/ads/manage';
}
