import { connectionsCopy } from './copy';

const CATEGORIES = [
  { id: 'channels', keys: ['channels', 'instagramAccounts'] },
  { id: 'adAccounts', keys: ['adAccounts'] },
  { id: 'posts', keys: ['postTargets', 'orphanPosts', 'comments'] },
  { id: 'inbox', keys: ['conversations', 'conversationMessages'] },
  { id: 'metrics', keys: ['pageInsights', 'adInsights', 'instagramInsights'] },
  { id: 'media', keys: ['instagramMedia'] },
] as const;

/** Provider-scheduled links are a subset of post targets, not another deletion count. */
export function summarizeDisconnectCounts(counts: Record<string, number>, locale: 'en' | 'fr' = 'en', labels: { [K in keyof typeof connectionsCopy.en.categories]: string } = connectionsCopy[locale].categories) {
  const known = new Set<string>(['scheduledRemote', ...CATEGORIES.flatMap(category => category.keys)]);
  const rows: { label: string; count: number }[] = CATEGORIES.map(category => ({
    label: labels[category.id],
    count: category.keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0),
  }));
  rows.push({ label: labels.other, count: Object.entries(counts).reduce((sum, [key, count]) => sum + (known.has(key) ? 0 : count), 0) });
  return { rows: rows.filter(row => row.count > 0), scheduledRemote: counts.scheduledRemote ?? 0 };
}
