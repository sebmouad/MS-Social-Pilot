/**
 * Synthetic-only local HTTP/MCP/PostgreSQL/Chromium probe for client Sharing and the public bio page (batch 79).
 * Never contacts a provider, production or customer data. Requires an explicit matching loopback `_preview`
 * database (DATABASE_URL === REBUILD_PREVIEW_DATABASE_URL), REBUILD_PREVIEW_ORIGIN=http://localhost:3200 and a
 * running local production-build preview. The parent starts the preview and executes this script.
 *
 * Hard preconditions/fixture problems abort immediately. Endpoint expectations are collected, so one run reports
 * every current limitation as a clear failure instead of inventing success. Paths the product genuinely does not
 * support are listed as REMAINING GAPS in the output; they are never reported as passes.
 *
 * Secrets: share tokens, session tokens and MCP keys live only in memory. Nothing token-bearing is printed.
 * The rebuild Prisma client is deliberately thin (no ShareLink/ReviewDecision/BioPage models), so those tables use
 * parameterised raw SQL.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

const run = promisify(execFile);
class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }

let stage = 'preview guards';
const failures: string[] = [];
const gaps: string[] = [];
function expect(value: unknown, message: string) { if (!value) failures.push(`[${stage}] ${message}`); }
const gap = (message: string) => { gaps.push(`[${stage}] ${message}`); };

const settingKeys = [
  'platforms.facebook.enabled', 'entitlements.modules.ads', 'entitlements.modules.analytics', 'entitlements.features.ads/campaigns', 'entitlements.features.analytics/overview', 'entitlements.features.settings/mcp',
  'mcp.enabled', 'mcp.authenticatedRoles', 'mcp.maxResultItems', 'storage.mediaRoot',
  'sharing.pageSize', 'sharing.maxExpiryDays', 'sharing.defaultExpiryDays', 'bio.maxLinks', 'bio.availabilityCacheMs',
  'entitlements.modules.settings', 'entitlements.modules.publishing',
  'entitlements.features.settings/sharing', 'entitlements.features.settings/bio', 'entitlements.features.settings/data',
  'entitlements.features.publishing/approvals', 'entitlements.features.publishing/posts', 'entitlements.features.publishing/media',
] as const;
type Setting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };

// A valid 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  const raw = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(raw && raw === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin required.');
  const u = new URL(raw), base = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && decodeURIComponent(u.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(k => u.searchParams.has(k)), 'Only loopback _preview PostgreSQL permitted.');
  check(base.origin === origin && base.protocol === 'http:' && base.hostname === 'localhost' && base.port === '3200', 'Only localhost:3200 preview permitted.');

  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const prefix = `preview_sharing_${randomUUID().replaceAll('-', '')}`;
  const id = (suffix: string) => `${prefix}_${suffix}`;
  const U = { owner: id('owner'), admin: id('admin'), editor: id('editor'), scoped: id('scoped'), foreign: id('foreign') };
  const userIds = Object.values(U);
  const W = { main: id('ws_main'), foreign: id('ws_foreign'), erase: id('ws_erase'), purge: id('ws_purge') };
  const wsIds = Object.values(W);
  const T = { orphan: id('t_orphan'), a1: id('t_a1'), a2: id('t_a2'), b: id('t_b'), off: id('t_off'), f: id('t_f'), erase: id('t_erase'), purge: id('t_purge') };
  const marker = (label: string) => `${prefix} ${label}`;
  const sessionToken = { owner: randomBytes(32).toString('base64url'), admin: randomBytes(32).toString('base64url'), editor: randomBytes(32).toString('base64url'), foreign: randomBytes(32).toString('base64url') };
  const newKey = () => `mcp_${randomBytes(32).toString('base64url')}`;
  const keys = { full: newKey(), settingsOnly: newKey(), ro: newKey(), bioOnly: newKey(), noApprove: newKey(), editor: newKey(), revoked: newKey(), foreign: newKey(), scoped: newKey() };
  const keyIds = Object.fromEntries(Object.keys(keys).map(name => [name, id(`key_${name}`)])) as Record<keyof typeof keys, string>;
  const sha = (value: string) => createHash('sha256').update(value).digest('hex');
  const expiresAt = new Date(Date.now() + 1800000);
  const settings = new Map<string, Setting | null>();
  const ledger = `/private/tmp/${prefix}-recovery.json`;
  const mediaDir = `/private/tmp/${prefix}-media`;
  const bioSlug = `pvbio-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const eraseSlug = `pvera-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  let captured = false, fixture = false, rootWrites = false, ledgerSaved = false, mediaMade = false;

  const ck = (who: keyof typeof sessionToken, ws: string) => `msp_session=${sessionToken[who]}; sp_workspace=${ws}`;
  const ownerMain = ck('owner', W.main);

  type Res = { status: number; headers: Headers; text: string; body: any };
  async function http(p: string, opts: { cookie?: string; method?: string; body?: unknown; headers?: Record<string, string>; origin?: string | null; redirect?: 'manual' | 'follow' } = {}): Promise<Res> {
    const headers: Record<string, string> = { ...(opts.origin === null ? {} : { origin: opts.origin ?? base.origin }), ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...opts.headers };
    const r = await fetch(new URL(p, base), { method: opts.method ?? 'GET', redirect: opts.redirect ?? 'manual', signal: AbortSignal.timeout(30000), headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) });
    const text = await r.text(); let body: any = null; try { body = JSON.parse(text); } catch { /* keep null */ }
    return { status: r.status, headers: r.headers, text, body };
  }
  async function rpc(method: string, params: unknown, bearer?: string) {
    const r = await fetch(new URL('/api/mcp?scope=workspace', base), {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { origin: base.origin, 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    });
    const text = await r.text(); let body: any = null; try { body = JSON.parse(text); } catch { /* keep null */ }
    return { status: r.status, body, text };
  }
  /** Run one MCP tool. `data` is the parsed JSON text content; `refused` covers protocol errors and isError results. */
  async function tool(key: string, name: string, args: unknown = {}) {
    const r = await rpc('tools/call', { name, arguments: args }, key);
    const text: string = r.body?.result?.content?.find((c: any) => c?.type === 'text')?.text ?? '';
    let data: any = null; try { data = JSON.parse(text); } catch { /* keep null */ }
    const refused = r.body?.error !== undefined || r.body?.result?.isError === true || r.status >= 400;
    return { status: r.status, refused, data, code: data?.code ?? r.body?.error?.data?.code ?? null, text: r.text };
  }
  const toolNames = async (key: string) => ((await rpc('tools/list', {}, key)).body?.result?.tools ?? []).map((t: any) => t.name as string);
  const resourceUris = async (key: string) => ((await rpc('resources/list', {}, key)).body?.result?.resources ?? []).map((t: any) => t.uri as string);
  async function readResource(key: string, uri: string) {
    const r = await rpc('resources/read', { uri }, key);
    let data: any = null; try { data = JSON.parse(r.body?.result?.contents?.[0]?.text ?? ''); } catch { /* keep null */ }
    return { refused: r.body?.error !== undefined, data, text: r.text };
  }
  async function save(key: string, value: unknown) {
    rootWrites = true;
    const r = await http('/api/root/config', { cookie: ownerMain, method: 'PUT', body: { key, value } });
    check(r.status < 300 && r.body?.schemaVersion === CONFIG_SCHEMA_VERSION, `Root setting ${key} did not save.`);
  }
  const confirmCreate = (title: string) => `CREATE SHARE LINK ${title}`;
  const tokenOf = (p: string) => p.split('/').pop()!;
  const links: Record<string, any> = {};
  async function mk(label: string, body: Record<string, unknown>, cookie = ownerMain) {
    const title = marker(label);
    const r = await http('/api/sharing/links', { cookie, method: 'POST', body: { title, confirmation: confirmCreate(title), ...body } });
    check(r.status === 201 && typeof r.body?.id === 'string' && typeof r.body?.path === 'string', `Link ${label} was not created (${r.status}).`);
    links[label] = { id: r.body.id, token: tokenOf(r.body.path) };
    return { ...r, link: links[label] };
  }
  const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const leaks = (text: string, hidden: string[]) => hidden.filter(value => value && text.includes(value));

  let browser: Browser | undefined;
  type Rendered = { status: number; text: string; robots: string | null; referrer: string | null; imgs: Array<{ src: string; width: number }>; hrefs: string[]; overflow: boolean };
  /** Hydrated DOM through Chromium on loopback only; never regex-parse Next's streamed HTML. */
  async function render(p: string, o: { cookie?: string; selector?: string; width?: number; act?: (page: Page) => Promise<void> } = {}): Promise<Rendered> {
    browser ??= await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: o.width ?? 1280, height: 900 } });
    try {
      if (o.cookie) await context.addCookies(o.cookie.split('; ').map(value => { const at = value.indexOf('='); return { name: value.slice(0, at), value: value.slice(at + 1), url: base.origin, httpOnly: true, sameSite: 'Lax' as const }; }));
      await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
      const page = await context.newPage();
      const response = await page.goto(new URL(p, base).href, { waitUntil: 'networkidle', timeout: 30000 });
      const sel = o.selector ?? (o.cookie ? '#main-content' : 'main');
      await page.locator(sel).first().waitFor({ state: 'visible', timeout: 10000 });
      if (o.act) await o.act(page);
      return {
        status: response?.status() ?? 0,
        text: await page.locator(sel).first().innerText(),
        robots: await page.locator('meta[name=robots]').first().getAttribute('content', { timeout: 2000 }).catch(() => null),
        referrer: await page.locator('meta[name=referrer]').first().getAttribute('content', { timeout: 2000 }).catch(() => null),
        imgs: await page.$$eval('img', els => els.map(e => ({ src: e.getAttribute('src') ?? '', width: (e as HTMLImageElement).naturalWidth }))),
        hrefs: await page.$$eval('a', els => els.map(e => e.getAttribute('href') ?? '')),
        overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      };
    } finally { await context.close(); }
  }
  /** True when the address answers 404 (or renders the framework not-found page). */
  async function isGone(p: string): Promise<boolean> {
    const r = await http(p, { origin: null });
    if (r.status === 404) return true;
    if (r.status !== 200) return false;
    browser ??= await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
      const page = await context.newPage(); await page.goto(new URL(p, base).href, { waitUntil: 'networkidle', timeout: 30000 });
      return /could not be found|not found|404/i.test(await page.locator('body').innerText());
    } finally { await context.close(); }
  }
  const shareGone = (token: string) => isGone(`/share/${token}`);
  const decide = (token: string, body: unknown, opts: Parameters<typeof http>[1] = {}) => http(`/api/sharing/public/${token}/decision`, { method: 'POST', body, ...opts });
  const q = async <T = any>(sql: Prisma.Sql) => db.$queryRaw<T[]>(sql);
  const postRow = async (postId: string) => (await q<{ status: string; approvalStatus: string | null; reviewNote: string | null; reviewedById: string | null }>(Prisma.sql`SELECT status::text AS status, "approvalStatus"::text AS "approvalStatus", "reviewNote", "reviewedById" FROM posts WHERE id = ${postId}`))[0];
  const decisionsFor = async (linkId: string) => q<{ id: string; postId: string; decision: string; comment: string | null; authorName: string }>(Prisma.sql`SELECT id, "postId", decision, comment, "authorName" FROM review_decisions WHERE "shareLinkId" = ${linkId} ORDER BY "createdAt" ASC`);
  const linkRow = async (linkId: string) => (await q<{ tokenHash: string; revokedAt: Date | null; expiresAt: Date | null; targetIds: unknown; decides: boolean; allowComments: boolean }>(Prisma.sql`SELECT "tokenHash", "revokedAt", "expiresAt", "targetIds", decides, "allowComments" FROM share_links WHERE id = ${linkId}`))[0];
  const countLinks = async (ws: string) => Number((await q<{ n: bigint }>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM share_links WHERE "workspaceId" = ${ws}`))[0]?.n ?? 0);

  try {
    stage = 'preflight and capture exact settings';
    check((await fetch(new URL('/sign-in', base), { redirect: 'manual', signal: AbortSignal.timeout(5000) })).status < 500, 'Local preview unavailable.');
    const objects = await q<{ ready: boolean }>(Prisma.sql`SELECT to_regclass('public.share_links') IS NOT NULL AND to_regclass('public.review_decisions') IS NOT NULL AND to_regclass('public.bio_pages') IS NOT NULL AND to_regclass('public.bio_links') IS NOT NULL AND to_regclass('public.member_page_access') IS NOT NULL AND to_regclass('public.workspace_data_purges') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'share_links' AND column_name = 'expiresAt') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mcp_api_keys' AND column_name = 'resourceScope') AS ready`);
    check(objects[0]?.ready, 'Required sharing/bio tables, expiry or MCP scope column missing; no fixtures written.');
    for (const key of settingKeys) {
      const value = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
      check(!value?.encrypted, 'Unexpected encrypted probe setting.');
      settings.set(key, value);
    }
    captured = true;
    // Durable private recovery ledger BEFORE any mutation. Contains no session, key, token or credential values.
    await writeFile(ledger, JSON.stringify({ prefix, userIds, workspaceIds: wsIds, mediaDir, settings: [...settings] }), { mode: 0o600, flag: 'wx' });
    ledgerSaved = true; fixture = true;

    stage = 'create synthetic fixtures';
    for (const [name, userId] of Object.entries(U)) {
      await db.user.create({ data: { id: userId, email: `${userId}@example.test`, name: `Disposable Sharing ${name}`, passwordHash: 'unusable-preview-password', ...(userId === U.owner ? { isInstanceOwner: true, totpEnabledAt: new Date() } : {}) } });
    }
    for (const [key, workspaceId] of Object.entries(W)) await db.workspace.create({ data: { id: workspaceId, name: `${prefix} ${key}`, slug: workspaceId, timezone: 'UTC' } });
    const member = async (suffix: string, workspaceId: string, userId: string, role: 'owner' | 'admin' | 'editor') => { await db.membership.create({ data: { id: id(`m_${suffix}`), workspaceId, userId, role } }); return id(`m_${suffix}`); };
    await member('main_owner', W.main, U.owner, 'owner');
    const adminMembership = await member('main_admin', W.main, U.admin, 'admin');
    await member('main_editor', W.main, U.editor, 'editor');
    const scopedMembership = await member('main_scoped', W.main, U.scoped, 'admin');
    await member('foreign_owner', W.foreign, U.foreign, 'owner');
    await member('erase_owner', W.erase, U.owner, 'owner');
    await member('purge_owner', W.purge, U.owner, 'owner');
    await q(Prisma.sql`UPDATE memberships SET "allPages" = true WHERE id <> ${scopedMembership} AND "workspaceId" = ANY(${wsIds}::text[])`);
    await q(Prisma.sql`UPDATE memberships SET "allPages" = false WHERE id = ${scopedMembership}`);
    const now = new Date();
    for (const [who, userId] of [['owner', U.owner], ['admin', U.admin], ['editor', U.editor], ['foreign', U.foreign]] as const) {
      await db.session.create({ data: { id: id(`session_${who}`), userId, tokenHash: hashLegacySessionToken(sessionToken[who])!, expiresAt, pending: null } });
    }
    const target = (key: keyof typeof T, workspaceId: string, name: string, enabled: boolean) => db.target.create({ data: { id: T[key], workspaceId, type: 'page', providerId: id(`provider_${key}`), name, accessToken: 'synthetic-never-used', enabled, canPublish: true, createdAt: now } });
    await target('orphan', W.main, marker('Orphan channel'), true);
    await target('a1', W.main, marker('Channel A1'), true); await target('a2', W.main, marker('Channel A2'), true); await target('b', W.main, marker('Channel B'), true); await target('off', W.main, marker('Channel Off'), false);
    await target('f', W.foreign, marker('Channel Foreign'), true); await target('erase', W.erase, marker('Channel Erase'), true); await target('purge', W.purge, marker('Channel Purge'), true);
    const syntheticConnection = id('connection_main');
    await db.socialAccount.create({data:{id:syntheticConnection,workspaceId:W.main,provider:'facebook',providerUserId:id('provider_user'),name:'Synthetic scope connection',accessToken:'synthetic-never-used',scopes:''}});
    await db.target.updateMany({where:{id:{in:[T.a1,T.a2,T.b]}},data:{socialAccountId:syntheticConnection}});
    for (const [workspaceId,targetId] of [[W.foreign,T.f],[W.erase,T.erase],[W.purge,T.purge]] as const) {
      const connectionId=id(`connection_${workspaceId}`);
      await db.socialAccount.create({data:{id:connectionId,workspaceId,provider:'facebook',providerUserId:connectionId,name:'Synthetic sharing connection',accessToken:'synthetic-never-used',scopes:''}});
      await db.target.update({where:{id:targetId},data:{socialAccountId:connectionId}});
    }
    const adA=id('ad_account_a'),adB=id('ad_account_b');
    for(const [accountId,name,spend] of [[adA,'Scope account A',11],[adB,'Scope sibling B',22]] as const){
      await db.adAccount.create({data:{id:accountId,workspaceId:W.main,socialAccountId:syntheticConnection,actId:accountId,name,currency:'USD',enabled:true}});
      await db.adInsight.create({data:{id:id(`insight_${spend}`),adAccountId:accountId,level:'account',objectId:accountId,objectName:name,date:new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'),spend,impressions:100,clicks:3,reach:50,fetchedAt:new Date()}});
    }
    await q(Prisma.sql`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${scopedMembership}, ${T.a1})`);
    const days = (n: number) => new Date(Date.now() + n * 86_400_000);
    const post = async (label: string, workspaceId: string, targets: string[], status: 'draft' | 'pending_approval' | 'rejected' | 'scheduled' | 'published' | 'failed', extra: { scheduledAt?: Date | null; publishedAt?: Date | null; media?: unknown; link?: string | null; firstComment?: string | null } = {}) => {
      const postId = id(`post_${label}`);
      await db.post.create({ data: { id: postId, workspaceId, authorId: U.editor, message: marker(`post ${label}`), status, scheduledAt: extra.scheduledAt ?? null, publishedAt: extra.publishedAt ?? null, ...(extra.media === undefined ? {} : { media: extra.media as Prisma.InputJsonValue }), link: extra.link ?? null, firstComment: extra.firstComment ?? null, createdAt: now, updatedAt: now } });
      for (const targetId of targets) await db.postTarget.create({ data: { id: id(`pt_${label}_${targetId.slice(-4)}`), postId, targetId, status: 'pending' } });
      return postId;
    };
    const P: Record<string, string> = {
      p1: await post('pending1', W.main, [T.a1], 'pending_approval', { scheduledAt: days(2), link: 'javascript:alert(1)', firstComment: marker('first comment 1'), media: [{ kind: 'image', url: 'https://example.test/pixel.png' }, { kind: 'image', url: 'http://example.test/insecure.png' }, { kind: 'image', url: 'https://user:pw@example.test/cred.png' }] }),
      p2: await post('pending2', W.main, [T.a1], 'pending_approval', { scheduledAt: days(2) }),
      p3: await post('pending3', W.main, [T.a2], 'pending_approval', { scheduledAt: days(3) }),
      p4: await post('pending4', W.main, [T.a1], 'pending_approval', { scheduledAt: days(3) }),
      p6: await post('pending6', W.main, [T.a2], 'pending_approval', { scheduledAt: days(3) }),
      multi: await post('multi', W.main, [T.a1, T.b], 'pending_approval', { scheduledAt: days(2) }),
      draft: await post('draft', W.main, [T.a1], 'draft'),
      rejected: await post('rejected', W.main, [T.a1], 'rejected'),
      failed: await post('failed', W.main, [T.a1], 'failed'),
      betaPending: await post('betaPending', W.main, [T.b], 'pending_approval', { scheduledAt: days(2) }),
      offPending: await post('offPending', W.main, [T.off], 'pending_approval', { scheduledAt: days(2) }),
      scheduled: await post('scheduled', W.main, [T.a1], 'scheduled', { scheduledAt: days(1) }),
      published: await post('published', W.main, [T.a1], 'published', { publishedAt: days(-1) }),
      foreign: await post('foreignPending', W.foreign, [T.f], 'pending_approval', { scheduledAt: days(2) }),
    };
    const mk2 = (name: keyof typeof keys, userId: string, workspaceId: string, read: string[], write: string[], extra: { revokedAt?: Date } = {}) => db.mcpApiKey.create({ data: { id: keyIds[name], workspaceId, createdById: userId, name: `Disposable Sharing ${name}`, tokenHash: sha(keys[name]), tokenPrefix: keys[name].slice(0, 12), readFeatures: read, writeFeatures: write, expiresAt, ...extra } });
    const S = 'settings/sharing', B = 'settings/bio', A = 'publishing/approvals';
    await mk2('full', U.owner, W.main, [S, B, A], [S, B, A]);
    await mk2('settingsOnly', U.owner, W.main, [S], [S]);
    await mk2('ro', U.owner, W.main, [S, B], []);
    await mk2('bioOnly', U.owner, W.main, [B], [B]);
    await mk2('noApprove', U.owner, W.main, [S, B, 'publishing/approvals'], [S, B]);
    await mk2('editor', U.editor, W.main, [S, B], [S, B]);
    await mk2('revoked', U.owner, W.main, [S, B], [S, B], { revokedAt: new Date() });
    await mk2('foreign', U.foreign, W.foreign, [S, B, A], [S, B, A]);
    await mk2('scoped', U.scoped, W.main, [S, B, A, 'ads/campaigns'], [S, B, A]);
    await q(Prisma.sql`UPDATE mcp_api_keys SET "resourceScope"=${JSON.stringify({version:1,mode:'selected',ids:[T.a1],adAccountIds:[]})}::jsonb WHERE id=${keyIds.scoped}`);

    stage = 'enable local features, MCP and storage';
    for (const key of ['entitlements.modules.settings', 'entitlements.modules.publishing', 'entitlements.features.settings/sharing', 'entitlements.features.settings/bio', 'entitlements.features.settings/data', 'entitlements.features.publishing/approvals', 'entitlements.features.publishing/posts', 'entitlements.features.publishing/media'] as const) await save(key, true);
    for(const key of ['platforms.facebook.enabled','entitlements.modules.ads','entitlements.modules.analytics','entitlements.features.ads/campaigns','entitlements.features.analytics/overview','entitlements.features.settings/mcp'] as const) await save(key,true);
    await save('mcp.enabled', true); await save('mcp.authenticatedRoles', ['owner', 'admin']); await save('mcp.maxResultItems', 100);
    await save('sharing.pageSize', 25); await save('sharing.maxExpiryDays', 180); await save('sharing.defaultExpiryDays', 30);
    await save('bio.maxLinks', 30); await save('bio.availabilityCacheMs', 0);
    await mkdir(mediaDir, { mode: 0o700 }); mediaMade = true;
    await save('storage.mediaRoot', mediaDir);

    stage = 'owner API boundaries';
    const baseBody = (title: string) => ({ kind: 'review', title, targetIds: [T.a1], confirmation: confirmCreate(title) });
    const t0 = marker('boundary');
    const before = await countLinks(W.main);
    expect((await http('/api/sharing/links', {})).status === 401, 'Anonymous list must be refused (401).');
    expect((await http('/api/sharing/links', { method: 'POST', body: baseBody(t0) })).status === 401, 'Anonymous create must be refused (401).');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: baseBody(t0), origin: null })).status === 403, 'Create without Origin must be refused.');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: baseBody(t0), origin: 'http://evil.example' })).status === 403, 'Cross-origin create must be refused.');
    const edList = await http('/api/sharing/links', { cookie: ck('editor', W.main) });
    expect([401, 403].includes(edList.status) && !edList.text.includes('"links"'), `An editor must not list share links (${edList.status}).`);
    const edCreate = await http('/api/sharing/links', { cookie: ck('editor', W.main), method: 'POST', body: baseBody(t0) });
    expect([401, 403].includes(edCreate.status), `An editor must not create share links (${edCreate.status}).`);
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: { ...baseBody(t0), confirmation: 'yes' } })).status === 400, 'A wrong confirmation must be refused (400).');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: { ...baseBody(t0), extra: 1 } })).status === 400, 'An unexpected body key must be refused (400).');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: { ...baseBody(t0), kind: 'results' } })).status === 400, 'An unsupported kind (results) must be refused (400).');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: { ...baseBody(t0), targetIds: [T.f] } })).status === 400, 'A foreign-workspace channel must be refused (400).');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: { ...baseBody(t0), targetIds: [T.off] } })).status === 400, 'A disabled channel must be refused (400).');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: { ...baseBody(t0), targetIds: [T.orphan] } })).status === 400, 'An enabled orphan channel without a usable connection must be refused (400).');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: { ...baseBody(t0), kind: 'calendar', decides: true } })).status === 400, 'A deciding calendar link must be refused (400).');
    expect((await http('/api/sharing/links?bogus=1', { cookie: ownerMain })).status === 400 && (await http('/api/sharing/links?page=0', { cookie: ownerMain })).status === 400, 'Invalid list query must be refused (400).');
    expect(await countLinks(W.main) === before, 'A refused create changed the link table.');

    stage = 'link create: persistence and secrets';
    await mk('L1 review decides', { kind: 'review', targetIds: [T.a1], decides: true, allowComments: true });
    await mk('L2 review advice', { kind: 'review', targetIds: [T.a1], decides: false, allowComments: true });
    await mk('L3 calendar', { kind: 'calendar', targetIds: [T.a1, T.a2], daysBack: 7, daysAhead: 30 });
    await mk('L4 portal', { kind: 'portal', targetIds: [T.a1, T.a2], decides: true });
    await mk('L6 review by admin', { kind: 'review', targetIds: [T.a1], decides: true }, ck('admin', W.main));
    await mk('L7 review all channels', { kind: 'review', targetIds: [T.a1, T.a2, T.b], decides: false });
    await mk('L8 rotate', { kind: 'review', targetIds: [T.a1] });
    await mk('L9 revoke', { kind: 'review', targetIds: [T.a1] });
    await mk('L10 expire', { kind: 'review', targetIds: [T.a1] });
    await mk('L11 delete', { kind: 'review', targetIds: [T.a1], decides: true });
    const created = await mk('L12 exact targets', { kind: 'review', targetIds: [T.a1, T.a2], expiresInDays: 10 });
    expect(created.body.url?.startsWith(base.origin) && created.body.url.endsWith(created.body.path) && created.body.expiresInDays === 10, 'Create response must carry an absolute url and the chosen expiry.');
    expect(sameJson((await linkRow(links['L12 exact targets']!.id))?.targetIds, [T.a1, T.a2]), 'Stored targetIds must be exactly the selected channels.');
    const l1 = await linkRow(links['L1 review decides']!.id);
    expect(l1?.decides === true && l1.expiresAt !== null && l1.expiresAt.getTime() > Date.now() + 20 * 86_400_000 && l1.expiresAt.getTime() < Date.now() + 40 * 86_400_000, 'Default expiry (30 days) was not stored.');
    for (const [label, link] of Object.entries(links)) {
      const row = await linkRow(link.id);
      expect(row?.tokenHash === sha(link.token), `${label}: stored digest is not sha256(token).`);
      const dump = (await q<{ t: string }>(Prisma.sql`SELECT to_jsonb(l)::text AS t FROM share_links l WHERE id = ${link.id}`))[0]?.t ?? '';
      expect(!dump.includes(link.token), `${label}: the raw token is stored in the database row.`);
    }
    expect(new Set(Object.values(links).map(l => l.token)).size === Object.keys(links).length && Object.values(links).every(l => /^[A-Za-z0-9_-]{43}$/.test(l.token)), 'Tokens must be unique 32-byte base64url values.');
    const audits1 = await q<{ action: string; detail: unknown }>(Prisma.sql`SELECT action, detail FROM activity_logs WHERE "workspaceId" = ${W.main} AND action = 'sharing.link_created'`);
    expect(audits1.length === Object.keys(links).length, 'Every create must write exactly one audit row.');
    const secretsOf = () => [...Object.values(links).flatMap(l => [l.token, sha(l.token)])];
    expect(leaks(JSON.stringify(audits1), secretsOf()).length === 0, 'Create audits contain a token or digest.');

    stage = 'list, paging and secret omission';
    const list1 = await http('/api/sharing/links', { cookie: ownerMain });
    expect(list1.status === 200 && list1.headers.get('cache-control')?.includes('no-store') === true, 'List must be 200 and no-store.');
    expect(leaks(list1.text, [...secretsOf(), '"path"', '"tokenHash"', '/share/']).length === 0, 'List response exposes a token, digest or secret path.');
    expect(Array.isArray(list1.body?.links) && list1.body.links.length === Object.keys(links).length && list1.body.links.every((l: any) => l.status === 'active'), 'All created links must be listed as active.');
    await save('sharing.pageSize', 5);
    const pageOne = await http('/api/sharing/links?page=1', { cookie: ownerMain }), pageTwo = await http('/api/sharing/links?page=2', { cookie: ownerMain });
    expect(pageOne.body?.links?.length === 5 && pageOne.body.hasMore === true && pageTwo.body?.links?.length === 5 && pageTwo.body.links.every((l: any) => !pageOne.body.links.some((o: any) => o.id === l.id)), 'Root page size 5 was not consumed or pages overlap.');
    await save('sharing.pageSize', 25);
    const foreignLink = await mk('F1 foreign review', { kind: 'review', targetIds: [T.f], decides: true }, ck('foreign', W.foreign));
    const mainList = await http('/api/sharing/links', { cookie: ownerMain });
    expect(!mainList.text.includes(foreignLink.link.id), 'The main workspace list shows a foreign-workspace link.');
    const forgedList = await http('/api/sharing/links', { cookie: ck('foreign', W.main) });
    expect(!forgedList.text.includes(links['L1 review decides']!.id) && !forgedList.text.includes(marker('L1')), 'A forged workspace cookie listed another workspace links.');

    stage = 'public review view (HTTP)';
    const view = (token: string) => http(`/share/${token}`, { origin: null });
    expect((await view(links['L1 review decides']!.token)).status === 200, 'A valid review link must open (200).');
    for (const bad of ['short', 'x'.repeat(65), `${'A'.repeat(42)}!`, randomBytes(32).toString('base64url')]) expect(await shareGone(bad), 'A malformed or unknown token must answer not-found.');
    expect(await isGone(`/share/${links['L1 review decides']!.token}/media/${randomUUID()}`), 'An unknown image id must answer not-found.');

    stage = 'Sharing current connection and platform visibility';
    await db.socialAccount.update({where:{id:syntheticConnection},data:{invalidatedAt:new Date()}});
    expect(!(await view(links['L1 review decides'].token)).text.includes(marker('post pending1')), 'Invalidated connections must hide public post content.');
    expect((await decide(links['L1 review decides'].token, {postId:P.p1,decision:'approved',authorName:'Synthetic disconnected visitor'})).status === 404, 'Invalidated connections must refuse public decisions.');
    const invalidatedChannels=await tool(keys.full,'list_shareable_channels');
    expect(!invalidatedChannels.refused && invalidatedChannels.data?.channels?.length===0, 'Invalidated and orphan connections must disappear from the Sharing picker.');
    await db.socialAccount.update({where:{id:syntheticConnection},data:{invalidatedAt:null}});
    await db.target.update({where:{id:T.a1},data:{enabled:false}});
    expect(!(await view(links['L1 review decides'].token)).text.includes(marker('post pending1')), 'Deselecting a channel must hide its public post content.');
    await db.target.update({where:{id:T.a1},data:{enabled:true}});
    await save('platforms.facebook.enabled',false);
    expect(!(await view(links['L1 review decides'].token)).text.includes(marker('post pending1')), 'A disabled platform must hide public post content.');
    const platformOffChannels=await tool(keys.full,'list_shareable_channels');
    expect(platformOffChannels.refused || platformOffChannels.data?.channels?.length===0, 'Disabled platform channels must disappear from the Sharing picker.');
    await save('platforms.facebook.enabled',true);

    stage = 'public review view (Chromium DOM)';
    const l1Page = await render(`/share/${links['L1 review decides']!.token}`);
    const t = l1Page.text;
    expect(t.includes(marker('post pending1')) && t.includes(marker('post pending2')) && t.includes(marker('post pending4')) && t.includes(marker('post multi')) && t.includes('Waiting for your decision'), 'The review page must show the pending posts of its channel.');
    // Whether already-scheduled posts also appear in review mode is a product choice in flux; only the exclusions below are asserted.
    for (const hidden of ['draft', 'rejected', 'failed', 'betaPending', 'offPending', 'pending3', 'pending6', 'published']) expect(!t.includes(marker(`post ${hidden}`)), `The review page leaked the ${hidden} post (drafts, rejected, failed, other-channel, disabled-channel and published posts are never served).`);
    expect(!t.includes(marker('post foreignPending')) && !t.includes(marker('first comment 1')), 'The review page leaked a foreign post or the first comment.');
    expect(l1Page.robots?.includes('noindex') === true && l1Page.referrer === 'no-referrer', 'Share pages must be noindex with referrer no-referrer.');
    expect(!l1Page.hrefs.some(h => /^javascript:/i.test(h)) && !l1Page.imgs.some(i => i.src.startsWith('http://') || i.src.includes('user:pw')), 'A dangerous link or insecure/credentialed image was rendered.');
    expect(l1Page.imgs.some(i => i.src === 'https://example.test/pixel.png'), 'The https external image was not rendered.');
    const rawShare = (await view(links['L1 review decides']!.token)).text;
    expect(leaks(rawShare, [U.owner, U.editor, U.admin, W.main, sha(links['L1 review decides']!.token), marker('first comment 1')]).length === 0, 'The public page payload contains an internal id, digest or first comment.');
    const phone = await render(`/share/${links['L1 review decides']!.token}`, { width: 390 });
    expect(phone.status === 200 && !phone.overflow, 'The public review page overflows horizontally at 390px.');
    const calPage = await render(`/share/${links['L3 calendar'].token}`);
    expect(calPage.text.includes(marker('post scheduled')) && calPage.text.includes(marker('post published')) && calPage.text.includes('Published') && !calPage.text.includes(marker('post pending1')) && !calPage.text.includes(marker('post draft')), 'The calendar link must show scheduled and published posts only.');
    const portalReview = await render(`/share/${links['L4 portal'].token}`), portalCal = await render(`/share/${links['L4 portal'].token}?tab=calendar`);
    expect(portalReview.text.includes(marker('post pending1')) && portalReview.text.includes(marker('post pending3')) && !portalReview.text.includes(marker('post published')), 'Portal default tab must be the review list.');
    expect(portalCal.text.includes(marker('post published')) && !portalCal.text.includes(marker('post pending1')), 'Portal calendar tab must show the calendar.');
    const allCh = await render(`/share/${links['L7 review all channels'].token}`);
    expect(allCh.text.includes(marker('post betaPending')) && allCh.text.includes(marker('post pending3')) && !allCh.text.includes(marker('post offPending')) && !allCh.text.includes(marker('post draft')), 'An all-channel link must show every enabled channel but never disabled-channel posts or drafts.');
    const exact = await render(`/share/${links['L12 exact targets'].token}`);
    expect(exact.text.includes(marker('post pending3')) && exact.text.includes(marker('post pending1')) && !exact.text.includes(marker('post betaPending')), 'A link with exactly [A1,A2] must not show channel B.');

    stage = 'bounded public request body';
    const beforeOversized = (await decisionsFor(links['L1 review decides'].id)).length;
    const oversized = await decide(links['L1 review decides'].token, { postId: P.p4, decision: 'comment', authorName: 'Synthetic', comment: 'x'.repeat(1048577) });
    expect(oversized.status === 413 && (await decisionsFor(links['L1 review decides'].id)).length === beforeOversized, 'Oversized public bodies must be refused before recording feedback.');

    stage = 'client decisions: long comment approval (Chromium UI)';
    const long = `${'Long client note '.repeat(40)}END`; // ~ 640 characters, above the 500-char review note limit
    const ui = await render(`/share/${links['L1 review decides'].token}`, {
      act: async page => {
        const card = page.locator('li', { hasText: marker('post pending1') }).first();
        await card.locator('input[autocomplete="name"]').fill('Disposable Client');
        await card.locator('textarea').fill(long);
        await card.getByRole('button', { name: 'Approve' }).click();
        await card.getByText('Approved. Thank you.').waitFor({ timeout: 15000 });
      },
    });
    expect(ui.text.includes('Approved. Thank you.'), 'The browser approval did not confirm.');
    const p1 = await postRow(P.p1);
    expect(p1?.status === 'scheduled' && p1.approvalStatus === 'approved' && p1.reviewedById === U.owner, `Approval must settle the post as the link creator (status ${p1?.status}, approval ${p1?.approvalStatus}).`);
    expect((p1?.reviewNote?.length ?? 0) > 0 && (p1?.reviewNote?.length ?? 0) <= 500 && p1?.reviewNote === 'Approved by client via share link', 'The review note must be bounded to 500 characters.');
    const d1 = await decisionsFor(links['L1 review decides'].id);
    expect(d1.length === 1 && d1[0]?.postId === P.p1 && d1[0].decision === 'approved' && d1[0].comment === long.trim() && d1[0].authorName === 'Disposable Client', 'The full long comment and approval must be stored together as one answer.');
    expect(Number((await q<{ n: bigint }>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM root_activities WHERE detail->>'workspaceId' = ${W.main} AND action = 'publishing.post_approved' AND detail->>'postId' = ${P.p1}`))[0]?.n) === 1, 'Approval must write exactly one Publishing audit row.');
    const again = await decide(links['L1 review decides'].token, { postId: P.p1, decision: 'approved', authorName: 'Disposable Client' });
    expect([404, 409].includes(again.status) && (await decisionsFor(links['L1 review decides'].id)).length === 1, 'A second approval of a settled post must conflict (409) and record nothing.');

    stage = 'client decisions: request changes, advice, refusals';
    const rej = await decide(links['L1 review decides'].token, { postId: P.p2, decision: 'rejected', authorName: 'Disposable Client', comment: 'Please change the wording.' });
    expect(rej.status === 201 && rej.body?.recorded === true && rej.body.applied === true && rej.headers.get('x-robots-tag')?.includes('noindex') === true && rej.headers.get('cache-control')?.includes('no-store') === true, 'Request changes must be recorded and applied (201, noindex, no-store).');
    const p2 = await postRow(P.p2);
    expect(p2?.status === 'rejected' && p2.approvalStatus === 'rejected', `Request changes must reject the post (status ${p2?.status}).`);
    expect((await decide(links['L1 review decides'].token, { postId: P.p4, decision: 'rejected', authorName: 'Disposable Client' })).status === 400, 'Request changes without a comment must be refused (400).');
    const adv = await decide(links['L2 review advice'].token, { postId: P.p4, decision: 'approved', authorName: 'Advisor' });
    expect(adv.status === 201 && adv.body?.recorded === true && adv.body.applied === false, 'On a non-deciding link an approval is recorded as advice only.');
    expect((await postRow(P.p4))?.status === 'pending_approval', 'Advice must not change the post.');
    const note = await decide(links['L2 review advice'].token, { postId: P.p4, decision: 'comment', authorName: 'Advisor', comment: 'Looks fine to me.' });
    expect(note.status === 201 && note.body?.applied === false && note.body.decision === 'comment', 'A comment must be recorded as advice.');
    expect((await decisionsFor(links['L2 review advice'].id)).length === 2, 'Both advice answers must be stored.');
    const multi = await decide(links['L1 review decides'].token, { postId: P.multi, decision: 'approved', authorName: 'Disposable Client' });
    expect(multi.status === 409 && (await postRow(P.multi))?.status === 'pending_approval', 'A post also going to a channel outside the link cannot be decided by the client.');
    for (const [label, postId] of [['draft', P.draft], ['rejected', P.rejected], ['failed', P.failed], ['foreign', P.foreign], ['other-channel', P.betaPending], ['unknown', id('nope')]] as const) {
      expect((await decide(links['L1 review decides'].token, { postId, decision: 'comment', authorName: 'x1', comment: 'hello' })).status === 404, `A decision on a ${label} post must answer not-found (404).`);
    }
    expect((await decide(links['L3 calendar'].token, { postId: P.scheduled, decision: 'comment', authorName: 'x1', comment: 'hello' })).status === 404, 'A calendar link must not accept answers.');
    expect((await decide(links['L1 review decides'].token, { postId: P.p4, decision: 'comment', authorName: 'Disposable Client', comment: 'x' }, { origin: null })).status === 403, 'A decision without Origin must be refused.');
    expect((await decide(links['L1 review decides'].token, { postId: P.p4, decision: 'comment', authorName: 'x', comment: 'x' }, { origin: 'http://evil.example' })).status === 403, 'A cross-origin decision must be refused.');
    expect((await decide(links['L1 review decides'].token, { postId: P.p4, decision: 'comment', comment: 'x' })).status === 400, 'A decision without a name must be refused (400).');
    expect((await decide(links['L1 review decides'].token, { postId: P.p4, decision: 'approved', authorName: 'x', extra: 1 })).status === 400, 'Unexpected decision keys must be refused (400).');
    expect((await decide(randomBytes(32).toString('base64url'), { postId: P.p4, decision: 'comment', authorName: 'x', comment: 'x' })).status === 404, 'An unknown token must answer not-found on decide.');
    const fb = await http(`/api/sharing/links/${links['L1 review decides'].id}/feedback`, { cookie: ownerMain });
    expect(fb.status === 200 && fb.body?.feedback?.length === 2, 'Owner feedback must list the two applied answers.');
    const fbApproved = fb.body?.feedback?.find((f: any) => f.postId === P.p1);
    expect(fbApproved?.decision === 'approved' && fbApproved.postStatus === 'scheduled' && fbApproved.comment === long.trim(), 'Feedback must show the post current status (the actual effect) and the full comment.');
    expect(!fb.text.includes(links['L1 review decides'].token) && !fb.text.includes(sha(links['L1 review decides'].token)), 'Feedback exposes the token or digest.');
    expect((await http(`/api/sharing/links/${foreignLink.link.id}/feedback`, { cookie: ownerMain })).status === 404, 'Feedback of a foreign-workspace link must be not-found.');

    stage = 'atomicity: connection invalidation after review preflight';
    const invalidConnection=id('connection_invalid_review');
    await db.socialAccount.create({data:{id:invalidConnection,workspaceId:W.main,provider:'facebook',providerUserId:invalidConnection,name:'Synthetic invalid review connection',accessToken:'synthetic-never-used',scopes:'',invalidatedAt:new Date()}});
    const guardedPost=await post('connection_review_race',W.main,[T.a1,T.a2],'pending_approval',{scheduledAt:days(2)});
    const guardedLink=await mk('L guarded connection race',{kind:'review',targetIds:[T.a1,T.a2],decides:true});
    let inFlightDecision:ReturnType<typeof decide>|undefined;
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM posts WHERE id=${guardedPost} FOR UPDATE`;
      const backend=(await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      inFlightDecision=decide(guardedLink.link.token,{postId:guardedPost,decision:'approved',authorName:'Synthetic connection racer'});
      let reachedPostLock=false;
      for(let attempt=0;attempt<60;attempt++){
        const waiting=await db.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE ${backend} = ANY(pg_blocking_pids(a.pid))) AS waiting`;
        if(waiting[0]?.waiting){reachedPostLock=true;break;}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      expect(reachedPostLock,'The review race did not reach its verified post-row blocker.');
      await tx.target.update({where:{id:T.a2},data:{socialAccountId:invalidConnection}});
    },{timeout:10000});
    const racedDecision=await inFlightDecision!;
    expect([404,409].includes(racedDecision.status) && (await postRow(guardedPost))?.status==='pending_approval' && (await decisionsFor(guardedLink.link.id)).length===0, 'A mixed post with a newly invalidated destination must not approve or store feedback after preflight.');
    await db.target.update({where:{id:T.a2},data:{socialAccountId:syntheticConnection}});

    stage = 'comments switched off';
    await mk('L5 no comments', { kind: 'review', targetIds: [T.a2], decides: true, allowComments: false });
    const noComment = await decide(links['L5 no comments'].token, { postId: P.p3, decision: 'comment', authorName: 'x1', comment: 'hello' });
    expect(noComment.status === 400 && (await decisionsFor(links['L5 no comments'].id)).length === 0, 'A comment on a link with comments off must be refused and not stored.');

    stage = 'atomicity: approval racing revocation';
    for (const [round, postId] of [[1, P.p3], [2, P.p6]] as const) {
      const link = await mk(`L5R${round} race`, { kind: 'review', targetIds: [T.a2], decides: true });
      const [d, r] = await Promise.all([
        decide(link.link.token, { postId, decision: 'approved', authorName: 'Racer' }),
        http(`/api/sharing/links/${link.link.id}`, { cookie: ownerMain, method: 'POST', body: { action: 'revoke', confirmation: `REVOKE SHARE LINK ${link.link.id}` } }),
      ]);
      const status = (await postRow(postId))?.status, recorded = (await decisionsFor(link.link.id)).length;
      expect(r.status === 200 && (await linkRow(link.link.id))?.revokedAt !== null, `Race ${round}: the revocation must always succeed.`);
      expect((recorded === 1 && status === 'scheduled' && d.status === 201) || (recorded === 0 && status === 'pending_approval' && d.status === 404), `Race ${round}: approval and stored answer must commit or fail together (decision http ${d.status}, answers ${recorded}, post ${status}).`);
    }
    const afterRevoke = await decide(links['L5R1 race'].token, { postId: P.p3, decision: 'comment', authorName: 'x1', comment: 'late' });
    expect(afterRevoke.status === 404, 'An answer through a revoked link must be not-found.');

    stage = 'rotate, revoke, expire, delete';
    const l8Old = links['L8 rotate'].token;
    const rot = await http(`/api/sharing/links/${links['L8 rotate'].id}`, { cookie: ownerMain, method: 'POST', body: { action: 'rotate', confirmation: `ROTATE SHARE LINK ${links['L8 rotate'].id}` } });
    expect(rot.status === 200 && typeof rot.body?.path === 'string' && rot.body.url?.startsWith(base.origin), 'Rotate must return the new secret path once.');
    if (rot.status === 200 && typeof rot.body?.path === 'string') {
      links['L8 rotate'] = { id: links['L8 rotate'].id, token: tokenOf(rot.body.path) };
      expect(await shareGone(l8Old), 'The old rotated address must stop working.');
      expect((await view(links['L8 rotate'].token)).status === 200, 'The new rotated address must work.');
      expect((await linkRow(links['L8 rotate'].id))?.tokenHash === sha(links['L8 rotate'].token), 'Rotation must store the new digest only.');
    }
    expect((await http(`/api/sharing/links/${links['L8 rotate'].id}`, { cookie: ownerMain, method: 'POST', body: { action: 'rotate', confirmation: 'ROTATE SHARE LINK nope' } })).status === 400, 'Rotate with a wrong confirmation must be refused.');
    const rev = await http(`/api/sharing/links/${links['L9 revoke'].id}`, { cookie: ownerMain, method: 'POST', body: { action: 'revoke', confirmation: `REVOKE SHARE LINK ${links['L9 revoke'].id}` } });
    expect(rev.status === 200 && rev.body?.status === 'revoked' && await shareGone(links['L9 revoke'].token), 'Revoke must end public access at once.');
    expect((await http(`/api/sharing/links/${links['L9 revoke'].id}`, { cookie: ownerMain, method: 'POST', body: { action: 'revoke', confirmation: `REVOKE SHARE LINK ${links['L9 revoke'].id}` } })).status === 200, 'Revoking twice must stay a success.');
    const rotRevoked = await http(`/api/sharing/links/${links['L9 revoke'].id}`, { cookie: ownerMain, method: 'POST', body: { action: 'rotate', confirmation: `ROTATE SHARE LINK ${links['L9 revoke'].id}` } });
    expect(rotRevoked.status === 409, `Rotating a revoked link must conflict (${rotRevoked.status}).`);
    await q(Prisma.sql`UPDATE share_links SET "expiresAt" = NOW() - INTERVAL '1 hour' WHERE id = ${links['L10 expire'].id}`);
    expect(await shareGone(links['L10 expire'].token), 'An expired link must answer not-found.');
    const legacyToken = randomBytes(32).toString('base64url'), legacyId = id('legacy_link');
    await q(Prisma.sql`INSERT INTO share_links (id, "workspaceId", kind, "tokenHash", title, "targetIds", "daysBack", "daysAhead", "allowComments", decides, "createdById", "createdAt") VALUES (${legacyId}, ${W.main}, 'review', ${sha(legacyToken)}, ${marker('legacy no expiry')}, ${JSON.stringify([T.a1])}::jsonb, 7, 30, true, false, ${U.owner}, NOW())`);
    expect(await shareGone(legacyToken), 'A migrated link without an expiry must never be served.');
    const statusList = await http('/api/sharing/links', { cookie: ownerMain });
    const byId = new Map<string, any>((statusList.body?.links ?? []).map((l: any) => [l.id, l]));
    expect(byId.get(links['L9 revoke'].id)?.status === 'revoked' && byId.get(links['L10 expire'].id)?.status === 'expired' && byId.get(legacyId)?.status === 'expired' && byId.get(links['L1 review decides'].id)?.status === 'active', 'The owner list must report active/revoked/expired states.');
    expect(byId.get(links['L1 review decides'].id)?.feedbackCount === 2 && byId.get(links['L2 review advice'].id)?.feedbackCount === 2, 'List feedback counts must match stored answers.');
    expect((await http(`/api/sharing/links/${links['L10 expire'].id}`, { cookie: ownerMain, method: 'POST', body: { action: 'rotate', confirmation: `ROTATE SHARE LINK ${links['L10 expire'].id}` } })).status === 409, 'Rotating an expired link must conflict.');
    await q(Prisma.sql`INSERT INTO review_decisions (id, "shareLinkId", "postId", decision, comment, "authorName", "createdAt") VALUES (${id('dec_l11')}, ${links['L11 delete'].id}, ${P.p4}, 'comment', 'synthetic', 'Synthetic', NOW())`);
    expect((await http(`/api/sharing/links/${links['L11 delete'].id}`, { cookie: ownerMain, method: 'DELETE', body: { confirmation: 'DELETE SHARE LINK nope' } })).status === 400, 'Delete with a wrong confirmation must be refused.');
    const del = await http(`/api/sharing/links/${links['L11 delete'].id}`, { cookie: ownerMain, method: 'DELETE', body: { confirmation: `DELETE SHARE LINK ${links['L11 delete'].id}` } });
    expect(del.status === 200 && del.body?.deleted === true && del.body.feedbackRemoved === 1, 'Delete must remove the link and its feedback.');
    expect(!(await linkRow(links['L11 delete'].id)) && (await decisionsFor(links['L11 delete'].id)).length === 0 && await shareGone(links['L11 delete'].token), 'A deleted link, its answers and its public address must be gone.');
    expect((await postRow(P.p4))?.status === 'pending_approval', 'Deleting a link must not change posts.');
    const auditActions = (await q<{ action: string }>(Prisma.sql`SELECT DISTINCT action FROM activity_logs WHERE "workspaceId" = ${W.main} AND action LIKE 'sharing.%'`)).map(r => r.action);
    for (const action of ['sharing.link_created', 'sharing.link_revoked', 'sharing.link_rotated', 'sharing.link_deleted']) expect(auditActions.includes(action), `Missing audit action ${action}.`);

    stage = 'optimistic editing and deliberate renewal';
    const editing = links['L12 exact targets'];
    const editVersion = byId.get(editing.id)?.version;
    check(typeof editVersion === 'string', 'Owner list must expose an editing version.');
    const patch = (linkId: string, body: unknown) => http(`/api/sharing/links/${linkId}`, { cookie: ownerMain, method: 'PATCH', body });
    const beforeEditHash = (await linkRow(editing.id))?.tokenHash;
    const renamed = await patch(editing.id, { expectedVersion: editVersion, title: marker('Renamed exact targets') });
    expect(renamed.status === 200 && renamed.body?.rotated === false && !renamed.body?.path && (await linkRow(editing.id))?.tokenHash === beforeEditHash, 'Metadata editing must keep the current address and return no secret.');
    const stale = await patch(editing.id, { expectedVersion: editVersion, title: marker('Stale overwrite') });
    expect(stale.status === 409 && (await linkRow(editing.id))?.tokenHash === beforeEditHash, 'Stale edits must conflict without replacing the address.');
    const accessChange = { expectedVersion: renamed.body?.version, targetIds: [T.a1] };
    expect((await patch(editing.id, accessChange)).status === 400, 'Access editing requires explicit confirmation.');
    const narrowed = await patch(editing.id, { ...accessChange, confirmation: `UPDATE SHARE LINK ${editing.id}` });
    expect(narrowed.status === 200 && narrowed.body?.rotated === true && typeof narrowed.body?.path === 'string', 'Confirmed channel editing must rotate the address.');
    if (typeof narrowed.body?.path === 'string') {
      const oldToken = editing.token; editing.token = tokenOf(narrowed.body.path);
      expect(await shareGone(oldToken) && (await view(editing.token)).status === 200 && sameJson((await linkRow(editing.id))?.targetIds, [T.a1]), 'Narrowed address must replace the old token and persist only the chosen channel.');
    }
    const expired = links['L10 expire'];
    const renewed = await patch(expired.id, { expectedVersion: byId.get(expired.id)?.version, expiresInDays: 14, confirmation: `UPDATE SHARE LINK ${expired.id}` });
    expect(renewed.status === 200 && renewed.body?.rotated === true && renewed.body?.expiresInDays === 14, 'Deliberately renewing an expired link must issue a new bounded address.');
    if (typeof renewed.body?.path === 'string') {
      const oldToken = expired.token; expired.token = tokenOf(renewed.body.path);
      expect(await shareGone(oldToken) && (await view(expired.token)).status === 200, 'Renewal must leave the old expired address unusable.');
    }

    stage = 'tenant isolation';
    const fRevoke = await http(`/api/sharing/links/${links['L1 review decides'].id}`, { cookie: ck('foreign', W.foreign), method: 'POST', body: { action: 'revoke', confirmation: `REVOKE SHARE LINK ${links['L1 review decides'].id}` } });
    const fDelete = await http(`/api/sharing/links/${links['L1 review decides'].id}`, { cookie: ck('foreign', W.foreign), method: 'DELETE', body: { confirmation: `DELETE SHARE LINK ${links['L1 review decides'].id}` } });
    const fRotate = await http(`/api/sharing/links/${links['L1 review decides'].id}`, { cookie: ck('foreign', W.foreign), method: 'POST', body: { action: 'rotate', confirmation: `ROTATE SHARE LINK ${links['L1 review decides'].id}` } });
    expect([fRevoke.status, fDelete.status, fRotate.status].every(s => s === 404) && (await linkRow(links['L1 review decides'].id))?.revokedAt === null, 'A foreign owner must not revoke, delete or rotate another workspace link.');
    expect((await view(links['L1 review decides'].token)).status === 200 && !(await render(`/share/${foreignLink.link.token}`)).text.includes(marker('post pending1')), 'A foreign token must show only foreign content, and tenant links must stay intact.');
    const fPage = await render(`/share/${foreignLink.link.token}`);
    expect(fPage.text.includes(marker('post foreignPending')) && !fPage.text.includes(marker('post pending1')), 'The foreign link must show its own pending post only.');

    stage = 'creator authority, feature, suspension and erasure state';
    expect((await view(links['L6 review by admin'].token)).status === 200, 'An admin-created link must open while the admin is an admin.');
    await q(Prisma.sql`UPDATE memberships SET role = 'editor'::"WorkspaceRole" WHERE id = ${adminMembership}`);
    expect(await shareGone(links['L6 review by admin'].token), 'A link whose creator lost owner/admin authority must stop opening.');
    await q(Prisma.sql`UPDATE memberships SET role = 'admin'::"WorkspaceRole" WHERE id = ${adminMembership}`);
    expect((await view(links['L6 review by admin'].token)).status === 200, 'The link must recover when the creator authority returns.');
    await save('entitlements.features.settings/sharing', false);
    expect(await shareGone(links['L1 review decides'].token), 'Public links must stop when the Client sharing feature is off.');
    const offList = await http('/api/sharing/links', { cookie: ownerMain });
    expect([401, 403].includes(offList.status) && !offList.text.includes('"links"'), `The owner API must refuse while the feature is off (${offList.status}).`);
    expect(!(await toolNames(keys.full)).includes('list_share_links') && !(await resourceUris(keys.full)).includes('msp://settings/sharing'), 'MCP must hide sharing tools/resources while the feature is off.');
    const offTool = await tool(keys.full, 'list_share_links');
    expect(offTool.refused, 'MCP list_share_links must fail while the feature is off.');
    await save('entitlements.features.settings/sharing', true);
    expect((await view(links['L1 review decides'].token)).status === 200, 'Public links must recover when the feature returns.');
    const purgeLink = await mk('P1 purge workspace', { kind: 'review', targetIds: [T.purge] }, ck('owner', W.purge));
    expect((await view(purgeLink.link.token)).status === 200, 'The purge-workspace link must open before the state change.');
    await q(Prisma.sql`UPDATE workspaces SET "suspendedAt" = NOW() WHERE id = ${W.purge}`);
    expect(await shareGone(purgeLink.link.token), 'A suspended workspace link must answer not-found.');
    const susWrite = await http('/api/sharing/links', { cookie: ck('owner', W.purge), method: 'POST', body: { kind: 'review', title: marker('susp'), targetIds: [T.purge], confirmation: confirmCreate(marker('susp')) } });
    expect(susWrite.status === 403, `Creating in a suspended workspace must be forbidden (${susWrite.status}).`);
    await q(Prisma.sql`UPDATE workspaces SET "suspendedAt" = NULL WHERE id = ${W.purge}`);
    await db.workspaceDataPurge.create({ data: { workspaceId: W.purge, status: 'requested', requestedById: U.owner, mediaRoot: mediaDir } });
    expect(await shareGone(purgeLink.link.token), 'A workspace under erasure must not serve its links.');
    const purgeWrite = await http('/api/sharing/links', { cookie: ck('owner', W.purge), method: 'POST', body: { kind: 'review', title: marker('purge'), targetIds: [T.purge], confirmation: confirmCreate(marker('purge')) } });
    const purgeRead = await http('/api/sharing/links', { cookie: ck('owner', W.purge) });
    expect(purgeWrite.status >= 400 && purgeRead.status >= 400 && !purgeRead.text.includes('"links"'), `Reads and writes must be refused while erasure runs (${purgeRead.status}/${purgeWrite.status}).`);
    await db.workspaceDataPurge.deleteMany({ where: { workspaceId: W.purge } });

    stage = 'Root bounds consumed';
    await save('sharing.defaultExpiryDays', 3);
    await save('sharing.maxExpiryDays', 5);
    const tooLong = marker('too long');
    expect((await http('/api/sharing/links', { cookie: ownerMain, method: 'POST', body: { kind: 'review', title: tooLong, targetIds: [T.a1], expiresInDays: 6, confirmation: confirmCreate(tooLong) } })).status === 400, 'The Root maximum link lifetime was not consumed.');
    await save('sharing.maxExpiryDays', 180);
    await save('sharing.defaultExpiryDays', 30);

    stage = 'uploaded image preview';
    const form = new FormData(); form.append('imageFile', new File([new Uint8Array(PNG)], 'pixel.png', { type: 'image/png' }));
    const up = await fetch(new URL('/api/media', base), { method: 'POST', headers: { origin: base.origin, cookie: ownerMain }, body: form, signal: AbortSignal.timeout(30000) });
    const upBody: any = await up.json().catch(() => null);
    expect(up.status === 200 && typeof upBody?.id === 'string' && upBody.reference === `media:${upBody.id}`, `The real owned upload API did not accept the 1px image (${up.status}).`);
    if (up.status === 200 && upBody?.id) {
      const imageId: string = upBody.id;
      const files: string[] = await readdir(path.join(mediaDir, W.main, 'images')).catch((): string[] => []);
      expect(files.includes(imageId), 'The uploaded file is not in workspace storage.');
      P.p5 = await post('pending5', W.main, [T.a1], 'pending_approval', { scheduledAt: days(4), media: [{ kind: 'image', url: `media:${imageId}` }, { kind: 'image', url: `media:${randomUUID()}` }] });
      const imgLink = await mk('L13 image', { kind: 'review', targetIds: [T.a1] });
      const img = await fetch(new URL(`/share/${imgLink.link.token}/media/${imageId}`, base), { signal: AbortSignal.timeout(30000) });
      const bytes = Buffer.from(await img.arrayBuffer());
      expect(img.status === 200 && bytes.equals(PNG) && img.headers.get('content-type') === 'image/png' && img.headers.get('x-content-type-options') === 'nosniff' && img.headers.get('cache-control')?.includes('no-store') === true && /sandbox/.test(img.headers.get('content-security-policy') ?? ''), 'The shared image preview must serve the exact bytes with nosniff, no-store and a sandbox CSP.');
      const pageWithImage = await render(`/share/${imgLink.link.token}`);
      expect(pageWithImage.imgs.some(i => i.src === `/share/${imgLink.link.token}/media/${imageId}` && i.width === 1), 'The share page did not load the uploaded image through the token-gated route.');
      expect(await isGone(`/share/${links['L3 calendar'].token}/media/${imageId}`), 'A link that does not show the post must not serve the image.');
      expect(await isGone(`/share/${imgLink.link.token}/media/${randomUUID()}`) && await isGone(`/share/${imgLink.link.token}/media/..%2F..%2Fetc%2Fpasswd`), 'Unreferenced or traversal image ids must be not-found.');
      expect(await isGone(`/share/${foreignLink.link.token}/media/${imageId}`), 'A foreign link must not serve another workspace image.');
      await http(`/api/sharing/links/${imgLink.link.id}`, { cookie: ownerMain, method: 'POST', body: { action: 'revoke', confirmation: `REVOKE SHARE LINK ${imgLink.link.id}` } });
      expect(await isGone(`/share/${imgLink.link.token}/media/${imageId}`), 'A revoked link must stop serving the image.');
      const dangling = `${randomUUID()}`;
      expect(await isGone(`/share/${links['L1 review decides'].token}/media/${dangling}`), 'A referenced-but-missing image must answer not-found without leaking.');
      expect((await view(links['L1 review decides'].token)).status === 200, 'The link must keep working with a missing referenced image.');
    }

    stage = 'MCP: catalog, ceilings and confirmations';
    expect((await rpc('tools/list', {}, keys.editor)).status === 401 && (await rpc('tools/list', {}, keys.revoked)).status === 401 && (await rpc('tools/list', {})).status === 401, 'Editor-created, revoked and anonymous MCP access must be refused (401).');
    const SHARE_TOOLS = ['list_share_links', 'list_shareable_channels', 'list_share_feedback', 'create_share_link', 'update_share_link', 'revoke_share_link', 'rotate_share_link', 'delete_share_link'], BIO_TOOLS = ['get_bio_page', 'save_bio_page', 'delete_bio_page'];
    const fullTools = await toolNames(keys.full);
    expect([...SHARE_TOOLS, ...BIO_TOOLS].every(n => fullTools.includes(n)), 'The full key must see all eleven sharing/bio tools.');
    const roTools = await toolNames(keys.ro);
    expect(['list_share_links', 'list_shareable_channels', 'list_share_feedback', 'get_bio_page'].every(n => roTools.includes(n)) && ['create_share_link', 'update_share_link', 'revoke_share_link', 'rotate_share_link', 'delete_share_link', 'save_bio_page', 'delete_bio_page'].every(n => !roTools.includes(n)), 'The read-only key must see read tools only.');
    const bioTools = await toolNames(keys.bioOnly);
    expect(BIO_TOOLS.every(n => bioTools.includes(n)) && SHARE_TOOLS.every(n => !bioTools.includes(n)), 'A bio-only key must not see sharing tools.');
    const fullRes = await resourceUris(keys.full), roRes = await resourceUris(keys.ro), bioRes = await resourceUris(keys.bioOnly);
    expect(fullRes.includes('msp://settings/sharing') && fullRes.includes('msp://settings/bio') && roRes.includes('msp://settings/sharing') && bioRes.includes('msp://settings/bio') && !bioRes.includes('msp://settings/sharing'), 'MCP resources must follow the key feature ceiling.');
    expect((await readResource(keys.bioOnly, 'msp://settings/sharing')).refused, 'A bio-only key must not read the sharing resource.');
    const roCalls = [['create_share_link', { kind: 'review', title: marker('mcp ro'), targetIds: [T.a1], confirmation: confirmCreate(marker('mcp ro')) }], ['revoke_share_link', { id: links['L1 review decides'].id, confirmation: `REVOKE SHARE LINK ${links['L1 review decides'].id}` }], ['rotate_share_link', { id: links['L1 review decides'].id, confirmation: `ROTATE SHARE LINK ${links['L1 review decides'].id}` }], ['delete_share_link', { id: links['L1 review decides'].id, confirmation: `DELETE SHARE LINK ${links['L1 review decides'].id}` }], ['save_bio_page', { slug: bioSlug, title: 'x', links: [], confirmation: `SAVE BIO PAGE ${bioSlug}` }]] as const;
    for (const [name, args] of roCalls) { const r = await tool(keys.ro, name, args); expect(r.refused, `Read-only key: ${name} must be refused.`); }
    expect((await linkRow(links['L1 review decides'].id))?.revokedAt === null, 'A read-only key changed a link.');
    expect((await tool(keys.full, 'list_share_links', { bogus: 1 })).refused && (await tool(keys.full, 'list_share_links', { page: 0 })).refused, 'MCP must reject invalid list arguments.');
    const mcpBefore = await countLinks(W.main);
    const badConfirm = await tool(keys.full, 'create_share_link', { kind: 'review', title: marker('mcp bad'), targetIds: [T.a1], confirmation: 'nope' });
    expect(badConfirm.refused && await countLinks(W.main) === mcpBefore, 'MCP create with a wrong confirmation must be refused without a row.');
    const mcpTitle = marker('M1 mcp exact');
    const mcpCreate = await tool(keys.full, 'create_share_link', { kind: 'review', title: mcpTitle, targetIds: [T.a1, T.a2], decides: true, confirmation: confirmCreate(mcpTitle) });
    expect(!mcpCreate.refused && typeof mcpCreate.data?.path === 'string', 'MCP create with the exact confirmation must succeed.');
    if (typeof mcpCreate.data?.path === 'string') {
      links.M1 = { id: mcpCreate.data.id, token: tokenOf(mcpCreate.data.path) };
      const provenance = await q<{ detail: any }>(Prisma.sql`SELECT detail FROM activity_logs WHERE "workspaceId" = ${W.main} AND action = 'sharing.link_created' AND detail->>'linkId' = ${links.M1.id}`);
      expect(provenance.length === 1 && provenance[0]?.detail?.apiKeyId === keyIds.full && provenance[0]?.detail?.authSource === 'api_key' && !JSON.stringify(provenance).includes(keys.full), 'MCP domain audit must identify the key without storing its credential.');
      expect(sameJson((await linkRow(links.M1.id))?.targetIds, [T.a1, T.a2]) && (await linkRow(links.M1.id))?.tokenHash === sha(links.M1.token), 'MCP create must store exactly the selected targets and a digest only.');
      expect((await view(links.M1.token)).status === 200, 'An MCP-created link must open.');
      const mcpRotate = await tool(keys.full, 'rotate_share_link', { id: links.M1.id, confirmation: `ROTATE SHARE LINK ${links.M1.id}` });
      expect(!mcpRotate.refused && typeof mcpRotate.data?.path === 'string', 'MCP rotate must succeed.');
      if (typeof mcpRotate.data?.path === 'string') { const old = links.M1.token; links.M1.token = tokenOf(mcpRotate.data.path); expect(await shareGone(old) && (await view(links.M1.token)).status === 200, 'MCP rotation must replace the address.'); }
      const mcpFeedback = await tool(keys.full, 'list_share_feedback', { id: links['L1 review decides'].id });
      expect(!mcpFeedback.refused && mcpFeedback.data?.feedback?.length === 2, 'MCP feedback must list the stored answers.');
      expect(!(await tool(keys.foreign, 'list_share_feedback', { id: links['L1 review decides'].id })).data?.feedback, 'A foreign key must not read another workspace feedback.');
      const fRev = await tool(keys.foreign, 'revoke_share_link', { id: links['L1 review decides'].id, confirmation: `REVOKE SHARE LINK ${links['L1 review decides'].id}` });
      expect(fRev.refused && (await linkRow(links['L1 review decides'].id))?.revokedAt === null, 'A foreign key must not revoke another workspace link.');
      const mcpRevoke = await tool(keys.full, 'revoke_share_link', { id: links.M1.id, confirmation: `REVOKE SHARE LINK ${links.M1.id}` });
      expect(!mcpRevoke.refused && await shareGone(links.M1.token), 'MCP revoke must end public access.');
      const mcpDelete = await tool(keys.full, 'delete_share_link', { id: links.M1.id, confirmation: `DELETE SHARE LINK ${links.M1.id}` });
      expect(!mcpDelete.refused && !(await linkRow(links.M1.id)), 'MCP delete must remove the link.');
    }
    const decidingLink = links['L1 review decides'];
    const secretBeforeRefusal = (await linkRow(decidingLink.id))?.tokenHash;
    for (const key of [keys.settingsOnly, keys.noApprove]) {
      expect((await tool(key, 'rotate_share_link', { id: decidingLink.id, confirmation: `ROTATE SHARE LINK ${decidingLink.id}` })).refused, 'Settings-only or approval-read-only keys must not rotate a deciding credential.');
    }
    const linkList = await tool(keys.full, 'list_share_links');
    const decidingVersion = linkList.data?.links?.find((l: any) => l.id === decidingLink.id)?.version;
    expect((await tool(keys.noApprove, 'update_share_link', { id: decidingLink.id, expectedVersion: decidingVersion, expiresInDays: 14, confirmation: `UPDATE SHARE LINK ${decidingLink.id}` })).refused, 'A key without approval write must not renew a deciding credential.');
    expect((await linkRow(decidingLink.id))?.tokenHash === secretBeforeRefusal, 'Denied credential minting must preserve the existing digest.');
    const nonDecider = links['L2 review advice'];
    expect((await tool(keys.settingsOnly, 'rotate_share_link', { id: nonDecider.id, confirmation: `ROTATE SHARE LINK ${nonDecider.id}` })).refused, 'A Settings-only key must not mint even a non-deciding Publishing credential.');

    const noAppr = await tool(keys.noApprove, 'create_share_link', { kind: 'review', title: marker('mcp noappr'), targetIds: [T.a1], decides: true, confirmation: confirmCreate(marker('mcp noappr')) });
    expect(noAppr.refused, 'A key without the approvals ceiling must not create a deciding link.');
    const noApprOk = await tool(keys.noApprove, 'create_share_link', { kind: 'review', title: marker('M2 mcp noappr ok'), targetIds: [T.a1], decides: false, confirmation: confirmCreate(marker('M2 mcp noappr ok')) });
    expect(!noApprOk.refused, 'A key with approval read but no approval write may create a non-deciding link.');
    if (noApprOk.data?.path) links.M2 = { id: noApprOk.data.id, token: tokenOf(noApprOk.data.path) };
    for (const bad of [[T.f], [T.off], ['no such channel']]) expect((await tool(keys.full, 'create_share_link', { kind: 'review', title: marker('mcp ch'), targetIds: bad, confirmation: confirmCreate(marker('mcp ch')) })).refused, 'MCP create must refuse foreign, disabled or unknown channels.');
    const ch = await tool(keys.full, 'list_shareable_channels');
    expect(sameJson(ch.data?.channels?.map((c: any) => c.id).sort(), [T.a1, T.a2, T.b].sort()), 'Shareable channels must be exactly the enabled channels of the workspace.');
    await save('mcp.maxResultItems', 2);
    const capList = await tool(keys.full, 'list_share_links'), capCh = await tool(keys.full, 'list_shareable_channels');
    expect(capList.data?.links?.length === 2 && capList.data.hasMore === true && capCh.data?.channels?.length === 2, 'The MCP result ceiling (2) was not applied to links/channels.');
    const capRes = await readResource(keys.full, 'msp://settings/sharing');
    expect(capRes.data?.links?.length === 2, 'The MCP result ceiling was not applied to the sharing resource.');
    await save('mcp.maxResultItems', 100);
    const roRead = await readResource(keys.ro, 'msp://settings/sharing');
    expect(!roRead.refused && Array.isArray(roRead.data?.links), 'A read-only key must read the sharing resource.');
    expect(leaks(JSON.stringify([capRes.text, roRead.text, capList.text]), secretsOf()).length === 0 && !/"tokenHash"|"path"/.test(roRead.text), 'MCP reads must not expose tokens, digests or secret paths.');

    stage = 'MCP: channel ceiling probe';
    const scopedCh = await tool(keys.scoped, 'list_shareable_channels');
    const scopedIds: string[] = (scopedCh.data?.channels ?? []).map((c: any) => c.id).sort();
    if (sameJson(scopedIds, [T.a1])) {
      const scopedAll = await tool(keys.scoped, 'create_share_link', { kind: 'review', title: marker('mcp sc all'), targetIds: [], confirmation: confirmCreate(marker('mcp sc all')) });
      const scopedOut = await tool(keys.scoped, 'create_share_link', { kind: 'review', title: marker('mcp sc out'), targetIds: [T.a2], confirmation: confirmCreate(marker('mcp sc out')) });
      const scopedIn = await tool(keys.scoped, 'create_share_link', { kind: 'review', title: marker('M3 mcp sc in'), targetIds: [T.a1], confirmation: confirmCreate(marker('M3 mcp sc in')) });
      expect(scopedAll.refused && scopedOut.refused && !scopedIn.refused, 'A channel-scoped key must not create a blanket or out-of-scope link, only an in-scope one.');
      const scopedList = await tool(keys.scoped, 'list_share_links');
      expect(scopedList.data?.links?.every((l: any) => l.targetIds.length > 0 && l.targetIds.every((t: string) => t === T.a1)), 'A channel-scoped key must list only links wholly inside its scope.');
      if (scopedIn.data?.path) links.M3 = { id: scopedIn.data.id, token: tokenOf(scopedIn.data.path) };
    } else {
      expect(false, `Channel-scoped Sharing keys are unreachable with real fixtures: the sharing manager roles (owner/admin) always resolve to unrestricted channel scope (resolvePermissions), so list_shareable_channels for an admin with allPages=false and one channel grant returned ${scopedIds.length} channels. The actor.allowedTargetIds ceiling in modules/sharing is covered only by unit tests, not end to end, and no scoped key can be fixtured to prove "no blanket channels".`);
    }

    stage = 'MCP independent resource issuance and sibling account isolation';
    const issueBody={name:marker('API scoped key'),readFeatures:[S,A,'publishing/posts','ads/campaigns','analytics/overview','settings/connections','settings/data'],writeFeatures:[S,A,'settings/data'],expiresInDays:30,resourceScope:{version:1,mode:'selected',ids:[],adAccountIds:[adA]},confirmation:`CREATE MCP KEY ${marker('API scoped key')}`};
    const foreignScope=await http('/api/settings/mcp-keys',{cookie:ownerMain,method:'POST',body:{...issueBody,resourceScope:{version:1,mode:'selected',ids:[T.f],adAccountIds:[]}}});
    expect(foreignScope.status===403,'Key issuance must refuse a foreign channel identity.');
    const issued=await http('/api/settings/mcp-keys',{cookie:ownerMain,method:'POST',body:issueBody});
    check(issued.status===201&&typeof issued.body?.token==='string','Explicit account-only API key issuance failed.');
    const issuedToken=issued.body.token,issuedId=issued.body.key.id;
    const storedKey=await q<{tokenHash:string;resourceScope:unknown}>(Prisma.sql`SELECT "tokenHash","resourceScope" FROM mcp_api_keys WHERE id=${issuedId} AND "workspaceId"=${W.main}`);
    expect(storedKey[0]?.tokenHash===sha(issuedToken)&&(storedKey[0]?.resourceScope as any)?.version===1&&(storedKey[0]?.resourceScope as any)?.mode==='selected'&&sameJson((storedKey[0]?.resourceScope as any)?.ids,[])&&sameJson((storedKey[0]?.resourceScope as any)?.adAccountIds,[adA]),'Key issuance must store only a credential digest and the exact independent resource ceiling.');
    const scopedAccounts=await tool(issuedToken,'list_ad_accounts');
    expect(!scopedAccounts.refused&&Array.isArray(scopedAccounts.data?.accounts)&&sameJson(scopedAccounts.data.accounts.map((a:any)=>a.id),[adA]),'Account-only key must see account A with no channel grants, never sibling account B.');
    const noChannels=await tool(issuedToken,'list_shareable_channels');
    expect(!noChannels.refused&&noChannels.data?.channels?.length===0,'Account-only key must have no channel access.');
    const channelOnlyAds=await tool(keys.scoped,'list_ad_accounts');
    expect(!channelOnlyAds.refused&&channelOnlyAds.data?.accounts?.length===0,'A channel-only key must not inherit sibling advertising accounts.');
    for(const toolName of ['export_workspace_data','preview_workspace_data_deletion','delete_workspace_data']) expect((await tool(issuedToken,toolName,{})).refused,'Selected-resource keys must refuse workspace-wide data operations on direct calls.');
    expect((await readResource(issuedToken,'msp://data/deletion-preview')).refused,'Selected-resource keys must not read a hidden global resource.');
    const today=new Date().toISOString().slice(0,10);
    const analyticsScoped=await tool(issuedToken,'get_analytics_overview',{start:today,end:today});
    expect(!analyticsScoped.refused&&analyticsScoped.data?.adAccountCount===1&&analyticsScoped.data?.metrics?.find((m:any)=>m.key==='facebook:spend::USD')?.total===11&&!analyticsScoped.text.includes(adB),'Analytics must enforce the independent ad-account ceiling, including options and metrics.');
    expect((await tool(issuedToken,'get_analytics_overview',{start:today,end:today,adAccountIds:[adB]})).refused,'Explicit Analytics filters must not escape the account ceiling.');
    const wrongRevoke=await http('/api/settings/mcp-keys',{cookie:ownerMain,method:'DELETE',body:{id:issuedId,confirmation:'no'}});
    expect(wrongRevoke.status===400,'Revocation requires its consequence confirmation.');
    const revokedKey=await http('/api/settings/mcp-keys',{cookie:ownerMain,method:'DELETE',body:{id:issuedId,confirmation:`REVOKE MCP KEY ${issuedId}`}});
    expect(revokedKey.status===200&&revokedKey.body?.revoked===true&&(await rpc('tools/list',{},issuedToken)).status===401,'Confirmed revocation must immediately stop the credential.');

    stage = 'bio: owner API save, read, edit';
    const bioUrl = '/api/sharing/bio';
    const bioConfirm = (slug: string) => `SAVE BIO PAGE ${slug}`;
    const bioBody = (over: Record<string, unknown> = {}) => ({ slug: bioSlug, title: marker('Bio title'), description: 'Synthetic bio.', enabled: true, links: [{ label: 'Alpha link', url: 'https://example.test/a' }, { label: 'Beta link', url: 'http://example.test/b?x=1' }, { label: 'Gamma link', url: 'https://example.test/c' }], confirmation: bioConfirm(bioSlug), ...over });
    const bio0 = await http(bioUrl, { cookie: ownerMain });
    expect(bio0.status === 200 && bio0.body?.page === null, 'A workspace without a bio page must read as page: null.');
    expect((await http(bioUrl, {})).status === 401 && (await http(bioUrl, { cookie: ck('editor', W.main) })).status !== 200, 'Anonymous and editor bio reads must be refused.');
    expect((await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody(), origin: 'http://evil.example' })).status === 403, 'Cross-origin bio save must be refused.');
    expect((await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody({ confirmation: 'nope' }) })).status === 400, 'A wrong bio confirmation must be refused.');
    const dangerous = ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://example.test/f', 'file:///etc/passwd', 'https://user:pw@example.test/', 'vbscript:x', '//example.test/relative', `https://example.test/${'a'.repeat(2100)}`];
    for (const url of dangerous) expect((await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody({ links: [{ label: 'Bad', url }] }) })).status === 400, `A dangerous or invalid bio URL must be refused (${url.slice(0, 18)}).`);
    for (const avatarUrl of ['http://example.test/a.png', 'javascript:alert(1)']) expect((await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody({ avatarUrl }) })).status === 400, 'A non-https avatar must be refused.');
    expect((await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody({ slug: 'Bad Slug!', confirmation: bioConfirm('Bad Slug!') }) })).status === 400, 'An invalid slug must be refused.');
    expect(!(await q(Prisma.sql`SELECT 1 FROM bio_pages WHERE "workspaceId" = ${W.main}`)).length, 'A refused bio save created a page.');
    const saved = await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody({ avatarUrl: 'https://example.test/avatar.png' }) });
    expect(saved.status === 200 && saved.body?.path === `/bio/${bioSlug}` && saved.body.linkCount === 3, 'Bio save must create the page with three links.');
    const read1 = await http(bioUrl, { cookie: ownerMain });
    expect(read1.body?.page?.slug === bioSlug && read1.body.links?.map((l: any) => l.label).join() === 'Alpha link,Beta link,Gamma link' && read1.body.links.every((l: any) => l.clicks === 0) && read1.body.truncated === false, 'Bio read must return ordered links with zero clicks.');
    const foreignBio = await http(bioUrl, { cookie: ck('foreign', W.foreign), method: 'PUT', body: bioBody() });
    expect(foreignBio.status === 409, `A slug owned by another workspace must conflict (${foreignBio.status}).`);

    stage = 'bio: public page, clicks and edit';
    const goUrl = (linkId: string) => `/bio/${bioSlug}/go/${linkId}`;
    const pub = await render(`/bio/${bioSlug}`);
    expect(pub.text.includes(marker('Bio title')) && pub.text.includes('Alpha link') && pub.text.includes('Gamma link'), 'The public bio page must show title and link labels.');
    expect(pub.hrefs.some(h => h === goUrl(read1.body.links[0].id)) && !pub.hrefs.some(h => h.includes('example.test/a')), 'Bio anchors must point at the counted redirect, not the destination.');
    const alphaId: string = read1.body.links[0].id, betaId: string = read1.body.links[1].id;
    for (let i = 0; i < 3; i++) {
      const go = await http(goUrl(alphaId), { origin: null });
      expect(go.status === 302 && go.headers.get('location') === 'https://example.test/a' && go.headers.get('referrer-policy') === 'no-referrer', 'A bio click must redirect (302) to the saved address.');
    }
    const goBeta = await http(goUrl(betaId), { origin: null });
    expect(goBeta.status === 302 && goBeta.headers.get('location') === 'http://example.test/b?x=1', 'An http destination is allowed and must redirect unchanged.');
    const read2 = await http(bioUrl, { cookie: ownerMain });
    expect(read2.body?.links?.find((l: any) => l.id === alphaId)?.clicks === 3 && read2.body.links.find((l: any) => l.id === betaId)?.clicks === 1, 'Click totals must count each redirect.');
    expect((await http(`/bio/${bioSlug}/go/${randomUUID()}`, { origin: null })).status === 404 && (await http(`/bio/nope-${bioSlug.slice(6)}/go/${alphaId}`, { origin: null })).status === 404, 'Unknown bio links and pages must answer 404.');
    const dangerId = id('bio_danger');
    const pageId = read2.body.page.id as string;
    await q(Prisma.sql`INSERT INTO bio_links (id, "pageId", label, url, position, clicks) VALUES (${dangerId}, ${pageId}, 'Danger', 'javascript:alert(1)', 99, 0)`);
    expect((await http(goUrl(dangerId), { origin: null })).status === 404, 'A corrupted javascript: destination must never be redirected to.');
    await q(Prisma.sql`DELETE FROM bio_links WHERE id = ${dangerId}`);
    const resave = await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody({ links: [{ label: 'Alpha link', url: 'https://example.test/a' }, { label: 'Beta link', url: 'https://example.test/b-changed' }] }) });
    const read3 = await http(bioUrl, { cookie: ownerMain });
    expect(resave.status === 200 && read3.body?.links?.length === 2 && read3.body.links[0].clicks === 3 && read3.body.links[1].clicks === 0, 'A re-save must keep clicks for unchanged links and reset changed ones.');
    const oldAlpha = await http(goUrl(alphaId), { origin: null });
    if (oldAlpha.status !== 302) gap('Bio link ids are regenerated on every save (delete + insert), so previously published /bio/<slug>/go/<id> click addresses stop working after an edit; stable link ids are not supported.');
    else expect(oldAlpha.headers.get('location') === 'https://example.test/a', 'A stable bio link id must keep its destination.');
    expect(!(await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody({ links: Array.from({ length: 31 }, (_, i) => ({ label: `L${i}`, url: 'https://example.test/x' })) }) })).body?.path, 'More than the Root bio link limit must be refused.');

    stage = 'bio: disable, feature off, MCP and delete';
    const disabled = await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody({ enabled: false }) });
    expect(disabled.status === 200 && await isGone(`/bio/${bioSlug}`) && (await http(goUrl(read3.body.links[0].id), { origin: null })).status === 404, 'A disabled bio page and its redirects must answer 404.');
    expect((await http(bioUrl, { cookie: ownerMain })).body?.page?.enabled === false, 'The owner must still read a disabled page.');
    await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody() });
    expect((await render(`/bio/${bioSlug}`)).text.includes('Alpha link'), 'Re-enabling must publish the page again.');
    await save('entitlements.features.settings/bio', false);
    const bioLinkId = (await http(bioUrl, { cookie: ownerMain })).body;
    expect(await isGone(`/bio/${bioSlug}`), 'The public bio page must answer 404 while the Link in bio feature is off.');
    const offBioRead = await http(bioUrl, { cookie: ownerMain });
    expect([401, 403].includes(offBioRead.status), `The owner bio API must refuse while the feature is off (${offBioRead.status}).`);
    void bioLinkId;
    expect(!(await toolNames(keys.full)).includes('get_bio_page') && !(await resourceUris(keys.full)).includes('msp://settings/bio'), 'MCP must hide bio tools/resources while the feature is off.');
    await save('entitlements.features.settings/bio', true);
    expect((await render(`/bio/${bioSlug}`)).text.includes('Alpha link'), 'The bio page must recover when the feature returns.');
    const currentLinks = (await http(bioUrl, { cookie: ownerMain })).body.links as Array<{ id: string }>;
    expect((await http(goUrl(currentLinks[0]!.id), { origin: null })).status === 302, 'Bio redirects must recover when the feature returns.');
    await save('mcp.maxResultItems', 2);
    const capBio = await tool(keys.full, 'get_bio_page'), capBioRes = await readResource(keys.full, 'msp://settings/bio');
    expect(capBio.data?.links?.length === 2 && capBio.data.truncated === true && capBioRes.data?.links?.length === 2, 'The MCP result ceiling (2) was not applied to bio links (3 saved).');
    await save('mcp.maxResultItems', 100);
    const mcpBioSave = await tool(keys.full, 'save_bio_page', bioBody({ title: marker('Bio via MCP'), links: [{ label: 'Via MCP', url: 'https://example.test/mcp' }] }));
    expect(!mcpBioSave.refused && (await tool(keys.full, 'get_bio_page')).data?.page?.title === marker('Bio via MCP'), 'MCP bio save and get must round-trip.');
    expect((await tool(keys.full, 'save_bio_page', bioBody({ links: [{ label: 'Bad', url: 'javascript:alert(1)' }] }))).refused, 'MCP must refuse a dangerous bio URL.');
    expect((await tool(keys.ro, 'save_bio_page', bioBody())).refused, 'A read-only key must not save the bio page.');
    expect((await http(bioUrl, { cookie: ownerMain, method: 'DELETE', body: { confirmation: 'DELETE BIO PAGE nope' } })).status === 400, 'Bio delete with a wrong confirmation must be refused.');
    const delBio = await http(bioUrl, { cookie: ownerMain, method: 'DELETE', body: { confirmation: `DELETE BIO PAGE ${bioSlug}` } });
    expect(delBio.status === 200 && await isGone(`/bio/${bioSlug}`) && !(await q(Prisma.sql`SELECT 1 FROM bio_links WHERE "pageId" = ${pageId}`)).length && !(await q(Prisma.sql`SELECT 1 FROM bio_pages WHERE id = ${pageId}`)).length, 'Bio delete must remove the page and its links.');
    expect((await http(bioUrl, { cookie: ownerMain, method: 'DELETE', body: { confirmation: `DELETE BIO PAGE ${bioSlug}` } })).status === 404, 'Deleting a missing bio page must be not-found.');
    // Leave a page for export coverage.
    await http(bioUrl, { cookie: ownerMain, method: 'PUT', body: bioBody() });

    stage = 'owner pages (Chromium DOM)';
    const sharePage = await render('/settings/sharing', { cookie: ownerMain });
    expect(sharePage.text.includes(marker('L1 review decides')) && leaks(sharePage.text, secretsOf()).length === 0 && !sharePage.text.includes(marker('F1 foreign')), 'The Client sharing page must list this workspace links and never a secret or foreign link.');
    const bioPage = await render('/settings/bio', { cookie: ownerMain });
    expect(bioPage.text.includes(marker('Bio title')) || bioPage.text.includes(bioSlug), 'The bio settings page must show the saved page.');
    const sharePhone = await render('/settings/sharing', { cookie: ownerMain, width: 390 });
    expect(sharePhone.status === 200, 'The Client sharing page must open at 390px.');

    stage = 'export coverage';
    const exportRes = await fetch(new URL('/api/settings/data', base), { headers: { cookie: ownerMain }, signal: AbortSignal.timeout(60000) });
    const zipBytes = Buffer.from(await exportRes.arrayBuffer());
    expect(exportRes.status === 200 && exportRes.headers.get('content-type') === 'application/zip' && zipBytes.length > 100, `The workspace export did not return a zip (${exportRes.status}).`);
    if (exportRes.status === 200) {
      const tmp = await mkdtemp(path.join(os.tmpdir(), 'sharing-export-'));
      try {
        const zipPath = path.join(tmp, 'export.zip'); await writeFile(zipPath, zipBytes);
        const entries = (await run('/usr/bin/unzip', ['-Z1', zipPath], { maxBuffer: 64 * 1024 * 1024 })).stdout.split('\n').filter(Boolean);
        const dbJson = (await run('/usr/bin/unzip', ['-p', zipPath, 'database/workspace.json'], { maxBuffer: 256 * 1024 * 1024 })).stdout;
        const parsed = JSON.parse(dbJson);
        const find = (value: any, key: string): any => { if (!value || typeof value !== 'object') return undefined; if (Object.hasOwn(value, key)) return value[key]; for (const v of Object.values(value)) { const hit = find(v, key); if (hit !== undefined) return hit; } return undefined; };
        const nShare = find(parsed, 'share_links'), nBioP = find(parsed, 'bio_pages'), nBioL = find(parsed, 'bio_links'), nDec = find(parsed, 'review_decisions');
        const mainShare = Number((await q<{ n: bigint }>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM share_links WHERE "workspaceId" = ${W.main}`))[0]?.n);
        expect(Array.isArray(nShare) && nShare.length === mainShare, `The export must include every share link row (${Array.isArray(nShare) ? nShare.length : 'missing'} of ${mainShare}).`);
        expect(Array.isArray(nBioP) && nBioP.length === 1 && Array.isArray(nBioL) && nBioL.length === 3, 'The export must include the bio page and its links.');
        expect(Array.isArray(nDec) && nDec.length >= 4, 'The export must include the stored client answers.');
        expect(leaks(dbJson, secretsOf()).length === 0, 'The export contains a share token or token digest.');
        expect(upBody?.id ? entries.some(e => e.includes(upBody.id)) : true, 'The export archive does not include the uploaded image.');
        expect(!dbJson.includes(sessionToken.owner) && !Object.values(keys).some(k => dbJson.includes(k)), 'The export contains a session token or MCP key.');
      } finally { await rm(tmp, { recursive: true, force: true }); }
    }

    stage = 'erasure coverage';
    const eraseCookie = ck('owner', W.erase);
    const eraseLink = await mk('E1 erase workspace', { kind: 'review', targetIds: [T.erase] }, eraseCookie);
    const eraseBio = await http(bioUrl, { cookie: eraseCookie, method: 'PUT', body: bioBody({ slug: eraseSlug, confirmation: bioConfirm(eraseSlug) }) });
    expect(eraseBio.status === 200, 'The erase-workspace bio page could not be saved.');
    await q(Prisma.sql`INSERT INTO review_decisions (id, "shareLinkId", "postId", decision, comment, "authorName", "createdAt") VALUES (${id('dec_erase')}, ${eraseLink.link.id}, ${P.foreign}, 'comment', 'synthetic', 'Synthetic', NOW())`);
    const eraseForm = new FormData(); eraseForm.append('imageFile', new File([new Uint8Array(PNG)], 'pixel.png', { type: 'image/png' }));
    const eraseUp = await fetch(new URL('/api/media', base), { method: 'POST', headers: { origin: base.origin, cookie: eraseCookie }, body: eraseForm, signal: AbortSignal.timeout(30000) });
    const eraseUpBody: any = await eraseUp.json().catch(() => null);
    const eraseImage = eraseUpBody?.id ? path.join(mediaDir, W.erase, 'images', eraseUpBody.id) : null;
    expect(eraseUp.status === 200 && eraseImage !== null && await stat(eraseImage).then(() => true, () => false), 'The erase-workspace image upload did not reach storage.');
    const preview = await http('/api/settings/data', { cookie: eraseCookie, method: 'POST', body: {}, origin: null });
    expect(preview.status === 200 && /share_links/.test(preview.text) && /bio_pages/.test(preview.text) && /review_decisions/.test(preview.text) && /bio_links/.test(preview.text), 'The erasure preview must count share links, bio pages/links and review decisions.');
    const erased = await http('/api/settings/data', { cookie: eraseCookie, method: 'DELETE', body: { confirmation: 'DELETE' } });
    expect(erased.status === 200 && erased.body?.ok === true, `Workspace erasure did not complete (${erased.status}).`);
    for (const table of ['share_links', 'bio_pages']) expect(Number((await q<{ n: bigint }>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM ${Prisma.raw(`"${table}"`)} WHERE "workspaceId" = ${W.erase}`))[0]?.n) === 0, `Erasure left ${table} rows.`);
    expect(!(await q(Prisma.sql`SELECT 1 FROM review_decisions WHERE "shareLinkId" = ${eraseLink.link.id}`)).length && !(await q(Prisma.sql`SELECT 1 FROM bio_links WHERE "pageId" IN (SELECT id FROM bio_pages WHERE slug = ${eraseSlug})`)).length, 'Erasure left review decisions or bio links.');
    expect(await shareGone(eraseLink.link.token) && await isGone(`/bio/${eraseSlug}`), 'Erased share and bio addresses must answer 404.');
    expect(eraseImage !== null && !(await stat(eraseImage).then(() => true, () => false)), 'Erasure left the uploaded image in storage.');
    expect((await view(links['L1 review decides'].token)).status === 200 && Number((await q<{ n: bigint }>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM share_links WHERE "workspaceId" = ${W.main}`))[0]?.n) > 0, 'Erasing one workspace must not touch another workspace sharing data.');

    stage = 'audit secrecy';
    const allAudits = await q<{ action: string; detail: unknown }>(Prisma.sql`SELECT action, detail FROM activity_logs WHERE "workspaceId" = ANY(${wsIds}::text[]) AND (action LIKE 'sharing.%' OR action LIKE 'publishing.post_%')`);
    const auditText = JSON.stringify(allAudits);
    expect(leaks(auditText, [...secretsOf(), ...Object.values(keys), ...Object.values(sessionToken), 'Long client note']).length === 0, 'Audit rows contain a token, digest, key, session token or client comment body.');
    for (const action of ['sharing.bio_saved', 'sharing.bio_deleted']) expect(allAudits.some(a => a.action === action), `Missing audit action ${action}.`);

    if (failures.length) throw new ProbeFailure(`Sharing expectations not met (${failures.length}):\n- ${failures.join('\n- ')}${gaps.length ? `\nREMAINING GAPS (${gaps.length}):\n- ${gaps.join('\n- ')}` : ''}`);
    console.log('PASS: actual local HTTP/MCP/PostgreSQL/Chromium Sharing and bio workflow — link create/list/revoke/rotate/delete with token-hash-only storage, pending-only public review (drafts excluded), long-comment approval + stored answer atomic outcome (including revoke race), advice/comments, revoked/expired/foreign/legacy refusals, creator/feature/suspension/purge state, MCP read-only/feature/result ceilings and resources, exact selected targets, uploaded image preview, bio save/edit/read/click/disable/feature-off/delete with dangerous-URL refusal, export and erasure coverage; independent API-key issuance, selected-channel Sharing, account-only Ads/Analytics sibling isolation, workspace-wide refusals and revocation; no provider call.');
    if (gaps.length) console.log(`REMAINING GAPS (not passes, ${gaps.length}):\n- ${gaps.join('\n- ')}`);
  } finally {
    if (failures.length === 0 && gaps.length && stage) { /* gaps are printed on success above; failures print them in the thrown message */ }
    const errors: string[] = [];
    const clean = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch { errors.push(label); } };
    if (captured) for (const key of settingKeys) {
      const old = settings.get(key);
      await clean(`restore ${key}`, () => old
        ? db.appSetting.upsert({ where: { key }, create: { ...old, value: old.value === null ? Prisma.JsonNull : old.value }, update: { value: old.value === null ? Prisma.JsonNull : old.value, encrypted: old.encrypted, updatedAt: old.updatedAt } })
        : db.appSetting.deleteMany({ where: { key } }));
    }
    if (browser) await clean('headless browser', () => browser!.close());
    if (mediaMade) await clean('media storage cleanup', async () => {
      check(mediaDir.startsWith('/private/tmp/preview_sharing_') && mediaDir.endsWith('-media'), 'Refusing to remove an unexpected storage path.');
      await rm(mediaDir, { recursive: true, force: true });
      check(!(await stat(mediaDir).then(() => true, () => false)), 'Synthetic media storage remained.');
    });
    if (fixture) await clean('exact synthetic fixture cleanup', async () => {
      const tryRun = async (sql: Prisma.Sql) => { try { await db.$executeRaw(sql); return true; } catch { return false; } };
      await tryRun(Prisma.sql`DELETE FROM ad_insights WHERE "adAccountId" IN (SELECT id FROM ad_accounts WHERE "workspaceId"=ANY(${wsIds}::text[]))`);
      await tryRun(Prisma.sql`DELETE FROM review_decisions WHERE "shareLinkId" IN (SELECT id FROM share_links WHERE "workspaceId" = ANY(${wsIds}::text[])) OR "postId" IN (SELECT id FROM posts WHERE "workspaceId" = ANY(${wsIds}::text[]))`);
      await tryRun(Prisma.sql`DELETE FROM bio_links WHERE "pageId" IN (SELECT id FROM bio_pages WHERE "workspaceId" = ANY(${wsIds}::text[]))`);
      for (const table of ['post_versions', 'post_notes', 'post_labels', 'post_field_values']) await tryRun(Prisma.sql`DELETE FROM ${Prisma.raw(`"${table}"`)} WHERE "postId" IN (SELECT id FROM posts WHERE "workspaceId" = ANY(${wsIds}::text[]))`);
      await tryRun(Prisma.sql`DELETE FROM post_targets WHERE "postId" IN (SELECT id FROM posts WHERE "workspaceId" = ANY(${wsIds}::text[])) OR "targetId" IN (SELECT id FROM targets WHERE "workspaceId" = ANY(${wsIds}::text[]))`);
      await tryRun(Prisma.sql`DELETE FROM member_page_access WHERE "membershipId" IN (SELECT id FROM memberships WHERE "workspaceId" = ANY(${wsIds}::text[]))`);
      await db.mcpApiKey.deleteMany({ where: { id: { in: Object.values(keyIds) } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await tryRun(Prisma.sql`DELETE FROM root_activities WHERE "actorId" = ANY(${userIds}::text[]) OR detail->>'workspaceId' = ANY(${wsIds}::text[])`);
      // Every other workspace-keyed table (notifications, versions, audit rows ...), in repeated passes so foreign-key order resolves itself.
      const tables = (await q<{ table_name: string }>(Prisma.sql`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'public' AND c.column_name = 'workspaceId' AND c.table_name NOT IN ('workspaces')`)).map(r => r.table_name);
      let pending = tables;
      for (let pass = 0; pass < 6 && pending.length; pass++) {
        const next: string[] = [];
        for (const table of pending) if (!(await tryRun(Prisma.sql`DELETE FROM ${Prisma.raw(`"${table.replaceAll('"', '')}"`)} WHERE "workspaceId" = ANY(${wsIds}::text[])`))) next.push(table);
        pending = next;
      }
      const userTables = (await q<{ table_name: string }>(Prisma.sql`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'public' AND c.column_name = 'userId' AND c.table_name NOT IN ('users', 'memberships', 'sessions')`)).map(r => r.table_name);
      for (const table of userTables) await tryRun(Prisma.sql`DELETE FROM ${Prisma.raw(`"${table.replaceAll('"', '')}"`)} WHERE "userId" = ANY(${userIds}::text[])`);
      await db.workspace.deleteMany({ where: { id: { in: wsIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    });
    if (fixture) await clean('fixture/audit absence verification', async () => {
      const left = await q<{ n: bigint }>(Prisma.sql`SELECT (
        (SELECT COUNT(*) FROM users WHERE id = ANY(${userIds}::text[])) + (SELECT COUNT(*) FROM workspaces WHERE id = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM memberships WHERE "workspaceId" = ANY(${wsIds}::text[]) OR "userId" = ANY(${userIds}::text[]))
        + (SELECT COUNT(*) FROM sessions WHERE "userId" = ANY(${userIds}::text[])) + (SELECT COUNT(*) FROM mcp_api_keys WHERE "workspaceId" = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM targets WHERE "workspaceId" = ANY(${wsIds}::text[])) + (SELECT COUNT(*) FROM posts WHERE "workspaceId" = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM share_links WHERE "workspaceId" = ANY(${wsIds}::text[])) + (SELECT COUNT(*) FROM bio_pages WHERE "workspaceId" = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM review_decisions WHERE "postId" LIKE ${`${prefix}%`} OR id LIKE ${`${prefix}%`})
        + (SELECT COUNT(*) FROM bio_links WHERE id LIKE ${`${prefix}%`} OR "pageId" LIKE 'bio_%' AND "pageId" NOT IN (SELECT id FROM bio_pages))
        + (SELECT COUNT(*) FROM workspace_data_purges WHERE "workspaceId" = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM root_activities WHERE "actorId" = ANY(${userIds}::text[]) OR detail->>'workspaceId' = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM activity_logs WHERE "workspaceId" = ANY(${wsIds}::text[])))::bigint AS n`);
      check(left[0]?.n === BigInt(0), 'Synthetic fixtures or audit rows remained.');
    });
    if (captured) await clean('exact setting verification', async () => {
      for (const key of settingKeys) {
        const current = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
        check(JSON.stringify(current) === JSON.stringify(settings.get(key)), `Setting ${key} failed exact restoration.`);
      }
    });
    if (!errors.length && ledgerSaved) await clean('recovery ledger cleanup', () => unlink(ledger));
    await db.$disconnect();
    if (errors.length) { console.error(`Cleanup incomplete (${errors.join(', ')}); private recovery ledger retained at ${ledger}.`); process.exitCode = 1; }
    else if (fixture || captured) console.log(`All synthetic fixtures, audit rows and media storage removed; exact prior Root settings${rootWrites ? ' restored and' : ''} verified.`);
  }
}
main().catch(error => { console.error(`Sharing workflow probe failed at ${stage}: ${error instanceof ProbeFailure ? error.message : 'unexpected local failure (details withheld)'}`); process.exitCode = 1; });
