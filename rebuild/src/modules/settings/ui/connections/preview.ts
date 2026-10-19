const CATEGORIES = [
  { label: 'Channels', keys: ['channels', 'instagramAccounts'] },
  { label: 'Ad accounts', keys: ['adAccounts'] },
  { label: 'Posts and comments', keys: ['postTargets', 'orphanPosts', 'comments'] },
  { label: 'Inbox messages', keys: ['conversations', 'conversationMessages'] },
  { label: 'Performance metrics', keys: ['pageInsights', 'adInsights', 'instagramInsights'] },
  { label: 'Media records', keys: ['instagramMedia'] },
] as const;

/** Provider-scheduled links are a subset of post targets, not another deletion count. */
export function summarizeDisconnectCounts(counts: Record<string, number>) {
  const known = new Set<string>(['scheduledRemote', ...CATEGORIES.flatMap(category => category.keys)]);
  const rows: { label: string; count: number }[] = CATEGORIES.map(category => ({
    label: category.label,
    count: category.keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0),
  }));
  rows.push({ label: 'Other linked records', count: Object.entries(counts).reduce((sum, [key, count]) => sum + (known.has(key) ? 0 : count), 0) });
  return { rows: rows.filter(row => row.count > 0), scheduledRemote: counts.scheduledRemote ?? 0 };
}
