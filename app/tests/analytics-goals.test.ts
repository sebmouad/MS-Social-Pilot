import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'editor', scope: null as string[] | null, writeDenied: false, timeZone: 'UTC' as string | null, posts: 3,
  channels: [] as Array<{ id: string; name: string; provider: string | null }>, stored: [] as Array<{ targetId: string; metric: string; target: number }>,
  measures: { audienceGained: 40, views: 900, engagements: null } as { audienceGained: number | null; views: number | null; engagements: number | null },
  measureCalls: [] as Array<{ targetId: string; from: Date; to: Date }>, execs: [] as Array<{ sql: string; values: unknown[] }>, usable: ['c1', 'c2'],
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/config/store', async () => { const { goalsCopyDefaults } = await import('@/modules/analytics/goals/copy'); return { runtimeConfig: async () => goalsCopyDefaults }; });
vi.mock('@/modules/analytics/server/error-copy', async () => {
  const { errorCopyDefaults } = await import('@/modules/analytics/error-copy');
  const { OperationError } = await import('@/lib/operation-error');
  return { analyticsError: async (code: import('@/lib/operation-error').OperationErrorCode, key: keyof typeof errorCopyDefaults) => new OperationError(code, errorCopyDefaults[key].en), analyticsLanguage: async () => 'en', localizeAnalyticsError: async (error: unknown) => error };
});
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_w: string, fn: () => Promise<unknown>) => fn(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async (_u: string, w: string) => ({ workspaceId: w }), entitledPlatformIds: () => ['facebook', 'other'] }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async (_w: string, providers: string[]) => ({ provider: { in: providers } }) }));
vi.mock('@/modules/analytics/reports/server/access', () => ({ usableChannelIds: async (_db: unknown, _w: string, _p: string[], wanted: string[] | null) => state.usable.filter(id => wanted === null || wanted.includes(id)) }));
vi.mock('@/server/platforms/registry', () => ({
  platformAnalytics: async (provider: string) => provider === 'facebook'
    ? { load: async () => ({}), goalMeasures: async (r: { targetId: string; from: Date; to: Date }) => { state.measureCalls.push(r); return state.measures; } }
    : { load: async () => ({}) },
}));
vi.mock('@/modules/analytics/server/access', async () => {
  const actual = await vi.importActual<typeof import('../src/modules/analytics/server/access')>('../src/modules/analytics/server/access');
  return {
    ...actual,
    authorize: async (_a: unknown, _f: string, access: string) => { if (access === 'write' && state.writeDenied) throw Object.assign(new Error('no'), { code: 'forbidden' }); return { role: state.role, scope: state.scope }; },
    lockActor: async () => undefined,
    audit: async (_tx: unknown, _a: unknown, action: string, detail: unknown) => { state.execs.push({ sql: 'audit:' + action, values: [detail] }); },
  };
});

import { readGoals, setGoals, channelGoalProgress } from '../src/modules/analytics/goals/server/goals';
import { goalPace, goalPercent, monthIn, monthWindow } from '../src/modules/analytics/goals/contracts';
import { goalsCopy, goalsLocale, goalsText } from '../src/modules/analytics/goals/copy';
import { executeAnalyticsGoalTool, analyticsGoalToolDefinitions } from '../src/modules/analytics/goals/mcp';
import { facebookGoalMeasures } from '../src/platforms/facebook/goals';
import { renderReport } from '../src/modules/analytics/reports/generation/document';

const actor = { userId: 'u1', workspaceId: 'w1' };
const now = new Date('2026-10-16T12:00:00Z');

beforeEach(() => {
  Object.assign(state, {
    role: 'editor', scope: null, writeDenied: false, timeZone: 'UTC', posts: 3, usable: ['c1', 'c2'], measureCalls: [], execs: [],
    channels: [{ id: 'c1', name: 'Page One', provider: 'facebook' }, { id: 'c2', name: 'Other', provider: 'other' }],
    stored: [{ targetId: 'c1', metric: 'followers', target: 100 }, { targetId: 'c1', metric: 'views', target: 900 }, { targetId: 'c1', metric: 'engagements', target: 50 }, { targetId: 'c1', metric: 'posts', target: 20 }, { targetId: 'c2', metric: 'followers', target: 10 }],
    measures: { audienceGained: 40, views: 900, engagements: null },
  });
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const sql = s.join('?');
    if (sql.includes('FROM workspaces')) return [{ timezone: state.timeZone }];
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(state.posts) }];
    if (sql.includes('FROM page_goals')) return state.stored;
    if (sql.includes('LEFT JOIN social_accounts')) { const ids = v.find(Array.isArray) as string[]; return state.channels.filter(c => ids.includes(c.id)); }
    if (sql.includes('FOR SHARE')) return [{ id: v[0] }];
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { state.execs.push({ sql: s.join('?'), values: v }); return 1; });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});

