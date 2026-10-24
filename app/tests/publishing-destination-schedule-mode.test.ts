import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BASELINE_NAME, BASELINE_SHA256, baselineBlock } from './baseline-block';

const state = vi.hoisted(() => ({
  config: { 'publishing.remoteScheduling.offered': true, 'publishing.remoteScheduling.defaultMode': 'application', 'publishing.remoteScheduling.handOffBatch': 25 } as Record<string, unknown>,
  key: null as null | Record<string, unknown>,
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), post: { findFirst: vi.fn() } }));
const svc = vi.hoisted(() => ({
  createPost: vi.fn(), schedulePost: vi.fn(), reschedulePostToInstant: vi.fn(), cancelScheduledPost: vi.fn(), queuePostRequest: vi.fn(), hold: vi.fn(),
  loadPermissions: vi.fn(), loadEntitlements: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => state.config[key] ?? ({ 'data.workspaceOperationTimeoutMs': 30000, 'api.enabled': true } as Record<string, unknown>)[key] }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, cb: () => Promise<unknown>) => cb(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: (...args: unknown[]) => svc.loadEntitlements(...args), canUseFeature: () => true, entitledPlatformIds: () => ['facebook'] }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: (...args: unknown[]) => svc.loadPermissions(...args) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: (p: { features: Record<string, { read: boolean; write: boolean }> }, feature: string, access = 'read') => Boolean(p.features?.[feature]?.[access as 'read' | 'write']) }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({}) }));
