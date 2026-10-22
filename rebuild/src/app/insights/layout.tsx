import '@/modules/analytics/ui/analytics.css';
import '@/modules/ads/ui/ads.css';
import '@/modules/analytics/ui/insights/insights.css';

/** Insights area (design v2): Overview, Explore, Audience, Posts, Compare, Ads and Reports. Each page frames itself because Analytics and Ads authorize separately. */
export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
