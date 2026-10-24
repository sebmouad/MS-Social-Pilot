import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  auth: vi.fn(), lock: vi.fn(), read: vi.fn(), source: vi.fn(), query: vi.fn(), txQuery: vi.fn(),
  find: vi.fn(), update: vi.fn(), override: vi.fn(), audit: vi.fn(), guard: vi.fn(), config: vi.fn(), settings: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: m.query } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config, runtimeSecret: m.config }));
vi.mock('@/modules/publishing/server/guard', () => ({ withPublishingOperation: m.guard, withPublishingTransaction: async (_signal: unknown, fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.txQuery, $executeRaw: m.override, post: { findFirst: m.find, updateMany: m.update } }) }));
vi.mock('../src/modules/feeds/server/access', () => ({ authorizeFeedWrite: m.auth }));
vi.mock('../src/modules/feeds/server/core', () => ({
  bad: async () => new Error('refused'), lockActor: m.lock, audit: m.audit,
  transact: async (_w: string, _limits: unknown, fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.txQuery, post: { findFirst: m.find, updateMany: m.update }, postTarget: { update: m.override } }),
}));
vi.mock('../src/modules/feeds/server/wordpress-settings', () => ({ loadWordpressSettings: m.settings, patchLimits: () => ({}) }));
vi.mock('../src/modules/feeds/server/wordpress-store', () => ({ selectSource: m.source }));
vi.mock('../src/modules/feeds/wordpress/recipe', () => ({ resolveConfig: () => ({ mapping: {} }) }));
vi.mock('../src/modules/feeds/wordpress/db', () => ({ readWordpressCaption: m.read }));
import { captionRepairProposal, repairPlannedRecipeCaption } from '../src/modules/feeds/wordpress/caption-repair';
const actor = { userId: 'owner', workspaceId: 'workspace' };
const previewId = 'd17a852d-c07a-4e82-8dab-d4232836877b';
let receipt: Record<string, unknown> | null;
let post: Record<string, any>;
let identities: { id: string }[];
let attempts: { id: string }[];
const sql = (parts: TemplateStringsArray) => parts.join('?');
beforeEach(() => {
  vi.clearAllMocks(); receipt = null; identities = [{ id: 'plan' }]; attempts = [];
  m.auth.mockResolvedValue({ role: 'owner', workspaceWide: true });
  m.lock.mockImplementation(m.auth);
  m.guard.mockImplementation(async (_a, _o, fn) => fn({ signal: new AbortController().signal }));
  m.source.mockResolvedValue({ id: 'source', config: {}, updatedAt: new Date('2026-01-01Z') });
  m.query.mockResolvedValue([{ id: 'plan', wpPostId: '123', targetId: 'channel' }]);
  m.read.mockResolvedValue('Salade fraîche&#8239;: 10 g ce soir&nbsp;?');
  m.settings.mockResolvedValue({ defaults: {}, tablePrefix: 'wp_', db: {}, transaction: { timeoutMs: 1000, maxWaitMs: 1000 } });
  m.config.mockImplementation(async key => key === 'feeds.wordpress.databaseUrl' ? 'mysql://read-only' : 10000);
  post = { id: 'post', message: 'Salade fraîche0: 10 g ce soir0?', status: 'scheduled', publishedAt: null, scheduledAt: new Date('2099-01-01Z'), updatedAt: new Date('2026-01-01Z'), targets: [{ id: 'pt', targetId: 'channel', messageOverride: null, status: 'pending', attempts: 0, lockedAt: null, lockedBy: null, remotePostId: null, remoteUrl: null, publishedAt: null, nativeScheduledFor: null, updatedAt: new Date('2026-01-01Z') }] };
  m.find.mockImplementation(async () => post);
  m.update.mockResolvedValue({ count: 1 });
  m.override.mockResolvedValue(1);
  m.txQuery.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const q = sql(parts);
    if (q.includes('FROM wordpress_recipe_plans')) return identities;
    if (q.includes('FROM post_targets')) return post.targets;
    if (q.includes('FROM rebuild_publication_attempts')) return attempts;
    if (q.includes('FROM activity_logs')) return receipt && values.includes(receipt.previewId) && values.includes(receipt.reviewHash) ? [{ id: 'audit' }] : [];
    throw new Error(q);
  });
  m.audit.mockImplementation(async (_tx, _w, _a, action, detail) => {
    if (action === 'feeds.recipe_caption_repair_preview') receipt = detail;
  });
});
const preview = () => repairPlannedRecipeCaption(actor, { postId: 'post' });
const apply = (id: string = receipt?.previewId as string) => repairPlannedRecipeCaption(actor, { postId: 'post', dryRun: false, previewId: id, confirmation: `REPAIR RECIPE CAPTION ${id}` });

