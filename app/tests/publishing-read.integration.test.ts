import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ platformFor: vi.fn(), authorize: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/platforms/registry', () => ({
  enabledSocialAccountWhere: async () => ({ provider: { in: ['facebook'] } }),
  platformFor: mocked.platformFor,
}));
vi.mock('../src/modules/publishing/server/access', () => ({ authorizePublishing: mocked.authorize }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocked.config }));

import { prisma, listPostPage } from '../src/server/data';
import { publishingPostVisibilityWhere, selectedPublishingTargetIds } from '../src/modules/publishing/server/read-scope';
import { readPublishingPostPage } from '../src/modules/publishing/server/read';
import { PostStatus, PostTargetStatus } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('Publishing selected reads against isolated PostgreSQL', () => {
  let safeDatabaseVerified = false;
  const prefix = `preview_publish_read_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = `${prefix}_workspace`;
  const otherWorkspaceId = `${prefix}_other_workspace`;
  const userId = `${prefix}_user`;
  const otherUserId = `${prefix}_other_user`;
  const accountId = `${prefix}_account`;
  const revokedAccountId = `${prefix}_revoked_account`;
  const targetId = `${prefix}_selected_target`;
  const foreignTargetId = `${prefix}_foreign_target`;
  const expiredTargetId = `${prefix}_expired_target`;
  const disabledTargetId = `${prefix}_disabled_target`;
  const revokedTargetId = `${prefix}_revoked_target`;
  const otherWorkspaceTargetId = `${prefix}_other_workspace_target`;
  const connectedPostIds = [`${prefix}_visible_1`, `${prefix}_visible_2`, `${prefix}_visible_3`];
  const ownDraftId = `${prefix}_own_draft`;
  const otherDraftId = `${prefix}_other_draft`;
  const foreignPostId = `${prefix}_foreign_post`;
  const mixedPostId = `${prefix}_mixed_post`;
  const expiredHistoryId = `${prefix}_expired_history`;

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== databaseUrl) {
      throw new Error('Publishing read integration requires Prisma DATABASE_URL to exactly match the guarded preview URL.');
    }
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Publishing read integration writes require an isolated loopback _preview database.');
    }
    safeDatabaseVerified = true;
    await prisma.user.createMany({ data: [
      { id: userId, email: `${prefix}@example.test`, name: 'Synthetic reader', passwordHash: 'unusable' },
      { id: otherUserId, email: `${prefix}_other@example.test`, name: 'Synthetic other author', passwordHash: 'unusable' },
    ] });
    await prisma.workspace.createMany({ data: [
      { id: workspaceId, name: 'Synthetic read workspace', slug: workspaceId, timezone: 'UTC' },
      { id: otherWorkspaceId, name: 'Synthetic other workspace', slug: otherWorkspaceId, timezone: 'UTC' },
    ] });
    await prisma.socialAccount.create({ data: {
      id: accountId, workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`, name: 'Synthetic expired connection',
      accessToken: 'synthetic-token', scopes: '', tokenExpiresAt: new Date(Date.now() - 86400000),
    } });
    await prisma.socialAccount.create({ data: {
      id: revokedAccountId, workspaceId, provider: 'facebook', providerUserId: `${prefix}_revoked_provider`, name: 'Synthetic revoked connection',
      accessToken: 'synthetic-token', scopes: '', invalidatedAt: new Date(),
    } });
    const now = new Date();
    await prisma.target.createMany({ data: [
      { id: targetId, workspaceId, socialAccountId: accountId, type: 'page', providerId: `${prefix}_page`, name: 'Selected synthetic channel', accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now },
      { id: expiredTargetId, workspaceId, socialAccountId: accountId, type: 'page', providerId: `${prefix}_expired_page`, name: 'Expired synthetic channel', accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now },
      { id: foreignTargetId, workspaceId, type: 'page', providerId: `${prefix}_foreign_page`, name: 'Unselected synthetic channel', accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now },
      { id: disabledTargetId, workspaceId, socialAccountId: accountId, type: 'page', providerId: `${prefix}_disabled_page`, name: 'Disabled synthetic channel', accessToken: 'synthetic-token', enabled: false, canPublish: true, createdAt: now },
      { id: revokedTargetId, workspaceId, socialAccountId: revokedAccountId, type: 'page', providerId: `${prefix}_revoked_page`, name: 'Revoked synthetic channel', accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now },
      { id: otherWorkspaceTargetId, workspaceId: otherWorkspaceId, type: 'page', providerId: `${prefix}_other_workspace_page`, name: 'Other workspace channel', accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now },
    ] });
    const post = (id: string, wId: string, authorId: string, status: PostStatus = PostStatus.published) => ({
      id, workspaceId: wId, authorId, message: `Synthetic ${id}`, status, firstComment: null, media: [], scheduledAt: null,
      publishedAt: now, createdAt: now, updatedAt: now,
    });
    await prisma.post.createMany({ data: [
      ...connectedPostIds.map(id => post(id, workspaceId, userId)),
      post(ownDraftId, workspaceId, userId, 'draft'), post(otherDraftId, workspaceId, otherUserId, 'draft'),
      post(foreignPostId, workspaceId, userId), post(mixedPostId, workspaceId, userId),
      post(expiredHistoryId, workspaceId, userId), post(`${prefix}_cross_tenant`, otherWorkspaceId, userId),
    ] });
    await prisma.postTarget.createMany({ data: [
      ...connectedPostIds.map((id, index) => ({ id: `${prefix}_pt_${index}`, postId: id, targetId, status: PostTargetStatus.published })),
      { id: `${prefix}_pt_foreign`, postId: foreignPostId, targetId: foreignTargetId, status: PostTargetStatus.published },
      { id: `${prefix}_pt_mixed_a`, postId: mixedPostId, targetId, status: PostTargetStatus.published },
      { id: `${prefix}_pt_mixed_b`, postId: mixedPostId, targetId: foreignTargetId, status: PostTargetStatus.published },
      { id: `${prefix}_pt_expired`, postId: expiredHistoryId, targetId: expiredTargetId, status: PostTargetStatus.published },
    ] });
    mocked.platformFor.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => true });
    mocked.config.mockImplementation(async (key: string) => ({
      'publishing.identifierMaxCharacters': 200, 'publishing.postPageSize': 50,
    }[key]));
    mocked.authorize.mockImplementation(async (actor: { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] }) => ({
      actor, role: 'editor', permissions: {}, entitlements: {
        workspaceId: actor.workspaceId, modules: { publishing: true }, features: { 'publishing/posts': true }, platformCapabilities: { facebook: true },
      },
    }));
  });

  afterAll(async () => {
    if (!safeDatabaseVerified) return;
    await prisma.postTarget.deleteMany({ where: { postId: { startsWith: prefix } } });
    await prisma.post.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.target.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.socialAccount.deleteMany({ where: { id: accountId } });
    await prisma.socialAccount.deleteMany({ where: { id: revokedAccountId } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it('applies current selected destination, whole-post, tenant, draft-owner, and count pagination predicates', async () => {
    const where = publishingPostVisibilityWhere(workspaceId, [targetId], userId);
    const first = await listPostPage(workspaceId, 1, 2, [targetId], userId);
    const second = await listPostPage(workspaceId, 2, 2, [targetId], userId);
    const ids = [...first.posts, ...second.posts].map(item => item.id);
    expect(first.total).toBe(4);
    expect(second.total).toBe(4);
    expect(first.pages).toBe(2);
    expect(ids).toContain(ownDraftId);
    expect(ids).not.toContain(otherDraftId);
    expect(ids).not.toContain(foreignPostId);
    expect(ids).not.toContain(mixedPostId);
    expect(ids).not.toContain(`${prefix}_cross_tenant`);
    expect(ids).not.toContain(expiredHistoryId);
    expect(where).toMatchObject({ workspaceId, OR: expect.any(Array) });
  });

  it('keeps expired-connection publication history readable when its channel remains in the current selected scope', async () => {
    const result = await listPostPage(workspaceId, 1, 10, [expiredTargetId], userId);
    expect(result.posts.map(item => item.id)).toContain(expiredHistoryId);
    expect(result.posts.map(item => item.id)).not.toContain(foreignPostId);
  });

  it('resolves only current selected, enabled, publishable, non-revoked channels and intersects caller IDs', async () => {
    const entitlements = {
      workspaceId, modules: { publishing: true }, features: { 'publishing/posts': true }, platformCapabilities: { facebook: true },
    } as never;
    const allGranted = [targetId, expiredTargetId, foreignTargetId, disabledTargetId, revokedTargetId, otherWorkspaceTargetId];
    const selected = await selectedPublishingTargetIds(workspaceId, entitlements, allGranted);
    expect(new Set(selected)).toEqual(new Set([targetId, expiredTargetId]));
    await expect(selectedPublishingTargetIds(workspaceId, entitlements, [foreignTargetId, disabledTargetId, revokedTargetId, otherWorkspaceTargetId])).resolves.toEqual([]);
    await expect(selectedPublishingTargetIds(`${workspaceId}_wrong`, entitlements, allGranted)).resolves.toEqual([]);
  });

  it('uses the real selected-channel resolver from the shared read service for posts and counts', async () => {
    const result = await readPublishingPostPage({ userId, workspaceId, allowedTargetIds: [targetId] });
    expect(result.total).toBe(4);
    expect(result.posts.map(item => item.id)).toEqual(expect.arrayContaining([ownDraftId, ...connectedPostIds]));
    expect(result.posts.map(item => item.id)).not.toContain(foreignPostId);
    expect(result.posts.map(item => item.id)).not.toContain(mixedPostId);
    const noChannelAccess = await readPublishingPostPage({ userId: otherUserId, workspaceId, allowedTargetIds: [foreignTargetId] });
    expect(noChannelAccess.total).toBe(1);
    expect(noChannelAccess.posts.map(item => item.id)).toEqual([otherDraftId]);
  });
});
