/** Guarded synthetic Root API/MCP/Chromium probe for Facebook native status. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Prisma, PrismaClient } from '../generated/client';
import { encryptSecret } from '../src/server/secret-crypto';
import { hashSessionToken } from '../src/server/auth';
import { runtimeConfig } from '../src/server/config/store';
import { executeFacebookNativeWithJournal, type FacebookNativeJournalBinding } from '../src/platforms/facebook/formats/journal';
import { facebookNativeStatusConfirmation } from '../src/platforms/facebook/formats/status-recovery-contract';
import { assertFacebookNativeResolution } from '../src/platforms/facebook/formats/journal-recovery';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'guards';

async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL, rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  const certPath = process.env.REBUILD_NATIVE_TEST_CERT, keyPath = process.env.REBUILD_NATIVE_TEST_KEY;
  check(rawDatabase && rawDatabase === process.env.DATABASE_URL && rawOrigin === 'http://localhost:3200' && process.env.NODE_ENV !== 'production',
    'Explicit matching synthetic preview database and localhost origin required.');
  const parsedDatabase = new URL(rawDatabase);
  check(['postgres:', 'postgresql:'].includes(parsedDatabase.protocol) && parsedDatabase.port === '55432' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsedDatabase.hostname) && decodeURIComponent(parsedDatabase.pathname).endsWith('_preview') &&
    !['host', 'hostaddr', 'socket'].some(key => parsedDatabase.searchParams.has(key)), 'Only the guarded loopback preview database is permitted.');
  check(certPath === '/private/tmp/native91-local-cert.pem' && keyPath === '/private/tmp/native91-local-key.pem',
    'Only the generated native91 local HTTPS certificate paths are permitted.');

  const db = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const rootId = 'preview_qa_user', prefix = `preview_native91_${randomUUID().replaceAll('-', '')}`;
  const ordinaryId = `${prefix}_workspace_owner`, workspaceIds = [`${prefix}_published_ws`, `${prefix}_scheduled_ws`];
  const rootToken = randomBytes(32).toString('base64url'), ordinaryToken = randomBytes(32).toString('base64url');
  const apiKey = `mcp_${randomBytes(32).toString('base64url')}`;
  const rootCookie = `msp_session=${rootToken}; sp_workspace=${workspaceIds[0]}`;
  const ordinaryCookie = `msp_session=${ordinaryToken}; sp_workspace=${workspaceIds[0]}`;
  const sessionIds = [`${prefix}_root_session`, `${prefix}_ordinary_session`], apiKeyId = `${prefix}_workspace_key`;
  const settingKeys = ['facebook.native.statusRecoveryEnabled', 'meta.graphBaseUrl', 'meta.appSecretProofEnabled', 'platforms.facebook.enabled'] as const;
  const originalSettings = new Map<string, { value: unknown; encrypted: boolean; updatedAt: Date } | null>();
  const auditBaseline = new Map<string, Set<string>>();
  const remote = new Map<string, { pageId: string; outcome: 'published' | 'scheduled'; token: string }>();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let httpsServer: ReturnType<typeof createHttpsServer> | undefined;
  let serverOrigin = '';
  let graphDefault: unknown;
  let proofDefault: unknown;
  let platformDefault: unknown;
  let anySettingWriteStarted = false;
  let settingsSnapshotted = false;
  let graphRequests = 0;
  const serverFailures: string[] = [];
  const readGraphRequestCount = () => graphRequests;

  const rpc = async (name: string, args: object, scope: 'installation' | 'workspace' = 'installation') => {
    const response = await fetch(`${rawOrigin}/api/mcp?scope=${scope}`, {
      method: 'POST', headers: { origin: rawOrigin, 'content-type': 'application/json',
        ...(scope === 'workspace' ? { authorization: `Bearer ${apiKey}` } : { cookie: rootCookie }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual',
    });
    const body = await response.json() as any;
    return { response, body, data: body.result?.structuredContent };
  };
  const setRootConfig = async (key: string, value: unknown) => {
    const result = await rpc('set_root_config', { key, value, confirmation: `SET ROOT CONFIG ${key}` });
    check(result.response.ok && !result.body.error && !result.body.result?.isError && result.data?.saved === true,
      'Root configuration change was refused.');
  };
  const postRootAction = (body: object, cookie: string | null = rootCookie, origin = rawOrigin) => fetch(`${rawOrigin}/api/root/platform-publication-evidence`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), redirect: 'manual',
  });
  const getRootEvidence = async (operationId: string, cookie?: string) => {
    const response = await fetch(`${rawOrigin}/api/root/platform-publication-evidence?providerId=facebook&operationId=${encodeURIComponent(operationId)}`,
      { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    return { response, body: await response.json() as any };
  };

  async function makeFixture(kind: 'published' | 'scheduled') {
    const workspaceId = workspaceIds[kind === 'published' ? 0 : 1]!;
    const operationId = randomUUID(), targetId = `${workspaceId}_target`, postId = `${workspaceId}_post`, postTargetId = `${workspaceId}_delivery`;
    const remoteTargetId = `${workspaceId}_page`, remoteId = `${workspaceId}_${kind}_final`;
    const pageToken = `synthetic_native91_${randomBytes(18).toString('hex')}`;
    remote.set(remoteId, { pageId: remoteTargetId, outcome: kind, token: pageToken });
    stage = `fixture ${kind} workspace`;
    await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: 'Disposable native status probe', timezone: 'UTC' } });
    stage = `fixture ${kind} membership`;
    await db.membership.create({ data: { id: `${workspaceId}_membership`, workspaceId, userId: ordinaryId, role: 'owner' } });
    const readScopes = await runtimeConfig('meta.postReadScopes') as unknown;
    check(Array.isArray(readScopes) && readScopes.length > 0 && readScopes.every(scope => typeof scope === 'string' && scope.trim()),
      'Configured Facebook post-read scopes are required for the synthetic fixture.');
    stage = `fixture ${kind} source`;
    await db.socialAccount.create({ data: { id: `${workspaceId}_account`, workspaceId, provider: 'facebook', providerUserId: workspaceId,
      name: 'Synthetic Facebook source', accessToken: encryptSecret(pageToken), scopes: (readScopes as string[]).join(' ') } });
    stage = `fixture ${kind} target`;
    await db.target.create({ data: { id: targetId, workspaceId, socialAccountId: `${workspaceId}_account`, type: 'page', providerId: remoteTargetId,
      name: 'Synthetic native status Page', accessToken: encryptSecret(pageToken), enabled: true, canPublish: true, createdAt: new Date() } });
    stage = `fixture ${kind} post`;
    await db.post.create({ data: { id: postId, workspaceId, authorId: ordinaryId, message: 'Disposable synthetic native status probe', format: 'post', status: 'publishing', createdAt: new Date(), updatedAt: new Date() } });
    stage = `fixture ${kind} destination`;
    await db.postTarget.create({ data: { id: postTargetId, postId, targetId, status: 'processing', formatId: 'future_video' } });
    const scope: FacebookNativeJournalBinding = { workspaceId, operationId, postId, postTargetId, targetId, actorId: ordinaryId, remoteTargetId, sourceFormatId: 'future_video' };
    await db.$executeRaw`INSERT INTO rebuild_publication_attempts (id,"workspaceId","postId","postTargetId","targetId",provider,"actorId",state)
      VALUES (${operationId},${workspaceId},${postId},${postTargetId},${targetId},'facebook',${ordinaryId},'started')`;
    stage = `fixture ${kind} journal`;
    const outcome = await executeFacebookNativeWithJournal(scope, { format: 'video', targetId: remoteTargetId, description: 'Synthetic status test', scheduledUnix: null,
      media: { kind: 'video', url: 'https://example.invalid/native91-synthetic.mp4', sizeBytes: 3 } }, {
      database: db, limits: async () => ({ timeout: 10_000, maxWait: 5_000 }),
      transport: { postGraph: async () => ({ id: remoteId }), upload: async () => {} },
    });
    check(outcome.status === 'submitted' && outcome.remoteId === remoteId, 'The private native journal did not retain its synthetic final identity.');
    const [journal] = await db.$queryRaw<Array<{ revision: number; state: string; remoteId: string }>>`SELECT revision,state,"remoteId" FROM rebuild_facebook_native_journal WHERE "operationId"=${operationId}`;
    check(journal?.state === 'published' && journal.remoteId === remoteId, 'Synthetic native journal must be complete before status recovery.');
    return { scope, workspaceId, operationId, targetId, remoteTargetId, remoteId, revision: journal.revision, pageToken, kind };
  }

  const stored = async (operationId: string) => {
    const [row] = await db.$queryRaw<Array<Record<string, any>>>`SELECT * FROM rebuild_facebook_native_journal WHERE "operationId"=${operationId}`;
    return row;
  };
  const proofs = (operationId: string) => db.$queryRaw<Array<Record<string, any>>>`SELECT * FROM rebuild_facebook_native_status_proofs WHERE "operationId"=${operationId} ORDER BY "createdAt"`;
  const rootAction = (fixture: { operationId: string; revision: number }, confirmation = facebookNativeStatusConfirmation(fixture.operationId, fixture.revision)) => ({
    providerId: 'facebook', actionId: 'refresh_native_status', subjectId: fixture.operationId, confirmation, acknowledged: true as const,
  });
  const rootMcpAction = async (fixture: { operationId: string; revision: number }, confirmation?: string) => rpc('run_root_platform_publication_action',
    { actionId: 'refresh_native_status', subjectId: fixture.operationId, confirmation: confirmation ?? facebookNativeStatusConfirmation(fixture.operationId, fixture.revision), acknowledged: true, providerId: 'facebook' });

  try {
    stage = 'preview identities';
    check(await db.user.count({ where: { id: rootId, isInstanceOwner: true, disabledAt: null } }) === 1, 'Seeded active preview installation owner required.');
    graphDefault = await runtimeConfig('meta.graphBaseUrl');
    proofDefault = await runtimeConfig('meta.appSecretProofEnabled');
    platformDefault = await runtimeConfig('platforms.facebook.enabled');
    const graphVersion = await runtimeConfig('meta.graphVersion');
    check(typeof graphVersion === 'string' && /^v\d+\.\d+$/.test(graphVersion), 'Configured Graph version is required.');

    for (const key of settingKeys) {
      const row = await db.appSetting.findUnique({ where: { key } });
      check(!row || row.encrypted === false, 'Only plain non-secret preview configuration rows are permitted.');
      originalSettings.set(key, row ? { value: row.value, encrypted: row.encrypted, updatedAt: row.updatedAt } : null);
      const existing = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=${key}`;
      auditBaseline.set(key, new Set(existing.map(item => item.id)));
    }
    settingsSnapshotted = true;

    stage = 'local HTTPS Graph mock';
    const cert = await readFile(certPath!), key = await readFile(keyPath!);
    httpsServer = createHttpsServer({ cert, key }, (request, response) => {
      graphRequests++;
      try {
        check(request.method === 'GET', 'Only local synthetic Graph status GETs are permitted.');
        const incoming = new URL(request.url ?? '/', serverOrigin);
        const remoteId = decodeURIComponent(incoming.pathname.split('/').filter(Boolean).at(-1) ?? '');
        const fixture = remote.get(remoteId);
        check(fixture && incoming.pathname.startsWith(`/${graphVersion}/`), 'Unexpected local Graph request path.');
        check(incoming.searchParams.get('access_token') === fixture.token, 'The local mock received an unexpected synthetic Page credential.');
        check(incoming.searchParams.get('fields') === 'id,from,status,published,scheduled_publish_time', 'The local mock received an unexpected status read shape.');
        const payload = { id: remoteId, from: { id: fixture.pageId }, status: { video_status: 'ready' },
          published: fixture.outcome === 'published', scheduled_publish_time: fixture.outcome === 'scheduled' ? 1_900_000_000 : null };
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(payload));
      } catch {
        serverFailures.push('unexpected local Graph request');
        response.writeHead(400, { 'content-type': 'application/json' }); response.end('{}');
      }
    });
    await new Promise<void>((resolve, reject) => { httpsServer!.once('error', reject); httpsServer!.listen(0, 'localhost', resolve); });
    const address = httpsServer.address();
    check(address && typeof address !== 'string', 'Local Graph mock did not bind an ephemeral port.');
    serverOrigin = `https://localhost:${address.port}`;

    stage = 'sessions and workspace MCP key';
    await db.user.create({ data: { id: ordinaryId, email: `${prefix}@example.invalid`, name: 'Disposable ordinary workspace owner', passwordHash: 'unusable-preview-password' } });
    const expiry = new Date(Date.now() + 10 * 60_000);
    await db.session.createMany({ data: [
      { id: sessionIds[0]!, userId: rootId, tokenHash: hashSessionToken(rootToken)!, expiresAt: expiry, pending: null },
      { id: sessionIds[1]!, userId: ordinaryId, tokenHash: hashSessionToken(ordinaryToken)!, expiresAt: expiry, pending: null },
    ] });
    stage = 'audited Root policy changes';
    anySettingWriteStarted = true;
    await setRootConfig(settingKeys[0], true);
    await setRootConfig(settingKeys[1], serverOrigin);
    await setRootConfig(settingKeys[2], false);
    await setRootConfig(settingKeys[3], false);
    check(serverFailures.length === 0, 'Local HTTPS Graph mock reported an invalid request.');

    stage = 'synthetic completed journals';
    const accepted = await makeFixture('published');
    const scheduled = await makeFixture('scheduled');
    stage = 'workspace key fixture';
    await db.mcpApiKey.create({ data: { id: apiKeyId, workspaceId: workspaceIds[0], createdById: ordinaryId, name: 'Disposable status probe key',
      tokenHash: createHash('sha256').update(apiKey).digest('hex'), tokenPrefix: apiKey.slice(0, 12), readFeatures: ['publishing/posts'],
      writeFeatures: ['publishing/posts'], expiresAt: expiry } });
    check(graphRequests === 0, 'Native journal fixture construction must not contact Graph.');

    stage = 'authorization and exact intent';
    const anon = await getRootEvidence(accepted.operationId);
    check(anon.response.status === 401, 'Anonymous Root evidence reads must be refused.');
    const ordinaryRead = await getRootEvidence(accepted.operationId, ordinaryCookie);
    check(ordinaryRead.response.status === 403, 'Workspace ownership must not grant Root evidence access.');
    const action = rootAction(accepted);
    check((await postRootAction(action, null)).status === 401, 'Anonymous Root status actions must be refused.');
    check((await postRootAction(action, ordinaryCookie)).status === 403, 'Workspace owners must not execute Root status actions.');
    check((await postRootAction(action, rootCookie, 'https://untrusted.example.invalid')).status === 403, 'Cross-origin Root status actions must be refused.');

    const initialized = await fetch(`${rawOrigin}/api/mcp?scope=workspace`, { method: 'POST', headers: { origin: rawOrigin, authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'initialize', params: {} }), redirect: 'manual' });
    const initBody = await initialized.json() as any;
    check(initialized.ok && initBody.result?.serverInfo && !initBody.error, 'Workspace MCP key must authenticate before its Root denial is tested.');
    const keyDenied = await rpc('run_root_platform_publication_action', action, 'workspace');
    check(keyDenied.body.error || keyDenied.body.result?.isError || !keyDenied.response.ok, 'Workspace MCP keys must never execute Root recovery.');

    const badConfirmation = await postRootAction(rootAction(accepted, 'WRONG STATUS CONFIRMATION'));
    check(badConfirmation.status === 400 && graphRequests === 0, 'Wrong revision confirmation must fail before any Graph GET.');
    const evidenceResponse = await getRootEvidence(accepted.operationId, rootCookie);
    check(evidenceResponse.response.ok && evidenceResponse.response.headers.get('cache-control') === 'no-store', 'Root API must return uncached native status intent.');
    const acceptedAction = evidenceResponse.body.actions?.find((item: any) => item.actionId === 'refresh_native_status' && item.subjectId === accepted.operationId);
    check(acceptedAction?.intent === 'inspect' && acceptedAction.confirmation === facebookNativeStatusConfirmation(accepted.operationId, accepted.revision) &&
      !acceptedAction.fields?.length, 'Root evidence must expose the exact current read-only action with no extra fields.');
    check(graphRequests === 0, 'Root evidence inspection must not contact Graph.');

    stage = 'Root Chromium matrix and accepted status read';
    browser = await chromium.launch({ headless: true, proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost,127.0.0.1,[::1]' } });
    let views = 0;
    const matrix = (['grove', 'coast', 'clay', 'nightfall'] as const).flatMap(theme => [1440, 390].map(width => ({ theme, width })));
    for (let index = 0; index < matrix.length; index++) {
      const { theme, width } = matrix[index]!;
      const context = await browser.newContext({ viewport: { width, height: 980 } });
      try {
        await context.addCookies([
          { name: 'msp_session', value: rootToken, url: rawOrigin, httpOnly: true, sameSite: 'Lax' },
          { name: 'sp_workspace', value: workspaceIds[0]!, url: rawOrigin, sameSite: 'Lax' },
        ]);
        const page = await context.newPage();
        await page.goto(`${rawOrigin}/root/platforms/facebook?operationId=${accepted.operationId}`, { waitUntil: 'networkidle' });
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        const heading = page.getByRole('heading', { name: 'Facebook publication evidence', exact: true });
        await heading.waitFor();
        const section = page.locator('section.root-jobs').filter({ has: heading }).last();
        if (width === 390) {
          const filter = page.getByLabel('Publication operation ID', { exact: true });
          await filter.scrollIntoViewIfNeeded();
          check(await filter.inputValue() === accepted.operationId,
            'Phone evidence filter must keep its value in-page.');
          check(await filter.evaluate(element => Boolean(element.closest('main'))),
            'Phone evidence filter must live in the page, not the menu drawer.');
        }
        const trigger = section.getByRole('button', { name: 'Check final publication status', exact: true });
        check((await trigger.getAttribute('class'))?.includes('ui-button--secondary'), 'Status inspection must use the neutral secondary button style.');
        await trigger.click();
        const dialog = page.getByRole('dialog'); await dialog.waitFor({ state: 'visible' });
        check((await dialog.locator('input:not([type="checkbox"])').count()) === 1, 'Status action must request only its exact confirmation.');
        check((await dialog.locator('strong').innerText()) === acceptedAction.confirmation, 'Dialog confirmation must match the inspected revision.');
        const contextText = await dialog.getByLabel('Resolved action context').innerText();
        check(contextText.includes(accepted.remoteTargetId) && contextText.includes(accepted.remoteId) && contextText.includes(String(accepted.revision)),
          'Dialog must show the Page, final identity, and inspected journal revision.');
        const cancel = dialog.locator('[data-dialog-cancel]');
        if (width === 390) {
          const labelFits = await cancel.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); return new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top))).size === 1; });
          check(labelFits, 'Phone Cancel label must remain on one line.');
        }
        check(await cancel.evaluate(element => element === document.activeElement), 'Opening the dialog must place focus on Cancel.');
        check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'Status dialog must not widen the viewport.');
        await page.screenshot({ path: `/private/tmp/native91-${theme}-${width}.png`, animations: 'disabled' });

        if (index < matrix.length - 1) {
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'detached' });
          check(await trigger.evaluate(element => element === document.activeElement), 'Escape must close the dialog and restore trigger focus.');
        } else {
          await dialog.getByLabel('Exact confirmation').fill(acceptedAction.confirmation);
          await dialog.getByText(acceptedAction.acknowledgmentLabel, { exact: true }).click();
          const [actionResponse] = await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/api/root/platform-publication-evidence') && response.request().method() === 'POST'),
            dialog.getByRole('button', { name: 'Check final publication status', exact: true }).click(),
          ]);
          check(actionResponse.ok(), 'Root browser status action did not complete successfully.');
          await dialog.waitFor({ state: 'detached' });
        }
        check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'Root page must fit the viewport.');
        views++;
      } finally { await context.close(); }
    }
    check(views === 8 && readGraphRequestCount() === 1 && serverFailures.length === 0, 'Browser matrix must perform exactly one successful local status GET.');

    stage = 'accepted proof and held scheduled observation';
    const acceptedJournal = await stored(accepted.operationId);
    const acceptedRows = await proofs(accepted.operationId);
    check(acceptedJournal.state === 'confirmed' && acceptedRows.length === 1 && acceptedRows[0].accepted === true &&
      acceptedRows[0].actorId === rootId && acceptedRows[0].remoteId === accepted.remoteId && acceptedRows[0].remoteTargetId === accepted.remoteTargetId,
      'A positive identity- and Page-matched local observation must write a Root-owned accepted proof.');
    const [parent] = await db.$queryRaw<Array<{ state: string; remotePostId: string | null; actorId: string }>>`SELECT state,"remotePostId","actorId" FROM rebuild_publication_attempts WHERE id=${accepted.operationId}`;
    check(parent.state === 'uncertain' && parent.remotePostId === null && parent.actorId === ordinaryId,
      'Native status proof must leave the original publication claim held and attributed to its original actor.');
    await db.$transaction(tx => assertFacebookNativeResolution(tx, accepted.workspaceId, accepted.operationId, 'PUBLISHED', accepted.remoteId));
    await expectConflict(db, accepted);
    const acceptedAudit = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='facebook.native_status_observed' AND detail->>'operationId'=${accepted.operationId}`;
    check(acceptedAudit.length === 1, 'Accepted status proof requires one audited Root observation.');
    check((await proofs(scheduled.operationId)).length === 0 && readGraphRequestCount() === 1, 'Scheduled fixture must remain untouched until its Root MCP inspection.');

    const scheduledJournal = await stored(scheduled.operationId);
    const scheduledMcp = await rootMcpAction({ operationId: scheduled.operationId, revision: scheduledJournal.revision });
    check(scheduledMcp.response.ok && !scheduledMcp.body.error && !scheduledMcp.body.result?.isError &&
      scheduledMcp.data?.ok === false && scheduledMcp.data?.state === 'needs_review', 'Installation MCP must preserve the scheduled observation as held.');
    const scheduledRows = await proofs(scheduled.operationId), scheduledAfter = await stored(scheduled.operationId);
    check(readGraphRequestCount() === 2 && scheduledRows.length === 1 && scheduledRows[0].outcome === 'scheduled' && scheduledRows[0].accepted === false &&
      scheduledRows[0].appliedRevision === null && scheduledAfter.state === 'uncertain', 'Scheduled evidence must be retained without confirming or releasing the native receipt.');
    check(!JSON.stringify([evidenceResponse.body, scheduledMcp.body]).includes(accepted.pageToken) &&
      !JSON.stringify([evidenceResponse.body, scheduledMcp.body]).includes(scheduled.pageToken), 'Root API/MCP outputs must not expose Page credentials.');

    await setRootConfig('facebook.native.statusRecoveryEnabled', false);
    const disabledEvidence = await getRootEvidence(accepted.operationId, rootCookie);
    check(disabledEvidence.response.ok && disabledEvidence.body.items.some((row: any) => row.recordType === 'native_status_proof') &&
      !disabledEvidence.body.actions?.some((item: any) => item.actionId === 'refresh_native_status'),
      'Accepted proof evidence must remain visible while both customer platform access and recovery action are disabled.');
    check(!JSON.stringify(disabledEvidence.body).includes(acceptedJournal.ownerToken), 'Creator fencing tokens must never leave Root evidence.');

    console.log(JSON.stringify({ rootApiAuthorization: true, installationMcpAuthorization: true, workspaceMcpDenied: true, exactRevisionConfirmation: true,
      statusReadOnlyIntent: true, evidenceVisibleWhileDisabled: true, acceptedBrowserProof: true, parentClaimHeld: true, scheduledMcpObservationHeld: true,
      graphRequests: 2, browserViews: views, themes: ['grove', 'coast', 'clay', 'nightfall'], viewportWidths: [1440, 390], externalProviderRequests: false }));
  } finally {
    const cleanupErrors: string[] = [];
    try { await browser?.close(); } catch { cleanupErrors.push('browser'); }
    try { httpsServer?.closeAllConnections(); await new Promise<void>(resolve => httpsServer?.close(() => resolve()) ?? resolve()); } catch { cleanupErrors.push('local mock'); }
    if (settingsSnapshotted && anySettingWriteStarted) {
      for (const settingKey of settingKeys) {
        try {
          const original = originalSettings.get(settingKey) ?? null;
          const defaults: Record<string, unknown> = { 'facebook.native.statusRecoveryEnabled': false, 'meta.graphBaseUrl': graphDefault, 'meta.appSecretProofEnabled': proofDefault, 'platforms.facebook.enabled': platformDefault };
          await setRootConfig(settingKey, original?.value ?? defaults[settingKey]);
          if (original) await db.appSetting.update({ where: { key: settingKey }, data: { value: original.value as Prisma.InputJsonValue, encrypted: original.encrypted, updatedAt: original.updatedAt } });
          else await db.appSetting.deleteMany({ where: { key: settingKey } });
          const restored = await db.appSetting.findUnique({ where: { key: settingKey } });
          check(original ? restored?.encrypted === original.encrypted && JSON.stringify(restored.value) === JSON.stringify(original.value) &&
            restored.updatedAt.getTime() === original.updatedAt.getTime() : restored === null, 'A Root configuration row was not restored exactly.');
          const baseline = auditBaseline.get(settingKey) ?? new Set<string>();
          const current = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=${settingKey}`;
          const newIds = current.map(row => row.id).filter(id => !baseline.has(id));
          if (newIds.length) await db.$executeRaw`DELETE FROM root_activities WHERE "actorId"=${rootId} AND id=ANY(${newIds}::text[])`;
          const finalRows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=${settingKey}`;
          check(finalRows.length === baseline.size && finalRows.every(row => baseline.has(row.id)), 'Scoped Root config audit restoration failed.');
        } catch { cleanupErrors.push(`setting:${settingKey}`); }
      }
    }
    try {
      for (const workspaceId of workspaceIds) {
        await db.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId}`;
        await db.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId"=${workspaceId}`;
        await db.postTarget.deleteMany({ where: { post: { workspaceId } } });
        await db.post.deleteMany({ where: { workspaceId } });
        await db.target.deleteMany({ where: { workspaceId } });
        await db.socialAccount.deleteMany({ where: { workspaceId } });
        await db.membership.deleteMany({ where: { workspaceId } });
        await db.workspace.deleteMany({ where: { id: workspaceId } });
      }
      await db.session.deleteMany({ where: { id: { in: sessionIds } } });
      await db.mcpApiKey.deleteMany({ where: { id: apiKeyId } });
      await db.user.deleteMany({ where: { id: ordinaryId } });
      check(await db.workspace.count({ where: { id: { in: workspaceIds } } }) === 0 && await db.session.count({ where: { id: { in: sessionIds } } }) === 0 &&
        await db.user.count({ where: { id: ordinaryId } }) === 0 && await db.mcpApiKey.count({ where: { id: apiKeyId } }) === 0,
        'Disposable Root status fixtures were not fully removed.');
    } catch { cleanupErrors.push('fixtures'); }
    try { await db.$disconnect(); } catch { cleanupErrors.push('database'); }
    check(cleanupErrors.length === 0, `Synthetic cleanup incomplete: ${cleanupErrors.join(',')}`);
    console.log(JSON.stringify({ syntheticFixturesCleaned: true, RootSettingsAndAuditsRestoredExactly: true, screenshotsPrivate: true, credentialsPrinted: false }));
  }
}

async function expectConflict(db: PrismaClient, fixture: { workspaceId: string; operationId: string; remoteId: string }) {
  let refused = false;
  try { await db.$transaction(tx => assertFacebookNativeResolution(tx, fixture.workspaceId, fixture.operationId, 'ABSENT')); }
  catch { refused = true; }
  check(refused, 'A confirmed positive status proof must not permit contradictory absence.');
}

main().catch(error => {
  console.error(error instanceof ProbeFailure ? error.message : `Facebook native status probe failed at ${stage}; private evidence is withheld (${typeof error?.code === "string" ? error.code : "no code"}).`);
  process.exitCode = 1;
});