describe('source-backed caption proposals', () => {
  it('changes only the exact source-proven space damage and retains legitimate zeroes', () => {
    expect(captionRepairProposal('10 g0: prêt0?', '10 g&#8239;: prêt&nbsp;?')).toBe('10 g\u202f: prêt\u00a0?');
    expect(captionRepairProposal('10 g\u202f: prêt0?', '10 g&#8239;: prêt&nbsp;?')).toBe('10 g\u202f: prêt\u00a0?');
    expect(captionRepairProposal('10 g&#8239;: prêt&nbsp;?', '10 g&#8239;: prêt&nbsp;?')).toBe('10 g\u202f: prêt\u00a0?');
    expect(captionRepairProposal('100: prêt0?', '10 g&#8239;: prêt&nbsp;?')).toBeNull();
    expect(captionRepairProposal('10:30 ce soir0?', '10:30 ce soir0?')).toBeNull();
  });
});
describe('audited planned-caption repair service', () => {
  it('defaults to dry-run with a review receipt, without updating content or logging captions', async () => {
    expect(await preview()).toMatchObject({ dryRun: true, changed: false, before: post.message, after: 'Salade fraîche\u202f: 10 g ce soir\u00a0?' });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.override).not.toHaveBeenCalled();
    expect(JSON.stringify(receipt)).not.toContain('Salade');
    expect(m.guard).toHaveBeenCalledWith(actor, { postId: 'post' }, expect.any(Function));
    expect(m.txQuery.mock.calls.some(c => sql(c[0]).includes('FOR UPDATE OF l, s'))).toBe(true);
  });
  it('requires a real preview and exact confirmation before applying and auditing atomically', async () => {
    await expect(apply(previewId)).rejects.toThrow('refused');
    await preview();
    await expect(repairPlannedRecipeCaption(actor, { postId: 'post', dryRun: false, previewId: receipt?.previewId, confirmation: 'yes' })).rejects.toThrow('refused');
    expect(await apply()).toMatchObject({ dryRun: false, changed: true, postId: 'post' });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'workspace', message: post.message, status: 'scheduled' }), data: { message: 'Salade fraîche\u202f: 10 g ce soir\u00a0?' } }));
    expect(m.audit.mock.calls.at(-1)?.[3]).toBe('feeds.recipe_caption_repaired');
  });
  it('repairs a destination override only when it exactly mirrors the original message', async () => {
    post.targets[0].messageOverride = post.message;
    await preview(); await apply();
    expect(sql(m.override.mock.calls[0][0])).toContain('UPDATE post_targets');
    expect(m.override.mock.calls[0]).toContain('Salade fraîche\u202f: 10 g ce soir\u00a0?');
  });
  it.each([
    ['published', () => { post.status = 'published'; }],
    ['due', () => { post.scheduledAt = new Date('2000-01-01Z'); }],
    ['published receipt', () => { post.targets[0].publishedAt = new Date(); }],
    ['native hold', () => { post.targets[0].status = 'scheduled_remote'; }],
    ['remote identity', () => { post.targets[0].remotePostId = 'remote'; }],
    ['claimed', () => { post.targets[0].lockedBy = 'worker'; }],
    ['attempted', () => { post.targets[0].attempts = 1; }],
    ['journal', () => { attempts = [{ id: 'attempt' }]; }],
    ['override edit', () => { post.targets[0].messageOverride = 'Edited'; }],
    ['multiple destinations', () => { post.targets.push({ ...post.targets[0], targetId: 'other' }); }],
    ['stale identity', () => { identities = []; }],
  ])('refuses %s posts', async (_name, mutate) => {
    mutate(); await expect(preview()).rejects.toThrow('refused'); expect(m.update).not.toHaveBeenCalled();
  });
  it('invalidates review when stored content or the authoritative source changes', async () => {
    await preview();
    post.updatedAt = new Date('2026-02-01Z');
    await expect(apply()).rejects.toThrow('refused');
    post.updatedAt = new Date('2026-01-01Z');
    m.read.mockResolvedValue('Different recipe');
    expect(await apply()).toMatchObject({ changed: false, reason: 'source_mismatch' });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('refuses missing and ambiguous WordPress captions', async () => {
    m.read.mockResolvedValue(null);
    await expect(preview()).rejects.toThrow('refused');
  });
  it('does not guess at customer edits and is idempotent on corrected captions', async () => {
    post.message = 'Customer edit0?';
    expect(await preview()).toMatchObject({ changed: false, reason: 'source_mismatch' });
    post.message = 'Salade fraîche\u202f: 10 g ce soir\u00a0?';
    expect(await preview()).toMatchObject({ changed: false, reason: 'unchanged' });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('refuses limited members, revoked authority, cross-workspace identity and lost update races', async () => {
    m.auth.mockResolvedValueOnce({ role: 'owner', workspaceWide: false });
    await expect(preview()).rejects.toThrow('refused');
    m.lock.mockResolvedValueOnce({ role: 'viewer', workspaceWide: true });
    await expect(preview()).rejects.toThrow('refused');
    m.query.mockResolvedValueOnce([]);
    await expect(preview()).rejects.toThrow('refused');
    await preview(); m.update.mockResolvedValue({ count: 0 });
    await expect(apply()).rejects.toThrow('refused');
  });
  it('propagates an audit failure so the transaction cannot commit unaudited writes', async () => {
    await preview();
    m.audit.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(apply()).rejects.toThrow('audit unavailable');
  });
});
