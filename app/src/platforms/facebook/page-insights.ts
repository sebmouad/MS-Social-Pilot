import { runtimeConfig } from '@/server/config/store';
import { facebookPageMetricPolicySchema } from './config';

/** Resolve legacy additions and explicit exclusions before constructing a Page transport. */
export async function configuredFacebookPageInsightMetrics(): Promise<string[]> {
  return facebookPageMetricPolicySchema.parse(await runtimeConfig('meta.pageInsightMetrics')).metrics;
}