describe('goal arithmetic and months', () => {
  it('keeps the legacy pace and percent rules', () => {
    expect(goalPace(100, null, 0.5)).toBe('noData');
    expect(goalPace(100, 100, 0.1)).toBe('met');
    expect(goalPace(100, 45, 0.5)).toBe('onTrack');
    expect(goalPace(100, 44, 0.5)).toBe('behind');
    expect(goalPercent(100, 250)).toBe(100);
    expect(goalPercent(100, null)).toBe(0);
  });
  it('uses workspace-local calendar months, including the year rollover', () => {
    expect(monthIn(new Date('2026-11-01T02:00:00Z'), 'America/New_York')).toBe('2026-10');
    const december = monthWindow('2026-12', 'America/New_York');
    expect(december.start.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(december.end.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
});

describe('Facebook goal measures', () => {
  it('takes the newest metric name per day, nets unfollows and keeps missing as unknown', () => {
    const at = (d: string) => new Date(`2026-10-${d}T07:00:00Z`);
    const rows = [
      { metric: 'page_daily_follows_unique', endTime: at('02'), numeric: 10 }, { metric: 'page_fan_adds', endTime: at('02'), numeric: 99 },
      { metric: 'page_fan_adds', endTime: at('03'), numeric: 5 },
      { metric: 'page_daily_unfollows_unique', endTime: at('03'), numeric: 2 },
      { metric: 'page_media_view', endTime: at('02'), numeric: 300 }, { metric: 'page_impressions', endTime: at('02'), numeric: 1000 },
      { metric: 'page_impressions', endTime: at('03'), numeric: 200.4 },
      { metric: 'page_media_view', endTime: at('20'), numeric: 5000 },
    ];
    const window = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-16T00:00:00Z') };
    expect(facebookGoalMeasures(rows, window)).toEqual({ audienceGained: 13, views: 500, engagements: null });
    expect(facebookGoalMeasures([], window)).toEqual({ audienceGained: null, views: null, engagements: null });
  });
});

describe('goals service', () => {
  it('reads progress from the channel module and stored posts, and offers only trackable metrics', async () => {
    const result = await readGoals(actor, {}, now);
    expect(result.month).toEqual({ month: '2026-10', start: '2026-10-01', end: '2026-10-31', timeZone: 'UTC' });
    const [one, other] = result.channels;
    expect(one!.trackable).toEqual(['followers', 'views', 'engagements', 'posts']);
    expect(one!.goals.map(g => [g.metric, g.actual, g.percent, g.pace])).toEqual([
      ['followers', 40, 40, 'behind'], ['views', 900, 100, 'met'], ['engagements', null, 0, 'noData'], ['posts', 3, 15, 'behind'],
    ]);
    expect(state.measureCalls[0]).toMatchObject({ targetId: 'c1', from: new Date('2026-10-01T00:00:00Z'), to: now });
    expect(other!.trackable).toEqual(['posts']);
    expect(other!.goals).toEqual([expect.objectContaining({ metric: 'followers', actual: null, pace: 'noData' })]);
    expect(result.canManage).toBe(true);
  });
  it('limits to resource scope, refuses a foreign channel and hides management from viewers', async () => {
    state.scope = ['c2']; state.role = 'member';
    const result = await readGoals(actor, {}, now);
    expect(result.channels.map(c => c.channelId)).toEqual(['c2']);
    expect(result.canManage).toBe(false);
    await expect(readGoals(actor, { channelId: 'c1' }, now)).rejects.toMatchObject({ code: 'not_found' });
    await expect(readGoals({ ...actor, maxResultItems: 0 }, {}, now)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('requires the exact confirmation, a writer role and a trackable metric before writing', async () => {
    await expect(setGoals(actor, { channelId: 'c1', goals: { followers: 5 }, confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(setGoals(actor, { channelId: 'c2', goals: { views: 5 }, confirmation: 'SET ANALYTICS GOALS c2' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.role = 'member';
    await expect(setGoals(actor, { channelId: 'c1', goals: { followers: 5 }, confirmation: 'SET ANALYTICS GOALS c1' })).rejects.toMatchObject({ code: 'forbidden' });
    state.role = 'editor'; state.scope = ['c2'];
    await expect(setGoals(actor, { channelId: 'c1', goals: { followers: 5 }, confirmation: 'SET ANALYTICS GOALS c1' })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.execs).toHaveLength(0);
  });
  it('upserts and clears within the workspace and audits, including clearing a legacy untrackable goal', async () => {
    await expect(setGoals(actor, { channelId: 'c2', goals: { posts: 12, followers: null }, confirmation: 'SET ANALYTICS GOALS c2' })).resolves.toEqual({ ok: true, channelId: 'c2', changed: 2 });
    expect(state.execs[0]!.sql).toContain('DELETE FROM page_goals');
    expect(state.execs[0]!.values).toEqual(['c2', 'w1', 'followers']);
    expect(state.execs[1]!.sql).toContain('INSERT INTO page_goals');
    expect(state.execs[1]!.sql).toContain('WHERE page_goals."workspaceId" = ?');
    expect(state.execs[1]!.values).toEqual(expect.arrayContaining(['w1', 'c2', 'posts', 12]));
    expect(state.execs[2]).toEqual({ sql: 'audit:analytics.goals_changed', values: [{ channelId: 'c2', metrics: [{ metric: 'followers', cleared: true }, { metric: 'posts', cleared: false }] }] });
  });
  it('judges a past report month whole, in the workspace time zone', async () => {
    state.timeZone = 'Africa/Casablanca';
    const result = await channelGoalProgress('w1', 'c1', '2026-09-30', now);
    expect(result.month).toEqual({ month: '2026-09', start: '2026-09-01', end: '2026-09-30', timeZone: 'Africa/Casablanca' });
    expect(state.measureCalls[0]!.from.toISOString()).toBe('2026-08-31T23:00:00.000Z');
    expect(state.measureCalls[0]!.to.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(result.goals.find(g => g.metric === 'followers')!.pace).toBe('behind');
  });
  it('routes MCP tools through the same service and declares views as settable', async () => {
    await expect(executeAnalyticsGoalTool(actor, 'get_analytics_goals', {})).resolves.toMatchObject({ ok: true });
    await expect(executeAnalyticsGoalTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
    const set = analyticsGoalToolDefinitions.find(t => t.name === 'set_analytics_goals')!;
    expect(Object.keys(set.inputSchema.properties.goals.properties)).toEqual(['followers', 'views', 'engagements', 'posts']);
  });
});

describe('goals copy and report section', () => {
  it('ships matching en and fr copy and picks the language from the request', () => {
    expect(Object.keys(goalsCopy.fr).sort()).toEqual(Object.keys(goalsCopy.en).sort());
    expect(goalsLocale('fr-FR,fr;q=0.9')).toBe('fr');
    expect(goalsLocale('en-US,fr;q=0.5')).toBe('en');
    expect(goalsText('fr', 'perMonth', { label: 'Vues' })).toBe('Vues par mois');
  });
  it('renders goals with their month and zone, and unknown progress as no data', () => {
    const snapshot = { period: { start: '2026-09-01', end: '2026-09-30' }, publishing: { published: 1, scheduled: 0, failed: 0 }, audience: { entries: [], total: 0, covered: 0, selected: 1 }, allMetrics: [], comparisons: {} };
    const goals = { month: { month: '2026-09', start: '2026-09-01', end: '2026-09-30', timeZone: 'UTC' }, goals: [{ metric: 'views' as const, label: 'Views', target: 900, actual: null, percent: 0, pace: 'noData' as const, paceLabel: 'No data yet' }] };
    const out = renderReport(snapshot as never, { channelName: 'Page One', sections: ['goals'], generatedAt: now, goals }, { maxRows: 50, maxBytes: 20000 });
    expect(out.html).toContain('<h2>Goals</h2>');
    expect(out.html).toContain('2026-09-01 to 2026-09-30 (UTC)');
    expect(out.html).toContain('<td>No data</td>');
    expect(out.csv).toContain('"goal","views","Views","Goals","","2026-09-01","","target 900","0%","No data yet; month 2026-09-01 to 2026-09-30 (UTC)"');
    const empty = renderReport(snapshot as never, { channelName: 'Page One', sections: ['goals'], generatedAt: now, goals: { ...goals, goals: [] } }, { maxRows: 50, maxBytes: 20000 });
    expect(empty.html).toContain('No goals are set for this channel.');
  });
});
