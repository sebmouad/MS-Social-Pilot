import { adObjectsMcp } from './ad-objects/mcp';
import { postsMcp } from './explorer-posts/mcp';
import { OperationError } from '@/lib/operation-error';
import { isResourceRestricted } from '@/modules/settings/mcp-access/tool-policy';
import { ensureReportWorkflows } from '@/modules/analytics/server/report-workflows';
import { analyticsActorFor, pageIdsFor, requiredString, type McpToolGroup } from '@/server/mcp/kit';
import type { McpViewer } from '@/server/mcp/types';
import { readAnalyticsSnapshot } from './server/read';
import { analyticsReportToolDefinitions, analyticsReportAvailableToolDefinitions, executeAnalyticsReportTool } from './reports/mcp';
import { analyticsDemographicsToolDefinitions, executeAnalyticsDemographicsTool } from './demographics/mcp';
import { analyticsPinToolDefinitions, executeAnalyticsPinTool } from './pins/mcp';
import { analyticsGoalToolDefinitions, executeAnalyticsGoalTool } from './goals/mcp';
import { analyticsComparisonToolDefinitions, executeAnalyticsComparisonTool } from './comparison/mcp';
import { analyticsExplorerToolDefinitions, executeAnalyticsExplorerTool } from './explorer-mcp';

async function readMcpAnalyticsSnapshot(viewer: McpViewer, args: Record<string, unknown>, metricKey?: string) {
  const cap = viewer.maxResultItems ?? 100;
  const selectedIds = (value: unknown, label: string): unknown => {
    if (value === undefined) return undefined;
    if (Array.isArray(value) && value.length > cap) throw new OperationError('invalid_request', `${label} cannot exceed the configured result limit of ${cap}.`);
    return value;
  };
  const targetIds = selectedIds(args.targetIds, 'targetIds');
  const adAccountIds = selectedIds(args.adAccountIds, 'adAccountIds');
  const input: Record<string, unknown> = {};
  for (const key of ['start', 'end', 'compare', 'search'] as const) if (args[key] !== undefined) input[key] = args[key];
  if (targetIds !== undefined) { input.filter = '1'; input.channel = targetIds; }
  if (adAccountIds !== undefined) { input.adFilter = '1'; input.adAccount = adAccountIds; }
  if (metricKey !== undefined) input.metric = metricKey;
  return readAnalyticsSnapshot(viewer, input, { allowedChannelIds: pageIdsFor(viewer) });
}
function analyticsPageArgs(args: Record<string, unknown>, cap: number, fallback: number) {
  const integer = (key: string, minimum: number, maximum?: number) => {
    const value = args[key] === undefined ? (key === 'limit' ? fallback : 0) : args[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) throw new OperationError('invalid_request', `${key} must be a valid integer.`);
    return value;
  };
  const offset = integer('offset', 0);
  const audienceOffset = integer('audienceOffset', 0);
  const targetOffset = integer('targetOffset', 0);
  const limit = integer('limit', 1, 200);
  return { offset, audienceOffset, targetOffset, limit: Math.min(limit, cap) };
}

