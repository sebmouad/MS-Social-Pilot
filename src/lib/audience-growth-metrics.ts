/** Keep retired Page likes distinct from current follows in stored history. */
export function audienceGrowthIdentity(metric: string | null, direction: 'gained' | 'lost') {
  const kind = metric?.startsWith('page_fan_') ? 'likes' : 'followers';
  return {
    metric,
    kind,
    labelKey: kind === 'likes' ? (direction === 'gained' ? 'newLikes' : 'lostLikes') : (direction === 'gained' ? 'newFollowers' : 'lostFollowers'),
    definitionKey: kind === 'likes' ? (direction === 'gained' ? 'def.newLikes' : 'def.lostLikes') : (direction === 'gained' ? 'def.newFollowers' : 'def.lostFollowers'),
    unit: 'people',
    aggregation: 'sum',
  } as const;
}
