import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const ANALYTICS_EXPLORER_CONFIG = [
  entry({ key: 'analytics.explorerPageSize', group: 'Analytics · Explorer', label: 'Explorer metrics per page', kind: 'number', description: 'Maximum stored metrics shown on one Analytics Explorer page.', defaultValue: 25, schema: z.number().int().min(1).max(200), consumption: 'active' }),
  entry({ key: 'analytics.explorerSearchMaxCharacters', group: 'Analytics · Explorer', label: 'Explorer search length', kind: 'number', description: 'Maximum characters in Analytics Explorer metric search.', defaultValue: 200, schema: z.number().int().min(1).max(2000), consumption: 'active' }),
] as const;

export const ANALYTICS_EXPLORER_DEFAULTS = { pageSize: 25, searchMaxCharacters: 200 } as const;
