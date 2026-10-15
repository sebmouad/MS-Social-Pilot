import { describe, expect, it } from 'vitest';
import { summarizeDeletionCounts } from '@/app/settings/data/preview';

describe('customer deletion preview', () => {
  it('accounts for every direct and older linked record without exposing table names', () => {
    const counts = { posts: 2, comments: 3, targets: 1, 'indirect:bio_links': 4, 'other:mcp_api_keys': 1, 'other:future_table': 7 };
    const rows = summarizeDeletionCounts(counts);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(Object.values(counts).reduce((sum, count) => sum + count, 0));
    expect(rows).toContainEqual({ label: 'API keys', count: 1 });
    expect(rows).toContainEqual({ label: 'Other linked records', count: 11 });
    expect(rows.every(row => !row.label.includes(':') && !row.label.includes('_'))).toBe(true);
  });
});
