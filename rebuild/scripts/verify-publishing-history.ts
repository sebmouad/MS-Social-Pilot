/** Guarded synthetic-only localhost/PostgreSQL/MCP verification for Publishing post history and restore. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new ProbeFailure(message); }
let stage = 'preview guards';
const settingKeys = [
  'mcp.enabled', 'mcp.authenticatedRoles', 'platforms.facebook.enabled',
  'entitlements.features.publishing/posts', 'entitlements.features.publishing/collaboration', 'entitlements.features.publishing/labels',
  'publishing.collab.versionPageSize', 'publishing.collab.versionRetention',
] as const;
type SavedSetting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required; production is refused.');
  const database = new URL(databaseUrl), previewOrigin = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only an isolated loopback PostgreSQL database ending in _preview is allowed.');
  check(previewOrigin.origin === origin && previewOrigin.protocol === 'http:' && previewOrigin.hostname === 'localhost' && previewOrigin.port === '3200', 'Only the explicit localhost:3200 HTTP preview origin is allowed.');

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_history_${randomUUID().replaceAll('-', '')}`;
  const workspaceA = `${prefix}_a`, workspaceB = `${prefix}_b`, userId = `${prefix}_owner`, sessionId = `${prefix}_session`;
  const postId = `${prefix}_post`, foreignPostId = `${prefix}_foreign`, publishedPostId = `${prefix}_published`, labelId = `${prefix}_label`;
  const targetId = `${prefix}_target`, socialId = `${prefix}_social`, readKeyId = `${prefix}_read_key`, writeKeyId = `${prefix}_write_key`;
  const sessionToken = randomBytes(32).toString('base64url');
  const readBearer = `mcp_${randomBytes(32).toString('base64url')}`, writeBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const cookie = `msp_session=${sessionToken}; sp_workspace=${workspaceA}`;
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const settings = new Map<string, SavedSetting | null>();
  const priorRootAuditIds = new Set<string>();
  let settingsCaptured = false, rootWrites = false, fixtureStarted = false;
  const generatedAuditIds = new Set<string>();
  let labelCreated = false;

  async function json(response: Response): Promise<any> { try { return await response.json(); } catch { return null; } }
  async function http(path: string, method = 'GET', body?: unknown, workspace = workspaceA) {
    return fetch(new URL(path, previewOrigin), { method, redirect: 'manual', headers: {
      origin: previewOrigin.origin, cookie: `msp_session=${sessionToken}; sp_workspace=${workspace}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function mcp(name: string, args: unknown = {}, bearer = readBearer) {
    const response = await fetch(new URL('/api/mcp?scope=workspace', previewOrigin), { method: 'POST', redirect: 'manual', headers: {
      origin: previewOrigin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    return { response, body: await json(response) };
  }
  async function saveSetting(key: string, value: unknown) {
    rootWrites = true;
    const response = await http('/api/root/config', 'PUT', { key, value });
    const body = await json(response);
    check(response.ok && body?.schemaVersion === CONFIG_SCHEMA_VERSION, `Root setting ${key} did not apply the current schema.`);
  }
  async function storedPost(id: string) {
    return (await db.$queryRaw<Array<{ id: string; workspaceId: string; message: string; firstComment: string | null; link: string | null; media: any; status: string; publishedAt: Date | null; approvalStatus: string; reviewedById: string | null; reviewedAt: Date | null; reviewNote: string | null }>>`
      SELECT id, "workspaceId", message, "firstComment", link, media, status::text AS status, "publishedAt", "approvalStatus"::text AS "approvalStatus", "reviewedById", "reviewedAt", "reviewNote" FROM posts WHERE id=${id}`)[0] ?? null;
  }
  async function restoreViaHttp(id: string, versionId: string) {
    return http('/api/publishing/versions', 'POST', { postId: id, versionId, confirmation: `RESTORE VERSION ${versionId}` });
  }
  async function updateViaMcp(id: string, content: { message: string; firstComment: string; link?: string; media: unknown[] }) {
    return mcp('update_post', { postId: id, ...content, targetIds: [targetId], confirmation: `UPDATE POST ${id}` }, writeBearer);
  }

  try {
    stage = 'preview preflight and exact Root-setting capture';
    const requiredTables = ['workspaces', 'users', 'memberships', 'sessions', 'mcp_api_keys', 'app_settings', 'root_activities', 'activity_logs', 'social_accounts', 'targets', 'labels', 'posts', 'post_targets', 'post_labels', 'post_versions'];
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY(${requiredTables}::text[])`;
    check(tables.length === requiredTables.length, `Required preview tables are unavailable (${tables.length}/${requiredTables.length}); no fixtures were written.`);
    const preflight = await fetch(new URL('/sign-in', previewOrigin), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    check(preflight.status < 500 && new URL(preflight.url).origin === previewOrigin.origin, 'Expected localhost preview is not responding.');
    const original = await db.appSetting.findMany({ where: { key: { in: [...settingKeys] } }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
    for (const key of settingKeys) {
      const row = original.find(item => item.key === key) ?? null;
      check(!row || !row.encrypted, `Root setting ${key} unexpectedly contains encrypted data.`);
      settings.set(key, row);
    }
    settingsCaptured = true;
    const existingAudits = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;
    existingAudits.forEach(row => priorRootAuditIds.add(row.id));

    stage = 'create synthetic Root owner, two workspaces, Facebook channel, label and MCP keys';
    fixtureStarted = true;
    await db.user.create({ data: { id: userId, email: `${userId}@example.test`, name: 'Disposable history verification owner', passwordHash: 'unusable-preview-password', isInstanceOwner: true, totpEnabledAt: new Date() } });
    for (const [index, workspaceId] of [workspaceA, workspaceB].entries()) {
      await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: `Disposable history workspace ${index ? 'B' : 'A'}`, timezone: 'UTC' } });
      await db.membership.create({ data: { id: `${prefix}_membership_${index}`, userId, workspaceId, role: 'owner' } });
    }
    await db.session.create({ data: { id: sessionId, userId, tokenHash: hashLegacySessionToken(sessionToken)!, expiresAt, pending: null } });
    await db.socialAccount.create({ data: { id: socialId, workspaceId: workspaceA, provider: 'facebook', providerUserId: `${prefix}_provider`, name: 'Disposable Facebook channel', accessToken: 'synthetic-no-credential', scopes: 'pages_manage_posts' } });
    await db.target.create({ data: { id: targetId, workspaceId: workspaceA, socialAccountId: socialId, type: 'page', providerId: `${prefix}_page`, name: 'Disposable history channel', accessToken: 'synthetic-no-credential', enabled: true, canPublish: true, createdAt: new Date() } });
    await db.$executeRaw`INSERT INTO labels (id, "workspaceId", name, color, "createdAt") VALUES (${labelId}, ${workspaceA}, 'Disposable history label', 'blue', NOW())`;
    labelCreated = true;
    await db.mcpApiKey.create({ data: { id: readKeyId, workspaceId: workspaceA, createdById: userId, name: 'Disposable read-only history key', tokenHash: sha256(readBearer), tokenPrefix: readBearer.slice(0, 12), readFeatures: ['publishing/posts', 'publishing/collaboration'], writeFeatures: [], expiresAt } });
    await db.mcpApiKey.create({ data: { id: writeKeyId, workspaceId: workspaceA, createdById: userId, name: 'Disposable history writer key', tokenHash: sha256(writeBearer), tokenPrefix: writeBearer.slice(0, 12), readFeatures: ['publishing/posts', 'publishing/collaboration'], writeFeatures: ['publishing/posts', 'publishing/collaboration'], expiresAt } });

    stage = 'enable scoped modules and set version bounds';
    await saveSetting('mcp.enabled', true);
    await saveSetting('mcp.authenticatedRoles', ['owner', 'admin']);
    await saveSetting('platforms.facebook.enabled', true);
    await saveSetting('entitlements.features.publishing/posts', true);
    await saveSetting('entitlements.features.publishing/collaboration', true);
    await saveSetting('entitlements.features.publishing/labels', true);
    await saveSetting('publishing.collab.versionPageSize', 5);
    await saveSetting('publishing.collab.versionRetention', 20);

    stage = 'create and edit one synthetic draft through shared MCP lifecycle';
    const base = { message: 'History A', media: [] as unknown[], targetIds: [targetId] };
    const created = await mcp('create_post', { ...base, confirmation: 'CREATE POST' }, writeBearer);
    const createData = created.body?.result?.structuredContent;
    const createCode = created.body?.error?.data?.code ?? created.body?.result?.structuredContent?.code ?? 'unknown';
    check(created.response.ok && !created.body?.result?.isError && typeof createData?.id === 'string', `Synthetic draft creation failed safely (HTTP ${created.response.status}, MCP error ${created.body?.result?.isError === true}, code ${String(createCode)}).`);
    const postKey = createData.id as string;
    check(await db.post.count({ where: { id: postKey, workspaceId: workspaceA } }) === 1, 'Created draft did not persist in the synthetic workspace.');
    await db.$executeRaw`INSERT INTO post_labels ("postId", "labelId") VALUES (${postKey}, ${labelId})`;
    const imageMedia = [{ kind: 'image', url: 'https://assets.example.test/history-image.jpg', altText: 'Disposable history image' }];
    const editA = await updateViaMcp(postKey, { message: 'History A', firstComment: 'First comment A', link: 'https://example.test/story-a', media: [] });
    check(editA.response.ok && !editA.body?.result?.isError, 'Initial synthetic content edit failed.');
    const editB = await updateViaMcp(postKey, { message: 'History B', firstComment: 'First comment B', media: imageMedia });
    check(editB.response.ok && !editB.body?.result?.isError, 'First synthetic content edit failed.');
    const editC = await updateViaMcp(postKey, { message: 'History C', firstComment: 'First comment C', link: 'https://example.test/story-c', media: [] });
    check(editC.response.ok && !editC.body?.result?.isError, 'Second synthetic content edit failed.');
    const current = await storedPost(postKey);
    check(current?.message === 'History C' && current.status === 'draft' && current.publishedAt === null, 'Edits changed the post out of draft state.');
    const versionRows = await db.$queryRaw<Array<{ id: string; message: string; firstComment: string | null; link: string | null; media: any; targetIds: string[]; labelIds: string[]; createdAt: Date }>>`SELECT id,message,"firstComment",link,media,"targetIds","labelIds","createdAt" FROM post_versions WHERE "postId"=${postKey} ORDER BY "createdAt" DESC,id DESC`;
    const versionA = versionRows.find(row => row.message === 'History A' && row.firstComment === 'First comment A' && row.link === 'https://example.test/story-a' && row.labelIds.includes(labelId));
    const versionB = versionRows.find(row => row.message === 'History B' && row.firstComment === 'First comment B' && row.link === null && row.labelIds.includes(labelId));
    check(versionA && versionB && Array.isArray(versionB.media) && versionB.media.some((item: any) => item.url === imageMedia[0]!.url)
      && versionA.targetIds.includes(targetId) && versionB.targetIds.includes(targetId), 'Lifecycle did not persist the expected content, media, target and label snapshots.');

    stage = 'HTTP and MCP version-history reads';
    const historyResponse = await http(`/api/publishing/versions?postId=${encodeURIComponent(postKey)}`);
    const history = await json(historyResponse);
    check(historyResponse.ok && history.postId === postKey && history.versions?.some((row: any) => row.id === versionA.id && row.message === 'History A')
      && history.versions?.some((row: any) => row.id === versionB.id && row.message === 'History B'), 'HTTP history does not return saved versions.');
    const mcpHistory = await mcp('list_post_versions', { postId: postKey });
    check(!mcpHistory.body?.result?.isError && mcpHistory.body?.result?.structuredContent?.versions?.some((row: any) => row.id === versionA.id)
      && mcpHistory.body?.result?.structuredContent?.versions?.some((row: any) => row.id === versionB.id), 'MCP history does not return the same saved versions.');

    stage = 'confirmed HTTP restore and approval reset';
    await db.$executeRaw`UPDATE posts SET "approvalStatus"='approved',"reviewedById"=${userId},"reviewedAt"=NOW(),"reviewNote"='Synthetic approved state' WHERE id=${postKey} AND "workspaceId"=${workspaceA}`;
    const badConfirm = await http('/api/publishing/versions', 'POST', { postId: postKey, versionId: versionA.id, confirmation: 'RESTORE VERSION wrong' });
    check(badConfirm.status === 400 && (await storedPost(postKey))?.message === 'History C', 'Incorrect confirmation changed post content.');
    const httpRestore = await restoreViaHttp(postKey, versionA.id);
    const httpReceipt = await json(httpRestore), restoredA = await storedPost(postKey);
    const restoredLabelsA = await db.$queryRaw<Array<{ labelId: string }>>`SELECT "labelId" FROM post_labels WHERE "postId"=${postKey}`;
    const restoredTargetsA = await db.postTarget.findMany({ where: { postId: postKey }, select: { targetId: true, status: true, remotePostId: true } });
    check(httpRestore.ok && httpReceipt?.versionId === versionA.id && httpReceipt?.approvalReset === true
      && restoredA?.message === 'History A' && restoredA.firstComment === 'First comment A' && restoredA.link === 'https://example.test/story-a'
      && Array.isArray(restoredA.media) && restoredA.media.length === 0 && restoredA.status === 'draft' && restoredA.publishedAt === null
      && restoredA.approvalStatus === 'pending' && restoredA.reviewedById === null && restoredA.reviewedAt === null && restoredA.reviewNote === null
      && restoredLabelsA.some(row => row.labelId === labelId) && restoredTargetsA.length === 1 && restoredTargetsA[0]!.targetId === targetId
      && restoredTargetsA[0]!.status === 'pending' && restoredTargetsA[0]!.remotePostId === null, 'HTTP restore did not revalidate and restore original fields, labels, destination, draft state and approval reset.');

    stage = 'confirmed MCP restore of media version and read-only denial';
    const readOnlyRestore = await mcp('restore_post_version', { postId: postKey, versionId: versionB.id, confirmation: `RESTORE VERSION ${versionB.id}` }, readBearer);
    check(readOnlyRestore.body?.result?.isError === true && JSON.stringify(readOnlyRestore.body).includes('forbidden') && (await storedPost(postKey))?.message === 'History A', 'Read-only MCP key restored a version.');
    const mcpRestore = await mcp('restore_post_version', { postId: postKey, versionId: versionB.id, confirmation: `RESTORE VERSION ${versionB.id}` }, writeBearer);
    const mcpReceipt = mcpRestore.body?.result?.structuredContent, restoredB = await storedPost(postKey);
    const mediaB = await db.$queryRaw<Array<{ targetId: string; status: string; remotePostId: string | null }>>`SELECT "targetId",status::text AS status,"remotePostId" FROM post_targets WHERE "postId"=${postKey}`;
    const labelsB = await db.$queryRaw<Array<{ labelId: string }>>`SELECT "labelId" FROM post_labels WHERE "postId"=${postKey}`;
    check(!mcpRestore.body?.result?.isError && mcpReceipt?.versionId === versionB.id && restoredB?.message === 'History B' && restoredB.firstComment === 'First comment B'
      && restoredB.link === null && Array.isArray(restoredB.media) && restoredB.media.some((item: any) => item.url === imageMedia[0]!.url && item.altText === imageMedia[0]!.altText)
      && restoredB.status === 'draft' && restoredB.publishedAt === null && mediaB.length === 1 && mediaB[0]!.targetId === targetId && mediaB[0]!.status === 'pending' && mediaB[0]!.remotePostId === null
      && labelsB.some(row => row.labelId === labelId), 'MCP restore did not restore the media version with current target, label and draft safeguards.');
    const afterNoOp = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_versions WHERE "postId"=${postKey}`;
    const noOp = await updateViaMcp(postKey, { message: 'History B', firstComment: 'First comment B', media: imageMedia });
    const afterNoOpAgain = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM post_versions WHERE "postId"=${postKey}`;
    check(!noOp.body?.result?.isError && afterNoOpAgain[0]?.count === afterNoOp[0]?.count, 'Unchanged edit created a duplicate version.');

    stage = 'foreign-version and locked published-post denial';
    const foreignVersionId = `${prefix}_foreign_version`, publishedVersionId = `${prefix}_published_version`;
    const fixtureTime = new Date();
    await db.$executeRaw`INSERT INTO posts (id,"workspaceId","authorId",message,status,"createdAt","updatedAt") VALUES (${foreignPostId},${workspaceB},${userId},'Foreign synthetic draft','draft'::"PostStatus",${fixtureTime},${fixtureTime})`;
    await db.$executeRaw`INSERT INTO post_versions (id,"postId","authorId","createdAt",message,"firstComment",link,media,format,"targetIds","labelIds","scheduledAt",timezone) VALUES (${foreignVersionId},${foreignPostId},${userId},${fixtureTime},'Foreign version',NULL,NULL,'[]'::jsonb,'feed',ARRAY[]::text[],ARRAY[]::text[],NULL,'UTC')`;
    await db.$executeRaw`INSERT INTO posts (id,"workspaceId","authorId",message,status,"publishedAt","createdAt","updatedAt") VALUES (${publishedPostId},${workspaceA},${userId},'Synthetic published post','published'::"PostStatus",${fixtureTime},${fixtureTime},${fixtureTime})`;
    await db.$executeRaw`INSERT INTO post_versions (id,"postId","authorId","createdAt",message,"firstComment",link,media,format,"targetIds","labelIds","scheduledAt",timezone) VALUES (${publishedVersionId},${publishedPostId},${userId},${fixtureTime},'Synthetic published content',NULL,NULL,'[]'::jsonb,'feed',ARRAY[]::text[],ARRAY[]::text[],NULL,'UTC')`;
    const foreignRestore = await restoreViaHttp(foreignPostId, foreignVersionId);
    check(foreignRestore.status === 404, 'HTTP restore accepted a version from another workspace.');
    const mcpForeign = await mcp('restore_post_version', { postId: foreignPostId, versionId: foreignVersionId, confirmation: `RESTORE VERSION ${foreignVersionId}` }, writeBearer);
    check(mcpForeign.body?.result?.isError === true && JSON.stringify(mcpForeign.body).includes('not_found'), 'MCP restore accepted a version from another workspace.');
    const publishedRestore = await restoreViaHttp(publishedPostId, publishedVersionId);
    check(publishedRestore.status === 409 && (await storedPost(publishedPostId))?.message === 'Synthetic published post', 'Restore modified a published post.');

    stage = 'rapid edit ordering, snapshot deduplication and configured retention';
    await saveSetting('publishing.collab.versionRetention', 5);
    for (let index = 1; index <= 7; index++) {
      const rapid = await updateViaMcp(postKey, { message: `Rapid history ${index}`, firstComment: `Rapid comment ${index}`, media: [] });
      check(!rapid.body?.result?.isError, `Rapid synthetic edit ${index} failed.`);
    }
    const retained = await db.$queryRaw<Array<{ id: string; message: string; createdAt: Date }>>`SELECT id,message,"createdAt" FROM post_versions WHERE "postId"=${postKey} ORDER BY "createdAt" DESC,id DESC`;
    check(retained.length === 5 && retained[0]?.message === 'Rapid history 7' && retained.every((row, index) => index === 0 || retained[index - 1]!.createdAt.getTime() > row.createdAt.getTime()), 'Rapid edit ordering or five-version retention failed.');
    const pageOneResponse = await http(`/api/publishing/versions?postId=${postKey}&page=1`), pageTwoResponse = await http(`/api/publishing/versions?postId=${postKey}&page=2`);
    const pageOne = await json(pageOneResponse), pageTwo = await json(pageTwoResponse);
    check(pageOneResponse.ok && pageOne.versions.length === 5 && pageOne.hasMore === false && pageTwoResponse.ok && pageTwo.versions.length === 0, 'History page size or retention bounds were not applied.');
    const finalPost = await storedPost(postKey);
    const finalTargets = await db.postTarget.findMany({ where: { postId: postKey }, select: { status: true, remotePostId: true, publishedAt: true } });
    const attempts = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM rebuild_publication_attempts WHERE "postId"=${postKey}`;
    check(finalPost?.message === 'Rapid history 7' && finalPost.status === 'draft' && finalPost.publishedAt === null && finalTargets.every(row => row.status === 'pending' && row.remotePostId === null && row.publishedAt === null)
      && attempts[0]?.count === BigInt(0), 'History workflow triggered publication or changed the post out of draft state.');
    const workspaceAudits = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId"=${workspaceA} AND action LIKE 'publishing.version_%'`;
    check(workspaceAudits[0]?.count >= BigInt(3), 'Version restore and lifecycle changes were not durably audited.');
    console.log('PASS: version HTTP/MCP history, confirmed HTTP/MCP restore, message/comment/link/media/target/label state, approval reset, foreign and published denial, read-only MCP denial, rapid ordering/deduplication, retention, and no publication verified.');
  } finally {
    stage = `cleanup after ${stage}`;
    const cleanupErrors: string[] = [];
    async function cleanup(label: string, action: () => Promise<unknown>) { try { await action(); } catch { cleanupErrors.push(label); } }
    if (settingsCaptured && rootWrites) {
      for (const key of settingKeys) {
        const original = settings.get(key);
        await cleanup(`setting:${key}`, async () => {
          await db.appSetting.deleteMany({ where: { key } });
          if (original) await db.appSetting.create({ data: { ...original, value: original.value === null ? Prisma.JsonNull : original.value as Prisma.InputJsonValue } });
        });
      }
      await cleanup('Root config audits', async () => {
        const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;
        for (const row of rows) if (!priorRootAuditIds.has(row.id)) generatedAuditIds.add(row.id);
        if (generatedAuditIds.size) await db.$executeRaw`DELETE FROM root_activities WHERE id=ANY(${[...generatedAuditIds]}::text[])`;
        const remaining = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM root_activities WHERE "actorId"=${userId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`;
        check(remaining[0]?.count === BigInt(priorRootAuditIds.size), 'Synthetic Root audits remain or prior config audits changed.');
      });
    }
    if (fixtureStarted) {
      await cleanup('synthetic version rows', () => db.$executeRaw`DELETE FROM post_versions WHERE "postId"=ANY(${[postId, foreignPostId, publishedPostId]}::text[])`);
      await cleanup('synthetic post label relations', () => db.$executeRaw`DELETE FROM post_labels WHERE "postId"=ANY(${[postId, foreignPostId, publishedPostId]}::text[])`);
      await cleanup('synthetic post targets', () => db.postTarget.deleteMany({ where: { postId: { in: [postId, foreignPostId, publishedPostId] } } }));
      await cleanup('synthetic posts', () => db.post.deleteMany({ where: { id: { in: [postId, foreignPostId, publishedPostId] } } }));
      if (labelCreated) await cleanup('synthetic label', () => db.$executeRaw`DELETE FROM labels WHERE id=${labelId} AND "workspaceId"=${workspaceA}`);
      await cleanup('workspace audit rows', () => db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceA, workspaceB]}::text[])`);
      await cleanup('MCP keys', () => db.mcpApiKey.deleteMany({ where: { id: { in: [readKeyId, writeKeyId] } } }));
      await cleanup('synthetic sessions', () => db.session.deleteMany({ where: { userId } }));
      await cleanup('synthetic destination', async () => { await db.target.deleteMany({ where: { id: targetId } }); await db.socialAccount.deleteMany({ where: { id: socialId } }); });
      await cleanup('synthetic memberships', () => db.membership.deleteMany({ where: { userId, workspaceId: { in: [workspaceA, workspaceB] } } }));
      await cleanup('synthetic workspaces', () => db.workspace.deleteMany({ where: { id: { in: [workspaceA, workspaceB] } } }));
      await cleanup('synthetic user', () => db.user.deleteMany({ where: { id: userId } }));
      await cleanup('fixture and setting restoration verification', async () => {
        check(await db.workspace.count({ where: { id: { in: [workspaceA, workspaceB] } } }) === 0
          && await db.user.count({ where: { id: userId } }) === 0 && await db.session.count({ where: { id: sessionId } }) === 0
          && await db.mcpApiKey.count({ where: { id: { in: [readKeyId, writeKeyId] } } }) === 0
          && await db.post.count({ where: { id: { in: [postId, foreignPostId, publishedPostId] } } }) === 0
          && await db.target.count({ where: { id: targetId } }) === 0 && await db.socialAccount.count({ where: { id: socialId } }) === 0,
        'Synthetic identity, tenant, connection, content, session or MCP keys remain after cleanup.');
        const auditRows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceA, workspaceB]}::text[])`;
        check(auditRows[0]?.count === BigInt(0), 'Synthetic workspace audit records remain after cleanup.');
        for (const key of settingKeys) {
          const restored = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
          check(JSON.stringify(restored) === JSON.stringify(settings.get(key)), `Root setting ${key} was not restored exactly.`);
        }
      });
    }
    await db.$disconnect().catch(() => cleanupErrors.push('database disconnect'));
    check(cleanupErrors.length === 0, 'Disposable records or Root settings could not be restored and verified.');
    console.log('Both synthetic workspaces, identities, session, MCP keys, connection, target, label, draft/published fixtures, versions, audit rows and exact prior Root settings restored and verified.');
  }
}

main().catch(error => {
  console.error(`Publishing history probe failed at ${stage}: ${error instanceof ProbeFailure ? error.message : `unexpected ${error instanceof Error ? error.name : 'local'} failure (details withheld)`}`);
  process.exitCode = 1;
});
