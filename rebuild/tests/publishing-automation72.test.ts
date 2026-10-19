import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: {
    role: 'admin', post: null as any, policy: { timezone: 'UTC', requiresApproval: true },
    formats: ['post', 'synthetic-module-format'].map(id => ({ id, label: id, media: { kinds: ['image', 'video'], maxImages: 4, maxVideos: 4, mixedKinds: true, linkWithMedia: true, imageAltText: true }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } })),
    stored: { format: 'post', approvalStatus: 'approved', firstCommentDelayMinutes: 0 },
    targets: [{ id: 't1', accessToken: 'credential', socialAccount: { provider: 'facebook', invalidatedAt: null, tokenExpiresAt: null, scopes: [] } }] as any[],
    credential: true, capability: true, targetValidation: true, allowedTargetIds: undefined as string[] | undefined, collision: false, badLabels: [] as any[],
    updateCount: 1, metadataCount: 1, advisoryLock: true, jobProviders: [] as any[],
    jobAccess: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    executeRaw: vi.fn(), queryRaw: vi.fn(), capturedRecycle: null as any, capturedMix: null as any,
  },
  recordVersion: vi.fn(), loadRetention: vi.fn(),
  runRecycle: vi.fn(), runMix: vi.fn(),
}));

vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'publishing.maxFirstCommentDelayMinutes' ? 10080 : undefined }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: (...args: any[]) => h.state.queryRaw(...args) } }));
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: (...args: any[]) => h.state.jobAccess(...args) }));
vi.mock('@/server/entitlements', () => ({ hasPlatformCapability: () => h.state.capability }));
vi.mock('@/server/platforms/registry', () => ({ platformFor: async () => ({ publish: vi.fn(), publishingFormats: h.state.formats, defaultPublishingFormatId: 'post' }) }));
vi.mock('@/server/platforms/resource-lock', () => ({ lockSelectedResources: vi.fn() }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: vi.fn(async () => {}) }));
vi.mock('@/modules/publishing/server/guard', () => ({ lockPublishingTargets: vi.fn() }));
vi.mock('@/modules/publishing/server/credentials', () => ({ readPublishingCredential: () => h.state.credential ? {} : null }));
vi.mock('@/modules/publishing/server/publication-guard', () => ({ assertPublicationAttemptsSettled: vi.fn() }));
vi.mock('@/modules/publishing/server/post-deletion-guard', () => ({ assertNoPendingPostDeletionForAliases: vi.fn() }));
vi.mock('@/modules/publishing/collaboration/server/core', () => ({ lockActor: async (tx: unknown, actor: any) => ({ actor: h.state.allowedTargetIds === undefined ? actor : { ...actor, allowedTargetIds: h.state.allowedTargetIds }, role: h.state.role, entitlements: {} }) }));
vi.mock('@/modules/publishing/collaboration/server/versions', () => ({
  loadVersionRetention: () => h.loadRetention(), recordPostVersion: (...args: any[]) => h.recordVersion(...args),
}));
vi.mock('@/modules/publishing/collaboration/server/executors', () => ({
  runRecycleCycle: (options: any) => { h.state.capturedRecycle = options; return h.runRecycle(options); },
  runContentMix: (options: any) => { h.state.capturedMix = options; return h.runMix(options); },
}));
vi.mock('@/modules/publishing/server/lifecycle', () => ({
  limits: async () => ({ maxMedia: 10, maxAlt: 500, maxText: 5000, maxTargets: 20 }),
  validatePostAttachments: () => ({ link: null, media: [] }),
  validatePostContent: (text: string) => text,
  validFirstComment: () => '',
  resolvePublishMedia: async (_workspaceId: string, media: unknown) => media,
  validateTargets: async (actor: any, ids: string[]) => {
    if (!h.state.targetValidation || (actor.allowedTargetIds !== undefined && ids.some(id => !actor.allowedTargetIds.includes(id)))) throw new OperationError('conflict', 'target validation refused');
    const destinations = ids.map(id => h.state.targets.find(target => target.id === id)).filter(Boolean);
    if (destinations.length !== ids.length) throw new OperationError('conflict', 'target validation refused');
    return destinations;
  },
}));

