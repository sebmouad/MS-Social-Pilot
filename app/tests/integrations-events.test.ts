import { beforeEach, describe, expect, it, vi } from 'vitest';

type Q = { sql: string; values: unknown[] };
const state = vi.hoisted(() => ({ queries: [] as Q[], executions: [] as Q[], handlers: [] as Array<[string, (values: unknown[]) => unknown]>, config: {} as Record<string, unknown> }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => (key in state.config ? state.config[key] : key === 'data.workspaceOperationTimeoutMs' ? 30000 : DEFAULTS[key]) }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async () => ({}), canUseFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => null }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/secret-crypto', () => ({ encryptSecret: (v: string) => v, decryptSecret: (v: string) => v }));

import { EMITTED_EVENTS, WEBHOOK_EVENTS } from '../src/modules/integrations/contracts';
import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
import { emitRecentCommentEvents, emitRecentDisconnectEvents, emitRecentEvents, emitRecentReportEvents, emitRecentScheduledEvents } from '../src/modules/integrations/server/events';
const DEFAULTS: Record<string, unknown> = Object.fromEntries(INTEGRATIONS_CONFIG.map(item => [item.key, item.defaultValue]));

const now = new Date('2026-10-19T12:00:00Z');
const when = (fragment: string, fn: (values: unknown[]) => unknown) => { state.handlers.unshift([fragment, fn]); };
const inserts = () => state.executions.filter(q => q.sql.includes('INSERT INTO webhook_deliveries'));
const payloadOf = (q: Q) => JSON.parse(q.values.find(v => typeof v === 'string' && v.startsWith('{"event"')) as string) as { event: string; eventId: string; occurredAt: string; data: Record<string, unknown> };
const scan = (fragment: string) => state.queries.find(q => q.sql.includes(fragment))!;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { queries: [], executions: [], handlers: [], config: {} });
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = { sql: strings.join('?'), values }; state.queries.push(q);
    for (const [fragment, fn] of state.handlers) if (q.sql.includes(fragment)) return fn(values);
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => { state.executions.push({ sql: strings.join('?'), values }); return 1; });
});

describe('every subscribable event has an honest source', () => {
  it('declares all events as emitted, and one worker pass scans every source for listening workspaces only', async () => {
    expect([...EMITTED_EVENTS].sort()).toEqual([...WEBHOOK_EVENTS].sort());
    await emitRecentEvents(now);
    for (const fragment of ['FROM post_targets pt', 'FROM activity_logs l', 'FROM post_comments c', 'FROM social_accounts a', 'FROM report_runs r']) {
      const q = scan(fragment);
      expect(q, fragment).toBeTruthy();
      expect(q.sql, fragment).toContain('EXISTS (SELECT 1 FROM webhook_endpoints e'); expect(q.sql, fragment).toContain('e.enabled');
    }
  });
  it('is off with the capability switch and bounded by the Root window and scan size', async () => {
    state.config['integrations.webhooks.enabled'] = false;
    expect(await emitRecentEvents(now)).toEqual({ examined: 0, queued: 0 }); expect(state.queries).toHaveLength(0);
    state.config['integrations.webhooks.enabled'] = true; state.config['integrations.webhooks.eventScanLimit'] = 7; state.config['integrations.webhooks.eventLookbackMinutes'] = 30;
    await emitRecentEvents(now);
    for (const fragment of ['FROM activity_logs l', 'FROM post_comments c', 'FROM social_accounts a', 'FROM report_runs r']) {
      const values = scan(fragment).values;
      expect(values, fragment).toContain(7); expect(values, fragment).toContainEqual(new Date(now.getTime() - 30 * 60_000));
    }
  });
  it('uses Root limits for event payload truncation and destination lists', async () => {
    state.config['integrations.webhooks.eventAuthorNameMaxCharacters'] = 3;
    state.config['integrations.webhooks.eventMessageMaxCharacters'] = 4;
    state.config['integrations.webhooks.eventDestinationIdsMaxItems'] = 1;
    const comment = { id: 'c-limit', workspaceId: 'workspace-a', postId: 'p1', targetId: 't1', targetName: 'Alpha', fromName: 'Samuel', message: 'message', createdTime: now, firstSeenAt: now };
    when('FROM post_comments c', () => [comment]);
    await emitRecentCommentEvents(now);
    expect(payloadOf(inserts()[0]!).data).toMatchObject({ authorName: 'Sam', text: 'mess' });
    state.queries.length = 0; state.executions.length = 0; state.handlers.length = 0;
    const scheduled = { id: 'log-limit', workspaceId: 'workspace-a', postId: 'p1', scheduledAt: now, createdAt: now, destinationIds: ['t1', 't2'] };
    when('FROM activity_logs l', () => [scheduled]);
    await emitRecentScheduledEvents(now);
    expect(payloadOf(inserts()[0]!).data.destinationIds).toEqual(['t1']);
  });
  it('a failing source never stops the others', async () => {
    when('FROM activity_logs l', () => { throw new Error('boom'); });
    when('FROM report_runs r', () => [{ id: 'run1', workspaceId: 'workspace-a', targetId: 't1', kind: 'scheduled', periodStart: '2026-09-01', periodEnd: '2026-09-30', rowCount: 12, status: 'completed', finishedAt: new Date('2026-10-19T11:50:00Z') }]);
    expect(await emitRecentEvents(now)).toEqual({ examined: 1, queued: 1 });
  });
});

