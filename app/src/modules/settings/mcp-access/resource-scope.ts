import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import type { ScopedPageAccess } from '@/server/permissions';

/** Versioned credential data, independent from provider IDs or current role grants. */
export type McpResourceScope = { version: 1; mode: 'all' } | { version: 1; mode: 'selected'; ids: string[]; adAccountIds: string[] };

/** NULL is reserved for pre-scope credentials; malformed/missing stored data must never grant all. */
export function parseResourceScope(value: unknown, maximum: number): McpResourceScope | null {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new OperationError('unavailable', 'MCP resource policy is unavailable.');
  if (value === null) return null;
  const schema = z.discriminatedUnion('mode', [
    z.object({ version: z.literal(1), mode: z.literal('all') }).strict(),
    z.object({ version: z.literal(1), mode: z.literal('selected'), ids: z.array(z.string().min(1)).max(maximum), adAccountIds: z.array(z.string().min(1)).max(maximum).default([]) }).strict(),
  ]);
  const result = schema.safeParse(value);
  if (!result.success) throw new OperationError('forbidden', 'The API key resource scope is invalid. Create a new key.');
  if (result.data.mode === 'selected' && result.data.ids.length + result.data.adAccountIds.length > maximum) throw new OperationError('forbidden', 'The API key resource scope exceeds the current limit.');
  return result.data.mode === 'selected' ? { ...result.data, ids: [...new Set(result.data.ids)], adAccountIds: [...new Set(result.data.adAccountIds)] } : result.data;
}

/** Intersect on every request. An empty selected list is always an explicit denial. */
export function intersectResourceScope(current: ScopedPageAccess, ceiling: McpResourceScope | null): ScopedPageAccess {
  if (!ceiling || ceiling.mode === 'all') return current.all ? { all: true } : { all: false, ids: [...current.ids] };
  return { all: false, ids: ceiling.ids.filter(id => current.all || current.ids.includes(id)) };
}
