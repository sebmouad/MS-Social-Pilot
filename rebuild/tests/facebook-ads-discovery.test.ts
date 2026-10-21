import { describe, expect, it, vi } from 'vitest';
import { discoverFacebookAdObjects } from '../src/platforms/facebook/ads-discovery';

const now = new Date('2026-10-21T12:00:00Z');
const policy = { pageSize: 25, maxPages: 3 };
describe('Facebook object discovery independent of insights', () => {
  it('discovers paused campaigns, ad sets and ads with parent links and follows cursors without following remote URLs', async () => {
    const get = vi.fn().mockResolvedValueOnce({ data: [{ id: 'c1', account_id: '1', name: 'Autumn', status: 'PAUSED' }], paging: { next: 'https://untrusted.invalid', cursors: { after: 'cursor2' } } })
      .mockResolvedValueOnce({ data: [{ id: 'c2', account_id: '1', status: 'PAUSED' }] })
      .mockResolvedValueOnce({ data: [{ id: 's1', account_id: '1', campaign_id: 'c1', status: 'PAUSED' }] })
      .mockResolvedValueOnce({ data: [{ id: 'a1', account_id: '1', adset_id: 's1', status: 'PAUSED' }] });
    const rows = await discoverFacebookAdObjects({ get, post: vi.fn() }, 'fixture-token', 'act_1', 'local1', policy, now);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ adAccountId: 'local1', objectId: 'c1', level: 'campaign', status: 'paused' });
    expect(rows[2]).toMatchObject({ parentId: 'c1', level: 'adset' });
    expect(rows[3]).toMatchObject({ parentId: 's1', level: 'ad' });
    expect(get.mock.calls[1]).toMatchObject(['act_1/campaigns', 'fixture-token', { after: 'cursor2', limit: '25' }, undefined]);
    expect(get.mock.calls.every(call => !call[0].includes('://'))).toBe(true);
  });
  it('rejects cross-account objects', async () => {
    const get = vi.fn(async () => ({ data: [{ id: 'c1', account_id: '2' }] }));
    await expect(discoverFacebookAdObjects({ get, post: vi.fn() }, 'fixture-token', 'act_1', 'local1', policy, now)).rejects.toThrow('account mismatch');
  });
  it('does not silently accept a truncated inventory', async () => {
    const get = vi.fn(async () => ({ data: [], paging: { next: 'more', cursors: { after: 'same' } } }));
    await expect(discoverFacebookAdObjects({ get, post: vi.fn() }, 'fixture-token', 'act_1', 'local1', { ...policy, maxPages: 1 }, now)).rejects.toThrow('pagination incomplete');
  });
});
