import { expect, it } from 'vitest';
import { audienceGrowthIdentity } from '../src/lib/audience-growth-metrics';
it('preserves follows and retired likes as distinct metric identities', () => {
  expect(audienceGrowthIdentity('page_daily_follows_unique', 'gained')).toMatchObject({ labelKey: 'newFollowers', kind: 'followers', aggregation: 'sum' });
  expect(audienceGrowthIdentity('page_fan_adds_unique', 'gained')).toMatchObject({ labelKey: 'newLikes', kind: 'likes', metric: 'page_fan_adds_unique' });
  expect(audienceGrowthIdentity('page_fan_removes', 'lost').definitionKey).toBe('def.lostLikes');
});
