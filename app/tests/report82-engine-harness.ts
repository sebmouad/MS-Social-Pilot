import { PUBLICATION_REPORT_DEFAULTS } from '@/modules/analytics/reports/config';
import { workspaceCopyDefaults } from '@/modules/analytics/workspace-copy';
import { goalsCopyDefaults } from '@/modules/analytics/goals/copy';
import { responseTimeCopyDefaults } from '@/modules/analytics/reports/generation/response-copy';
import { errorCopyDefaults } from '@/modules/analytics/error-copy';
/** Shared in-memory stand-in for the database and shared services used by the report engine tests. Pure: no network, no real database. */
import { vi } from 'vitest';

export type Call = { sql: string; values: unknown[] };
export const defaults = () => ({
  publicationRows: [] as unknown[], failedPublicationRows: [] as unknown[], publicationDays: [] as unknown[],
  role: 'editor', member: true, disabled: false, suspended: false, purge: null as string | null,
  entitled: true, canAccess: true, scope: null as string[] | null, providers: ['p1'], usable: true,
  lockMember: true, lockRole: null as string | null, lockSuspended: false, freshScope: null as string[] | null, freshDeny: [] as string[],
  count: 0, found: true, templateOk: true, templateSections: ['analysis'] as unknown, failAudit: false, auditThrows: false, tz: 'UTC', duplicate: false,
  tablePresent: true, due: [] as unknown[], stale: [] as unknown[], insertConflict: false, insertConflicts: [] as string[], scheduleRow: true, scheduleSections: ['analysis'] as unknown,
  recipientsNow: ['a@example.com', 'b@example.com'] as string[] | null, failFenceAt: null as number | null, fenceCalls: 0, sweepChanged: 1,
  runRows: [] as unknown[], existing: null as Record<string, unknown> | null, expiredOutputs: [] as unknown[], scheduleTemplateId: null as string | null, depth: 0, maxDepth: 0, queries: [] as Call[], execs: [] as Call[], config: {} as Record<string, unknown>,
});
export const state = defaults();
const runLeases = new Map<string, number>();
export const reset = () => { Object.assign(state, defaults()); runLeases.clear(); queriedDue = null; dueIndex = 0; };

const text = (s: TemplateStringsArray) => s.join('?');
let queriedDue: unknown[] | null = null;
let dueIndex = 0;
const nextDue = () => {
  if (queriedDue !== state.due) { queriedDue = state.due; dueIndex = 0; }
  return state.due[dueIndex++];
};
const CONFIG: Record<string, unknown> = {
  'analytics.reports.publicationDetails': PUBLICATION_REPORT_DEFAULTS,
  'analytics.reports.pageSize': 2, 'analytics.reports.maxTemplates': 3, 'analytics.reports.templateNameMaxCharacters': 20, 'analytics.reports.maxSchedules': 3,
  'analytics.reports.maxRecipients': 3, 'analytics.reports.dueBatchSize': 10, 'analytics.reports.transactionTimeoutMs': 5000, 'analytics.reports.transactionMaxWaitMs': 2000,
  'analytics.reports.sendTime': '08:00', 'analytics.reports.maxOutputRows': 100, 'analytics.reports.maxOutputBytes': 20000, 'analytics.reports.runLeaseSeconds': 600,
  'analytics.reports.runHistoryPageSize': 5, 'analytics.reports.staleSweepBatchSize': 10, 'analytics.reports.finishRetries': 1, 'analytics.reports.outputRetentionHours': 24, 'analytics.reports.maxStoredArtifactBytes': 2200000,
  'analytics.defaultRangeDays': 30, 'analytics.maxRangeDays': 90,
};
export const configValue = (key: string) => (key === 'analytics.workspaceCopy' ? workspaceCopyDefaults : key === 'analytics.goalsCopy' ? goalsCopyDefaults : key === 'analytics.responseTimeCopy' ? responseTimeCopyDefaults : key === 'analytics.errorCopy' ? errorCopyDefaults : key in state.config ? state.config[key] : CONFIG[key]);

