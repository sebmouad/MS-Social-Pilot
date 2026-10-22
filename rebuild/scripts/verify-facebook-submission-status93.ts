/** Guarded synthetic HTTP/MCP probe for reconciling ordinary Facebook feed submissions. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '../generated/client';
import { encryptSecret } from '../src/server/secret-crypto';
import { hashSessionToken } from '../src/server/auth';
import { runtimeConfig } from '../src/server/config/store';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'guards';

async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL, rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  const certPath = process.env.REBUILD_NATIVE_TEST_CERT, keyPath = process.env.REBUILD_NATIVE_TEST_KEY;
  check(rawDatabase && rawDatabase === process.env.DATABASE_URL && rawOrigin === 'http://localhost:3200' && process.env.NODE_ENV !== 'production',
    'Explicit matching synthetic preview database and localhost origin required.');
  const parsed = new URL(rawDatabase);
  check(['postgres:', 'postgresql:'].includes(parsed.protocol) && parsed.port === '55432' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && decodeURIComponent(parsed.pathname).endsWith('_preview') &&
    !['host', 'hostaddr', 'socket'].some(key => parsed.searchParams.has(key)), 'Only the guarded loopback preview database is permitted.');
  check(certPath === '/private/tmp/native92-local-cert.pem' && keyPath === '/private/tmp/native92-local-key.pem',
    'Only the generated native92 local HTTPS certificate paths are permitted.');

  const db = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const rootId = 'preview_qa_user', prefix = `preview_fb_submit93_${randomUUID().replaceAll('-', '')}`;
  const userId = `${prefix}_owner`, workspaceId = `${prefix}_workspace`;
  const sessionId = `${prefix}_session`, rootSessionId = `${prefix}_root_session`, writeKeyId = `${prefix}_write_key`, readKeyId = `${prefix}_read_key`;
  const sessionToken = randomBytes(32).toString('base64url'), writeKey = `mcp_${randomBytes(32).toString('base64url')}`;
  const readKey = `mcp_${randomBytes(32).toString('base64url')}`;
  const cookie = `msp_session=${sessionToken}; sp_workspace=${workspaceId}`;
  const settings = ['meta.graphBaseUrl', 'meta.appSecretProofEnabled', 'platforms.facebook.enabled'] as const;
  const originals = new Map<string, { value: unknown; encrypted: boolean; updatedAt: Date } | null>();
  const auditBaseline = new Map<string, Set<string>>();
  const remote = new Map<string, { targetId: string; token: string; mismatch: boolean }>();
  let httpsServer: ReturnType<typeof createHttpsServer> | undefined;
  let graphOrigin = '', graphRequests = 0, graphWrites = 0;
  let anySettingWriteStarted = false, settingsSnapshotted = false;
  let rootToken: string | undefined;
  let pageToken = '';
  let accountId: string | undefined;
  let defaults: Record<string, unknown> = {};
  const serverFailures: string[] = [];

  const rpc = async (name: string, args: object, key?: string) => {
    const response = await fetch(`${rawOrigin}/api/mcp?scope=${key ? 'workspace' : 'installation'}`, {
      method: 'POST', headers: { origin: rawOrigin, 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : { cookie: `msp_session=${rootToken}` }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual',
    });
    const body = await response.json() as any;
    return { response, body, data: body.result?.structuredContent };
  };
  const setConfig = async (key: string, value: unknown) => {
    const result = await rpc('set_root_config', { key, value, confirmation: `SET ROOT CONFIG ${key}` });
    check(result.response.ok && !result.body.error && !result.body.result?.isError && result.data?.saved === true,
      'Root configuration change was refused.');
  };
  const syncApi = async (postId: string, withCookie = true) => fetch(`${rawOrigin}/api/publishing/recovery`, {
    method: 'POST', headers: { origin: rawOrigin, 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify({ action: 'sync', postId }), redirect: 'manual',
  });

  async function makePost(label: 'api-published' | 'api-mismatch' | 'mcp-published') {
    const postId = `${workspaceId}_${label}_post`, postTargetId = `${workspaceId}_${label}_delivery`;
    const operationId = `${workspaceId}_${label}_operation`, remoteId = `${workspaceId}_${label}_remote`;
    const targetId = `${workspaceId}_target`, remoteTargetId = `${workspaceId}_page`;
    remote.set(remoteId, { targetId: remoteTargetId, token: pageToken, mismatch: label === 'api-mismatch' });
    await db.post.create({ data: { id: postId, workspaceId, authorId: userId, message: 'Synthetic ordinary public video post', format: 'post',
      firstComment: null, media: [{ kind: 'video', url: 'https://example.invalid/native93-synthetic.mp4', sizeBytes: 3 }],
      status: 'publishing', scheduledAt: null, publishedAt: null, createdAt: new Date(), updatedAt: new Date() } });
    await db.postTarget.create({ data: { id: postTargetId, postId, targetId, status: 'processing', formatId: 'post' } });
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts
      (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state,reason,"remotePostId","receiptAt")
      VALUES (${operationId},${workspaceId},${postId},${postTargetId},${targetId},'facebook',${userId},'submitted','provider_submission',${remoteId},CURRENT_TIMESTAMP)`;
    return { postId, postTargetId, operationId, remoteId, targetId, remoteTargetId };
  }

  try {
    stage = 'seeded preview Root and current configuration';
    check(await db.user.count({ where: { id: rootId, isInstanceOwner: true, disabledAt: null } }) === 1, 'Seeded active preview installation owner required.');
    check(!await db.user.findUnique({ where: { id: userId }, select: { id: true } }), 'Synthetic user ID unexpectedly exists.');
    const graphDefault = await runtimeConfig('meta.graphBaseUrl');
    const proofDefault = await runtimeConfig('meta.appSecretProofEnabled');
    const platformDefault = await runtimeConfig('platforms.facebook.enabled');
    defaults = { 'meta.graphBaseUrl': graphDefault, 'meta.appSecretProofEnabled': proofDefault, 'platforms.facebook.enabled': platformDefault };
    const graphVersion = await runtimeConfig('meta.graphVersion');
    const scopesValue = await runtimeConfig('meta.postReadScopes');
    check(typeof graphVersion === 'string' && /^v\d+\.\d+$/.test(graphVersion), 'Configured Graph API version is required.');
    check(Array.isArray(scopesValue) && scopesValue.length > 0 && scopesValue.every(scope => typeof scope === 'string' && scope.trim()),
      'Configured Facebook post-read scopes are required.');
    for (const setting of settings) {
      const row = await db.appSetting.findUnique({ where: { key: setting } });
      check(!row || row.encrypted === false, 'Only non-secret preview configuration rows are permitted.');
      originals.set(setting, row ? { value: row.value, encrypted: row.encrypted, updatedAt: row.updatedAt } : null);
      const priorAudits = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=${setting}`;
      auditBaseline.set(setting, new Set(priorAudits.map(row => row.id)));
    }
    settingsSnapshotted = true;

    stage = 'synthetic local HTTPS Graph endpoint';
    const cert = await readFile(certPath!), key = await readFile(keyPath!);
    httpsServer = createHttpsServer({ cert, key }, (request, response) => {
      if (request.method !== 'GET') graphWrites++;
      graphRequests++;
      try {
        check(request.method === 'GET', 'Only local synthetic Graph status GETs are permitted.');
        const incoming = new URL(request.url ?? '/', graphOrigin);
        const remoteId = decodeURIComponent(incoming.pathname.split('/').filter(Boolean).at(-1) ?? '');
        const fixture = remote.get(remoteId);
        check(fixture && incoming.pathname.startsWith(`/${graphVersion}/`), 'Unexpected local Graph request path.');
        check(incoming.searchParams.get('access_token') === fixture.token, 'The local mock received an unexpected synthetic Page credential.');
        check(incoming.searchParams.get('fields') === 'id,from,status,published,created_time,scheduled_publish_time', 'Unexpected Facebook video status read shape.');
        const payload = { id: remoteId, from: { id: fixture.mismatch ? 'wrong_synthetic_page' : fixture.targetId },
          status: { video_status: 'ready' }, published: true, created_time: '2026-10-19T12:00:00+0000', scheduled_publish_time: null };
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(payload));
      } catch {
        serverFailures.push('unexpected local Graph request');
        response.writeHead(400, { 'content-type': 'application/json' }); response.end('{}');
      }
    });
    await new Promise<void>((resolve, reject) => { httpsServer!.once('error', reject); httpsServer!.listen(0, 'localhost', resolve); });
    const address = httpsServer.address();
    check(address && typeof address !== 'string', 'The local Graph mock did not bind.');
    graphOrigin = `https://localhost:${address.port}`;

    stage = 'synthetic session, workspace and resources';
    rootToken = randomBytes(32).toString('base64url');
    await db.user.create({ data: { id: userId, email: `${userId}@example.invalid`, name: 'Synthetic workspace owner', passwordHash: 'unusable-preview-password' } });
    await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: 'Disposable submission status probe', timezone: 'UTC' } });
    await db.membership.create({ data: { id: `${workspaceId}_membership`, workspaceId, userId, role: 'owner' } });
    const expiry = new Date(Date.now() + 10 * 60_000);
    await db.session.createMany({ data: [
      { id: sessionId, userId, tokenHash: hashSessionToken(sessionToken)!, expiresAt: expiry, pending: null },
      { id: rootSessionId, userId: rootId, tokenHash: hashSessionToken(rootToken)!, expiresAt: expiry, pending: null },
    ] });
    pageToken = `synthetic_fb_status93_${randomBytes(18).toString('hex')}`;
    accountId = `${workspaceId}_account`;
    await db.socialAccount.create({ data: { id: accountId, workspaceId, provider: 'facebook', providerUserId: workspaceId,
      name: 'Synthetic Facebook source', accessToken: encryptSecret(pageToken), scopes: (scopesValue as string[]).join(' ') } });
    await db.target.create({ data: { id: `${workspaceId}_target`, workspaceId, socialAccountId: accountId, type: 'page', providerId: `${workspaceId}_page`,
      name: 'Synthetic Facebook Page', accessToken: encryptSecret(pageToken), enabled: true, canPublish: true, createdAt: new Date() } });

    stage = 'audited Root configuration and synthetic operations';
    anySettingWriteStarted = true;
    await setConfig(settings[0], graphOrigin);
    await setConfig(settings[1], false);
    await setConfig(settings[2], true);
    const apiAccepted = await makePost('api-published');
    const apiMismatch = await makePost('api-mismatch');
    const mcpAccepted = await makePost('mcp-published');
    const apiKeys = [
      { id: writeKeyId, token: writeKey, writes: ['publishing/posts'] },
      { id: readKeyId, token: readKey, writes: [] as string[] },
    ];
    for (const row of apiKeys) await db.mcpApiKey.create({ data: { id: row.id, workspaceId, createdById: userId,
      name: row.writes.length ? 'Disposable status writer' : 'Disposable status reader',
      tokenHash: createHash('sha256').update(row.token).digest('hex'), tokenPrefix: row.token.slice(0, 12),
      readFeatures: ['publishing/posts'], writeFeatures: row.writes, expiresAt: expiry } });
    check(graphRequests === 0 && graphWrites === 0, 'Synthetic fixtures must not contact the provider mock.');

    stage = 'unauthorized and read-only denial';
    const anonymous = await syncApi(apiAccepted.postId, false);
    check(anonymous.status === 401 && graphRequests === 0, 'Anonymous API status sync must be refused before provider access.');
    const readOnly = await fetch(`${rawOrigin}/api/mcp?scope=workspace`, { method: 'POST', headers: { origin: rawOrigin, authorization: `Bearer ${readKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name: 'sync_post_status', arguments: { postId: mcpAccepted.postId, confirmation: `SYNC POST STATUS ${mcpAccepted.postId}` } } }), redirect: 'manual' });
    const readOnlyBody = await readOnly.json() as any;
    check(readOnlyBody.error || readOnlyBody.result?.isError || !readOnly.ok, 'A read-only workspace key must not run status sync.');
    check(graphRequests === 0, 'Denied sync must not contact the provider mock.');

    stage = 'authorized UI API sync';
    const apiResponse = await syncApi(apiAccepted.postId);
    const apiBody = await apiResponse.json() as any;
    check(apiResponse.ok && apiBody.synced === 1, 'The authenticated publication recovery API did not reconcile the matching receipt.');
    const [apiAttempt] = await db.$queryRaw<Array<{ state: string; remotePostId: string }>>`SELECT state,"remotePostId" FROM rebuild_publication_attempts WHERE id=${apiAccepted.operationId}`;
    const apiTarget = await db.postTarget.findUnique({ where: { id: apiAccepted.postTargetId }, select: { status: true, remotePostId: true, remoteUrl: true, publishedAt: true } });
    check(apiAttempt?.state === 'projected' && apiAttempt.remotePostId === apiAccepted.remoteId && apiTarget?.status === 'published' &&
      apiTarget.remotePostId === apiAccepted.remoteId, 'API status sync did not atomically project the same provider receipt.');

    stage = 'mismatch remains held';
    const mismatchResponse = await syncApi(apiMismatch.postId);
    const mismatchBody = await mismatchResponse.json() as any;
    check(mismatchResponse.ok && mismatchBody.synced === 0, 'A mismatched provider identity must not be treated as published.');
    const [mismatchAttempt] = await db.$queryRaw<Array<{ state: string; remotePostId: string }>>`SELECT state,"remotePostId" FROM rebuild_publication_attempts WHERE id=${apiMismatch.operationId}`;
    const mismatchTarget = await db.postTarget.findUnique({ where: { id: apiMismatch.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } });
    check(mismatchAttempt?.state === 'submitted' && mismatchAttempt.remotePostId === apiMismatch.remoteId &&
      mismatchTarget?.status === 'processing' && mismatchTarget.remotePostId === null && mismatchTarget.publishedAt === null,
      'The mismatch must remain held with no target projection.');

    stage = 'authorized MCP status sync';
    const mcp = await rpc('sync_post_status', { postId: mcpAccepted.postId, confirmation: `SYNC POST STATUS ${mcpAccepted.postId}` }, writeKey);
    check(mcp.response.ok && !mcp.body.error && !mcp.body.result?.isError && mcp.data?.synced === 1, 'The writable MCP sync tool did not reconcile its submitted receipt.');
    const [mcpAttempt] = await db.$queryRaw<Array<{ state: string; remotePostId: string }>>`SELECT state,"remotePostId" FROM rebuild_publication_attempts WHERE id=${mcpAccepted.operationId}`;
    check(mcpAttempt?.state === 'projected' && mcpAttempt.remotePostId === mcpAccepted.remoteId, 'MCP sync did not preserve and project the exact submitted identity.');
    check(Number(graphRequests) === 3 && Number(graphWrites) === 0 && serverFailures.length === 0, 'Only the three expected local provider status GETs are allowed.');

    console.log(JSON.stringify({ syntheticProbe: true, apiSync: true, mcpSync: true, anonymousApiDenied: true, readOnlyMcpDenied: true,
      mismatchedIdentityHeld: true, providerRequests: graphRequests, providerWrites: graphWrites, secretsPrinted: false }));
  } finally {
    const cleanupErrors: string[] = [];
    if (settingsSnapshotted && anySettingWriteStarted) {
      for (const setting of settings) {
        try {
          const original = originals.get(setting) ?? null;
          await setConfig(setting, original ? original.value : defaults[setting]);
          if (original) await db.appSetting.update({ where: { key: setting }, data: { value: original.value as Prisma.InputJsonValue, encrypted: original.encrypted, updatedAt: original.updatedAt } });
          else await db.appSetting.deleteMany({ where: { key: setting } });
          const baseline = auditBaseline.get(setting) ?? new Set<string>();
          const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=${setting}`;
          const extra = rows.map(row => row.id).filter(id => !baseline.has(id));
          if (extra.length) await db.$executeRaw`DELETE FROM root_activities WHERE "actorId"=${rootId} AND id=ANY(${extra}::text[])`;
          const final = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=${setting}`;
          check(final.length === baseline.size && final.every(row => baseline.has(row.id)), 'Root configuration audit rows were not restored.');
        } catch { cleanupErrors.push(`setting:${setting}`); }
      }
    }
    try { httpsServer?.closeAllConnections(); await new Promise<void>(resolve => httpsServer?.close(() => resolve()) ?? resolve()); } catch { cleanupErrors.push('https'); }
    try {
      await db.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId}`;
      await db.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId}`;
      await db.postTarget.deleteMany({ where: { post: { workspaceId } } });
      await db.post.deleteMany({ where: { workspaceId } });
      if (accountId) await db.target.deleteMany({ where: { workspaceId } });
      if (accountId) await db.socialAccount.deleteMany({ where: { workspaceId } });
      await db.mcpApiKey.deleteMany({ where: { id: { in: [writeKeyId, readKeyId] } } });
      await db.session.deleteMany({ where: { id: { in: [sessionId, rootSessionId] } } });
      await db.membership.deleteMany({ where: { workspaceId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
      await db.user.deleteMany({ where: { id: userId } });
      check(await db.workspace.count({ where: { id: workspaceId } }) === 0 && await db.user.count({ where: { id: userId } }) === 0,
        'Synthetic workspace fixtures were not fully removed.');
    } catch { cleanupErrors.push('fixtures'); }
    try { await db.$disconnect(); } catch { cleanupErrors.push('database'); }
    check(cleanupErrors.length === 0, `Synthetic cleanup incomplete: ${cleanupErrors.join(',')}`);
    console.log(JSON.stringify({ syntheticFixturesCleaned: true, RootSettingsAndAuditsRestored: true, credentialsPrinted: false }));
  }
}

main().catch(error => {
  console.error(error instanceof ProbeFailure ? error.message : `Facebook submission status probe failed at ${stage}; private evidence is withheld (${typeof error?.code === 'string' ? error.code : 'no code'}).`);
  process.exitCode = 1;
});
