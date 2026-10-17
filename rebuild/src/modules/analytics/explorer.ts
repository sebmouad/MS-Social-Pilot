import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const page = z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).refine(Number.isSafeInteger)]);
export const analyticsExplorerFilterSchema = z.object({
  start: z.string().optional(), end: z.string().optional(), compare: z.enum(['none', 'previous', 'year']).optional(),
  filter: z.literal('1').optional(), channel: z.union([id, z.array(id)]).optional(),
  adFilter: z.literal('1').optional(), adAccount: z.union([id, z.array(id)]).optional(),
  search: z.string().optional(), source: z.string().max(200).optional(), kind: z.enum(['all', 'stock', 'flow', 'ratio', 'breakdown']).optional(),
  metric: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).max(500).optional()), page: z.unknown().optional(), pointPage: z.unknown().optional(), rowPage: z.unknown().optional(),
}).strict();

export type AnalyticsExplorerInput = z.infer<typeof analyticsExplorerFilterSchema>;
export type AnalyticsExplorerMetric = { key: string; label: string; sourceLabel: string; kind: string; unit: string; total: number | null; displayTotal?: string; aggregationLabel: string; aggregationNote?: string; coverage: number; available: number; latestAt: Date | null };
export type AnalyticsExplorerMetricData = AnalyticsExplorerMetric & { points: Array<{ date: string; label: string; value: number }>; rows: Array<{ label: string; value: number; asOf: Date | null }> };
export type AnalyticsExplorerResult = {
  period: { start: string; end: string; comparison: null | { mode: 'previous' | 'year'; start: string; end: string } };
  options: { channels: Array<{ id: string; name: string }>; adAccounts: Array<{ id: string; name: string; currency: string | null }>; sources: string[]; metrics: Array<{ key: string; label: string; sourceLabel: string }> };
  selected: { channelIds: string[]; adAccountIds: string[] };
  filters: { search: string; source: string; kind: string };
  searchMaxCharacters: number;
  metrics: { items: AnalyticsExplorerMetric[]; total: number; page: number; pages: number; pageSize: number };
  detail: null | { metric: AnalyticsExplorerMetric; points: { items: AnalyticsExplorerMetricData['points']; total: number; page: number; pages: number; pageSize: number }; rows: { items: AnalyticsExplorerMetricData['rows']; total: number; page: number; pages: number; pageSize: number } };
  query: string;
};

export function parseAnalyticsExplorerInput(raw: unknown, searchMaxCharacters: number): AnalyticsExplorerInput & { page?: number; pointPage?: number; rowPage?: number } {
  const parsed = analyticsExplorerFilterSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose valid Analytics Explorer filters, or reset the filters and try again.');
  const input = parsed.data;
  const channels = input.channel === undefined ? [] : Array.isArray(input.channel) ? input.channel : [input.channel];
  const accounts = input.adAccount === undefined ? [] : Array.isArray(input.adAccount) ? input.adAccount : [input.adAccount];
  if (new Set(channels).size !== channels.length || new Set(accounts).size !== accounts.length || (channels.length > 0 && input.filter !== '1') || (accounts.length > 0 && input.adFilter !== '1')) throw new OperationError('invalid_request', 'Choose valid Analytics Explorer filters, or reset the filters and try again.');
  const search = input.search?.trim() ?? '';
  if (search.length > searchMaxCharacters) throw new OperationError('invalid_request', 'Shorten the metric search and try again.');
  const parsePage = (value: unknown) => { if (value === undefined) return undefined; const result = page.safeParse(value); if (!result.success) throw new OperationError('invalid_request', 'Choose a valid result page.'); return result.data; };
  return { ...input, search, page: parsePage(input.page), pointPage: parsePage(input.pointPage), rowPage: parsePage(input.rowPage) };
}
