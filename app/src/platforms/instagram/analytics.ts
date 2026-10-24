import { INSTAGRAM_POLICY_DEFAULTS, type InstagramPolicy } from './config';

export function instagramMetricLabel(key: string, locale: 'en' | 'fr' = 'en', labels: InstagramPolicy['labels'] = INSTAGRAM_POLICY_DEFAULTS.labels): string | undefined {
  return labels[key]?.[locale];
}

export function instagramMetricKind(key: string): 'stock' | 'flow' | 'ratio' | 'breakdown' {
  if (key === 'follower_count') return 'flow';
  if (/demographics|online_followers|follows_and_unfollows/.test(key)) return 'breakdown';
  return 'flow';
}