import { OperationError } from '../src/lib/operation-error';
import { authorizePublishing } from '../src/modules/publishing/server/access';
import { publishingAutomationLifecycle, runPublishingMix, runPublishingRecycle } from '@/modules/publishing/server/automation';

function post(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'source1', workspaceId: 'w1', authorId: 'author1', message: 'Original', firstComment: null,
    link: null, media: [], status, publishedAt: status === 'published' ? new Date('2026-01-01T00:00:00Z') : null,
    targets: [{ id: 'pt1', targetId: 't1', formatId: null, status: 'pending', remotePostId: null }], ...overrides,
  };
}

function makeTx() {
  const tx: any = {
    $queryRaw: h.state.queryRaw,
    $executeRaw: h.state.executeRaw,
    post: {
      findFirst: h.state.findFirst,
      findMany: h.state.findMany,
      findUnique: h.state.findUnique,
      create: h.state.create,
      updateMany: h.state.updateMany,
    },
    target: { findMany: h.state.findMany },
  };
  return tx;
}

const later = () => new Date(Date.now() + 60_000);
const recycleInput = (overrides: Record<string, unknown> = {}) => ({ workspaceId: 'w1', sourcePostId: 'source1', copyId: 'copy1', message: 'Original', scheduledAt: later(), run: 1, ...overrides });
const scheduleInput = (overrides: Record<string, unknown> = {}) => ({ workspaceId: 'w1', postId: 'draft1', scheduledAt: later(), timeZone: 'UTC', ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h.state, {
    role: 'admin', post: post('published'), policy: { timezone: 'UTC', requiresApproval: true },
    stored: { format: 'post', approvalStatus: 'approved', firstCommentDelayMinutes: 0 },
    targets: [{ id: 't1', accessToken: 'credential', socialAccount: { provider: 'facebook', invalidatedAt: null, tokenExpiresAt: null, scopes: [] } }],
    credential: true, capability: true, targetValidation: true, allowedTargetIds: undefined, collision: false, badLabels: [], updateCount: 1,
    metadataCount: 1, advisoryLock: true, jobProviders: [], capturedRecycle: null, capturedMix: null,
  });
  h.state.queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: h.state.advisoryLock }];
    if (sql.includes('SELECT timezone, "requiresApproval"')) return [h.state.policy];
    if (sql.includes('SELECT format, "approvalStatus"')) return [h.state.stored];
    if (sql.includes('SELECT pl."labelId"')) return h.state.badLabels;
    if (sql.includes('SELECT DISTINCT sa.provider')) return h.state.jobProviders;
    return [];
  });
  h.state.executeRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('UPDATE posts SET timezone=')) return h.state.metadataCount;
    return 1;
  });
  h.state.findFirst.mockImplementation(async () => h.state.post);
  h.state.findMany.mockImplementation(async () => h.state.targets);
  h.state.findUnique.mockImplementation(async () => h.state.collision ? { id: 'copy1' } : null);
  h.state.create.mockImplementation(async () => ({ id: 'copy1' }));
  h.state.updateMany.mockImplementation(async () => ({ count: h.state.updateCount }));
  h.state.jobAccess.mockReset(); h.state.jobAccess.mockImplementation(async () => {});
  h.loadRetention.mockResolvedValue(5);
});

