import { dataCopy } from './copy';

const CATEGORIES = [
  { id: 'posts', keys: ['posts', 'postTargets', 'comments'] },
  { id: 'channels', keys: ['targets', 'socialAccounts', 'instagramAccounts', 'adAccounts'] },
  { id: 'inbox', keys: ['conversations', 'conversationMessages'] },
  { id: 'metrics', keys: ['pageInsights', 'adInsights', 'instagramInsights'] },
  { id: 'keys', keys: ['other:mcp_api_keys'] },
] as const;

/** Product-facing deletion preview. Every server count belongs to exactly one row. */
export function summarizeDeletionCounts(counts: Record<string, number>, locale: 'en' | 'fr' = 'en', labels: { [K in keyof typeof dataCopy.en.categories]: string } = dataCopy[locale].categories) {
  const known = new Set<string>(CATEGORIES.flatMap(category => category.keys));
  const rows: { label: string; count: number }[] = CATEGORIES.map(category => ({
    label: labels[category.id],
    count: category.keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0),
  }));
  rows.push({ label: labels.other, count: Object.entries(counts).reduce((sum, [key, count]) => sum + (known.has(key) ? 0 : count), 0) });
  return rows.filter(row => row.count > 0);
}
