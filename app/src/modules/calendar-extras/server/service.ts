import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { z } from 'zod';
import { type Actor, type Area, type KeyDate, type Season, type Note, type Feed, type Filters } from '../contracts';
import { settings } from './settings';
import { authorize, audit, checkTargets, fail, transact, visibleArray, array, type Access } from './access';
import { actionSchema, confirmation, day } from './validation';
import { createFeedRecord } from './subscriptions';
import { readTrends } from './trends';

export async function calendarOptions(actor: Actor, area: Area, maxItems?: number) {
 const { policy, copy } = await settings(actor.locale);
 const access = await authorize(actor, area, 'read', copy);
 if (access.channels.length > policy.maxRows) return fail('invalid_request', copy.tooMany);
 const groups = area === 'feeds' ? await prisma.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`SELECT g.id, g.name FROM page_groups g WHERE g."workspaceId" = ${actor.workspaceId} AND EXISTS (SELECT 1 FROM page_group_targets gt WHERE gt."groupId" = g.id) AND NOT EXISTS (SELECT 1 FROM page_group_targets gt WHERE gt."groupId" = g.id AND NOT (gt."targetId" = ANY(${array(access.channels.map(c => c.id))}))) ORDER BY g.name, g.id LIMIT ${policy.maxRows + 1}`) : [];
 if (groups.length > policy.maxRows || maxItems !== undefined && (access.channels.length > maxItems || groups.length > maxItems)) return fail('invalid_request', copy.tooMany);
 return { policy, copy, groups, channels: access.channels, allChannels: access.scope === null, canWrite: access.canWrite, timeZone: access.timeZone };
}
export async function listCalendarEntries(actor: Actor, area: Area, raw: unknown, maxItems?: number) {
 const { policy, copy } = await settings(actor.locale);
 const access = await authorize(actor, area, 'read', copy);
 const checked = z.object({ from: day, to: day, offset: z.number().int().min(0).default(0), targetId: z.string().max(policy.maxIdentifier).optional(), showAll: z.boolean().optional() }).strict().safeParse(raw);
 if (!checked.success) return fail('invalid_request', copy.invalid);
 const f: Filters = checked.data;
 if (f.to < f.from || (Date.parse(f.to) - Date.parse(f.from)) / 86400000 > policy.maxRangeDays) return fail('invalid_request', copy.invalid);
 if (f.targetId) checkTargets([f.targetId], access, copy);
 const limit = Math.min(policy.pageSize, maxItems === undefined ? policy.pageSize : z.number().int().positive().parse(maxItems));
 const scope = visibleArray(Prisma.sql`"targetIds"`, access);
 const targetFilter = f.targetId ? Prisma.sql`AND ("targetIds" = ARRAY[]::text[] OR ${f.targetId} = ANY("targetIds"))` : Prisma.empty;
 let rows: Array<KeyDate | Season | Note | Feed>;
 if (area === 'trends') return readTrends(actor, access, f, policy, copy, limit);
 if (area === 'dates') rows = await prisma.$queryRaw<KeyDate[]>(Prisma.sql`SELECT id, date, title, yearly, "targetIds" FROM key_dates WHERE "workspaceId" = ${actor.workspaceId} AND ${scope} ${targetFilter} AND (yearly OR date BETWEEN ${f.from} AND ${f.to}) ORDER BY date, id OFFSET ${f.offset} LIMIT ${limit + 1}`);
 else if (area === 'seasons') rows = await prisma.$queryRaw<Season[]>(Prisma.sql`SELECT id, name, "startsOn", "endsOn", "targetIds", rule, "shiftMinutes", "extraTimes" FROM seasonal_modes WHERE "workspaceId" = ${actor.workspaceId} AND ${scope} ${targetFilter} AND "startsOn" <= ${f.to} AND "endsOn" >= ${f.from} ORDER BY "startsOn", id OFFSET ${f.offset} LIMIT ${limit + 1}`);
 else if (area === 'notes') rows = await prisma.$queryRaw<Note[]>(Prisma.sql`SELECT id, day, label, color, "targetId" FROM chart_notes WHERE "workspaceId" = ${actor.workspaceId} AND ("targetId" IS NULL OR "targetId" = ANY(${array(access.channels.map(c => c.id))})) AND day BETWEEN ${f.from} AND ${f.to} ${f.targetId ? Prisma.sql`AND ("targetId" IS NULL OR "targetId" = ${f.targetId})` : Prisma.empty} ORDER BY day, id OFFSET ${f.offset} LIMIT ${limit + 1}`);
 else rows = await prisma.$queryRaw<Feed[]>(Prisma.sql`SELECT id, name, "pageIds", "groupId", "createdAt", "lastUsedAt" FROM calendar_feeds WHERE "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId} ORDER BY "createdAt", id OFFSET ${f.offset} LIMIT ${limit + 1}`);
 return { items: rows.slice(0, limit), hasMore: rows.length > limit, limit, offset: f.offset };
}

