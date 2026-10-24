import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const G = 'Analytics · Demographics';
export const demographicDimensionsSchema = z.array(z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  label: z.string().trim().min(1).max(60),
  /** Lower-case words that identify the dimension in a normalized breakdown metric's label or key. */
  terms: z.array(z.string().trim().toLowerCase().min(1).max(40)).min(1).max(20),
}).strict()).min(1).max(20).superRefine((dimensions, context) => {
  const ids = new Set<string>();
  for (const [index, dimension] of dimensions.entries()) {
    if (ids.has(dimension.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Dimension IDs must be unique.' });
    ids.add(dimension.id);
  }
});
export type DemographicDimension = z.infer<typeof demographicDimensionsSchema>[number];

export const DEMOGRAPHICS_CONFIG = [
  entry({
    key: 'analytics.demographics.dimensions', group: G, label: 'Audience dimensions', kind: 'json',
    description: 'Dimensions grouped on the Audience breakdown screen. A breakdown metric belongs to a dimension when its label or key contains one of the terms.',
    defaultValue: [
      { id: 'country', label: 'Country', terms: ['country', 'countries'] },
      { id: 'city', label: 'City', terms: ['city', 'cities'] },
      { id: 'age-gender', label: 'Age and gender', terms: ['age', 'gender'] },
      { id: 'language', label: 'Language', terms: ['language', 'locale'] },
    ], schema: demographicDimensionsSchema, consumption: 'active',
  }),
  entry({ key: 'analytics.demographics.maxRowsPerMetric', group: G, label: 'Rows shown per breakdown', kind: 'number', description: 'Most categories returned for one breakdown; the remainder is reported as hidden.', defaultValue: 50, schema: z.number().int().min(5).max(500), consumption: 'active' }),
] as const;
