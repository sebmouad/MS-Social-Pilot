import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { copyError, copyText, withCustomerCopy } from './copy';
import { listTeamInvitations } from '@/modules/settings/server/invitations';
import {
  AGENCY_CLIENTS_FEATURE_ID, AGENCY_GROUPS, AGENCY_OVERVIEW_FEATURE_ID, AGENCY_SORTS,
  type AgencyActor, type AgencyClient, type AgencyClients, type AgencyGroup, type AgencyMetrics, type AgencyOverview, type AgencyTotals, type AgencyWorkspace,
} from '../agency';
import { administeredWorkspaces, assertInstallationPolicy, classifyWorkspaces, likePattern, type Classified } from './access';

const OVERVIEW_FILTERS = z.object({
  q: z.string().trim().optional(),
  sort: z.enum(AGENCY_SORTS).default('attention'),
  order: z.enum(['asc', 'desc']).default('desc'),
  attentionOnly: z.boolean().default(false),
}).strict();
const CLIENT_FILTERS = z.object({ q: z.string().trim().optional() }).strict();

const unavailable = () => copyError('unavailable', 'Agency views are currently unavailable.');
const count = (max: number, min = 1) => z.number().int().min(min).max(max);
const CONFIG_KEYS = [
  'agency.workspaceLimit', 'agency.failureWindowDays', 'agency.clientListLimit', 'agency.searchMaxLength', 'agency.accessConcurrency',
  'agency.attentionWeightUnavailable', 'agency.attentionWeightDisconnected', 'agency.attentionWeightFailed', 'agency.attentionWeightOverdue',
] as const;
const CONFIG_SCHEMA = z.tuple([count(2000), count(365), count(2000), count(500), count(32), count(10_000, 0), count(10_000, 0), count(10_000, 0), count(10_000, 0)]);

type Weights = { unavailable: number; disconnected: number; failed: number; overdue: number };

/** Every operational bound and weight comes from Root settings, validated on each read; an invalid value makes Agency unavailable. */
async function bounds() {
  const checked = CONFIG_SCHEMA.safeParse(await Promise.all(CONFIG_KEYS.map(key => runtimeConfig(key))));
  if (!checked.success) throw unavailable();
  const [workspaceLimit, windowDays, clientListLimit, searchMaxLength, concurrency, ...weights] = checked.data;
  return { workspaceLimit, windowDays, clientListLimit, searchMaxLength, concurrency, weights: { unavailable: weights[0], disconnected: weights[1], failed: weights[2], overdue: weights[3] } as Weights };
}

/** The longest search text Agency accepts, for form inputs. */
async function agencySearchLimitImpl(): Promise<number> { return (await bounds()).searchMaxLength; }

function searchText(raw: string | undefined, max: number): string | undefined {
  if (!raw) return undefined;
  if (raw.length > max) throw copyError('invalid_request', copyText("Search text can be at most {0} characters.", max));
  return raw;
}

/**
 * The administered workspaces this person may use through Agency right now. The search runs in SQL before the cap.
 * Refuses when the person administers matching workspaces but none is entitled, so a disabled feature reads as
 * unavailable, not as empty.
 */
async function scope(actor: AgencyActor, featureId: string, config: Awaited<ReturnType<typeof bounds>>, search?: { text: string }): Promise<{ items: Classified[]; truncated: boolean }> {
  await assertInstallationPolicy(featureId);
  const rows = await administeredWorkspaces(actor, config.workspaceLimit, search);
  const truncated = rows.length > config.workspaceLimit;
  const items = await classifyWorkspaces(actor, rows.slice(0, config.workspaceLimit), featureId, config.concurrency);
  if (rows.length > 0 && items.length === 0) throw copyError('forbidden', 'Agency is not available for your workspaces.');
  return { items, truncated };
}

const EMPTY: AgencyMetrics = { channels: null, disconnected: null, scheduled: null, failed: null, waitingConversations: null, openTasks: null, overdueTasks: null, members: null, clients: null };

/**
 * Counts per capability group, each read only for the workspaces whose owning module the person may use.
 * A group without a grant is never queried and stays null.
 */