describe('Publishing automatic lifecycle', () => {
  it('refuses a current author without publishing authority before writes', async () => {
    h.state.role = 'contributor';
    vi.mocked(authorizePublishing).mockRejectedValueOnce(new OperationError('forbidden', 'denied'));
    await expect(publishingAutomationLifecycle.recycle(makeTx(), recycleInput())).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.state.create).not.toHaveBeenCalled(); expect(h.state.executeRaw).not.toHaveBeenCalled();
    expect(h.recordVersion).not.toHaveBeenCalled();
  });

  it('refuses a workspace whose owner qualification fails before writes', async () => {
    h.state.jobAccess.mockRejectedValueOnce(new OperationError('forbidden', 'owner qualification denied'));
    await expect(publishingAutomationLifecycle.recycle(makeTx(), recycleInput())).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.state.create).not.toHaveBeenCalled(); expect(h.state.executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['provider capability missing', () => { h.state.capability = false; }],
    ['publishing credential missing', () => { h.state.credential = false; }],
    ['destination scope incomplete', () => { h.state.targets = []; }],
    ['destination outside current author scope', () => { h.state.allowedTargetIds = []; }],
  ])('refuses automation when %s', async (_label, setup) => {
    setup();
    await expect(publishingAutomationLifecycle.recycle(makeTx(), recycleInput())).rejects.toMatchObject({ code: 'conflict' });
    expect(h.state.create).not.toHaveBeenCalled(); expect(h.state.executeRaw).not.toHaveBeenCalled();
  });

  it('refuses an unapproved mix draft without writing history or post state', async () => {
    h.state.post = post('draft'); h.state.role = 'contributor';
    h.state.stored = { format: 'post', approvalStatus: 'not_required', firstCommentDelayMinutes: 0 };
    await expect(publishingAutomationLifecycle.schedule(makeTx(), scheduleInput())).rejects.toMatchObject({ code: 'conflict' });
    expect(h.state.updateMany).not.toHaveBeenCalled(); expect(h.state.executeRaw).not.toHaveBeenCalled(); expect(h.recordVersion).not.toHaveBeenCalled();
  });

  it('records versions and audit for an approved mix draft, and refuses a failed affected-row update before audit', async () => {
    h.state.post = post('draft', { id: 'draft1' });
    expect(await publishingAutomationLifecycle.schedule(makeTx(), scheduleInput())).toBe(true);
    expect(h.recordVersion).toHaveBeenCalledTimes(2);
    expect(h.state.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'draft1', workspaceId: 'w1', status: 'draft' }) }));
    expect(h.state.executeRaw).toHaveBeenCalledTimes(2); // schedule metadata and system audit

    vi.clearAllMocks(); h.state.updateCount = 0;
    await expect(publishingAutomationLifecycle.schedule(makeTx(), scheduleInput())).rejects.toMatchObject({ code: 'conflict' });
    expect(h.state.executeRaw).not.toHaveBeenCalled(); expect(h.recordVersion).toHaveBeenCalledTimes(1);
  });

  it('holds changed recycle wording for approval and retains approval for unchanged reviewed wording', async () => {
    await publishingAutomationLifecycle.recycle(makeTx(), recycleInput({ message: 'Edited variant' }));
    const changed = h.state.create.mock.calls[0]![0].data;
    expect(changed.status).toBe('pending_approval');
    expect(h.state.executeRaw.mock.calls[0]![0].join('?')).toContain('"approvalStatus"');
    expect(h.state.executeRaw.mock.calls[0]).toContain('pending');
    expect(JSON.parse(h.state.executeRaw.mock.calls[2]![4] as string)).toMatchObject({ approvalRequired: true });

    vi.clearAllMocks(); await publishingAutomationLifecycle.recycle(makeTx(), recycleInput());
    expect(h.state.create.mock.calls[0]![0].data.status).toBe('scheduled');
    expect(h.state.executeRaw.mock.calls[0]).toContain('approved');
  });

  it('accepts and stores a supported destination format that differs from legacy post format', async () => {
    h.state.stored = { format: 'post', approvalStatus: 'approved', firstCommentDelayMinutes: 0 };
    h.state.post = post('published', { targets: [{ id: 'pt1', targetId: 't1', formatId: 'synthetic-module-format', status: 'pending', remotePostId: null }] });
    await expect(publishingAutomationLifecycle.recycle(makeTx(), recycleInput())).resolves.toBe(true);
    expect(h.state.create.mock.calls[0]![0].data.targets.create).toEqual([
      expect.objectContaining({ targetId: 't1', formatId: 'synthetic-module-format', status: 'pending' }),
    ]);
  });

  it.each([-1, 10081])('refuses recycle with delay %s outside the current bound', async delay => {
    h.state.stored.firstCommentDelayMinutes = delay;
    await expect(publishingAutomationLifecycle.recycle(makeTx(), recycleInput())).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.state.create).not.toHaveBeenCalled(); expect(h.recordVersion).not.toHaveBeenCalled();
  });

  it('preserves the requested delay in recycled posts', async () => {
    h.state.stored.firstCommentDelayMinutes = 10;
    await publishingAutomationLifecycle.recycle(makeTx(), recycleInput());
    expect(h.state.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ firstCommentDelayMinutes: 10 }) }));
  });

  it('refuses a deterministic copy collision before creation', async () => {
    h.state.collision = true;
    await expect(publishingAutomationLifecycle.recycle(makeTx(), recycleInput())).rejects.toMatchObject({ code: 'conflict' });
    expect(h.state.create).not.toHaveBeenCalled(); expect(h.state.executeRaw).not.toHaveBeenCalled();
  });

  it('declines stopping when a destination was reenabled after resource locks, without writes', async () => {
    h.state.targets = [{ enabled: true, socialAccount: { provider: 'facebook' } }];
    await expect(publishingAutomationLifecycle.stop(makeTx(), { workspaceId: 'w1', sourcePostId: 'source1', reason: 'no_active_destinations' })).resolves.toBe(false);
    expect(authorizePublishing).toHaveBeenCalledWith(expect.objectContaining({ userId: 'author1', workspaceId: 'w1' }), 'publishing/posts', 'write');
    expect(h.state.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'w1', id: { in: ['t1'] } } }));
    expect(h.state.executeRaw).not.toHaveBeenCalled(); expect(h.state.create).not.toHaveBeenCalled(); expect(h.recordVersion).not.toHaveBeenCalled();
  });

  it('allows stopping all-disabled destinations only after current author and provider owner checks', async () => {
    h.state.targets = [{ enabled: false, socialAccount: { provider: 'facebook' } }];
    await expect(publishingAutomationLifecycle.stop(makeTx(), { workspaceId: 'w1', sourcePostId: 'source1', reason: 'no_active_destinations' })).resolves.toBe(true);
    expect(authorizePublishing).toHaveBeenCalledWith(expect.objectContaining({ userId: 'author1', workspaceId: 'w1' }), 'publishing/posts', 'write');
    expect(h.state.jobAccess).toHaveBeenCalledWith('w1', { provider: 'facebook', anyFeatureOf: ['publishing/collaboration'] });
    expect(h.state.executeRaw).not.toHaveBeenCalled(); expect(h.state.create).not.toHaveBeenCalled(); expect(h.recordVersion).not.toHaveBeenCalled();
  });

  it('rejects a foreign label relation before history or audit', async () => {
    h.state.badLabels = [{ labelId: 'foreign-label' }];
    await expect(publishingAutomationLifecycle.recycle(makeTx(), recycleInput())).rejects.toMatchObject({ code: 'conflict' });
    expect(h.state.create).toHaveBeenCalledTimes(1);
    expect(h.recordVersion).not.toHaveBeenCalled();
    expect(h.state.executeRaw).toHaveBeenCalledTimes(1); // scoped post metadata; enclosing transaction rolls it back
  });

  it('passes lifecycle callbacks and current workspace eligibility hooks to worker runners', async () => {
    h.runRecycle.mockResolvedValue({ checked: 0 }); h.runMix.mockResolvedValue({ workspaces: 0 });
    await runPublishingRecycle(later()); await runPublishingMix(later());
    expect(h.state.capturedRecycle.lifecycle.recycle).toBe(publishingAutomationLifecycle.recycle);
    expect(h.state.capturedMix.lifecycle.schedule).toBe(publishingAutomationLifecycle.schedule);
    h.state.jobProviders = [{ provider: 'facebook' }];
    await expect(h.state.capturedRecycle.eligible('w1')).resolves.toBe(true);
    expect(h.state.jobAccess).toHaveBeenCalledWith('w1', { provider: 'facebook', anyFeatureOf: ['publishing/collaboration'] });
    h.state.jobAccess.mockRejectedValueOnce(new OperationError('forbidden', 'owner unqualified'));
    await expect(h.state.capturedMix.eligible('w1')).resolves.toBe(false);
    expect(h.state.jobAccess).toHaveBeenLastCalledWith('w1', { provider: 'facebook', anyFeatureOf: ['publishing/queue'] });
    const scans = h.state.queryRaw.mock.calls.filter((call: any[]) => call[0].join('?').includes('SELECT DISTINCT sa.provider'));
    expect(scans[0]![3]).toBe(true); // recycle cleanup can qualify through disabled destinations
    expect(scans[1]![3]).toBe(false); // mix only considers enabled publishing destinations
  });
});
