const metricNames: Record<string, string> = {
  views: 'Views', profile_views: 'Profile views', follower_count: 'New followers',
  follows_and_unfollows: 'Follows and unfollows',
};

export function instagramMetricLabel(key: string): string | undefined {
  return metricNames[key];
}

export function instagramMetricKind(key: string): 'stock' | 'flow' | 'ratio' | 'breakdown' {
  if (key === 'follower_count') return 'flow';
  if (/demographics|online_followers|follows_and_unfollows/.test(key)) return 'breakdown';
  return 'flow';
}