/** All consent, authorization, validation and audit policy lives here for UI, REST and MCP. */
export async function changeCalendarEntry(actor: Actor, area: Area, raw: unknown) {
 const { policy, copy } = await settings(actor.locale);
 await authorize(actor, area, 'write', copy);
 const parsed = actionSchema(area, policy).safeParse(raw);
 if (!parsed.success) return fail('invalid_request', copy.invalid);
 const input = parsed.data;
 if (area === 'feeds' && input.operation === 'update' || area === 'trends' && input.operation !== 'update') return fail('invalid_request', copy.invalid);
 const identity = input.operation === 'create' ? actor.workspaceId : input.id;
 if (input.confirmation !== confirmation(area, input.operation, identity)) return fail('invalid_request', copy.wrongConfirmation);
 return transact(actor, area, policy, copy, async (tx, access) => {
  const id = input.operation === 'create' ? randomUUID() : input.id;
  let url: string | undefined;
  if (area === 'trends') {
   if (id !== actor.workspaceId || access.scope !== null || input.operation !== 'update') return fail('forbidden', copy.denied);
   const data = input.data as { keywords: string[] };
   const count = await tx.$executeRaw`UPDATE workspaces SET "trendKeywords" = ${data.keywords}::text[] WHERE id = ${actor.workspaceId}`;
   if (count !== 1) return fail('not_found', copy.missing);
  } else if (area === 'feeds') {
   if (input.operation === 'create') {
    const data = input.data as { name: string; targetIds: string[]; groupId: string | null };
    url = await createFeedRecord(tx, actor, access, id, data, policy, copy);
   } else {
    const count = await tx.$executeRaw`DELETE FROM calendar_feeds WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId}`;
    if (count !== 1) return fail('not_found', copy.missing);
   }
  } else {
   const table = area === 'dates' ? Prisma.sql`key_dates` : area === 'seasons' ? Prisma.sql`seasonal_modes` : Prisma.sql`chart_notes`;
   if (input.operation !== 'create') {
    const current = await tx.$queryRaw<Array<{ targetIds?: string[]; targetId?: string | null }>>(Prisma.sql`SELECT ${area === 'notes' ? Prisma.sql`"targetId"` : Prisma.sql`"targetIds"`} FROM ${table} WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`);
    const row = current[0];
    if (!row) return fail('not_found', copy.missing);
    checkTargets(area === 'notes' ? row.targetId ? [row.targetId] : [] : row.targetIds!, access, copy);
   }
   if (input.operation === 'delete') await tx.$executeRaw(Prisma.sql`DELETE FROM ${table} WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`);
   else {
    const data = input.data;
    if (area === 'dates') {
     const d = data as Omit<KeyDate, 'id'>;
     const targets = checkTargets(d.targetIds, access, copy);
     if (input.operation === 'create') await tx.$executeRaw`INSERT INTO key_dates (id, "workspaceId", date, title, yearly, "targetIds", "createdById", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${d.date}, ${d.title}, ${d.yearly}, ${targets}::text[], ${actor.userId}, NOW())`;
     else await tx.$executeRaw`UPDATE key_dates SET date = ${d.date}, title = ${d.title}, yearly = ${d.yearly}, "targetIds" = ${targets}::text[] WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    } else if (area === 'seasons') {
     const d = data as Omit<Season, 'id'>;
     const targets = checkTargets(d.targetIds, access, copy);
     if (input.operation === 'create') await tx.$executeRaw`INSERT INTO seasonal_modes (id, "workspaceId", name, "startsOn", "endsOn", "targetIds", rule, "shiftMinutes", "extraTimes", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${d.name}, ${d.startsOn}, ${d.endsOn}, ${targets}::text[], ${d.rule}, ${d.shiftMinutes}, ${d.extraTimes}::text[], NOW())`;
     else await tx.$executeRaw`UPDATE seasonal_modes SET name = ${d.name}, "startsOn" = ${d.startsOn}, "endsOn" = ${d.endsOn}, "targetIds" = ${targets}::text[], rule = ${d.rule}, "shiftMinutes" = ${d.shiftMinutes}, "extraTimes" = ${d.extraTimes}::text[] WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    } else {
     const d = data as Omit<Note, 'id'>;
     checkTargets(d.targetId ? [d.targetId] : [], access, copy);
     if (input.operation === 'create') await tx.$executeRaw`INSERT INTO chart_notes (id, "workspaceId", day, label, color, "targetId", "authorId", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${d.day}, ${d.label}, ${d.color}, ${d.targetId}, ${actor.userId}, NOW())`;
     else await tx.$executeRaw`UPDATE chart_notes SET day = ${d.day}, label = ${d.label}, color = ${d.color}, "targetId" = ${d.targetId} WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    }
   }
  }
  await audit(tx, actor, area, input.operation, id, copy);
  return { confirmed: true as const, area, operation: input.operation, id, ...(url ? { url } : {}) };
 });
}
/** Queue integration hook: refuses partial rules rather than silently ignoring the rest. */
export async function seasonalRules(actor: Actor, from: string, to: string, targetId?: string): Promise<Season[]> {
 const { policy, copy } = await settings(actor.locale);
 const items: Season[] = [];
 let offset = 0;
 for (;;) {
  const page = await listCalendarEntries(actor, 'seasons', { from, to, offset, ...(targetId ? { targetId } : {}) });
  if (!('items' in page)) return fail('unavailable', copy.unavailable);
  items.push(...page.items as Season[]);
  if (items.length > policy.maxRows) return fail('invalid_request', copy.tooMany);
  if (!page.hasMore) return items;
  offset += page.limit;
 }
}
