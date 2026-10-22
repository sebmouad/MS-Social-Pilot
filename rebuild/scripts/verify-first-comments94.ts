/** Guarded synthetic MCP and Chromium probe for saved first-comment delays and receipts. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
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
  check(certPath === '/private/tmp/native92-local-cert.pem' && keyPath === '/private/tmp/native92-local-key.pem', 'Only the generated local HTTPS certificate paths are permitted.');

  const db = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const prefix = `preview_first_comment94_${randomUUID().replaceAll('-', '')}`, rootId = 'preview_qa_user';
  const userId = `${prefix}_owner`, workspaceId = `${prefix}_workspace`, accountId = `${workspaceId}_account`, targetId = `${workspaceId}_target`;
  const rootToken = randomBytes(32).toString('base64url'), sessionToken = randomBytes(32).toString('base64url');
  const writeKey = `mcp_${randomBytes(32).toString('base64url')}`, readKey = `mcp_${randomBytes(32).toString('base64url')}`;
  const sessionIds = [`${prefix}_root_session`, `${prefix}_session`], writeKeyId = `${prefix}_write_key`, readKeyId = `${prefix}_read_key`;
  const cookie = `msp_session=${sessionToken}; sp_workspace=${workspaceId}`;
  const rootCookie = `msp_session=${rootToken}; sp_workspace=${workspaceId}`;
  const settings = ['meta.graphBaseUrl', 'meta.appSecretProofEnabled', 'platforms.facebook.enabled'] as const;
  const originals = new Map<string, { value: unknown; encrypted: boolean; updatedAt: Date } | null>();
  const auditBaseline = new Map<string, Set<string>>();
  const defaults: Record<string, unknown> = {};
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let httpsServer: ReturnType<typeof createHttpsServer> | undefined;
  let graphOrigin = '', expectedRemoteId = '', expectedToken = '', expectedMessage = '', graphWrites = 0, rejectedGraphRequests = 0;
  let rootConfigChanged = false, settingsSnapshotted = false;
  let facebookScopes: string[] = [], graphVersion = '', maxDelay = 0;
  const serverFailures: string[] = [];

  const rpc = async (name: string, args: object, key?: string) => {
    const response = await fetch(`${rawOrigin}/api/mcp?scope=${key ? 'workspace' : 'installation'}`, {
      method: 'POST', headers: { origin: rawOrigin, 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : { cookie: rootCookie }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual',
    });
    const body = await response.json() as any;
    return { response, body, data: body.result?.structuredContent };
  };
  const setConfig = async (key: string, value: unknown) => {
    const result = await rpc('set_root_config', { key, value, confirmation: `SET ROOT CONFIG ${key}` });
    check(result.response.ok && !result.body.error && !result.body.result?.isError && result.data?.saved === true, 'Root configuration change was refused.');
  };
  const firstCommentArgs = (postId: string, postTargetId: string) => ({ postId, postTargetId, confirmation: `SEND FIRST COMMENT ${postTargetId}` });
  async function makeFixture(label: 'due' | 'future', delay: number) {
    const postId = `${workspaceId}_${label}_post`, postTargetId = `${workspaceId}_${label}_delivery`;
    const remotePostId = `${workspaceId}_${label}_remote`, publishedAt = new Date(Date.now() - 10 * 60_000);
    const message = `Synthetic ${label} first-comment probe ${prefix}`;
    await db.post.create({ data: { id: postId, workspaceId, authorId: userId, message: `Public post for ${label}`, format: 'post', firstComment: message,
      media: [], status: 'published', scheduledAt: null, publishedAt, createdAt: publishedAt, updatedAt: publishedAt } });
    if (delay !== 0) await db.$executeRaw`UPDATE posts SET "firstCommentDelayMinutes"=${delay} WHERE id=${postId} AND "workspaceId"=${workspaceId}`;
    await db.postTarget.create({ data: { id: postTargetId, postId, targetId, status: 'published', formatId: 'post', remotePostId, remoteUrl: `https://example.invalid/${remotePostId}`, publishedAt } });
    return { postId, postTargetId, remotePostId, message, publishedAt, delay };
  }

  try {
    stage = 'preview identities and settings snapshot';
    check(await db.user.count({ where: { id: rootId, isInstanceOwner: true, disabledAt: null } }) === 1, 'Seeded active preview installation owner required.');
    check(!await db.user.findUnique({ where: { id: userId }, select: { id: true } }), 'Synthetic user ID unexpectedly exists.');
    const graphDefault = await runtimeConfig('meta.graphBaseUrl'), proofDefault = await runtimeConfig('meta.appSecretProofEnabled'), platformDefault = await runtimeConfig('platforms.facebook.enabled');
    const publishScopes = await runtimeConfig('meta.postPublishScopes'), firstCommentScopes = await runtimeConfig('meta.firstCommentScopes');
    graphVersion = String(await runtimeConfig('meta.graphVersion'));
    maxDelay = Number(await runtimeConfig('publishing.maxFirstCommentDelayMinutes'));
    check(/^v\d+\.\d+$/.test(graphVersion) && Array.isArray(publishScopes) && publishScopes.length > 0 && Array.isArray(firstCommentScopes) && firstCommentScopes.length > 0 && Number.isSafeInteger(maxDelay) && maxDelay >= 15,
      'Facebook publish/comment scopes and a usable delay ceiling are required.');
    facebookScopes = [...new Set([...(publishScopes as string[]), ...(firstCommentScopes as string[])])];
    Object.assign(defaults, { 'meta.graphBaseUrl': graphDefault, 'meta.appSecretProofEnabled': proofDefault, 'platforms.facebook.enabled': platformDefault });
    for (const setting of settings) {
      const row = await db.appSetting.findUnique({ where: { key: setting } });
      check(!row || row.encrypted === false, 'Only non-secret preview configuration rows are permitted.');
      originals.set(setting, row ? { value: row.value, encrypted: row.encrypted, updatedAt: row.updatedAt } : null);
      const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=${setting}`;
      auditBaseline.set(setting, new Set(rows.map(row => row.id)));
    }
    settingsSnapshotted = true;

    stage = 'local HTTPS comment endpoint';
    const cert = await readFile(certPath!), key = await readFile(keyPath!);
    httpsServer = createHttpsServer({ cert, key }, async (request, response) => {
      let body = '';
      try {
        for await (const chunk of request) body += chunk.toString();
        const incoming = new URL(request.url ?? '/', graphOrigin);
        if (request.method !== 'POST') { rejectedGraphRequests++; response.writeHead(405); response.end('{}'); return; }
        const form = new URLSearchParams(body);
        check(incoming.pathname === `/${graphVersion}/${expectedRemoteId}/comments`, 'Unexpected Graph write path.');
        check(incoming.search === '' && request.headers['content-type']?.startsWith('application/x-www-form-urlencoded'), 'Unexpected Graph write transport.');
        check(form.get('access_token') === expectedToken && form.get('message') === expectedMessage, 'Unexpected synthetic comment credential or text.');
        graphWrites++;
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ id: `${workspaceId}_remote_comment` }));
      } catch {
        rejectedGraphRequests++;
        serverFailures.push('unexpected provider request');
        response.writeHead(400, { 'content-type': 'application/json' }); response.end('{}');
      }
    });
    await new Promise<void>((resolve, reject) => { httpsServer!.once('error', reject); httpsServer!.listen(0, 'localhost', resolve); });
    const address = httpsServer.address(); check(address && typeof address !== 'string', 'Local HTTPS comment endpoint did not bind.');
    graphOrigin = `https://localhost:${address.port}`;

    stage = 'synthetic user, session, workspace and Facebook Page';
    await db.user.create({ data: { id: userId, email: `${userId}@example.invalid`, name: 'Disposable first-comment owner', passwordHash: 'unusable-preview-password' } });
    await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: 'Disposable first-comment probe', timezone: 'UTC' } });
    await db.membership.create({ data: { id: `${workspaceId}_membership`, workspaceId, userId, role: 'owner' } });
    const expiry = new Date(Date.now() + 10 * 60_000);
    await db.session.createMany({ data: [
      { id: sessionIds[0]!, userId: rootId, tokenHash: hashSessionToken(rootToken)!, expiresAt: expiry, pending: null },
      { id: sessionIds[1]!, userId, tokenHash: hashSessionToken(sessionToken)!, expiresAt: expiry, pending: null },
    ] });
    await db.socialAccount.create({ data: { id: accountId, workspaceId, provider: 'facebook', providerUserId: `${workspaceId}_account`, name: 'Synthetic Facebook source',
      accessToken: encryptSecret(`synthetic_fb_comments94_${randomBytes(20).toString('hex')}`), scopes: facebookScopes.join(',') } });
    const pageToken = `synthetic_fb_comments94_${randomBytes(20).toString('hex')}`;
    // The target credential is the one used by Page publication and first-comment calls.
    await db.target.create({ data: { id: targetId, workspaceId, socialAccountId: accountId, type: 'page', providerId: `${workspaceId}_page`, name: 'Synthetic Facebook Page',
      accessToken: encryptSecret(pageToken), enabled: true, canPublish: true, createdAt: new Date() } });

    stage = 'Root-configured Graph mock and synthetic posts';
    rootConfigChanged = true;
    await setConfig(settings[0], graphOrigin);
    await setConfig(settings[1], false);
    await setConfig(settings[2], true);
    const due = await makeFixture('due', 5), future = await makeFixture('future', 15);
    expectedRemoteId = due.remotePostId; expectedToken = pageToken; expectedMessage = due.message;
    for (const key of [
      { id: writeKeyId, token: writeKey, writes: ['publishing/posts'] },
      { id: readKeyId, token: readKey, writes: [] as string[] },
    ]) await db.mcpApiKey.create({ data: { id: key.id, workspaceId, createdById: userId, name: key.writes.length ? 'Disposable comment sender' : 'Disposable read-only key',
      tokenHash: createHash('sha256').update(key.token).digest('hex'), tokenPrefix: key.token.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: key.writes, expiresAt: expiry } });
    check(graphWrites === 0 && rejectedGraphRequests === 0, 'Synthetic fixture creation must not contact the provider mock.');

    stage = 'read-only MCP denial and exact first-comment dispatch';
    const readOnly = await rpc('send_first_comment', firstCommentArgs(due.postId, due.postTargetId), readKey);
    check(readOnly.body.error || readOnly.body.result?.isError || !readOnly.response.ok, 'A read-only MCP key must not send a first comment.');
    check(graphWrites === 0, 'Read-only MCP denial must happen before provider access.');
    const sent = await rpc('send_first_comment', firstCommentArgs(due.postId, due.postTargetId), writeKey);
    check(sent.response.ok && !sent.body.error && !sent.body.result?.isError && sent.data?.state === 'sent', 'Writable MCP did not send the due first comment.');
    const repeated = await rpc('send_first_comment', firstCommentArgs(due.postId, due.postTargetId), writeKey);
    check(repeated.response.ok && !repeated.body.error && !repeated.body.result?.isError && repeated.data?.state === 'sent', 'Repeated MCP call did not return the stored first-comment receipt.');
    const receipt = await db.postTarget.findUnique({ where: { id: due.postTargetId }, select: { status: true, remotePostId: true, remoteUrl: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true } });
    check(receipt?.status === 'published' && receipt.remotePostId === due.remotePostId && receipt.remoteUrl === `https://example.invalid/${due.remotePostId}` &&
      receipt.firstCommentId === `${workspaceId}_remote_comment` && receipt.firstCommentAt instanceof Date && receipt.firstCommentError === null,
      'The exact comment receipt must persist while the original post receipt remains unchanged.');
    check(Number(graphWrites) === 1 && Number(rejectedGraphRequests) === 0 && serverFailures.length === 0, 'Only one exact Graph comment POST is permitted; no post-create or delete call is allowed.');

    stage = 'four-theme composer and post-status Chromium matrix';
    browser = await chromium.launch({ headless: true, proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost,127.0.0.1,[::1]' } });
    let views = 0;
    const matrix = (['grove', 'coast', 'clay', 'nightfall'] as const).flatMap(theme => [1440, 390].map(width => ({ theme, width })));
    for (const { theme, width } of matrix) {
      const context = await browser.newContext({ viewport: { width, height: 980 } });
      try {
        await context.addCookies([{ name: 'msp_session', value: sessionToken, url: rawOrigin, httpOnly: true, sameSite: 'Lax' }, { name: 'sp_workspace', value: workspaceId, url: rawOrigin, sameSite: 'Lax' }]);
        const page = await context.newPage();
        await page.goto(`${rawOrigin}/create`, { waitUntil: 'networkidle' });
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        const delay = page.getByLabel(/Wait before the first comment/);
        await delay.waitFor({ state: 'visible' });
        const destination = page.getByLabel('Synthetic Facebook Page', { exact: true });
        if (!(await destination.isVisible().catch(() => false))) {
          const menu = page.getByRole('button', { name: 'Menu & filters', exact: true });
          if (await menu.count()) await menu.click();
        }
        await destination.check();
        if (await page.locator('#shell-filters[role="dialog"]').count()) {
          await page.keyboard.press('Escape');
          await page.locator('#shell-filters[role="dialog"]').waitFor({ state: 'detached' });
        }
        check(await delay.getAttribute('type') === 'number' && await delay.getAttribute('min') === '0' &&
          Number(await delay.getAttribute('max')) === maxDelay && await delay.getAttribute('step') === '1', 'Composer delay input must expose the configured whole-minute bounds.');
        await delay.fill('-1'); check(await delay.evaluate(element => (element as HTMLInputElement).validity.rangeUnderflow), 'Negative first-comment delay must fail native validation.');
        await delay.fill('1.5'); check(await delay.evaluate(element => (element as HTMLInputElement).validity.stepMismatch), 'Fractional first-comment delay must fail native validation.');
        await delay.fill(String(maxDelay + 1)); check(await delay.evaluate(element => (element as HTMLInputElement).validity.rangeOverflow), 'Delay above Root maximum must fail native validation.');
        await page.locator('#composer-first-comment').focus();
        await page.keyboard.press('Tab'); check(await delay.evaluate(element => element === document.activeElement), 'Keyboard focus must proceed from the comment field to its delay field.');
        await delay.fill('5');
        check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'Composer must fit its viewport.');
        await page.screenshot({ path: `/private/tmp/first-comments94-${theme}-${width}.png`, animations: 'disabled', fullPage: true });
        views++;
        if (theme === 'grove' && width === 1440) {
          await page.goto(`${rawOrigin}/content`, { waitUntil: 'networkidle' });
          const row = page.getByRole('row').filter({ hasText: 'Public post for future' });
          await row.getByText('Manage post', { exact: true }).click();
          const status = row.getByRole('group', { name: 'First comment delivery for Synthetic Facebook Page', exact: true });
          check((await status.innerText()).includes('First comment scheduled for'), 'Future first comment must show its scheduled time.');
          const sendNow = status.getByRole('button', { name: 'Send now', exact: true });
          check(await sendNow.count() === 1, 'Future first comment must expose the explicit Send now action.');
          await sendNow.click();
          const dialog = page.getByRole('dialog'); await dialog.waitFor({ state: 'visible' });
          check((await dialog.innerText()).includes('without waiting for its saved delay') && await dialog.getByRole('button', { name: 'Send now', exact: true }).isDisabled(),
            'Manual early send must say it overrides the delay and require acknowledgment.');
          check(await dialog.locator('[data-first-comment-cancel]').evaluate(element => element === document.activeElement), 'Send-now dialog must initially focus Cancel.');
          await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
          check(await sendNow.evaluate(element => element === document.activeElement), 'Closing Send now must restore focus to its trigger.');
          check(Number(graphWrites) === 1, 'Inspecting the future Send now action must not dispatch to the provider.');
        }
      } finally { await context.close(); }
    }
    check(views === 8 && Number(graphWrites) === 1 && Number(rejectedGraphRequests) === 0 && serverFailures.length === 0, 'Composer matrix or provider-write count did not match expectations.');
    const postsRemaining = await db.post.count({ where: { workspaceId } });
    check(postsRemaining === 2, 'First-comment flow must not create or remove posts.');
    check(!JSON.stringify([sent.body, repeated.body]).includes(pageToken) && !JSON.stringify([sent.body, repeated.body]).includes(writeKey), 'MCP receipts must not expose provider credentials or API keys.');

    console.log(JSON.stringify({ readOnlyMcpDenied: true, writableMcpSend: true, repeatNoResend: true, exactCommentReceipt: true,
      providerCommentPosts: graphWrites, providerCreateDeleteRequests: 0, scheduledFutureShowsSendNow: true, composerValidationAndFocus: true,
      themes: ['grove', 'coast', 'clay', 'nightfall'], viewportWidths: [1440, 390], screenshotsPrivate: true, externalProviderRequests: false, secretsPrinted: false }));
  } finally {
    const cleanupErrors: string[] = [];
    try { await browser?.close(); } catch { cleanupErrors.push('browser'); }
    try { httpsServer?.closeAllConnections(); await new Promise<void>(resolve => httpsServer?.close(() => resolve()) ?? resolve()); } catch { cleanupErrors.push('local mock'); }
    if (settingsSnapshotted && rootConfigChanged) {
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
          const finalRows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=${setting}`;
          check(finalRows.length === baseline.size && finalRows.every(row => baseline.has(row.id)), 'Root configuration audit restoration failed.');
        } catch { cleanupErrors.push(`setting:${setting}`); }
      }
    }
    try {
      await db.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId}`;
      await db.postTarget.deleteMany({ where: { post: { workspaceId } } });
      await db.post.deleteMany({ where: { workspaceId } });
      await db.target.deleteMany({ where: { workspaceId } });
      await db.socialAccount.deleteMany({ where: { workspaceId } });
      await db.mcpApiKey.deleteMany({ where: { id: { in: [writeKeyId, readKeyId] } } });
      await db.session.deleteMany({ where: { id: { in: sessionIds } } });
      await db.membership.deleteMany({ where: { workspaceId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
      await db.user.deleteMany({ where: { id: userId } });
      check(await db.workspace.count({ where: { id: workspaceId } }) === 0 && await db.post.count({ where: { workspaceId } }) === 0 && await db.user.count({ where: { id: userId } }) === 0,
        'Disposable first-comment fixtures were not fully removed.');
    } catch { cleanupErrors.push('fixtures'); }
    try { await db.$disconnect(); } catch { cleanupErrors.push('database'); }
    check(cleanupErrors.length === 0, `Synthetic cleanup incomplete: ${cleanupErrors.join(',')}`);
    console.log(JSON.stringify({ syntheticFixturesCleaned: true, RootSettingsAndAuditsRestoredExactly: true, screenshotsPrivate: true, credentialsPrinted: false }));
  }
}

main().catch(error => {
  console.error(error instanceof ProbeFailure ? error.message : `First-comment probe failed at ${stage}; private evidence is withheld (${typeof error?.code === 'string' ? error.code : 'no code'}).`);
  process.exitCode = 1;
});
