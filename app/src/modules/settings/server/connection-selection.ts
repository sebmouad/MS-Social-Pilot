import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { setConnectionSelections } from '@/server/connection-mutations';

const selection = z.object({ kind: z.enum(['target', 'adAccount']), id: z.string().min(1), enabled: z.boolean() }).strict();

/** Both single and batch entry points validate consent here before the atomic, scoped and audited core. */
export async function changeConnectionSelections(actor: { userId: string; workspaceId: string }, input: unknown) {
  const max = await runtimeConfig('settings.connectionSelectionBatchSize');
  const parsed = z.union([
    z.object({ items: z.array(selection).min(1).max(max), confirmation: z.string() }).strict(),
    selection.extend({ confirmation: z.string() }).strict(),
  ]).safeParse(input);
  if (!parsed.success) throw invalidSelection();
  const data = parsed.data;
  const items = 'items' in data ? data.items : [{ kind: data.kind, id: data.id, enabled: data.enabled }];
  const expected = 'items' in data ? `SET CONNECTION SELECTIONS ${items.length}`
    : `SET CONNECTION ${data.kind} ${data.id} ${data.enabled ? 'ENABLED' : 'DISABLED'}`;
  if (items.length > max || data.confirmation !== expected) throw invalidSelection();
  await setConnectionSelections(actor, items);
  return { ok: true, changed: items.length };
}

function invalidSelection() {
  return new OperationError('invalid_request', 'Review the selected resources and confirm the exact selection.');
}