describe('post.scheduled', () => {
  const row = { id: 'log1', workspaceId: 'workspace-a', postId: 'p1', scheduledAt: new Date('2026-10-25T09:00:00Z'), createdAt: new Date('2026-10-19T11:00:00Z'), destinationIds: ['t1', 't2'] };
  it('is derived from the scheduling and approval audit rows with a stable id and no post text', async () => {
    when('FROM activity_logs l', () => [row]);
    expect(await emitRecentScheduledEvents(now)).toEqual({ examined: 1, queued: 1 });
    const payload = payloadOf(inserts()[0]!);
    expect(payload).toMatchObject({ event: 'post.scheduled', eventId: 'post_scheduled:log1', occurredAt: '2026-10-19T11:00:00.000Z', data: { postId: 'p1', scheduledAt: '2026-10-25T09:00:00.000Z', destinationIds: ['t1', 't2'] } });
    expect(JSON.stringify(payload)).not.toMatch(/message/i);
    expect(inserts()[0]!.values).toContain('workspace-a');
  });
  it('does not report a post still held for approval, rejected or back in draft', async () => {
    await emitRecentScheduledEvents(now);
    const sql = scan('FROM activity_logs l').sql;
    expect(sql).toContain("'publishing.post_scheduled', 'publishing.post_approved'");
    expect(sql).toContain("p.status::text IN ('scheduled', 'publishing', 'published', 'partially_failed', 'failed')");
    expect(sql).not.toContain('pending_approval'); expect(sql).toContain('p."workspaceId" = l."workspaceId"');
  });
  it('repeated scans reuse the same event id and the insert skips deliveries that already carry it', async () => {
    when('FROM activity_logs l', () => [row]);
    await emitRecentScheduledEvents(now); await emitRecentScheduledEvents(new Date(now.getTime() + 60_000));
    const [a, b] = inserts().map(payloadOf);
    expect(a!.eventId).toBe(b!.eventId);
    expect(inserts()[0]!.sql).toContain("NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.\"endpointId\" = e.id AND d.payload ->> 'eventId'");
    expect(state.queries.some(q => q.sql.includes('pg_advisory_xact_lock') && q.values.some(v => String(v).includes('integrations:event:workspace-a:post_scheduled:log1')))).toBe(true);
  });
});