async function metricsFor(items: readonly Classified[], since: Date): Promise<Map<string, AgencyMetrics>> {
  const available = items.filter(item => item.state === 'available');
  const out = new Map(available.map(item => [item.id, { ...EMPTY }]));
  const idsFor = (group: AgencyGroup) => available.filter(item => item.access[group]).map(item => item.id);
  const [channels, publishing, inbox, tasks, team] = AGENCY_GROUPS.map(idsFor);
  const merge = (rows: Array<Record<string, unknown> & { id: string }>) => { for (const { id, ...values } of rows) Object.assign(out.get(id) ?? {}, values); };
  await Promise.all([
    channels!.length && prisma.$queryRaw<Array<{ id: string; channels: number; disconnected: number }>>`
      SELECT w.id,
        (SELECT COUNT(*) FROM targets t WHERE t."workspaceId" = w.id AND t.enabled)::int AS channels,
        (SELECT COUNT(*) FROM targets t WHERE t."workspaceId" = w.id AND t.enabled AND (t."accessToken" IS NULL OR NOT t."canPublish"))::int AS disconnected
      FROM workspaces w WHERE w.id = ANY(${channels!}::text[])`.then(merge),
    publishing!.length && prisma.$queryRaw<Array<{ id: string; scheduled: number; failed: number }>>`
      SELECT w.id,
        (SELECT COUNT(*) FROM posts p WHERE p."workspaceId" = w.id AND p.status::text = 'scheduled')::int AS scheduled,
        (SELECT COUNT(*) FROM posts p WHERE p."workspaceId" = w.id AND p.status::text IN ('failed', 'partially_failed') AND p."updatedAt" >= ${since})::int AS failed
      FROM workspaces w WHERE w.id = ANY(${publishing!}::text[])`.then(merge),
    // Waiting work mirrors the Inbox list defaults: unresolved items of every kind, top-level visible comments only.
    inbox!.length && prisma.$queryRaw<Array<{ id: string; waitingConversations: number }>>`
      SELECT w.id,
        ((SELECT COUNT(*) FROM conversations c JOIN targets t ON t.id = c."targetId" WHERE t."workspaceId" = w.id AND t.enabled AND c."resolvedAt" IS NULL)
          + (SELECT COUNT(*) FROM post_comments pc JOIN post_targets pt ON pt.id = pc."postTargetId" JOIN targets t ON t.id = pt."targetId" JOIN posts p ON p.id = pt."postId"
            WHERE t."workspaceId" = w.id AND p."workspaceId" = w.id AND t.enabled AND pc."parentRemoteId" IS NULL AND pc."isHidden" = false AND pc."resolvedAt" IS NULL)
          + (SELECT COUNT(*) FROM page_reviews r JOIN targets t ON t.id = r."targetId" WHERE t."workspaceId" = w.id AND t.enabled AND r."resolvedAt" IS NULL))::int AS "waitingConversations"
      FROM workspaces w WHERE w.id = ANY(${inbox!}::text[])`.then(merge),
    tasks!.length && prisma.$queryRaw<Array<{ id: string; openTasks: number; overdueTasks: number }>>`
      SELECT w.id,
        (SELECT COUNT(*) FROM tasks k WHERE k."workspaceId" = w.id AND k.status <> 'done')::int AS "openTasks",
        (SELECT COUNT(*) FROM tasks k WHERE k."workspaceId" = w.id AND k.status <> 'done' AND k."dueOn" IS NOT NULL AND k."dueOn" < TO_CHAR(NOW() AT TIME ZONE w.timezone, 'YYYY-MM-DD'))::int AS "overdueTasks"
      FROM workspaces w WHERE w.id = ANY(${tasks!}::text[])`.then(merge),
    team!.length && prisma.$queryRaw<Array<{ id: string; members: number; clients: number }>>`
      SELECT w.id,
        (SELECT COUNT(*) FROM memberships x WHERE x."workspaceId" = w.id AND x.role::text <> 'client')::int AS members,
        (SELECT COUNT(*) FROM memberships x WHERE x."workspaceId" = w.id AND x.role::text = 'client')::int AS clients
      FROM workspaces w WHERE w.id = ANY(${team!}::text[])`.then(merge),
  ]);
  return out;
}

