import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { sanitizeRootActivity, type ActivityRow } from './read-model';

// Cursor wire protocol v1: bounded canonical base64url JSON, millisecond UTC
// timestamp (legacy TIMESTAMP(3)), stable record ID, direction and filter digest.
// Version, timestamp precision and digest shape are serialization invariants.
// Operational page, search and encoded cursor limits come from Root settings.
const CURSOR_VERSION = 1;
const cursorSchema = z.object({ v: z.literal(CURSOR_VERSION), at: z.string().datetime({ precision: 3 }).refine(value => !value.startsWith('0000-')), id: z.string().min(1), direction: z.enum(['older', 'newer']), filter: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Cursor = z.infer<typeof cursorSchema>;

function validDay(value: string) {
  return /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
const invalid = () => new OperationError('invalid_request', 'Choose valid activity filters, or reset to the latest activity.');

function readCursor(value: string | undefined, filter: string, maxCharacters: number): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > maxCharacters || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw invalid();
    const cursor = cursorSchema.parse(JSON.parse(decoded.toString('utf8')));
    if (cursor.filter !== filter || !Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString() !== cursor.at) throw invalid();
    return cursor;
  } catch { throw invalid(); }
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, character => `\\${character}`);

/** Installation-wide read, independent of workspace grants and module entitlements. */
export async function listRootActivity(actorId: string, input: unknown, maxResultItems?: number) {
  return readRootActivity(actorId, input, maxResultItems);
}

/** Complete bounded read: pagination arguments are deliberately rejected. */
export async function readRootActivityForExport(actorId: string, input: unknown, cap: number) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['q', 'workspaceId', 'from', 'to'].includes(key))) throw invalid();
  return readRootActivity(actorId, input, cap, true);
}

async function readRootActivity(actorId: string, input: unknown, maxResultItems?: number, exporting = false) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
  if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
  const [configuredLimit, searchCharacters, cursorCharacters] = await Promise.all([runtimeConfig('root.activityPageSize'), runtimeConfig('root.activitySearchMaxCharacters'), runtimeConfig('root.activityCursorMaxCharacters')]);
  const schema = z.object({
    q: z.string().trim().max(searchCharacters).optional(), workspaceId: z.string().trim().max(searchCharacters).optional(),
    from: z.string().refine(validDay).optional(), to: z.string().refine(validDay).optional(),
    limit: z.number().int().positive().safe().optional(), cursor: z.string().max(cursorCharacters).optional(),
  }).strict();
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalid();
  const filters = { q: parsed.data.q ?? '', workspaceId: parsed.data.workspaceId ?? '', from: parsed.data.from ?? '', to: parsed.data.to ?? '' };
  if (filters.from && filters.to && filters.from > filters.to) throw invalid();
  if (maxResultItems !== undefined && (!Number.isSafeInteger(maxResultItems) || maxResultItems < 1)) throw new Error('Invalid audit result cap.');
  const limit = exporting ? maxResultItems! : Math.min(parsed.data.limit ?? configuredLimit, configuredLimit, maxResultItems ?? configuredLimit);
  const filter = createHash('sha256').update(JSON.stringify(filters)).digest('hex');
  const cursor = readCursor(parsed.data.cursor, filter, cursorCharacters);
  const conditions: Prisma.Sql[] = [];
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    conditions.push(Prisma.sql`(a.action ILIKE ${pattern} ESCAPE ${'\\'} OR u.name ILIKE ${pattern} ESCAPE ${'\\'} OR u.email ILIKE ${pattern} ESCAPE ${'\\'})`);
  }
  if (filters.workspaceId) conditions.push(Prisma.sql`a.detail->>'workspaceId' = ${filters.workspaceId}`);
  // Legacy TIMESTAMP(3) stores UTC without a timezone. Binding ISO text with
  // an explicit timestamp cast avoids session-zone coercion of Date parameters.
  if (filters.from) conditions.push(Prisma.sql`a."createdAt" >= ${filters.from}::date`);
  if (filters.to) conditions.push(Prisma.sql`a."createdAt" < (${filters.to}::date + INTERVAL '1 day')`);
  if (cursor) conditions.push(cursor.direction === 'older'
    ? Prisma.sql`(a."createdAt", a.id) < (${cursor.at}::timestamp, ${cursor.id})`
    : Prisma.sql`(a."createdAt", a.id) > (${cursor.at}::timestamp, ${cursor.id})`);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  const order = cursor?.direction === 'newer' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const rows = await prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
    SELECT a.id, a.action, a.detail, a."createdAt", u.name AS "actorName", u.email AS "actorEmail"
    FROM root_activities AS a LEFT JOIN users AS u ON u.id = a."actorId"
    ${where} ORDER BY a."createdAt" ${order}, a.id ${order} LIMIT ${limit + 1}
  `);
  if (exporting && rows.length > limit) throw new OperationError('invalid_request', 'Too many matching audit events. Narrow the filters before exporting.');
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (cursor?.direction === 'newer') page.reverse();
  const encode = (row: ActivityRow | undefined, direction: Cursor['direction']) => {
    if (!row) return null;
    const payload = cursorSchema.parse({ v: CURSOR_VERSION, at: row.createdAt.toISOString(), id: row.id, direction, filter });
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    if (encoded.length > cursorCharacters) throw new Error('Audit cursor exceeds the configured limit.');
    return encoded;
  };
  return {
    items: page.map(sanitizeRootActivity), filters, limit, configuredLimit, searchCharacters,
    newerCursor: (cursor?.direction === 'older' || cursor?.direction === 'newer' && hasMore) ? encode(page[0], 'newer') : null,
    olderCursor: (cursor?.direction === 'newer' || hasMore) ? encode(page.at(-1), 'older') : null,
  };
}
