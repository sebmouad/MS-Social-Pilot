import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { setConnectionSelections } from '@/server/connection-mutations';

/** Atomic multi-resource selection uses the same mutation service as the Connections modal. */
export async function changeConnectionSelections(actor: { userId: string; workspaceId: string }, input: unknown) {
  const max = await runtimeConfig('settings.connectionSelectionBatchSize');
  const parsed = z.object({ items: z.array(z.object({ kind: z.enum(['target', 'adAccount']), id: z.string().min(1), enabled: z.boolean() }).strict()).min(1).max(max), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== `SET CONNECTION SELECTIONS ${parsed.data.items.length}`) throw new OperationError('invalid_request', 'Review the selected resources and confirm the exact selection count.');
  await setConnectionSelections(actor, parsed.data.items);
  return { ok: true, changed: parsed.data.items.length };
}