const positive = (value: number | null) => value !== null && value > 0;
const attention = (state: AgencyWorkspace['state'], metrics: AgencyMetrics | null) =>
  state !== 'available' || (metrics !== null && (positive(metrics.disconnected) || positive(metrics.failed) || positive(metrics.overdueTasks)));
const score = (item: AgencyWorkspace, weights: Weights) =>
  Number(item.state !== 'available') * weights.unavailable
  + (item.metrics ? (item.metrics.disconnected ?? 0) * weights.disconnected + (item.metrics.failed ?? 0) * weights.failed + (item.metrics.overdueTasks ?? 0) * weights.overdue : 0);

const SUMMED: Record<AgencyGroup, readonly (keyof AgencyMetrics & keyof AgencyTotals)[]> = {
  channels: ['channels', 'disconnected'], publishing: ['scheduled', 'failed'], inbox: ['waitingConversations'], tasks: ['openTasks', 'overdueTasks'], team: [],
};
const COVERAGE_FIELD: Record<AgencyGroup, keyof AgencyMetrics> = { channels: 'channels', publishing: 'scheduled', inbox: 'waitingConversations', tasks: 'openTasks', team: 'members' };

/** A group total sums only the workspaces that contributed; coverage says how many, and no contribution is null, not zero. */
function totalsOf(workspaces: readonly AgencyWorkspace[]): AgencyTotals {
  const available = workspaces.filter(item => item.metrics);
  const totals: AgencyTotals = {
    workspaces: workspaces.length, needingAttention: workspaces.filter(item => item.needsAttention).length,
    channels: null, disconnected: null, scheduled: null, failed: null, waitingConversations: null, openTasks: null, overdueTasks: null,
    coverage: { channels: { covered: 0, of: 0 }, publishing: { covered: 0, of: 0 }, inbox: { covered: 0, of: 0 }, tasks: { covered: 0, of: 0 }, team: { covered: 0, of: 0 } },
  };
  for (const group of AGENCY_GROUPS) {
    const contributing = available.filter(item => item.metrics![COVERAGE_FIELD[group]] !== null);
    totals.coverage[group] = { covered: contributing.length, of: available.length };
    for (const field of SUMMED[group]) if (contributing.length) totals[field] = contributing.reduce((sum, item) => sum + (item.metrics![field] ?? 0), 0);
  }
  return totals;
}

/** A withheld value always sorts last, in either direction. */
function compare(a: AgencyWorkspace, b: AgencyWorkspace, key: Exclude<(typeof AGENCY_SORTS)[number], 'name' | 'attention'>, direction: number): number {
  const left = a.metrics?.[key] ?? null; const right = b.metrics?.[key] ?? null;
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  return (left - right) * direction;
}

/**
 * Totals are counts of items in separate workspaces, not de-duplicated people or posts across them. They cover
 * the workspaces that matched the name search (all of them without one), up to the Root workspace limit, and
 * ignore the attention filter, which only narrows the table. `filtered` tells the reader which of those applies.
 */
