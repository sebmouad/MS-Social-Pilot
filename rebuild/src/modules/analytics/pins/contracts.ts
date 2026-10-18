import { z } from 'zod';

/** Rebuild pins share the legacy `users."pinnedMetrics"` column under this prefix; other entries are never touched. */
export const PIN_PREFIX = 'v2:';
export const metricKey = z.string().min(1).max(500).regex(/^[^\u0000-\u001F\u007F]+$/);
export const pinConfirmation = {
  pin: (key: string) => `PIN ANALYTICS METRIC ${key}`,
  unpin: (key: string) => `UNPIN ANALYTICS METRIC ${key}`,
  reorder: (count: number) => `REORDER ANALYTICS PINS ${count}`,
};
export const pinActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pin'), key: metricKey, confirmation: z.string().max(1000) }).strict(),
  z.object({ action: z.literal('unpin'), key: metricKey, confirmation: z.string().max(1000) }).strict(),
  z.object({ action: z.literal('reorder'), keys: z.array(metricKey).max(100), confirmation: z.string().max(1000) }).strict(),
]);
export type PinAction = z.infer<typeof pinActionSchema>;
export type PinnedMetricView = {
  key: string; label: string; sourceLabel: string; unit: string; kind: string; resourceKind: 'channel' | 'ad-account' | null; state: 'available' | 'unavailable';
  total: number | null; displayTotal?: string; aggregationLabel?: string; aggregationNote?: string;
  coverage: number | null; available: number | null; latestAt: Date | null;
  comparison: null | { status: string; previous: number | null; delta: number | null; percent: number | null };
};
