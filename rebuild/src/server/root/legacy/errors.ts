import { z } from 'zod';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { assertRootActor, lockRootActor, invalid, isMissingRelation, redact } from './authz';
import { writeRootAudit } from './audit';
import { rootResultLimit, legacySetting, rootTransaction } from './policy';

type ErrorRow = { id: string; source: string; name: string; message: string; stack?: string | null; location: string | null; release: string; count: number; firstSeenAt: Date; lastSeenAt: Date; resolvedAt: Date | null; total?: number };

const filterSchema = z.object({ status: z.enum(['open', 'resolved', 'all']).optional(), source: z.enum(['server', 'worker', 'browser']).optional(), q: z.string().trim().max(2000).optional(), page: z.coerce.number().int().min(1).max(100000).optional() }).strict();
const like = (value: string) => `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
const unavailable = () => new OperationError('unavailable', 'The error log is not available in this database.');

async function shape(row: ErrorRow, withStack: boolean) {
  const [message, stack] = await Promise.all([legacySetting('root.legacy.errorMessageMaxCharacters'), withStack ? legacySetting('root.legacy.errorStackMaxCharacters') : Promise.resolve(0)]);
  return {
    id: row.id, source: row.source, name: redact(row.name, 200), message: redact(row.message, message), location: redact(row.location?.split(/[?#]/)[0], 300), release: row.release.replace(/[^\x20-\x7e]/g, "").slice(0, 64), count: row.count,
    firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    ...(withStack ? { stack: redact(row.stack, stack) } : {}),
  };
}

/** Grouped error occurrences, newest first. Messages are redacted and truncated; stacks are detail only. */
export async function listRootErrors(actorId: string, input: unknown = {}, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const parsed = filterSchema.safeParse(input);
  const max = await legacySetting('root.legacy.searchMaxCharacters');
  if (!parsed.success || (parsed.data.q?.length ?? 0) > max) throw invalid('Use a shorter search and a valid filter.');
  const { status = 'open', source, q, page = 1 } = parsed.data;
  const size = rootResultLimit(await legacySetting('root.legacy.errorPageSize'), resultCap);
  const pattern = q ? like(q) : null;
  const sourceFilter = source ?? null;
  try {
    const rows = await prisma.$queryRaw<ErrorRow[]>`SELECT id, source, name, message, location, release, count, "firstSeenAt", "lastSeenAt", "resolvedAt", COUNT(*) OVER()::int AS total FROM error_events WHERE (${status} = 'all' OR (${status} = 'open' AND "resolvedAt" IS NULL) OR (${status} = 'resolved' AND "resolvedAt" IS NOT NULL)) AND (${sourceFilter}::text IS NULL OR source = ${sourceFilter}) AND (${pattern}::text IS NULL OR name ILIKE ${pattern} ESCAPE '\\' OR message ILIKE ${pattern} ESCAPE '\\' OR location ILIKE ${pattern} ESCAPE '\\') ORDER BY "lastSeenAt" DESC, id LIMIT ${size} OFFSET ${(page - 1) * size}`;
    return { items: await Promise.all(rows.map(row => shape(row, false))), page, pageSize: size, total: rows[0]?.total ?? 0, limits: { searchMaxCharacters: max } };
  } catch (error) {
    if (isMissingRelation(error)) throw unavailable();
    throw error;
  }
}

export async function getRootError(actorId: string, id: string) {
  await assertRootActor(prisma, actorId);
  if (!id || id.length > 200) throw invalid('Choose an error.');
  try {
    const row = (await prisma.$queryRaw<ErrorRow[]>`SELECT id, source, name, message, stack, location, release, count, "firstSeenAt", "lastSeenAt", "resolvedAt" FROM error_events WHERE id = ${id}`)[0];
    if (!row) throw new OperationError('not_found', 'Error not found.');
    return shape(row, true);
  } catch (error) {
    if (isMissingRelation(error)) throw unavailable();
    throw error;
  }
}

/** Mark an error group resolved or reopen it. Reversible bookkeeping, so no typed confirmation; audited atomically. A new occurrence reopens it by itself. */
export async function setRootErrorResolved(actorId: string, id: string, resolved: boolean) {
  if (!id || id.length > 200 || typeof resolved !== 'boolean') throw invalid('Choose an error.');
  try {
    return await rootTransaction(async tx => {
      await lockRootActor(tx, actorId);
      const row = (await tx.$queryRaw<Array<{ id: string; resolvedAt: Date | null }>>`SELECT id, "resolvedAt" FROM error_events WHERE id = ${id} FOR UPDATE`)[0];
      if (!row) throw new OperationError('not_found', 'Error not found.');
      if (Boolean(row.resolvedAt) === resolved) return { changed: false, id, resolved };
      const changed = await tx.$executeRaw`UPDATE error_events SET "resolvedAt" = ${resolved ? new Date() : null} WHERE id = ${id}`;
      if (changed !== 1) throw new OperationError('conflict', 'The error record changed. Reload and try again.');
      await writeRootAudit(tx, actorId, resolved ? 'root.error_resolved' : 'root.error_reopened', { errorId: id });
      return { changed: true, id, resolved };
    });
  } catch (error) {
    if (isMissingRelation(error)) throw unavailable();
    throw error;
  }
}