vi.mock('@/server/client-ip', () => ({ clientIp: () => 'ip-1' }));
vi.mock('@/server/mcp/bearer', () => ({ authenticateBearerHeader: async () => state.key }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({
  createPost: svc.createPost, schedulePost: svc.schedulePost, reschedulePostToInstant: svc.reschedulePostToInstant,
  cancelScheduledPost: svc.cancelScheduledPost, holdScheduledPostAtProvider: svc.hold,
}));
vi.mock('@/modules/publishing/server/queue', () => ({ queuePostRequest: svc.queuePostRequest }));
vi.mock('@/modules/publishing/server/read', () => ({ readPublishingPostList: vi.fn() }));

import { INTEGRATIONS_CONFIG } from '../src/modules/integrations/config';
import { reset as resetRateLimit } from '../src/server/rate-limit';
import * as postsRoute from '../src/app/api/v1/posts/route';
import * as actionRoute from '../src/app/api/v1/posts/[id]/[action]/route';
import { handOffRemoteSchedules } from '../src/modules/publishing/server/remote-handoff';
import { parseDestinationScheduleModes, parseDestinationScheduleModesJson, resolveScheduleModes, storeScheduleModes, systemScheduleModes, clearScheduleModes, destinationMode } from '../src/modules/publishing/server/schedule-modes';

for (const item of INTEGRATIONS_CONFIG) if (!(item.key in state.config)) state.config[item.key] = item.defaultValue;

const TOKEN = `mcp_${'a'.repeat(43)}`;
const origin = 'https://app.test';
const keyed = (path: string, body?: unknown) => new Request(`${origin}${path}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const viewer = (features: Record<string, { read: boolean; write: boolean }> = { 'publishing/posts': { read: true, write: true } }, pageScope = { all: true, ids: [] as string[] }) => ({
  scope: 'workspace', userId: 'user-a', workspaceId: 'workspace-a', role: 'owner', apiKeyId: 'mcpkey_1', entitlements: { workspaceId: 'workspace-a' },
  workspace: { id: 'workspace-a', name: 'Acme', timezone: 'UTC' }, maxResultItems: 100, resourceRestricted: !pageScope.all, permissions: { pageScope, features },
});
const ctx = (id: string, action: string) => ({ params: Promise.resolve({ id, action }) });
const future = new Date(Date.now() + 86_400_000).toISOString();
const receipt = { remoteHold: { held: 1, deferred: 0, reasons: [] } };

beforeEach(() => {
  vi.clearAllMocks(); resetRateLimit();
  state.key = viewer();
  state.config['publishing.remoteScheduling.offered'] = true; state.config['publishing.remoteScheduling.defaultMode'] = 'application';
  db.$queryRaw.mockImplementation(async () => []); db.$executeRaw.mockImplementation(async () => 1);
  db.post.findFirst.mockImplementation(async () => ({ status: 'scheduled', scheduledAt: new Date(future) }));
  svc.createPost.mockResolvedValue({ id: 'post-1', scheduleMode: 'remote', destinationScheduleModes: { t1: 'remote', t2: 'application' }, ...receipt });
  svc.schedulePost.mockResolvedValue({ scheduleMode: 'remote', destinationScheduleModes: { t1: 'remote' }, ...receipt });
  svc.reschedulePostToInstant.mockResolvedValue({ scheduledAt: new Date(future) });
  svc.cancelScheduledPost.mockResolvedValue(undefined);
  svc.queuePostRequest.mockResolvedValue({ postId: 'p1', scheduledAt: new Date(future), status: 'scheduled', scheduleMode: 'remote', destinationScheduleModes: { t1: 'remote' }, ...receipt });
});

describe('per-destination scheduling choice: parsing and resolution', () => {
  it('parses a strict map and refuses anything else', () => {
    expect(parseDestinationScheduleModes(undefined)).toBeUndefined();
    expect(parseDestinationScheduleModes({ t1: 'remote', t2: 'application' })).toEqual({ t1: 'remote', t2: 'application' });
    expect(() => parseDestinationScheduleModes({ t1: 'platform' })).toThrow();
    expect(() => parseDestinationScheduleModes({ t1: 1 })).toThrow();
    expect(() => parseDestinationScheduleModes(['remote'])).toThrow();
    expect(() => parseDestinationScheduleModes('remote')).toThrow();
  });
  it('treats an empty composer value as no overrides and refuses malformed JSON', () => {
    expect(parseDestinationScheduleModesJson('')).toBeUndefined();
    expect(parseDestinationScheduleModesJson('{}')).toBeUndefined();
    expect(parseDestinationScheduleModesJson('{"t1":"remote"}')).toEqual({ t1: 'remote' });
    expect(() => parseDestinationScheduleModesJson('{nope')).toThrow();
  });
  it('gives every destination an explicit mode: its override, else the post-level choice, else the Root default', async () => {
    const byPost = await resolveScheduleModes(['t1', 't2'], 'remote', { t2: 'application' });
    expect(byPost.byTarget).toEqual(new Map([['t1', 'remote'], ['t2', 'application']]));
    state.config['publishing.remoteScheduling.defaultMode'] = 'remote';
    expect((await resolveScheduleModes(['t1', 't2'], undefined)).byTarget).toEqual(new Map([['t1', 'remote'], ['t2', 'remote']]));
  });
  it('refuses a choice for a destination that is not on the post, and platform holding when Root withdrew it', async () => {
    await expect(resolveScheduleModes(['t1'], undefined, { other: 'remote' })).rejects.toMatchObject({ code: 'invalid_request' });
    state.config['publishing.remoteScheduling.offered'] = false;
    await expect(resolveScheduleModes(['t1', 't2'], undefined, { t2: 'remote' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect((await resolveScheduleModes(['t1'], undefined, { t1: 'application' })).byTarget.get('t1')).toBe('application');
  });
  it('system jobs never throw: when the choice cannot be honoured every destination stays with the application', async () => {
    state.config['publishing.remoteScheduling.defaultMode'] = 'remote';
    expect(await systemScheduleModes(['t1', 't2'])).toEqual(new Map([['t1', 'remote'], ['t2', 'remote']]));
    expect(await systemScheduleModes(['t1', 't2'], { t1: 'application', gone: 'remote' })).toEqual(new Map([['t1', 'application'], ['t2', 'remote']]));
    state.config['publishing.remoteScheduling.offered'] = false;
    expect(await systemScheduleModes(['t1'], { t1: 'remote' })).toEqual(new Map([['t1', 'application']]));
  });
  it('stores the legacy post flag as platform-held when any destination is, and writes each destination explicitly', async () => {
    const tx = { $executeRaw: vi.fn(async (..._args: unknown[]) => 1) };
    await storeScheduleModes(tx as never, 'w1', 'p1', new Map([['t1', 'application'], ['t2', 'remote']]));
    const sql = tx.$executeRaw.mock.calls.map(call => (call[0] as unknown as string[]).join('?'));
    expect(sql[0]).toContain('"publishMode"');
    expect(tx.$executeRaw.mock.calls[0]).toContain('native');
    expect(sql.filter(text => text.includes('post_targets'))).toHaveLength(2);
    const none = { $executeRaw: vi.fn(async (..._args: unknown[]) => 1) };
    await storeScheduleModes(none as never, 'w1', 'p1', new Map([['t1', 'application']]));
    expect(none.$executeRaw.mock.calls[0]).toContain('worker');
  });
  it('clears per-destination choices when a post returns to a draft, and null follows the post-level choice', async () => {
    const tx = { $executeRaw: vi.fn(async (..._args: unknown[]) => 1) };
    await clearScheduleModes(tx as never, 'w1', 'p1');
    expect(tx.$executeRaw.mock.calls.map(call => (call[0] as unknown as string[]).join('?')).join('|')).toContain('"scheduleMode" = NULL');
    expect(destinationMode(null, 'remote')).toBe('remote');
    expect(destinationMode('application', 'remote')).toBe('application');
  });
});

describe('REST v1: compose, schedule, reschedule, cancel and queue with a scoped key', () => {
  it('compose accepts scheduleMode and per-destination modes and reports the outcome', async () => {
    const response = await postsRoute.POST(keyed('/api/v1/posts', { confirmation: 'CREATE POST', message: 'Hi', targetIds: ['t1', 't2'], scheduledAt: future, scheduleMode: 'application', destinationScheduleModes: { t1: 'remote' } }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 'post-1', scheduleMode: 'remote', destinationScheduleModes: { t1: 'remote', t2: 'application' }, remoteHold: { held: 1 } });
    expect(svc.createPost).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a' }), expect.objectContaining({ scheduleMode: 'application', destinationScheduleModes: { t1: 'remote' }, scheduledAt: expect.any(Date) }));
  });
  it('compose refuses a scheduling place without a time and an unknown mode', async () => {
    expect((await postsRoute.POST(keyed('/api/v1/posts', { confirmation: 'CREATE POST', message: 'Hi', targetIds: ['t1'], scheduleMode: 'remote' }))).status).toBe(400);
    expect((await postsRoute.POST(keyed('/api/v1/posts', { confirmation: 'CREATE POST', message: 'Hi', targetIds: ['t1'], scheduledAt: future, destinationScheduleModes: { t1: 'platform' } }))).status).toBe(400);
    expect(svc.createPost).not.toHaveBeenCalled();
  });
  it('schedule needs the exact confirmation and passes both choices to the shared service', async () => {
    const refused = await actionRoute.POST(keyed('/api/v1/posts/p1/schedule', { scheduledAt: future, confirmation: 'yes' }), ctx('p1', 'schedule'));
    expect(refused.status).toBe(400); expect(svc.schedulePost).not.toHaveBeenCalled();
    const ok = await actionRoute.POST(keyed('/api/v1/posts/p1/schedule', { scheduledAt: future, scheduleMode: 'remote', destinationScheduleModes: { t1: 'remote' }, confirmation: `SCHEDULE POST p1 ${future}` }), ctx('p1', 'schedule'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ postId: 'p1', status: 'scheduled', scheduleMode: 'remote', mcpAuditRecorded: true });
    expect(svc.schedulePost).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a' }), 'p1', new Date(future), { scheduleMode: 'remote', destinationScheduleModes: { t1: 'remote' } });
  });
  it('reschedule, cancel-schedule and queue use their own exact confirmations', async () => {
    expect((await actionRoute.POST(keyed('/api/v1/posts/p1/reschedule', { scheduledAt: future, confirmation: 'RESCHEDULE POST p1' }), ctx('p1', 'reschedule'))).status).toBe(400);
    expect((await actionRoute.POST(keyed('/api/v1/posts/p1/reschedule', { scheduledAt: future, confirmation: `RESCHEDULE POST p1 ${future}` }), ctx('p1', 'reschedule'))).status).toBe(200);
    expect((await actionRoute.POST(keyed('/api/v1/posts/p1/cancel-schedule', { confirmation: 'CANCEL SCHEDULE other' }), ctx('p1', 'cancel-schedule'))).status).toBe(400);
    expect(svc.cancelScheduledPost).not.toHaveBeenCalled();
    const cancelled = await actionRoute.POST(keyed('/api/v1/posts/p1/cancel-schedule', { confirmation: 'CANCEL SCHEDULE p1' }), ctx('p1', 'cancel-schedule'));
    expect(await cancelled.json()).toMatchObject({ postId: 'p1', status: 'draft' });
    const queued = await actionRoute.POST(keyed('/api/v1/posts/p1/queue', { confirmation: 'QUEUE POST p1', scheduleMode: 'remote' }), ctx('p1', 'queue'));
    expect(queued.status).toBe(200);
    expect(svc.queuePostRequest).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a' }), { confirmation: 'QUEUE POST p1', scheduleMode: 'remote', postId: 'p1' });
    expect(await queued.json()).toMatchObject({ scheduleMode: 'remote', remoteHold: { held: 1 } });
  });
  it('a read-only key, an invalid key and an unknown action never reach the services', async () => {
    state.key = viewer({ 'publishing/posts': { read: true, write: false } });
    expect((await actionRoute.POST(keyed('/api/v1/posts/p1/cancel-schedule', { confirmation: 'CANCEL SCHEDULE p1' }), ctx('p1', 'cancel-schedule'))).status).toBe(403);
    state.key = null;
    expect((await actionRoute.POST(keyed('/api/v1/posts/p1/queue', { confirmation: 'QUEUE POST p1' }), ctx('p1', 'queue'))).status).toBe(401);
    state.key = viewer();
    expect((await actionRoute.POST(keyed('/api/v1/posts/p1/publish', { confirmation: 'PUBLISH POST p1' }), ctx('p1', 'publish'))).status).toBe(404);
    for (const fn of [svc.schedulePost, svc.reschedulePostToInstant, svc.cancelScheduledPost, svc.queuePostRequest]) expect(fn).not.toHaveBeenCalled();
  });
  it('a channel-limited key hands its ceiling to the service as the actor scope', async () => {
    state.key = viewer({ 'publishing/posts': { read: true, write: true } }, { all: false, ids: ['t1'] });
    await actionRoute.POST(keyed('/api/v1/posts/p1/cancel-schedule', { confirmation: 'CANCEL SCHEDULE p1' }), ctx('p1', 'cancel-schedule'));
    expect(svc.cancelScheduledPost).toHaveBeenCalledWith(expect.objectContaining({ allowedTargetIds: ['t1'] }), 'p1');
  });
});

describe('hand-off of automatically scheduled posts to the platform', () => {
  const row = { id: 'p1', authorId: 'u1', workspaceId: 'w1' };
  const access = { permissions: { pageScope: { all: true, ids: [] }, features: { 'publishing/posts': { read: true, write: true } } }, entitlements: {} };
  beforeEach(() => {
    svc.loadPermissions.mockResolvedValue(access.permissions); svc.loadEntitlements.mockResolvedValue(access.entitlements);
    db.$queryRaw.mockResolvedValue([row]);
  });
  it('hands each post over as its author with the author’s current access', async () => {
    svc.hold.mockResolvedValue({ remoteHold: { held: 1, deferred: 0, reasons: [] } });
    expect(await handOffRemoteSchedules('w1')).toEqual({ examined: 1, handedOver: 1, skipped: 0 });
    expect(svc.hold).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, 'p1');
  });
  it('skips an author who lost write access without calling the platform', async () => {
    svc.loadPermissions.mockResolvedValue({ pageScope: { all: true, ids: [] }, features: { 'publishing/posts': { read: true, write: false } } });
    expect(await handOffRemoteSchedules('w1')).toEqual({ examined: 1, handedOver: 0, skipped: 1 });
    expect(svc.hold).not.toHaveBeenCalled();
  });
  it('narrows the actor to a limited author’s channels and counts refusals as skipped', async () => {
    svc.loadPermissions.mockResolvedValue({ ...access.permissions, pageScope: { all: false, ids: ['t1'] } });
    svc.hold.mockRejectedValue(Object.assign(new (await import('../src/lib/operation-error')).OperationError('conflict', 'busy')));
    expect(await handOffRemoteSchedules()).toEqual({ examined: 1, handedOver: 0, skipped: 1 });
    expect(svc.hold).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', allowedTargetIds: ['t1'] }, 'p1');
  });
  it('reads its batch size from the Root setting', async () => {
    state.config['publishing.remoteScheduling.handOffBatch'] = 7;
    db.$queryRaw.mockResolvedValue([]);
    await handOffRemoteSchedules('w1');
    expect(db.$queryRaw.mock.calls[0]).toContain(7);
  });
});

describe('migration', () => {
  it('adds one nullable, constrained column and is pinned in deploy.sh', () => {
    const sql = baselineBlock('20261031100000_rebuild_destination_schedule_mode');
    const script = readFileSync('scripts/deploy.sh', 'utf8');
    expect(sql).toContain('ADD COLUMN "scheduleMode" TEXT;');
    expect(sql).not.toMatch(/NOT NULL|DROP|DELETE|UPDATE/i);
    expect(script).toContain(`BASELINE=${BASELINE_NAME}`);
    expect(script).toContain(`BASELINE_SHA256=${BASELINE_SHA256}`);
  });
});
