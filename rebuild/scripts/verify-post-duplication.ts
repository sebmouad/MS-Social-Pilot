import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }
const json = async (response: Response) => response.json();

/** Real local HTTP/MCP duplication flow against disposable preview-only data. */
async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.NODE_ENV !== 'production', 'Explicit isolated preview database and origin required.');
  check(process.env.DATABASE_URL === rawDatabase, 'DATABASE_URL must exactly match the guarded preview database.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === rawOrigin && origin.origin === 'http://localhost:3200', 'Origin must be explicit localhost:3200 HTTP.');

  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_post_dup_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = 'preview_workspace'; const ownerId = 'preview_qa_user';
  const userId = `${id}_editor`; const membershipId = `${id}_membership`; const sessionId = `${id}_session`;
  const writeKeyId = `${id}_write_key`; const readKeyId = `${id}_read_key`;
  const sourceId = `${id}_source`; const collisionSourceId = `${id}_collision_source`; const hiddenSourceId = `${id}_hidden_source`;
  const foreignWorkspaceId = `${id}_foreign_workspace`; const foreignPostId = `${id}_foreign_source`;
  const requestId = randomUUID(); const collisionRequestId = randomUUID(); const hiddenRequestId = randomUUID(); const foreignRequestId = randomUUID();
  const sourceTargetRowId = `${id}_source_target`; const collisionTargetRowId = `${id}_collision_target`; const hiddenTargetRowId = `${id}_hidden_target`;
  const sessionToken = randomBytes(32).toString('base64url');
  const writeBearer = `mcp_${randomBytes(32).toString('base64url')}`; const readBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const cookie = `msp_session=${sessionToken}; sp_workspace=${workspaceId}`;
  const now = new Date(); const expiresAt = new Date(Date.now() + 600_000);
  let originalRoleSetting: { value: unknown; encrypted: boolean; updatedAt: Date } | null = null;
  let roleSettingExisted = false; let roleSettingChanged = false; let editorDeniedByOriginalPolicy = false;
  const requestBody = (postId: string, requestIdValue: string) => ({ postId, requestId: requestIdValue, confirmation: `DUPLICATE POST ${postId}` });
  const httpPost = async (body: string, requestOrigin = origin.origin) => fetch(new URL('/api/publishing/duplicate', origin), {
    method: 'POST', headers: { origin: requestOrigin, cookie, 'content-type': 'application/json' }, body, redirect: 'manual',
  });
  const rpc = async (bearer: string, method: string, params: object) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), {
      method: 'POST', headers: { origin: origin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }), redirect: 'manual',
    });
    return { response, body: await json(response) };
  };
  const call = (bearer: string, args: object) => rpc(bearer, 'tools/call', { name: 'duplicate_post', arguments: args });
  const sourceSnapshot = async (postId: string) => client.post.findUnique({ where: { id: postId }, select: {
    id: true, workspaceId: true, authorId: true, message: true, firstComment: true, link: true, media: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, updatedAt: true,
    targets: { orderBy: { id: 'asc' }, select: { id: true, targetId: true, formatId: true, status: true, remotePostId: true, remoteUrl: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true, publishedAt: true } },
  } });
  const receiptIds = [requestId, collisionRequestId, hiddenRequestId, foreignRequestId].map(value => `duplicate:${value}`);

  try {
    const owner = await client.user.findUnique({ where: { id: ownerId }, select: { id: true, isInstanceOwner: true, disabledAt: true } });
    check(owner?.isInstanceOwner && !owner.disabledAt, 'Synthetic preview installation owner is required.');
    check(!await client.user.findUnique({ where: { id: userId } }) && !await client.workspace.findUnique({ where: { id: foreignWorkspaceId } }), 'Disposable identities must be unused.');
    const targets = await client.target.findMany({ where: { id: { in: ['preview_target_north', 'preview_target_studio'] }, workspaceId }, select: { id: true, enabled: true } });
    check(targets.some(target => target.id === 'preview_target_north' && target.enabled) && targets.some(target => target.id === 'preview_target_studio' && target.enabled), 'Enabled synthetic North and Studio destinations are required.');
    const roleSetting = await client.appSetting.findUnique({ where: { key: 'mcp.authenticatedRoles' }, select: { value: true, encrypted: true, updatedAt: true } });
    roleSettingExisted = roleSetting !== null; originalRoleSetting = roleSetting;
    const roleDefinition = CONFIG_BY_KEY.get('mcp.authenticatedRoles')!;
    const allowedRolesValue = roleSetting?.value ?? roleDefinition.defaultValue;
    const parsedRoles = roleDefinition.schema.safeParse(allowedRolesValue);
    check(parsedRoles.success, 'The existing MCP role policy must be valid before the isolated preview probe.');
    const allowedRoles = parsedRoles.data as string[];

    await client.user.create({ data: { id: userId, email: `${id}@example.test`, name: 'Disposable duplicate verification editor', passwordHash: 'unusable-probe-credential' } });
    await client.membership.create({ data: { id: membershipId, userId, workspaceId, role: 'editor' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, 'preview_target_north')`;
    await client.session.create({ data: { id: sessionId, userId, tokenHash: hashLegacySessionToken(sessionToken)!, pending: null, expiresAt } });
    await client.mcpApiKey.create({ data: { id: writeKeyId, workspaceId, createdById: userId, name: 'Temporary post duplication write probe', tokenHash: createHash('sha256').update(writeBearer).digest('hex'), tokenPrefix: writeBearer.slice(0, 12), readFeatures: ['publishing/posts', 'settings/connections'], writeFeatures: ['publishing/posts'], expiresAt } });
    await client.mcpApiKey.create({ data: { id: readKeyId, workspaceId, createdById: userId, name: 'Temporary post duplication read probe', tokenHash: createHash('sha256').update(readBearer).digest('hex'), tokenPrefix: readBearer.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: [], expiresAt } });

    if (!allowedRoles.includes('editor')) {
      const denied = await call(writeBearer, requestBody(sourceId, randomUUID()));
      check(denied.response.status === 401 && denied.response.headers.get('cache-control') === 'no-store', 'The original MCP policy must deny editor authentication before the temporary grant.');
      editorDeniedByOriginalPolicy = true;
      const temporaryRoles = [...new Set([...allowedRoles, 'editor'])];
      await client.appSetting.upsert({ where: { key: 'mcp.authenticatedRoles' },
        create: { key: 'mcp.authenticatedRoles', value: temporaryRoles, encrypted: false, updatedAt: new Date() },
        update: { value: temporaryRoles, encrypted: false, updatedAt: new Date() } });
      roleSettingChanged = true;
    }

    const media = [
      { kind: 'image', url: 'https://example.test/duplicate-probe-one.jpg', altText: 'Synthetic remote image one' },
      { kind: 'image', url: 'https://example.test/duplicate-probe-two.jpg', altText: 'Synthetic remote image two' },
    ];
    const createPublishedSource = (postId: string, targetRowId: string, targetId: string, message: string) => client.post.create({ data: {
      id: postId, workspaceId, authorId: userId, message, firstComment: `${id} synthetic first comment`, link: null, media, status: 'published',
      scheduledAt: null, publishedAt: now, createdAt: now, updatedAt: now,
      targets: { create: { id: targetRowId, targetId, formatId: 'post', status: 'published', remotePostId: `${postId}_fake_remote_post`, remoteUrl: `https://example.test/${postId}`, firstCommentId: `${postId}_fake_remote_comment`, firstCommentAt: now, firstCommentError: 'synthetic old error', publishedAt: now } },
    } });
    await createPublishedSource(sourceId, sourceTargetRowId, 'preview_target_north', `${id} original source message`);
    await createPublishedSource(collisionSourceId, collisionTargetRowId, 'preview_target_north', `${id} collision source message`);
    await createPublishedSource(hiddenSourceId, hiddenTargetRowId, 'preview_target_studio', `${id} hidden destination source message`);
    await client.workspace.create({ data: { id: foreignWorkspaceId, name: 'Disposable foreign workspace', slug: foreignWorkspaceId, timezone: 'UTC' } });
    await client.post.create({ data: { id: foreignPostId, workspaceId: foreignWorkspaceId, authorId: userId, message: `${id} foreign source`, firstComment: null, media: [], status: 'draft', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now } });
    const originalSource = await sourceSnapshot(sourceId);
    check(originalSource?.targets.length === 1 && originalSource.targets[0]?.targetId === 'preview_target_north', 'Synthetic North source must be present before duplication.');

    const crossOrigin = await httpPost(JSON.stringify(requestBody(sourceId, randomUUID())), 'https://attacker.example');
    check(crossOrigin.status === 403 && crossOrigin.headers.get('cache-control') === 'no-store', 'Cross-origin HTTP duplication must be denied without caching.');

    const created = await httpPost(JSON.stringify(requestBody(sourceId, requestId)));
    const createdBody = await json(created);
    check(created.status === 201 && created.headers.get('cache-control') === 'no-store'
      && createdBody.sourcePostId === sourceId && createdBody.postId === requestId && createdBody.draftCreated === true && createdBody.replayed === false,
    'HTTP must create one new draft and return its durable receipt with 201.');
    const copied = await client.post.findUnique({ where: { id: requestId }, include: { targets: { include: { comments: true } } } });
    check(copied?.workspaceId === workspaceId && copied.authorId === userId && copied.message === originalSource.message
      && copied.firstComment === originalSource.firstComment && JSON.stringify(copied.media) === JSON.stringify(originalSource.media)
      && copied.link === originalSource.link && copied.status === 'draft' && copied.scheduledAt === null && copied.publishedAt === null,
    'The HTTP copy must preserve all requested content as an unscheduled local draft.');
    check(copied.targets.length === 1 && copied.targets[0]?.targetId === 'preview_target_north' && copied.targets[0]?.formatId === 'post' && copied.targets[0]?.status === 'pending'
      && copied.targets[0]?.remotePostId === null && copied.targets[0]?.remoteUrl === null && copied.targets[0]?.firstCommentId === null
      && copied.targets[0]?.firstCommentAt === null && copied.targets[0]?.firstCommentError === null && copied.targets[0]?.publishedAt === null && copied.targets[0]?.comments.length === 0,
    'The copied destination must be clean pending state with no remote identity or history.');

    const replay = await call(writeBearer, requestBody(sourceId, requestId));
    check(replay.response.status === 200 && replay.response.headers.get('cache-control') === 'no-store'
      && !replay.body.result?.isError && replay.body.result?.structuredContent?.postId === requestId
      && replay.body.result?.structuredContent?.draftCreated === true && replay.body.result?.structuredContent?.replayed === true,
    'MCP must replay the HTTP receipt and return the same draft ID.');
    check(await client.post.count({ where: { workspaceId, authorId: userId } }) === 4, 'Receipt replay must not create a second draft.');

    await client.post.update({ where: { id: requestId }, data: { message: `${id} manually edited copy`, status: 'rejected', updatedAt: new Date() } });
    const beforeReplayEdit = await client.post.findUniqueOrThrow({ where: { id: requestId }, select: { message: true, status: true, updatedAt: true } });
    const replayAfterEdit = await httpPost(JSON.stringify(requestBody(sourceId, requestId)));
    const replayAfterEditBody = await json(replayAfterEdit);
    const afterReplayEdit = await client.post.findUniqueOrThrow({ where: { id: requestId }, select: { message: true, status: true, updatedAt: true } });
    check(replayAfterEdit.status === 200 && replayAfterEditBody.replayed === true
      && afterReplayEdit.message === beforeReplayEdit.message && afterReplayEdit.status === beforeReplayEdit.status
      && afterReplayEdit.updatedAt.getTime() === beforeReplayEdit.updatedAt.getTime(), 'Receipt replay must not overwrite later draft edits.');

    const collision = await call(writeBearer, requestBody(collisionSourceId, requestId));
    check(collision.response.status === 200 && collision.body.result?.isError && collision.body.result?.structuredContent?.code === 'conflict', 'The same request ID with a different source must conflict.');
    const unknownFields = await httpPost(JSON.stringify({ ...requestBody(sourceId, randomUUID()), unexpected: true }));
    const missingConfirmation = await httpPost(JSON.stringify({ postId: sourceId, requestId: randomUUID() }));
    check(unknownFields.status === 400 && missingConfirmation.status === 400, 'HTTP must reject unknown request fields and missing confirmation.');

    const foreign = await call(writeBearer, requestBody(foreignPostId, foreignRequestId));
    const hidden = await call(writeBearer, requestBody(hiddenSourceId, hiddenRequestId));
    check(foreign.response.status === 200 && foreign.body.result?.isError && ['not_found', 'forbidden'].includes(foreign.body.result?.structuredContent?.code)
      && hidden.response.status === 200 && hidden.body.result?.isError && ['not_found', 'forbidden'].includes(hidden.body.result?.structuredContent?.code)
      && await client.post.findUnique({ where: { id: foreignRequestId }, select: { id: true } }) === null
      && await client.post.findUnique({ where: { id: hiddenRequestId }, select: { id: true } }) === null,
    'Cross-workspace and out-of-grant sources must remain unavailable without creating a copy.');

    const readWriteAttempt = await call(readBearer, requestBody(sourceId, randomUUID()));
    const readTools = await rpc(readBearer, 'tools/list', {});
    const readDiscoveryAttempt = await rpc(readBearer, 'tools/call', { name: 'list_pages', arguments: {} });
    check(readWriteAttempt.body.result?.isError && readWriteAttempt.body.result?.structuredContent?.code === 'forbidden'
      && !readTools.body.result?.isError && Array.isArray(readTools.body.result?.tools) && !readTools.body.result.tools.some((tool: { name?: string }) => tool.name === 'duplicate_post')
      && readDiscoveryAttempt.body.result?.isError && readDiscoveryAttempt.body.result?.structuredContent?.code === 'forbidden', 'The read-only key must neither duplicate posts nor discover destinations.');

    const beforeInvalid = await client.post.count({ where: { authorId: userId } });
    const invalidFormat = await rpc(writeBearer, 'tools/call', {name:'create_post',arguments:{message:`${id} invalid format`,targetIds:['preview_target_north'],destinationFormats:{preview_target_north:'unavailable-format'},confirmation:'CREATE POST'}});
    check(invalidFormat.body.result?.isError && await client.post.count({where:{authorId:userId}}) === beforeInvalid, 'MCP must refuse an unavailable destination format before saving a draft.');
    const edited = await rpc(writeBearer, 'tools/call', {name:'update_post',arguments:{postId:requestId,message:`${id} format update`,firstComment:'Retained first comment',targetIds:['preview_target_north'],destinationFormats:{preview_target_north:'post'},confirmation:`UPDATE POST ${requestId}`}});
    check(!edited.body.result?.isError && (await client.postTarget.findFirst({where:{postId:requestId}}))?.formatId === 'post', 'MCP edit must preserve explicit per-destination format through the real service.');
    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId} AND "targetId" = 'preview_target_north'`;
    const revokedReplay = await call(writeBearer, requestBody(sourceId, requestId));
    check(revokedReplay.body.result?.isError && ['not_found', 'forbidden'].includes(revokedReplay.body.result?.structuredContent?.code)
      && await client.post.count({ where: { id: requestId } }) === 1, 'Revoking current North access must deny receipt replay without creating another copy.');

    check(JSON.stringify(await sourceSnapshot(sourceId)) === JSON.stringify(originalSource), 'The original synthetic source and remote history must remain unchanged.');
    console.log(JSON.stringify({ httpCreated201: true, mcpReplayedSameDraft: true, copyHasTwoImagesAndFirstComment: true, copyDeliveryIsCleanPending: true,
      replayPreservedEdits: true, sameRequestDifferentSourceConflicts: true, malformedHttpDenied: true, crossWorkspaceAndHiddenSourcesDenied: true,
      readKeyCannotWriteOrDiscover: true, currentGrantRevocationDeniesReplay: true, originalSourceUnchanged: true, perDestinationFormatRetained: true, mcpExplicitFormatUpdated: true, invalidFormatRefusedBeforeSave: true,
      editorDeniedByOriginalMcpPolicy: editorDeniedByOriginalPolicy, temporaryEditorPolicyGrant: roleSettingChanged, providerDispatch: false }));
  } finally {
    try {
      let cleanupFailed = false;
      try {
        await client.$transaction(async tx => {
          await tx.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${userId} AND detail->>'workspaceId' = ${workspaceId} AND (action = 'mcp.write' OR action LIKE 'publishing.%')`;
          await tx.postTarget.deleteMany({ where: { postId: { in: [sourceId, collisionSourceId, hiddenSourceId, foreignPostId, requestId] } } });
          await tx.post.deleteMany({ where: { id: { in: [sourceId, collisionSourceId, hiddenSourceId, foreignPostId, requestId] }, authorId: userId } });
          await tx.mcpApiKey.deleteMany({ where: { id: { in: [writeKeyId, readKeyId] }, workspaceId } });
          await tx.session.deleteMany({ where: { id: sessionId, userId } });
          await tx.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
          await tx.membership.deleteMany({ where: { id: membershipId, workspaceId, userId } });
          await tx.workspace.deleteMany({ where: { id: foreignWorkspaceId } });
          await tx.user.deleteMany({ where: { id: userId } });
        });
      } catch { cleanupFailed = true; }
      try {
        if (roleSettingChanged) {
          if (roleSettingExisted && originalRoleSetting) {
            await client.appSetting.update({ where: { key: 'mcp.authenticatedRoles' }, data: {
              value: originalRoleSetting.value as Prisma.InputJsonValue,
              encrypted: originalRoleSetting.encrypted,
              updatedAt: originalRoleSetting.updatedAt,
            } });
          } else {
            await client.appSetting.deleteMany({ where: { key: 'mcp.authenticatedRoles' } });
          }
        }
      } catch { cleanupFailed = true; }
      const [posts, keys, sessions, memberships, users, workspaces, grants, receipts, restoredRoleSetting] = await Promise.all([
        client.post.count({ where: { id: { in: [sourceId, collisionSourceId, hiddenSourceId, foreignPostId, requestId] } } }),
        client.mcpApiKey.count({ where: { id: { in: [writeKeyId, readKeyId] } } }), client.session.count({ where: { id: sessionId } }),
        client.membership.count({ where: { id: membershipId } }), client.user.count({ where: { id: userId } }), client.workspace.count({ where: { id: foreignWorkspaceId } }),
        client.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_page_access WHERE "membershipId" = ${membershipId}`,
        client.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM root_activities WHERE "actorId" = ${userId} AND detail->>'workspaceId' = ${workspaceId}`,
        client.appSetting.findUnique({ where: { key: 'mcp.authenticatedRoles' }, select: { value: true, encrypted: true, updatedAt: true } }),
      ]);
      check(posts === 0 && keys === 0 && sessions === 0 && memberships === 0 && users === 0 && workspaces === 0
        && Number(grants[0]?.count) === 0 && Number(receipts[0]?.count) === 0 && !cleanupFailed,
      'All disposable duplication fixtures, scoped grants and receipts must be removed and verified.');
      check(JSON.stringify(restoredRoleSetting) === JSON.stringify(originalRoleSetting), 'Original MCP role policy presence, value, encryption and timestamp must be restored exactly.');
      console.log(JSON.stringify({ fixturesCleaned: true, receiptRowsCleaned: true, rolePolicyRestoredExactly: true, noSecretsPrinted: true }));
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Post duplication HTTP/MCP probe failed; inspect isolated preview logs without displaying credentials.'); process.exitCode = 1; });
