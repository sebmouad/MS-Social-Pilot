import { OperationError } from '@/lib/operation-error';
import { randomUUID } from 'node:crypto';

type Executor = { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> };

/** Domain audit written in the same transaction as the change it describes. */
export async function writeRootAudit(tx: Executor, actorId: string, action: string, detail: Record<string, unknown>) {
  const json = JSON.stringify(detail);
  const written = await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${action}, ${json}::jsonb, NOW())`;
  if (written !== 1) throw new OperationError('unavailable', 'The change and audit could not be confirmed.');
}
