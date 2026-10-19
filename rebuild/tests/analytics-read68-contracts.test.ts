import { describe, expect, it } from 'vitest';
import { demographicDimensionsSchema } from '../src/modules/analytics/demographics/config';
import { analyticsDemographicsToolDefinitions } from '../src/modules/analytics/demographics/mcp';
import { comparisonInputSchema } from '../src/modules/analytics/comparison/contracts';
import { analyticsComparisonToolDefinitions } from '../src/modules/analytics/comparison/mcp';
import { pinActionSchema } from '../src/modules/analytics/pins/contracts';
import { pinnedSearchSchema } from '../src/modules/analytics/ui/pins/search';
import { comparisonSearchSchema } from '../src/modules/analytics/ui/compare/search';

describe('Analytics parity contracts', () => {
  it('rejects duplicate Root demographic dimension IDs', () => {
    expect(demographicDimensionsSchema.safeParse([
      { id: 'country', label: 'Country', terms: ['country'] },
      { id: 'country', label: 'Region', terms: ['region'] },
    ]).success).toBe(false);
  });

  it('keeps demographic MCP filters bounded and rejects unknown comparison fields', () => {
    const schema = analyticsDemographicsToolDefinitions[0]!.inputSchema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.channel.maxItems).toBe(500);
    expect(comparisonInputSchema.safeParse({ mode: 'period', a: { start: '2026-10-01', end: '2026-10-07' }, b: { start: '2026-10-08', end: '2026-10-14' }, includeAll: true }).success).toBe(false);
  });

  it('keeps comparison MCP resource lists bounded and personal pin actions exact', () => {
    const schema = analyticsComparisonToolDefinitions[0]!.inputSchema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.groupA.maxItems).toBe(500);
    expect(pinActionSchema.safeParse({ action: 'pin', key: 'reach', confirmation: 'PIN ANALYTICS METRIC reach', extra: true }).success).toBe(false);
  });

  it('rejects repeated scalar values and unknown keys in customer Analytics routes', () => {
    expect(pinnedSearchSchema.safeParse({ compare: 'year' }).success).toBe(false);
    expect(pinnedSearchSchema.safeParse({ start: ['2026-10-01'] }).success).toBe(false);
    expect(comparisonSearchSchema.safeParse({ mode: ['period'] }).success).toBe(false);
    expect(comparisonSearchSchema.safeParse({ mode: 'period', unknown: 'all' }).success).toBe(false);
  });
});