describe('comment.received', () => {
  const row = { id: 'c1', workspaceId: 'workspace-a', postId: 'p1', targetId: 't1', targetName: 'Alpha', fromName: 'Sam', message: 'x'.repeat(900), createdTime: new Date('2026-10-19T10:00:00Z'), firstSeenAt: new Date('2026-10-19T10:05:00Z') };
  it('comes from stored comment rows first seen inside the window, never from the channel itself, with capped text', async () => {
    when('FROM post_comments c', () => [row]);
    expect(await emitRecentCommentEvents(now)).toEqual({ examined: 1, queued: 1 });
    const payload = payloadOf(inserts()[0]!);
    expect(payload).toMatchObject({ event: 'comment.received', eventId: 'comment:c1', occurredAt: '2026-10-19T10:05:00.000Z', data: { commentId: 'c1', postId: 'p1', destinationId: 't1', authorName: 'Sam' } });
    expect((payload.data.text as string).length).toBe(500);
    const sql = scan('FROM post_comments c').sql;
    expect(sql).toContain('c."sentById" IS NULL'); expect(sql).toContain('c."fromId" <> t."providerId"'); expect(sql).toContain('t."workspaceId" = p."workspaceId"');
  });
  it('emits each comment once across overlapping scans', async () => {
    when('FROM post_comments c', () => [row]);
    await emitRecentCommentEvents(now); await emitRecentCommentEvents(new Date(now.getTime() + 120_000));
    expect(new Set(inserts().map(q => payloadOf(q).eventId))).toEqual(new Set(['comment:c1']));
  });
});

describe('page.disconnected', () => {
  const at = new Date('2026-10-19T11:30:00Z');
  const row = { workspaceId: 'workspace-a', targetId: 't1', targetName: 'Alpha', invalidatedAt: at, reason: 'Disconnected by a workspace member' };
  it('reports each channel of a connection invalidated in the window, with an id carrying the invalidation instant', async () => {
    when('FROM social_accounts a', () => [row]);
    expect(await emitRecentDisconnectEvents(now)).toEqual({ examined: 1, queued: 1 });
    expect(payloadOf(inserts()[0]!)).toMatchObject({ event: 'page.disconnected', eventId: `target:t1:disconnected:${at.getTime()}`, occurredAt: at.toISOString(), data: { destinationId: 't1', destinationName: 'Alpha' } });
  });
  it('reports a later disconnect of the same channel as a new event, and a repeat scan as the same one', async () => {
    when('FROM social_accounts a', () => [row, { ...row, invalidatedAt: new Date(at.getTime() + 3_600_000) }]);
    await emitRecentDisconnectEvents(now); await emitRecentDisconnectEvents(now);
    const ids = inserts().map(q => payloadOf(q).eventId);
    expect(new Set(ids).size).toBe(2); expect(ids).toHaveLength(4);
  });
});

describe('report.ready', () => {
  const row = { id: 'run1', workspaceId: 'workspace-a', targetId: 't1', kind: 'scheduled', periodStart: '2026-09-01', periodEnd: '2026-09-30', rowCount: 12, status: 'completed', finishedAt: new Date('2026-10-19T11:50:00Z') };
  it('reports finished runs by metadata only, with the run id as the stable event id', async () => {
    when('FROM report_runs r', () => [row]);
    expect(await emitRecentReportEvents(now)).toEqual({ examined: 1, queued: 1 });
    const payload = payloadOf(inserts()[0]!);
    expect(payload).toMatchObject({ event: 'report.ready', eventId: 'report_run:run1', data: { reportRunId: 'run1', destinationId: 't1', kind: 'scheduled', periodStart: '2026-09-01', periodEnd: '2026-09-30', rowCount: 12, status: 'completed' } });
    expect(Object.keys(payload.data)).not.toContain('output'); expect(JSON.stringify(payload)).not.toMatch(/recipient|deliveries/i);
    const sql = scan('FROM report_runs r').sql;
    expect(sql).toContain("r.status IN ('completed', 'partial')"); expect(sql).not.toMatch(/failed|skipped|uncertain|output/);
  });
});

describe('isolation and delivery targets', () => {
  it('queues an event only for endpoints of the event workspace that listen for it and existed when it happened', async () => {
    when('FROM report_runs r', () => [{ id: 'run1', workspaceId: 'workspace-b', targetId: 't9', kind: 'manual', periodStart: 'a', periodEnd: 'b', rowCount: null, status: 'partial', finishedAt: new Date('2026-10-19T11:50:00Z') }]);
    await emitRecentReportEvents(now);
    const insert = inserts()[0]!;
    expect(insert.values).toContain('workspace-b'); expect(insert.values).not.toContain('workspace-a');
    expect(insert.sql).toContain('e."workspaceId" ='); expect(insert.sql).toContain('= ANY(e.events)'); expect(insert.sql).toContain('e."createdAt" <=');
  });
});
