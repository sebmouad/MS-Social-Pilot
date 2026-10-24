import { z } from 'zod';

/** Root-managed order of overview metric cards; every value is a setting, nothing here is a rule about a provider. */
export const overviewOrderSchema = z.object({
  /** Which kind of resource leads: channel measures before ad-account measures by default. */
  resourceOrder: z.array(z.enum(['channel', 'ad-account'])).min(1).max(2),
  /** Case-insensitive fragments of a metric key, most important first (views/reach, then engagement, then follows). */
  headlinePriority: z.array(z.string().min(1).max(100)).max(100),
  /** Ratio, cost and rate measures whose total is zero or unknown sink below real figures. */
  demoteEmptyRatios: z.boolean(),
}).strict();

export type OverviewOrder = z.infer<typeof overviewOrderSchema>;

export const overviewOrderDefaults: OverviewOrder = {
  resourceOrder: ['channel', 'ad-account'],
  headlinePriority: ['media_view', 'views', 'reach', 'impressions', 'engage', 'reaction', 'comment', 'share', 'click', 'follow', 'fan'],
  demoteEmptyRatios: true,
};
