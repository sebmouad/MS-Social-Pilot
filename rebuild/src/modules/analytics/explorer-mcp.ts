import { analyticsError } from '@/modules/analytics/server/error-copy';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { readAnalyticsExplorer } from './server/explorer';
import type { AnalyticsReadActor, AnalyticsReadConstraints } from './server/types';

export const analyticsExplorerTools = new Set<string>(['get_analytics_explorer']);
export const analyticsExplorerWriteTools = new Set<string>();
export const analyticsExplorerToolDefinitions = [{
  name: 'get_analytics_explorer',
  description: 'Explore bounded stored Analytics metrics for selected authorized channels and ad accounts. Search metrics, filter by exact source and data kind, inspect coverage/provenance and continue metric, date-series, or resource pagination. Missing values remain unknown, not zero. No provider request is made.',
  inputSchema: { type: 'object', properties: {
    start: { type: 'string', description: 'Inclusive UTC date, YYYY-MM-DD.' }, end: { type: 'string', description: 'Inclusive UTC date, YYYY-MM-DD.' },
    compare: { type: 'string', enum: ['none', 'previous', 'year'] }, filter: { type: 'string', enum: ['1'] }, channel: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    adFilter: { type: 'string', enum: ['1'] }, adAccount: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    search: { type: 'string' }, source: { type: 'string', maxLength: 200 }, kind: { type: 'string', enum: ['all', 'stock', 'flow', 'ratio', 'breakdown'] },
    metric: { type: 'string' }, page: { type: 'integer', minimum: 1 }, pointPage: { type: 'integer', minimum: 1 }, rowPage: { type: 'integer', minimum: 1 },
  }, additionalProperties: false },
}] as const;
export type AnalyticsExplorerToolName = typeof analyticsExplorerToolDefinitions[number]['name'];

const inputSchema = z.object({
  start: z.string().optional(), end: z.string().optional(), compare: z.enum(['none', 'previous', 'year']).optional(),
  filter: z.literal('1').optional(), channel: z.union([z.string(), z.array(z.string())]).optional(), adFilter: z.literal('1').optional(), adAccount: z.union([z.string(), z.array(z.string())]).optional(),
  search: z.string().optional(), source: z.string().max(200).optional(), kind: z.enum(['all', 'stock', 'flow', 'ratio', 'breakdown']).optional(), metric: z.string().optional(),
  page: z.number().int().positive().optional(), pointPage: z.number().int().positive().optional(), rowPage: z.number().int().positive().optional(),
}).strict();

export async function executeAnalyticsExplorerTool(actor: AnalyticsReadActor, args: unknown, constraints: AnalyticsReadConstraints = {}, maxItems?: number) {
  const parsed = inputSchema.safeParse(args ?? {});
  if (!parsed.success) throw await analyticsError('invalid_request', "Choose valid Analytics Explorer filters.");
  return readAnalyticsExplorer(actor, parsed.data, constraints, maxItems);
}
