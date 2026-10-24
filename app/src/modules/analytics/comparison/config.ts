import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const COMPARISON_CONFIG = [
  entry({ key: 'analytics.comparison.maxMetrics', group: 'Analytics · Comparison', label: 'Metrics per comparison', kind: 'number', description: 'Most metrics returned by one period or channel comparison.', defaultValue: 300, schema: z.number().int().min(10).max(2000), consumption: 'active' }),
] as const;
