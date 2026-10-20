import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

/** Wave 1 services against the guarded loopback `_preview` database; only authority ports are stubbed. */
const url = process.env.REBUILD_PREVIEW_DATABASE_URL;
const shared = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown>, channelIds: [] as string[] }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => {
  const value = shared.client?.[key as string]; return typeof value === 'function' ? value.bind(shared.client) : value;
} }) }));
vi.mock('@/server/data', () => ({ prisma: new Proxy({}, { get: (_t, key) => {
  const value = shared.client?.[key as string]; return typeof value === 'function' ? value.bind(shared.client) : value;
} }) }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: async (actor: unknown) => ({ actor }) }));
vi.mock('../src/modules/publishing/server/access', () => ({ authorizePublishing: async (actor: unknown) => ({ actor }) }));
vi.mock('../src/modules/inbox/server/access', () => ({ authorizeInbox: async () => ({ channelIds: shared.channelIds, channels: [] }) }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: { all: true, ids: [] } }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'inbox.moderationRuleLimit': 50, 'inbox.moderationLogLimit': 100, 'inbox.moderationFreshHours': 48, 'inbox.moderationRunMaxComments': 500, 'inbox.moderationAutoRun': true, 'inbox.moderationAutoWorkspaceLimit': 5000 } as Record<string, unknown>)[key] }));

import { createSavedView, deleteSavedView, listSavedViews } from '../src/modules/publishing/server/saved-views';
import { deleteSavedViewConfirmation } from '../src/modules/publishing/saved-views';
import { performInboxModerationAction, readInboxModeration, runAutomaticInboxModeration } from '../src/modules/inbox/server/moderation';
import { moderationConfirmation } from '../src/modules/inbox/moderation';

function isolated(value: string) {
  const parsed = new URL(value);
  if (process.env.NODE_ENV === 'production' || parsed.port !== '55432' || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')) throw new Error('Only guarded loopback preview databases allowed.');
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!url)('wave 1 services on real PostgreSQL', () => {
  let db: PrismaClient; let actor: { userId: string; workspaceId: string }; let other: string;
  const created = { views: [] as string[], rules: [] as string[], since: new Date() };
  beforeAll(async () => {
    db = isolated(url!); shared.client = db as unknown as Record<string, unknown>;
    const m = await db.$queryRaw<Array<{ userId: string; workspaceId: string }>>`SELECT "userId", "workspaceId" FROM memberships ORDER BY "userId" LIMIT 1`;
    if (!m[0]) throw new Error('The preview database needs its synthetic example membership.');
    actor = m[0];
    const t = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM targets WHERE "workspaceId" = ${actor.workspaceId} ORDER BY id LIMIT 1`;
    shared.channelIds = t.map(r => r.id);
    const o = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id <> ${actor.userId} LIMIT 1`;
    other = o[0]?.id ?? randomUUID();
  });
  afterAll(async () => {
    if (!db) return;
    if (created.views.length) await db.$executeRaw`DELETE FROM saved_views WHERE id = ANY(${created.views}::text[])`;
    if (created.rules.length) await db.$executeRaw`DELETE FROM moderation_rules WHERE id = ANY(${created.rules}::text[])`;
    await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND "actorId" = ${actor.userId} AND action LIKE 'inbox.moderation_rule_%' AND "createdAt" >= ${created.since}`;
    await db.$disconnect();
  });

  it('creates, lists, isolates and deletes a personal saved view', async () => {
    const { view } = await createSavedView(actor, { screen: 'posts', name: 'Wave1 synthetic view', query: 'status=failed' });
    created.views.push(view.id);
    expect(view.href).toContain('/publishing/posts');
    expect((await listSavedViews(actor, { screen: 'posts' })).views.some(v => v.id === view.id)).toBe(true);
    // Another user in the same workspace never sees or removes it.
    expect((await listSavedViews({ ...actor, userId: other }, { screen: 'posts' })).views.some(v => v.id === view.id)).toBe(false);
    await expect(deleteSavedView({ ...actor, userId: other }, { id: view.id, confirmation: deleteSavedViewConfirmation(view.id) })).rejects.toMatchObject({ code: 'not_found' });
    await expect(deleteSavedView(actor, { id: view.id, confirmation: 'wrong' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await deleteSavedView(actor, { id: view.id, confirmation: deleteSavedViewConfirmation(view.id) })).toEqual({ deleted: true, id: view.id });
    const left = await db.$queryRaw<unknown[]>`SELECT id FROM saved_views WHERE id = ${view.id}`;
    expect(left).toHaveLength(0);
  });

  it('creates, updates and deletes a moderation rule with audit rows, and reads the log', async () => {
    if (!shared.channelIds.length) return;
    const rule = { name: 'Wave1 synthetic rule', enabled: false, targetIds: shared.channelIds, match: 'keywords', keywords: ['synthetic-wave1'], action: 'hide', replyText: null, dailyCap: 5, oncePerUser: true };
    const made = await performInboxModerationAction(actor, { action: 'rule.create', rule, confirmation: moderationConfirmation.create(rule.name) });
    if (!('id' in made)) throw new Error('no id');
    created.rules.push(made.id);
    const read = await readInboxModeration(actor);
    expect(read.rules.find(r => r.id === made.id)).toMatchObject({ name: rule.name, keywords: ['synthetic-wave1'], enabled: false });
    expect(Array.isArray(read.log)).toBe(true);
    await performInboxModerationAction(actor, { action: 'rule.update', id: made.id, rule: { ...rule, keywords: ['synthetic-wave1', 'second'] }, confirmation: moderationConfirmation.update(made.id) });
    const row = await db.$queryRaw<Array<{ keywords: string[] }>>`SELECT keywords FROM moderation_rules WHERE id = ${made.id}`;
    expect(row[0]!.keywords).toEqual(['synthetic-wave1', 'second']);
    // Automatic pass after sync: an enabled rule makes its workspace eligible and runs as an active owner.
    await performInboxModerationAction(actor, { action: 'rule.update', id: made.id, rule: { ...rule, enabled: true, keywords: ['synthetic-wave1-never-matches'] }, confirmation: moderationConfirmation.update(made.id) });
    const auto = await runAutomaticInboxModeration(new Date());
    expect(auto.workspaces).toBeGreaterThanOrEqual(1);
    expect(auto.acted).toBe(0);
    await performInboxModerationAction(actor, { action: 'rule.delete', id: made.id, confirmation: moderationConfirmation.remove(made.id) });
    expect(await db.$queryRaw<unknown[]>`SELECT id FROM moderation_rules WHERE id = ${made.id}`).toHaveLength(0);
    const audits = await db.$queryRaw<Array<{ action: string }>>`SELECT action FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND detail->>'ruleId' = ${made.id} ORDER BY "createdAt"`;
    expect(audits.map(a => a.action)).toEqual(['inbox.moderation_rule_created', 'inbox.moderation_rule_updated', 'inbox.moderation_rule_updated', 'inbox.moderation_rule_deleted']);
  });
});