export const db = {
  $queryRaw: vi.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const sql = text(s); state.queries.push({ sql, values: v });
    if (sql.includes('FROM post_targets pt JOIN posts p') && sql.includes('GROUP BY day')) return state.publicationDays;
    if (sql.includes('FROM post_targets pt JOIN posts p') && sql.includes("pt.status = 'published'")) return state.publicationRows;
    if (sql.includes('FROM post_targets pt JOIN posts p') && sql.includes("pt.status = 'failed'")) return state.failedPublicationRows;
    if (sql.includes('to_regclass')) return [{ present: state.tablePresent }];
    if (sql.includes('FROM memberships m JOIN users u') && sql.includes('FOR SHARE OF m, u, w')) {
      const role = state.lockRole ?? state.role;
      return state.lockMember ? [{ role, suspendedAt: state.lockSuspended ? new Date() : null, allPages: true, memberDisabled: [], workspaceDisabled: [], clientAccess: [], pageIds: [] }] : [];
    }
    if (sql.includes('FROM memberships m JOIN users u')) return state.member && !state.disabled ? [{ role: state.role, suspendedAt: state.suspended ? new Date() : null }] : [];
    if (sql.includes('FROM report_schedules s JOIN workspaces w') && sql.includes('SKIP LOCKED')) { const row = nextDue(); return row ? [row] : []; } // model one fresh row per bounded claim query
    if (sql.includes('FROM report_runs') && sql.includes("status IN ('claimed','generating','delivering')")) return sql.includes('FOR UPDATE') ? state.stale : state.stale.map((run: any) => ({ id: run.id, workspaceId: run.workspaceId }));
    if (sql.includes('UPDATE report_runs SET output = NULL')) return state.expiredOutputs;
    if (sql.includes('FROM report_runs r WHERE') && sql.includes('"outputExpiresAt"')) return state.expiredOutputs;
    if (sql.includes('FROM workspace_data_purges')) return state.purge ? (sql.includes('"workspaceId"') ? [{ workspaceId: 'w1' }] : [{ status: state.purge }]) : [];
    if (sql.includes('FROM workspaces WHERE id') && sql.includes('FOR SHARE')) return [{ id: 'w1' }];
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('FROM report_runs WHERE "idempotencyKey"')) return state.existing ? [state.existing] : [];
    if (sql.includes('INSERT INTO report_runs')) {
      const conflict = state.insertConflict || state.insertConflicts.some(key => v.includes(key));
      if (!conflict && (sql.includes("'scheduled'") || sql.includes("'manual'"))) {
        const id = v[0]; const leaseUntil = sql.includes("'scheduled'") ? v[8] : v[9];
        if (typeof id === 'string' && leaseUntil instanceof Date) runLeases.set(id, leaseUntil.getTime());
      }
      return conflict ? [] : [{ id: 'r' }];
    }
    if (sql.includes('FROM report_schedules s JOIN workspaces w')) return state.scheduleRow ? [{ targetId: 'c1', frequency: 'weekly', templateId: state.scheduleTemplateId, timezone: state.tz, weekStartsOn: 1, sections: state.scheduleSections }] : [];
    if (sql.includes('SELECT recipients FROM report_schedules')) return state.recipientsNow ? [{ recipients: state.recipientsNow }] : [];
    if (sql.includes('SELECT t.id FROM targets t JOIN social_accounts')) return state.usable ? [{ id: 'c1' }] : [];
    if (sql.includes('COUNT(*) AS count')) return [{ count: BigInt(state.count) }];
    if (sql.includes('FROM report_templates t WHERE')) return [{ id: 't1', name: 'A', sections: ['audience', 'bogus'], rangeKey: '30d', createdAt: new Date(), scheduleCount: BigInt(1) }, { id: 't2', name: 'B', sections: ['goals'], rangeKey: '7d', createdAt: new Date(), scheduleCount: 0 }, { id: 't3', name: 'C', sections: [], rangeKey: '7d', createdAt: new Date(), scheduleCount: 0 }];
    if (sql.includes('FROM report_schedules s LEFT JOIN targets')) return [{ id: 's1', targetId: 'c1', targetName: 'Page', templateId: 't1', templateName: 'Weekly', frequency: 'weekly', recipients: ['a@example.com', 'b@example.com'], nextRunAt: new Date(), lastRunAt: null, lastError: null, createdAt: new Date(), usable: state.usable }];
    if (sql.includes('FROM report_runs r JOIN targets')) return state.runRows;
    if (sql.includes('FROM report_templates WHERE id')) return state.templateOk || sql.includes('FOR UPDATE') ? [{ id: 't1', sections: state.templateSections }] : [];
    if (sql.includes('FROM report_schedules WHERE id') && sql.includes('FOR UPDATE')) return state.found ? [{ id: 's1', targetId: 'c1', templateId: 't1' }] : [];
    if (sql.includes('FROM workspaces WHERE id')) return [{ timezone: state.tz, weekStartsOn: 1 }];
    return [];
  }),
  $executeRaw: vi.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const sql = text(s); state.execs.push({ sql, values: v });
    if (sql.includes('activity_logs')) { if (state.auditThrows) throw new Error('audit failed'); return state.failAudit ? 0 : 1; }
    if (sql.includes('UPDATE report_runs') && sql.includes('"leaseUntil" < ')) return state.sweepChanged;
    if (sql.includes('UPDATE report_runs SET status')) {
      state.fenceCalls += 1;
      if (state.failFenceAt !== null && state.fenceCalls >= state.failFenceAt) return 0;
      if (sql.includes('"claimToken"')) {
        const id = v[10]; const now = v[9]; const leaseUntil = typeof id === 'string' ? runLeases.get(id) : undefined;
        if (leaseUntil === undefined || !(now instanceof Date) || leaseUntil <= now.getTime()) return 0;
        if (v[5] instanceof Date) runLeases.set(id as string, v[5].getTime());
      }
      return 1;
    }
    if (state.duplicate && sql.includes('INSERT INTO report_templates')) throw Object.assign(new Error('dup'), { code: 'P2002' });
    return 1;
  }),
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    state.depth += 1; state.maxDepth = Math.max(state.maxDepth, state.depth);
    try { return await fn(db); } finally { state.depth -= 1; }
  }),
};
/** Stand-in for the shared scoped Analytics reader the report generator calls. */
export const gen = { snapshot: null as unknown, error: null as unknown, input: null as unknown, constraints: null as unknown, calls: 0 };
export const resetGen = () => Object.assign(gen, { snapshot: snapshot(), error: null, input: null, constraints: null, calls: 0 });
export const metric = (over: Record<string, unknown> = {}) => ({ key: 'm1', label: 'Reach', sourceLabel: 'Source A', resourceKind: 'channel', aggregationLabel: 'Non-additive', aggregationNote: 'Not summed', unit: 'count', kind: 'flow', total: 10, latestAt: new Date('2026-10-18T00:00:00Z'), coverage: 1, available: 1, points: [{ date: '2026-10-17', label: 'Oct 17', value: 4 }], rows: [], ...over });
export const snapshot = (over: Record<string, unknown> = {}) => ({
  period: { start: '2026-10-12', end: '2026-10-18' }, options: { channels: [{ id: 'c1', name: 'Page One', type: 'page' }] }, selected: { channelIds: ['c1'], adAccountIds: [] },
  audience: { entries: [{ metric: 'followers', metricLabel: 'Followers', sourceLabel: 'S', name: '=HYPERLINK("x")', value: 5, asOf: new Date('2026-10-18T00:00:00Z') }], total: 5, covered: 1, selected: 1 },
  publishing: { published: 2, scheduled: 1, failed: 0 }, allMetrics: [metric(), metric({ key: 'm2', label: 'Spend', resourceKind: 'ad-account' }), metric({ key: 'm3', label: '<b>Empty</b>', total: null, points: [] })], ...over,
});
/** Same shape the real reader returns for the calls the generator makes. */
export const readSnapshot = async (_actor: unknown, input: unknown, constraints: unknown) => { gen.calls += 1; gen.input = input; gen.constraints = constraints; if (gen.error) throw gen.error; return gen.snapshot; };
export const execs = (needle: string) => state.execs.filter(e => e.sql.includes(needle));
export const queries = (needle: string) => state.queries.filter(e => e.sql.includes(needle));
export const permissionsFor = () => ({ pageScope: state.scope ? { all: false, ids: state.scope } : { all: true, ids: [] }, deny: state.freshDeny });
