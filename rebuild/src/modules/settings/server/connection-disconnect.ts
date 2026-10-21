import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { disconnectSocialAccount, type ConnectionMutationActor } from '@/server/connection-mutations';
import { withWorkspaceOperation } from '@/server/data-control/guard';

// Preserve the existing public MCP protocol; consent must identify both source and data choice.
const disconnectSchema = z.object({
  socialAccountId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  mode: z.enum(['retain', 'delete']),
  confirmation: z.string(),
}).strict();

/** Shared confirmation boundary; the transactional core owns current manager authority, tenant scope and audit. */
export async function changeConnectionDisconnect(actor: ConnectionMutationActor, input: unknown) {
  const parsed = disconnectSchema.safeParse(input);
  if (!parsed.success) throw invalidDisconnect();
  const { socialAccountId, mode, confirmation } = parsed.data;
  const expected = `DISCONNECT ${socialAccountId} ${mode === 'retain' ? 'RETAIN' : 'DELETE RELATED DATA'}`;
  if (confirmation !== expected) throw invalidDisconnect();
  const result = await withWorkspaceOperation(actor.workspaceId, () => disconnectSocialAccount(actor, socialAccountId, mode, mode === 'delete' ? 'DELETE' : undefined));
  return { ok: true, socialAccountId, ...result, providerAccessRevoked: false };
}

function invalidDisconnect() {
  return new OperationError('invalid_request', 'Review this source and confirm whether to keep or delete its related data.');
}