/** MCP tool groups this module installs. The host merges installed groups; edit only here. */
export const ANALYTICS_MCP: readonly McpToolGroup[] = [
  postsMcp,
  adObjectsMcp,
  {
    id: 'analytics-reports',
    tools: analyticsReportToolDefinitions,
    features: {
      list_report_templates: 'analytics/reports',
      manage_report_template: 'analytics/reports',
      list_report_schedules: 'analytics/reports',
      manage_report_schedule: 'analytics/reports',
      list_report_runs: 'analytics/reports',
      generate_report: 'analytics/reports',
    },
    writeTools: ['manage_report_template', 'manage_report_schedule', 'generate_report'],
    selfLockedWrites: ['manage_report_template', 'manage_report_schedule', 'generate_report'],
    scope: { resourceTools: ['list_report_schedules', 'manage_report_schedule', 'list_report_runs', 'generate_report'], workspaceTools: ['list_report_templates', 'manage_report_template'], resources: ['msp://analytics/reports/schedules', 'msp://analytics/reports/runs'] },
    listFilter: async () => {
      await ensureReportWorkflows();
      const names = new Set<string>((await analyticsReportAvailableToolDefinitions()).map(tool => tool.name));
      return name => names.has(name);
    },
    resources: [
      { uri: 'msp://analytics/reports/templates', name: "Report templates", description: "Workspace-wide saved report definitions.", mimeType: 'application/json', feature: 'analytics/reports', readTool: 'list_report_templates' },
      { uri: 'msp://analytics/reports/schedules', name: "Report schedules", description: "Current scoped report schedules and authorized recipient metadata.", mimeType: 'application/json', feature: 'analytics/reports', readTool: 'list_report_schedules' },
      { uri: 'msp://analytics/reports/runs', name: "Report history", description: "Scoped report outcomes and delivery history.", mimeType: 'application/json', feature: 'analytics/reports', readTool: 'list_report_runs', requiresAvailableTool: true },
    ],
    execute: async (viewer, name, args, cap) => {
      await ensureReportWorkflows();
      if (!(await analyticsReportAvailableToolDefinitions()).some(tool => tool.name === name)) throw new OperationError('unavailable', 'This report action is unavailable right now.');
      return executeAnalyticsReportTool({ ...analyticsActorFor(viewer, cap), resourceRestricted: isResourceRestricted(viewer), ...(viewer.apiKeyId ? { apiKeyId: viewer.apiKeyId } : {}), ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}) }, name, args);
    },
  },
  {
    id: 'analytics-pins',
    tools: analyticsPinToolDefinitions,
    features: {
      get_analytics_pins: 'analytics/pins',
      pin_analytics_metric: 'analytics/pins',
      unpin_analytics_metric: 'analytics/pins',
      reorder_analytics_pins: 'analytics/pins',
    },
    writeTools: ['pin_analytics_metric', 'unpin_analytics_metric', 'reorder_analytics_pins'],
    selfLockedWrites: ['pin_analytics_metric', 'unpin_analytics_metric', 'reorder_analytics_pins'],
    scope: { resourceTools: ['get_analytics_pins', 'pin_analytics_metric', 'unpin_analytics_metric', 'reorder_analytics_pins'], resources: ['msp://analytics/pins'] },
    resources: [
      { uri: 'msp://analytics/pins', name: "Pinned metrics", description: "Your current scoped pinned metrics and available choices.", mimeType: 'application/json', feature: 'analytics/pins', readTool: 'get_analytics_pins' },
    ],
    execute: (viewer, name, args, cap) => executeAnalyticsPinTool(analyticsActorFor(viewer, cap), name, args),
  },
  {
    id: 'analytics-goals',
    tools: analyticsGoalToolDefinitions,
    features: { get_analytics_goals: 'analytics/goals', set_analytics_goals: 'analytics/goals' },
    writeTools: ['set_analytics_goals'],
    scope: { resourceTools: ['get_analytics_goals', 'set_analytics_goals'], resources: ['msp://analytics/goals'] },
    resources: [
      { uri: 'msp://analytics/goals', name: "Goals", description: "Monthly channel goals with month-to-date progress.", mimeType: 'application/json', feature: 'analytics/goals', readTool: 'get_analytics_goals' },
    ],
    execute: (viewer, name, args, cap) => executeAnalyticsGoalTool(analyticsActorFor(viewer, cap), name, args),
  },
  {
    id: 'analytics-demographics',
    tools: analyticsDemographicsToolDefinitions,
    features: {
      get_analytics_demographics: 'analytics/demographics',
    },
    scope: { resourceTools: ['get_analytics_demographics'], resources: ['msp://analytics/demographics'] },
    resources: [
      { uri: 'msp://analytics/demographics', name: "Audience breakdowns", description: "Available scoped stored audience categories and coverage.", mimeType: 'application/json', feature: 'analytics/demographics', readTool: 'get_analytics_demographics' },
    ],
    execute: (viewer, _name, args, cap) => executeAnalyticsDemographicsTool(analyticsActorFor(viewer, cap), args),
  },
  {
    id: 'analytics-comparison',
    tools: analyticsComparisonToolDefinitions,
    features: {
      compare_analytics: 'analytics/compare',
    },
    scope: { resourceTools: ['compare_analytics'] },
    execute: (viewer, _name, args, cap) => executeAnalyticsComparisonTool(analyticsActorFor(viewer, cap), args),
  },
  {
    id: 'analytics-explorer',
    tools: analyticsExplorerToolDefinitions,
    features: {
      get_analytics_explorer: 'analytics/explorer',
    },
    scope: { resourceTools: ['get_analytics_explorer'], resources: ['msp://analytics/explorer'] },
    resources: [
      { uri: 'msp://analytics/explorer', name: "Analytics metric explorer", description: "Bounded stored metric catalog for authorized selected resources.", mimeType: 'application/json', feature: 'analytics/explorer', readTool: 'get_analytics_explorer' },
    ],
    execute: (viewer, _name, args, cap) => executeAnalyticsExplorerTool(analyticsActorFor(viewer, cap), args, { allowedChannelIds: pageIdsFor(viewer), feature: 'analytics/explorer' }, cap),
  },
  {
    id: 'analytics-overview',
    tools: [
    { name: 'get_analytics_overview', description: 'Read available metrics and combined audience for selected channels and ad accounts. Metrics, audience entries, and selected channels have independent offsets; each response is bounded.', inputSchema: { type: 'object', properties: { start: { type: 'string', description: 'Start date, YYYY-MM-DD.' }, end: { type: 'string', description: 'End date, YYYY-MM-DD.' }, compare: { type: 'string', enum: ['none', 'previous', 'year'] }, targetIds: { type: 'array', items: { type: 'string' }, description: 'Selected channel IDs; omit to use every accessible channel. An empty array selects no channels.' }, adAccountIds: { type: 'array', items: { type: 'string' }, description: 'Selected ad account IDs; omit to use every accessible account. An empty array selects no ad accounts.' }, search: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, audienceOffset: { type: 'integer', minimum: 0 }, targetOffset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
    { name: 'get_analytics_metric_details', description: 'Read a bounded page of stored date points or channel/breakdown rows for one Analytics metric. Continue with nextOffset until null.', inputSchema: { type: 'object', required: ['metricKey', 'kind'], properties: { start: { type: 'string', description: 'Start date, YYYY-MM-DD.' }, end: { type: 'string', description: 'End date, YYYY-MM-DD.' }, compare: { type: 'string', enum: ['none', 'previous', 'year'] }, targetIds: { type: 'array', items: { type: 'string' }, description: 'Selected channel IDs; omit to use every accessible channel. An empty array selects no channels.' }, adAccountIds: { type: 'array', items: { type: 'string' }, description: 'Selected ad account IDs; omit to use every accessible account. An empty array selects no ad accounts.' }, search: { type: 'string' }, metricKey: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['points', 'rows'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
    ],
    features: {
      get_analytics_overview: 'analytics/overview',
      get_analytics_metric_details: 'analytics/overview',
    },
    scope: { resourceTools: ['get_analytics_overview', 'get_analytics_metric_details'], resources: ['msp://analytics/overview'] },
    resources: [
      { uri: 'msp://analytics/overview', name: "Analytics overview", description: "Selected-channel audience totals and available stored metrics for the default date range.", mimeType: 'application/json', feature: 'analytics/overview', readTool: 'get_analytics_overview' },
    ],
    execute: async (viewer, name, args, cap) => {
      switch (name) {
      case 'get_analytics_overview': {
        const { offset, audienceOffset, targetOffset, limit: pageLimit } = analyticsPageArgs(args, cap, Math.min(cap, 50));
        const snapshot = await readMcpAnalyticsSnapshot(viewer, args);
        const filteredMetrics = snapshot.allMetrics;
        const metrics = filteredMetrics.slice(offset, offset + pageLimit);
        const boundedMetrics = metrics.map(metric => ({
          ...metric,
          comparison: snapshot.comparisons[metric.key] ?? null,
          points: metric.points.slice(0, cap),
          rows: metric.rows.slice(0, cap),
          pointsTruncated: metric.points.length > cap,
          rowsTruncated: metric.rows.length > cap,
        }));
        const audienceEntries = snapshot.audience.entries.slice(audienceOffset, audienceOffset + pageLimit);
        const selectedIds = new Set(snapshot.selected.channelIds);
        const selectedTargets = snapshot.options.channels.filter(target => selectedIds.has(target.id)).slice(targetOffset, targetOffset + pageLimit).map(target => ({ id: target.id, type: target.type, name: target.name }));
        const range = snapshot.period.range;
        return { period: snapshot.period, range, selectedTargets, selectedTargetCount: snapshot.selected.channelIds.length, nextTargetOffset: targetOffset + selectedTargets.length < snapshot.selected.channelIds.length ? targetOffset + selectedTargets.length : null, audience: { ...snapshot.audience, entries: audienceEntries, entryCount: snapshot.audience.entries.length, entriesTruncated: audienceOffset + audienceEntries.length < snapshot.audience.entries.length, nextOffset: audienceOffset + audienceEntries.length < snapshot.audience.entries.length ? audienceOffset + audienceEntries.length : null }, adAccountCount: snapshot.selected.adAccountIds.length, publishing: snapshot.publishing, metricCount: filteredMetrics.length, metrics: boundedMetrics, nextOffset: offset + metrics.length < filteredMetrics.length ? offset + metrics.length : null };
      }
      case 'get_analytics_metric_details': {
        const metricKey = requiredString(args, 'metricKey');
        const kind = args.kind;
        if (kind !== 'points' && kind !== 'rows') throw new OperationError('invalid_request', 'kind must be points or rows.');
        const offset = args.offset === undefined ? 0 : args.offset;
        const limit = args.limit === undefined ? Math.min(cap, 50) : args.limit;
        if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new OperationError('invalid_request', 'offset and limit must be valid integers.');
        const snapshot = await readMcpAnalyticsSnapshot(viewer, args, metricKey);
        const metric = snapshot.allMetrics.find(candidate => candidate.key === metricKey);
        if (!metric) throw new OperationError('not_found', 'Metric is unavailable for this selection and date range.');
        const pageLimit = Math.min(limit, cap);
        const details = metric[kind];
        const items = details.slice(offset, offset + pageLimit);
        return { period: snapshot.period, range: snapshot.period.range, metric: { key: metric.key, label: metric.label, sourceLabel: metric.sourceLabel, unit: metric.unit, kind: metric.kind, aggregationLabel: metric.aggregationLabel, aggregationNote: metric.aggregationNote, coverage: metric.coverage, available: metric.available }, comparison: snapshot.comparisons[metric.key] ?? null, detailKind: kind, totalCount: details.length, offset, items, nextOffset: offset + items.length < details.length ? offset + items.length : null };
      }
        default: throw new OperationError('invalid_request', `Unknown tool: ${name}`);
      }
    },
  },
];
