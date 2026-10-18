/** Facebook Graph reporting field names and opaque object-id validation stay in this module. */
export function facebookStoredAdsParent(input: { level: 'campaign' | 'adset' | 'ad'; fields: unknown }): string | null {
  const key = input.level === 'adset' ? 'campaign_id' : input.level === 'ad' ? 'adset_id' : null;
  if (!key || !input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) return null;
  const value = (input.fields as Record<string, unknown>)[key];
  // Graph identifiers are opaque decimal strings; numeric JSON values may already have lost precision.
  return typeof value === 'string' && /^[0-9]+$/.test(value) ? value : null;
}
