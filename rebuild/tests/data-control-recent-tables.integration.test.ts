import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '../generated/client';

const state = vi.hoisted(() => ({ tx: undefined as any }));
vi.mock('../src/server/data', () => ({ prisma: new Proxy({}, { get: (_, key) => state.tx[key] }) }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => Number.MAX_SAFE_INTEGER }));
vi.mock('../src/modules/publishing/server/guard', () => ({ assertPublishingTargetsSettled: vi.fn() }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({ assertInboxDeletionsSettled: vi.fn() }));
const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;

describe.skipIf(!databaseUrl)('recent data-control tables on isolated PostgreSQL', () => {
  let db: PrismaClient;
  beforeAll(() => {
    const u = new URL(databaseUrl!);
    if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || !decodeURIComponent(u.pathname).endsWith('_preview') || u.search) throw new Error('Only isolated loopback preview database without routing overrides permitted.');
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => db?.$disconnect());

  async function fixture(run: (tx: Prisma.TransactionClient, id: string) => Promise<void>) {
    const id = `preview_recent_${randomUUID().replaceAll('-', '')}`;
    const rollback = new Error('Intentional synthetic rollback');
    try {
      await db.$transaction(async tx => {
        state.tx = tx;
        for (const scope of [id, `${id}_foreign`]) {
          await tx.workspace.create({ data: { id: scope, name: 'Synthetic data control', slug: scope, timezone: 'UTC' } });
          await tx.user.create({ data: { id: scope, name: 'Synthetic account', email: `${scope}@example.test`, passwordHash: 'unusable-synthetic-password' } });
          await tx.membership.create({ data: { id: scope, userId: scope, workspaceId: scope, role: 'owner' } });
          await tx.target.create({ data: { id: scope, workspaceId: scope, type: 'page', providerId: scope, name: 'Synthetic channel', enabled: true, canPublish: true, createdAt: new Date() } });
          await tx.$executeRaw`INSERT INTO wordpress_recipe_sources (id,"workspaceId",name,"siteUrl",config) VALUES (${scope},${scope},'Synthetic recipes','https://example.test','{"timezone":"UTC"}'::jsonb)`;
          await tx.$executeRaw`INSERT INTO wordpress_recipe_plans (id,"workspaceId","sourceId","targetId","wpPostId","slotAt",state,title) VALUES (${scope},${scope},${scope},${scope},'42',NOW(),'uncertain','Synthetic recipe')`;
          await tx.$executeRaw`INSERT INTO rebuild_facebook_sync_cursors ("workspaceId","targetId","providerId",kind,cursor) VALUES (${scope},${scope},${scope},'post_history','{"after":"synthetic-next"}'::jsonb)`;
          await tx.$executeRaw`INSERT INTO rebuild_channel_profiles ("targetId",labels) VALUES (${scope},ARRAY['Recipes'])`;
          await tx.$executeRaw`INSERT INTO "OAuthClient" (id,name,"redirectUris") VALUES (${scope},'Synthetic client',ARRAY['https://example.test/callback'])`;
          await tx.$executeRaw`INSERT INTO "OAuthCode" (id,"codeHash","clientId","userId","workspaceId","redirectUri","codeChallenge",scope,"expiresAt") VALUES (${scope},${`synthetic-code-${scope}`},${scope},${scope},${scope},'https://example.test/callback','synthetic-challenge','read',NOW() + interval '1 day')`;
          await tx.$executeRaw`UPDATE users SET theme = 'warm' WHERE id = ${scope}`;
          await tx.appSetting.create({ data: { key: `settings.appearance.user.${scope}.mode`, value: 'dark', encrypted: false, updatedAt: new Date() } });
          await tx.$executeRaw`INSERT INTO person_mcp_keys (id,"userId",name,"tokenHash","tokenPrefix","expiresAt") VALUES (${scope},${scope},'Synthetic credential',${`synthetic-hash-${scope}`},'synthetic',NOW() + interval '1 day')`;
        }
        await run(tx, id);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { state.tx = undefined; }
    expect(await db.workspace.count({ where: { id: { in: [id, `${id}_foreign`] } } })).toBe(0);
    expect(await db.user.count({ where: { id: { in: [id, `${id}_foreign`] } } })).toBe(0);
  }

  it('exports tenant rows and counts, erases under active write gates, and preserves foreign/account data', async () => fixture(async (tx, id) => {
    const { exportWorkspaceData, previewWorkspaceDataDeletion, deleteWorkspaceDatabaseRows } = await import('../src/server/data-control');
    const data = await exportWorkspaceData({ userId: id, workspaceId: id });
    for (const table of ['wordpress_recipe_sources', 'wordpress_recipe_plans', 'rebuild_facebook_sync_cursors']) {
      expect(data.legacyTables[table]).toHaveLength(1);
      expect(data.legacyTables[table][0].workspaceId).toBe(id);
      expect(data.coverage.directlyOwnedLegacyRowCounts[table]).toBe(1);
    }
    expect(data.indirectTables.rebuild_channel_profiles).toEqual([{ targetId: id, labels: ['Recipes'] }]);
    expect(data.indirectTables.OAuthCode).toHaveLength(1);
    expect(data.indirectTables.OAuthCode[0]).toMatchObject({ userId: id, codeHash: '[REDACTED]', codeChallenge: '[REDACTED]' });
    expect(data).not.toHaveProperty('appearance');
    const counts = await previewWorkspaceDataDeletion({ userId: id, workspaceId: id });
    expect(counts).toMatchObject({ 'other:wordpress_recipe_sources': 1, 'other:wordpress_recipe_plans': 1, 'other:rebuild_facebook_sync_cursors': 1, 'indirect:rebuild_channel_profiles': 1 });
    await tx.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId",status,"requestedById","mediaRoot","updatedAt") VALUES (${id},'requested',${id},'/synthetic/recent',NOW())`;
    for (const table of ['wordpress_recipe_sources', 'wordpress_recipe_plans', 'rebuild_facebook_sync_cursors']) {
      await tx.$executeRaw`SAVEPOINT gate_check`;
      await expect(tx.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = NOW() WHERE "workspaceId" = $1`, id)).rejects.toMatchObject({ code: 'P2010', meta: { code: '55000' } });
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT gate_check`;
    }
    await deleteWorkspaceDatabaseRows(tx, id);
    for (const table of ['wordpress_recipe_sources', 'wordpress_recipe_plans', 'rebuild_facebook_sync_cursors']) {
      expect(await tx.$queryRawUnsafe(`SELECT * FROM "${table}" WHERE "workspaceId" = $1`, id)).toEqual([]);
      expect(await tx.$queryRawUnsafe(`SELECT * FROM "${table}" WHERE "workspaceId" = $1`, `${id}_foreign`)).toHaveLength(1);
    }
    expect(await tx.$queryRaw`SELECT * FROM rebuild_channel_profiles WHERE "targetId" = ${id}`).toEqual([]);
    expect(await tx.$queryRaw`SELECT * FROM rebuild_channel_profiles WHERE "targetId" = ${`${id}_foreign`}`).toHaveLength(1);
    expect(await tx.$queryRaw`SELECT id FROM "OAuthCode" WHERE "workspaceId" = ${id}`).toEqual([]);
    expect(await tx.$queryRaw`SELECT id FROM "OAuthCode" WHERE "workspaceId" = ${`${id}_foreign`}`).toHaveLength(1);
    expect(await tx.appSetting.findUnique({ where: { key: `settings.appearance.user.${id}.mode` } })).not.toBeNull();
    expect(await tx.$queryRaw`SELECT id FROM person_mcp_keys WHERE "userId" = ${id}`).toHaveLength(1);
  }));

  it('gates legacy OAuth and indirectly owned profiles for every active purge state', async () => fixture(async (tx, id) => {
    const queries = [
      () => tx.$executeRaw`UPDATE "OAuthCode" SET scope = 'changed' WHERE id = ${id}`,
      () => tx.$executeRaw`UPDATE rebuild_channel_profiles SET labels = ARRAY['Changed'] WHERE "targetId" = ${id}`,
      // BEFORE triggers must run for INSERT too, even if the primary key already exists.
      () => tx.$executeRaw`INSERT INTO rebuild_channel_profiles ("targetId", labels) VALUES (${id},ARRAY['Blocked'])`,
      () => tx.$executeRaw`INSERT INTO "OAuthCode" (id,"codeHash","clientId","userId","workspaceId","redirectUri","codeChallenge",scope,"expiresAt") VALUES (${`${id}_new`},${`${id}_new_hash`},${id},${id},${id},'https://example.test/callback','synthetic','read',NOW() + interval '1 day')`,
    ];
    for (const status of ['requested', 'db_deleted']) {
      await tx.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId",status,"requestedById","mediaRoot","updatedAt") VALUES (${id},${status},${id},'/synthetic/recent',NOW()) ON CONFLICT ("workspaceId") DO UPDATE SET status = EXCLUDED.status`;
      for (const write of queries) {
        await tx.$executeRaw`SAVEPOINT supplementary_gate`;
        await expect(write()).rejects.toMatchObject({ code: 'P2010', meta: { code: '55000' } });
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT supplementary_gate`;
      }
      // A foreign workspace remains writable throughout this purge.
      await tx.$executeRaw`UPDATE "OAuthCode" SET scope = 'read' WHERE id = ${`${id}_foreign`}`;
      await tx.$executeRaw`UPDATE rebuild_channel_profiles SET labels = ARRAY['Foreign'] WHERE "targetId" = ${`${id}_foreign`}`;
    }
    await tx.$executeRaw`UPDATE workspace_data_purges SET status = 'completed' WHERE "workspaceId" = ${id}`;
    await queries[0](); await queries[1](); await queries[3]();
    expect(await tx.$queryRaw`SELECT scope FROM "OAuthCode" WHERE id = ${id}`).toEqual([{ scope: 'changed' }]);
    expect(await tx.$queryRaw`SELECT labels FROM rebuild_channel_profiles WHERE "targetId" = ${id}`).toEqual([{ labels: ['Changed'] }]);
    // No workspace FK exists on legacy codes: the trigger also refuses post-deletion orphans.
    await tx.$executeRaw`SAVEPOINT missing_parent`;
    await expect(tx.$executeRaw`UPDATE "OAuthCode" SET "workspaceId" = ${`${id}_missing`} WHERE id = ${id}`).rejects.toMatchObject({ code: 'P2010', meta: { code: '23503' } });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT missing_parent`;
  }));

  it('exports personal preferences and removes non-FK mode storage with account deletion', async () => fixture(async (tx, id) => {
    const { exportAccountSupplementaryData, deleteAccountSupplementaryData } = await import('../src/server/data-control/account');
    const data = await exportAccountSupplementaryData(tx, id);
    expect(data.appearance).toEqual({ theme: 'warm', mode: 'dark' });
    expect(data.personCredentials).toHaveLength(1);
    expect(data.legacyOauthGrants).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('synthetic-hash');
    await deleteAccountSupplementaryData(tx, id);
    await tx.$executeRaw`DELETE FROM users WHERE id = ${id}`;
    expect(await tx.appSetting.findUnique({ where: { key: `settings.appearance.user.${id}.mode` } })).toBeNull();
    expect(await tx.appSetting.findUnique({ where: { key: `settings.appearance.user.${`${id}_foreign`}.mode` } })).not.toBeNull();
    expect(await tx.$queryRaw`SELECT id FROM person_mcp_keys WHERE "userId" = ${id}`).toEqual([]);
    expect(await tx.$queryRaw`SELECT id FROM "OAuthCode" WHERE "userId" = ${id}`).toEqual([]);
    expect(await tx.$queryRaw`SELECT id FROM "OAuthCode" WHERE "userId" = ${`${id}_foreign`}`).toHaveLength(1);
    expect(await tx.$queryRaw`SELECT id FROM person_mcp_keys WHERE "userId" = ${`${id}_foreign`}`).toHaveLength(1);
    expect(await tx.$queryRaw`SELECT id FROM wordpress_recipe_sources WHERE "workspaceId" = ${id}`).toHaveLength(1);
  }));
});
