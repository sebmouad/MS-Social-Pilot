import { describe, expect, it } from 'vitest';
import { facebookStoredAdsParent } from '../src/platforms/facebook/ads-parent';
describe('Facebook-owned stored Ads relations', () => {
  it('resolves only the parent appropriate to the object level', () => {
    const fields = { campaign_id: '1234567890123456789', adset_id: '2234567890123456789' };
    expect(facebookStoredAdsParent({ level: 'campaign', fields })).toBeNull();
    expect(facebookStoredAdsParent({ level: 'adset', fields })).toBe('1234567890123456789');
    expect(facebookStoredAdsParent({ level: 'ad', fields })).toBe('2234567890123456789');
  });
  it.each([null, [], {}, { campaign_id: 123 }, { campaign_id: 'https://example.test' }, { campaign_id: '123 token' }])('refuses missing, malformed or already-coerced provider identities: %j', fields => {
    expect(facebookStoredAdsParent({ level: 'adset', fields })).toBeNull();
  });
});
