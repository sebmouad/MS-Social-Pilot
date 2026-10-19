const CATEGORIES = [
  { label: 'Posts and comments', keys: ['posts', 'postTargets', 'comments'] },
  { label: 'Channels and ad accounts', keys: ['targets', 'socialAccounts', 'instagramAccounts', 'adAccounts'] },
  { label: 'Inbox messages', keys: ['conversations', 'conversationMessages'] },
  { label: 'Performance metrics', keys: ['pageInsights', 'adInsights', 'instagramInsights'] },
  { label: 'API keys', keys: ['other:mcp_api_keys'] },
] as const;

/** Product-facing deletion preview. Every server count belongs to exactly one row. */
export function summarizeDeletionCounts(counts: Record<string, number>) {
  const known = new Set<string>(CATEGORIES.flatMap(category => category.keys));
  const rows: { label: string; count: number }[] = CATEGORIES.map(category => ({
    label: category.label,
    count: category.keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0),
  }));
  rows.push({ label: 'Other linked records', count: Object.entries(counts).reduce((sum, [key, count]) => sum + (known.has(key) ? 0 : count), 0) });
  return rows.filter(row => row.count > 0);
}
