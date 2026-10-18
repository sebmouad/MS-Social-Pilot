import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const ids = z.array(id).min(1).max(500);
export const comparisonInputSchema = z.discriminatedUnion('mode', [
  /** Same channels and ad accounts over two date ranges (any two ranges, not only adjacent ones). */
  z.object({ mode: z.literal('period'), a: z.object({ start: day, end: day }).strict(), b: z.object({ start: day, end: day }).strict(), channel: ids.optional(), adAccount: ids.optional() }).strict(),
  /** One date range over two disjoint groups of channels. */
  z.object({ mode: z.literal('channels'), start: day, end: day, groupA: ids, groupB: ids }).strict(),
]);
export type ComparisonInput = z.infer<typeof comparisonInputSchema>;
export type ComparisonSide = { total: number | null; displayTotal?: string; coverage: number; available: number; latestAt: Date | null } | null;
export type ComparisonStatus = 'comparable' | 'missing' | 'coverage_changed' | 'not_comparable';
export type ComparisonRow = {
  key: string; label: string; sourceLabel: string; resourceKind: 'channel' | 'ad-account'; unit: string; kind: string; aggregationLabel: string;
  a: ComparisonSide; b: ComparisonSide;
  status: ComparisonStatus; delta: number | null; percent: number | null; reason: string;
};
