import { describe, expect, it } from 'vitest';
import { summarizeDisconnectCounts } from '@/modules/settings/ui/connections/preview';

describe('connection deletion preview', () => {
  it('accounts for related records without double-counting provider-scheduled posts', () => {
    const counts = { channels: 1, adAccounts: 2, postTargets: 3, orphanPosts: 1, comments: 4, scheduledRemote: 2, 'future:record': 5 };
    const view = summarizeDisconnectCounts(counts);
    expect(view.scheduledRemote).toBe(2);
    expect(view.rows.reduce((sum, row) => sum + row.count, 0)).toBe(16);
    expect(view.rows).toContainEqual({ label: 'Other linked records', count: 5 });
    expect(view.rows.every(row => !row.label.includes(':') && !row.label.includes('_'))).toBe(true);
  });
});
