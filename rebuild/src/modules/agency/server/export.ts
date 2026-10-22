import { z } from 'zod';
import { copyError, withCustomerCopy } from './copy';
import { AGENCY_GROUPS, AGENCY_SORTS, type AgencyActor, type AgencyMetrics } from '../agency';
import { loadExportCopy } from './copy';
import { agencyOverview } from './agency';

const INPUT = z.object({
  format: z.enum(['csv', 'json']), locale: z.enum(['en', 'fr']).default('en'),
  q: z.string().trim().optional(), sort: z.enum(AGENCY_SORTS).default('attention'),
  order: z.enum(['asc', 'desc']).default('desc'), attentionOnly: z.boolean().default(false),
}).strict();

/** Quote every field and neutralize spreadsheet formulas, including after leading whitespace. */
function cell(value: unknown): string {
  let text = String(value);
  if (/^\s*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Read-only packaging: never accepts caller-supplied rows or workspace ids. Authority stays in the overview service. */
async function exportAgencyOverviewImpl(actor: AgencyActor, raw: unknown, now: Date = new Date()) {
  const checked = INPUT.safeParse(raw);
  if (!checked.success) throw copyError('invalid_request', 'Choose valid agency export filters.');
  const { format, locale, ...filters } = checked.data;
  const overview = await agencyOverview(actor, filters, now);
  const t = (await loadExportCopy())[locale];
  const generatedAt = now.toISOString();
  const context = { generatedAt, filters, exportedWorkspaces: overview.workspaces.length, totalsIgnoreAttentionFilter: true, unavailableLabel: t.unavailable, notes: t.help };
  let contents: string;
  if (format === 'json') contents = JSON.stringify({ version: 1, ...context, ...overview }, null, 2) + '\n';
  else {
    const rows: unknown[][] = [[t.record, t.workspaceId, t.workspace, t.measure, t.value, t.of]];
    const add = (record: string, workspace: string, measure: string, value: unknown, of: unknown = '', workspaceId = '') => rows.push([record, workspaceId, workspace, measure, value === null || value === undefined ? t.unavailable : typeof value === 'boolean' ? (value ? t.yes : t.no) : value, of]);
    for (const [label, value] of [
      [t.notes, t.help], [t.generatedAt, generatedAt], [t.windowDays, overview.windowDays], [t.limit, overview.limit], [t.truncated, overview.truncated],
      [t.q, filters.q ?? ''], [t.sort, filters.sort], [t.order, filters.order], [t.attentionOnly, filters.attentionOnly], [t.exported, overview.workspaces.length],
    ] as const) add(t.metadata, '', label, value);
    const labels = { ...t, failed: t.failedPosts };
    for (const key of ['workspaces', 'needingAttention', 'channels', 'disconnected', 'scheduled', 'failed', 'waitingConversations', 'openTasks', 'overdueTasks'] as const) add(t.total, '', labels[key], overview.totals[key]);
    for (const group of AGENCY_GROUPS) add(t.coverage, '', t[group], overview.totals.coverage[group].covered, overview.totals.coverage[group].of);
    for (const item of overview.workspaces) {
      const own = (measure: string, value: unknown) => add(t.row, item.name, measure, value, '', item.id);
      own(t.role, t[item.role]); own(t.state, t[item.state]);
      own(t.needsAttention, item.needsAttention);
      for (const key of ['channels', 'disconnected', 'scheduled', 'failed', 'waitingConversations', 'openTasks', 'overdueTasks', 'members', 'clients'] satisfies Array<keyof AgencyMetrics>) own(labels[key], item.metrics?.[key]);
    }
    contents = '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  return { ok: true as const, version: 1 as const, format, filename: `agency-overview.${format}`, contentType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8', contents, bytes: Buffer.byteLength(contents, 'utf8'), exportedWorkspaces: overview.workspaces.length, truncated: overview.truncated };
}

export const exportAgencyOverview = (...args: Parameters<typeof exportAgencyOverviewImpl>) => withCustomerCopy(() => exportAgencyOverviewImpl(...args));
