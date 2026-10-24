import { instantFormatter } from '@/server/instant-labels';

/**
 * Person keys belong to the account, not to a workspace (the list also loads when no workspace is selected), so
 * their dates are labelled in UTC on the server instead of in the viewer's browser zone.
 */
export function labelPersonKeys<T extends { keys: Array<{ expiresAt: string | Date }> }>(directory: T, locale: 'en' | 'fr') {
  const fmt = instantFormatter('UTC', locale);
  return { ...directory, keys: directory.keys.map(key => ({ ...key, labels: { expiresAt: `${fmt.dateTime(key.expiresAt)} UTC` } })) };
}
