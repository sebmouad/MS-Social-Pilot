import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { scrub } from '@/server/errors/recorder';
import type { HistoryActor } from '../semantics';
import { authorizeHistory } from './access';

/**
 * What happened in a workspace, and what was emailed about it. One shared service behind the Settings › History screen,
 * the REST routes and the MCP tools. Both lists are read-only; the activity log is written by every module's own
 * audited writes and the email log by the mail sender.
 */
const KEYS = ['history.pageSize', 'history.maxOffset', 'history.searchMaxCharacters', 'history.detailMaxFields', 'history.detailValueMaxCharacters', 'history.errorMaxCharacters', 'history.recentFailureDays', 'history.hiddenDetailKeys', 'root.auditRetentionDays'] as const;

async function policy() {
  const values = await runtimeConfigBatch(KEYS);
  return {
    pageSize: values['history.pageSize'] as number, maxOffset: values['history.maxOffset'] as number, searchMax: values['history.searchMaxCharacters'] as number,
    detailFields: values['history.detailMaxFields'] as number, detailValue: values['history.detailValueMaxCharacters'] as number, errorMax: values['history.errorMaxCharacters'] as number,
    recentDays: values['history.recentFailureDays'] as number, hidden: (values['history.hiddenDetailKeys'] as string[]).map(word => word.toLowerCase()),
    retentionDays: values['root.auditRetentionDays'] as number,
  };
}

const like = (value: string) => `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
const bad = () => new OperationError('invalid_request', 'Choose valid history filters.');

const activityFilter = z.object({ q: z.string().trim().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).optional() }).strict();
const emailFilter = activityFilter.extend({ problemsOnly: z.boolean().optional() });

function window(parsed: { offset?: number | undefined; limit?: number | undefined }, p: Awaited<ReturnType<typeof policy>>, cap?: number) {
  const offset = parsed.offset ?? 0;
  if (offset > p.maxOffset) throw new OperationError('invalid_request', 'Narrow the search instead of skipping that far.');
  const size = Math.min(parsed.limit ?? p.pageSize, p.pageSize, cap ?? Number.MAX_SAFE_INTEGER);
  return { offset, size };
}

export type ActivityEntry = { id: string; action: string; actorName: string | null; hadActor: boolean; details: Array<{ key: string; value: string }>; createdAt: string };
export type EmailEntry = { id: string; to: string; subject: string; template: string; status: string; error: string | null; createdAt: string };

/** Scalars only, hidden keys dropped, values cut: detail is free-form JSON written by many call sites. */
function summarise(detail: unknown, p: Awaited<ReturnType<typeof policy>>): Array<{ key: string; value: string }> {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
    if (out.length >= p.detailFields) break;
    if (value === null || value === undefined || typeof value === 'object' || typeof value === 'function') continue;
    const lower = key.toLowerCase();
    if (p.hidden.some(word => lower.includes(word))) continue;
    out.push({ key: key.slice(0, 60), value: scrub(String(value)).slice(0, p.detailValue) });
  }
  return out;
}

/** Newest-first workspace activity. Owners and admins only; the workspace comes from the caller's membership, never from input. */
export async function listWorkspaceActivity(actor: HistoryActor, input: unknown = {}, resultCap?: number) {
  const access = await authorizeHistory(actor);
  const p = await policy();
  const parsed = activityFilter.safeParse(input);
  if (!parsed.success || (parsed.data.q?.length ?? 0) > p.searchMax) throw bad();
  const { offset, size } = window(parsed.data, p, resultCap);
  const pattern = parsed.data.q ? like(parsed.data.q) : null;
  const rows = await prisma.$queryRaw<Array<{ id: string; action: string; actorId: string | null; actorName: string | null; detail: unknown; createdAt: Date }>>`
    SELECT a.id, a.action, a."actorId", u.name AS "actorName", a.detail, a."createdAt"
    FROM activity_logs a LEFT JOIN users u ON u.id = a."actorId"
    WHERE a."workspaceId" = ${actor.workspaceId} AND (${pattern}::text IS NULL OR a.action ILIKE ${pattern} ESCAPE '\\')
    ORDER BY a."createdAt" DESC, a.id DESC LIMIT ${size + 1} OFFSET ${offset}`;
  return {
    items: rows.slice(0, size).map((row): ActivityEntry => ({
      id: row.id, action: row.action, actorName: row.actorName, hadActor: row.actorId !== null,
      details: summarise(row.detail, p), createdAt: row.createdAt.toISOString(),
    })),
    offset, pageSize: size, hasMore: rows.length > size, timeZone: access.timeZone,
    retentionDays: p.retentionDays > 0 ? p.retentionDays : null,
  };
}

/** Newest-first emails sent for the workspace, with the count of recent problems. Delivery problem text is scrubbed and cut. */
export async function listWorkspaceEmails(actor: HistoryActor, input: unknown = {}, resultCap?: number) {
  const access = await authorizeHistory(actor);
  const p = await policy();
  const parsed = emailFilter.safeParse(input);
  if (!parsed.success || (parsed.data.q?.length ?? 0) > p.searchMax) throw bad();
  const { offset, size } = window(parsed.data, p, resultCap);
  const pattern = parsed.data.q ? like(parsed.data.q) : null;
  const problemsOnly = parsed.data.problemsOnly === true;
  const since = new Date(Date.now() - p.recentDays * 86_400_000);
  const [rows, failures] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; to: string; subject: string; template: string; status: string; error: string | null; createdAt: Date }>>`
      SELECT id, "to", subject, template, status::text AS status, error, "createdAt" FROM email_logs
      WHERE "workspaceId" = ${actor.workspaceId} AND (${problemsOnly} = false OR status::text <> 'sent')
        AND (${pattern}::text IS NULL OR "to" ILIKE ${pattern} ESCAPE '\\' OR subject ILIKE ${pattern} ESCAPE '\\')
      ORDER BY "createdAt" DESC, id DESC LIMIT ${size + 1} OFFSET ${offset}`,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM email_logs WHERE "workspaceId" = ${actor.workspaceId} AND status::text = 'failed' AND "createdAt" >= ${since}`,
  ]);
  return {
    items: rows.slice(0, size).map((row): EmailEntry => ({
      id: row.id, to: row.to, subject: row.subject, template: row.template, status: row.status,
      error: row.error ? scrub(row.error).slice(0, p.errorMax) : null, createdAt: row.createdAt.toISOString(),
    })),
    offset, pageSize: size, hasMore: rows.length > size, timeZone: access.timeZone,
    recentFailures: failures[0]?.count ?? 0, recentFailureDays: p.recentDays,
  };
}