async function agencyOverviewImpl(actor: AgencyActor, rawFilters: unknown = {}, now: Date = new Date()): Promise<AgencyOverview> {
  const parsed = OVERVIEW_FILTERS.safeParse(rawFilters);
  if (!parsed.success) throw copyError('invalid_request', 'Choose valid agency filters.');
  const filters = parsed.data;
  const config = await bounds();
  const text = searchText(filters.q, config.searchMaxLength);
  const { items, truncated } = await scope(actor, AGENCY_OVERVIEW_FEATURE_ID, config, text ? { text } : undefined);
  const metrics = await metricsFor(items, new Date(now.getTime() - config.windowDays * 86_400_000));
  let workspaces: AgencyWorkspace[] = items.map(item => {
    const own = item.state === 'available' ? metrics.get(item.id) ?? null : null;
    return { id: item.id, name: item.name, role: item.role, state: item.state, metrics: own, needsAttention: attention(item.state, own) };
  });
  const totals = totalsOf(workspaces);
  if (filters.attentionOnly) workspaces = workspaces.filter(item => item.needsAttention);
  const direction = filters.order === 'asc' ? 1 : -1;
  workspaces.sort((a, b) => {
    const diff = filters.sort === 'name' ? (a.name.localeCompare(b.name) * direction)
      : filters.sort === 'attention' ? (score(a, config.weights) - score(b, config.weights)) * direction
        : compare(a, b, filters.sort, direction);
    return diff || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return { ok: true, windowDays: config.windowDays, limit: config.workspaceLimit, truncated, filtered: Boolean(text), totals, workspaces };
}

type ClientRow = { workspaceId: string; userId: string; name: string; email: string; total: number };

/**
 * Client accounts and pending client invitations for administered workspaces. Reads the invitation service; never writes.
 * A search matches workspace names only, in SQL before the workspace cap. Client names and emails never select
 * workspaces, since that would reveal them before the team permission check. Every client account and pending
 * invitation of a selected, team-readable workspace is listed.
 * Client accounts are shown only where the person may read the workspace team.
 */
async function listAgencyClientsImpl(actor: AgencyActor, rawFilters: unknown = {}): Promise<AgencyClients> {
  const parsed = CLIENT_FILTERS.safeParse(rawFilters);
  if (!parsed.success) throw copyError('invalid_request', 'Choose valid agency filters.');
  const config = await bounds();
  const text = searchText(parsed.data.q, config.searchMaxLength);
  const { items, truncated } = await scope(actor, AGENCY_CLIENTS_FEATURE_ID, config, text ? { text } : undefined);
  const readable = items.filter(item => item.state === 'available' && item.access.team);
  const members = readable.length ? await prisma.$queryRaw<ClientRow[]>`
    SELECT ranked."workspaceId", ranked."userId", ranked.name, ranked.email, ranked.total FROM (
      SELECT m."workspaceId", u.id AS "userId", u.name, u.email,
        ROW_NUMBER() OVER (PARTITION BY m."workspaceId" ORDER BY u.name ASC, u.id ASC) AS position,
        (COUNT(*) OVER (PARTITION BY m."workspaceId"))::int AS total
      FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId"
      WHERE m."workspaceId" = ANY(${readable.map(item => item.id)}::text[]) AND m.role::text = 'client' AND u."disabledAt" IS NULL
    ) ranked WHERE ranked.position <= ${config.clientListLimit}
    ORDER BY ranked.name ASC, ranked."userId" ASC` : [];
  const workspaces: AgencyClient[] = [];
  for (const row of items) {
    const base = { workspaceId: row.id, workspaceName: row.name, role: row.role, state: row.state };
    if (row.state !== 'available') { workspaces.push({ ...base, clientCount: null, clients: [], invitations: [], invitationsAvailable: false }); continue; }
    // Without team access the person gets neither client accounts nor invitations from Agency.
    if (!row.access.team) { workspaces.push({ ...base, clientCount: null, clients: [], invitations: [], invitationsAvailable: false }); continue; }
    let invitations: AgencyClient['invitations'] = [];
    let invitationsAvailable = false;
    try {
      const listed = await listTeamInvitations({ userId: actor.userId, workspaceId: row.id });
      invitations = listed.invitations.filter(item => item.role === 'client' && item.status !== 'accepted')
        .map(item => ({ id: item.id, email: item.email, status: item.status === 'expired' ? 'expired' as const : 'pending' as const, expiresAt: item.expiresAt.toISOString() }));
      invitationsAvailable = listed.available;
    } catch { /* A denied or unavailable invitation read must not hide the client accounts. */ }
    const own = members.filter(item => item.workspaceId === row.id);
    const clients = own.map(item => ({ userId: item.userId, name: item.name, email: item.email, status: 'active' as const }));
    workspaces.push({ ...base, clientCount: own[0]?.total ?? 0, clients, invitations, invitationsAvailable });
  }
  return { ok: true, limit: config.workspaceLimit, truncated, filtered: Boolean(text), workspaces };
}

export const agencySearchLimit = (...args: Parameters<typeof agencySearchLimitImpl>) => withCustomerCopy(() => agencySearchLimitImpl(...args));
export const agencyOverview = (...args: Parameters<typeof agencyOverviewImpl>) => withCustomerCopy(() => agencyOverviewImpl(...args));
export const listAgencyClients = (...args: Parameters<typeof listAgencyClientsImpl>) => withCustomerCopy(() => listAgencyClientsImpl(...args));
