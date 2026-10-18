import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const PINNED_METRIC_CONFIG = [
  entry({ key: 'analytics.pins.maxPerUser', group: 'Analytics · Pinned metrics', label: 'Pinned metrics per person', kind: 'number', description: 'Most metrics one person may pin as personal tiles.', defaultValue: 8, schema: z.number().int().min(1).max(50), consumption: 'active' }),
] as const;
