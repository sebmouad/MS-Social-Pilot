import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal(''));

/** Strict sidebar query contract: only resource selectors may repeat. */
export const comparisonSearchSchema = z.object({
  mode: z.enum(['period', 'channels']).optional(),
  aStart: day.optional(), aEnd: day.optional(), bStart: day.optional(), bEnd: day.optional(),
  start: day.optional(), end: day.optional(),
  channel: z.union([id, z.array(id).max(500)]).optional(),
  groupA: z.union([id, z.array(id).max(500)]).optional(),
  groupB: z.union([id, z.array(id).max(500)]).optional(),
}).strict();

export type ComparisonSearch = z.infer<typeof comparisonSearchSchema>;

const list = (value: string | string[] | undefined) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

export function comparisonInputFromSearch(params: ComparisonSearch) {
  const mode = first(params.mode);
  if (mode === 'channels') return { mode: 'channels' as const, start: first(params.start), end: first(params.end), groupA: list(params.groupA), groupB: list(params.groupB) };
  if (mode === 'period') {
    const channel = list(params.channel);
    return { mode: 'period' as const, a: { start: first(params.aStart), end: first(params.aEnd) }, b: { start: first(params.bStart), end: first(params.bEnd) }, ...(channel.length ? { channel } : {}) };
  }
  return null;
}
