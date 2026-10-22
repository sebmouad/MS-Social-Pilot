/**
 * Synthetic-only local HTTP/MCP/PostgreSQL probe for Agency (person-wide, cross-workspace administration).
 * Never contacts a provider, production or customer data. Requires an explicit matching loopback `_preview`
 * database (DATABASE_URL === REBUILD_PREVIEW_DATABASE_URL), REBUILD_PREVIEW_ORIGIN=http://localhost:3200 and a
 * running local preview. Parent starts the preview and executes this script.
 *
 * Hard preconditions/fixture problems abort immediately. Endpoint expectations are collected, so one run reports
 * every current limitation as a clear failure instead of inventing success.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }

let stage = 'preview guards';
const failures: string[] = [];
function expect(value: unknown, message: string) { if (!value) failures.push(`[${stage}] ${message}`); }

const settingKeys = [
  'mcp.enabled', 'mcp.authenticatedRoles',
  'entitlements.modules.agency', 'entitlements.modules.tasks', 'entitlements.modules.publishing', 'entitlements.modules.settings',
  'entitlements.features.agency/overview', 'entitlements.features.agency/clients', 'entitlements.features.tasks/board',
  'entitlements.features.publishing/posts', 'entitlements.features.settings/connections', 'entitlements.features.settings/team',
  'agency.workspaceLimit', 'agency.searchMaxLength',
] as const;
type Setting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };
type Ws = { id: string; name: string; role: 'owner' | 'admin'; state: string; metrics: Record<string, number | null> | null; needsAttention: boolean };
type Client = { workspaceId: string; state: string; clientCount: number | null; clients: Array<{ userId: string; name: string; email: string }>; invitations: Array<{ email: string; status: string }>; invitationsAvailable: boolean };

async function main() {
  const raw = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(raw && raw === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin required.');
  const u = new URL(raw), base = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && decodeURIComponent(u.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(k => u.searchParams.has(k)), 'Only loopback _preview PostgreSQL permitted.');
  check(base.origin === origin && base.protocol === 'http:' && base.hostname === 'localhost' && base.port === '3200', 'Only localhost:3200 preview permitted.');

  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const prefix = `preview_agency_${randomUUID().replaceAll('-', '')}`;
  const id = (suffix: string) => `${prefix}_${suffix}`;
  const actorId = id('actor'), otherOwnerId = id('other_owner'), editorOnlyId = id('editor_only'), foreignOwnerId = id('foreign_owner');
  const clientIds = { one: id('client_one'), two: id('client_two'), disabled: id('client_disabled'), active: id('client_active'), editorWs: id('client_editor_ws'), foreign: id('client_foreign') };
  const userIds = [actorId, otherOwnerId, editorOnlyId, foreignOwnerId, ...Object.values(clientIds)];
  const W = { alpha: id('ws_alpha'), bravo: id('ws_bravo'), charlie: id('ws_charlie'), delta: id('ws_delta'), echo: id('ws_echo'), foxtrot: id('ws_foxtrot'), golf: id('ws_golf'), hotel: id('ws_hotel'), zulu: id('ws_zulu') };
  const wsIds = Object.values(W);
  const name = (ws: keyof typeof W) => `${prefix} ${ws[0]!.toUpperCase()}${ws.slice(1)}`;
  const clientName = (key: keyof typeof clientIds) => `${prefix} Client ${key}`;
  const token = { actor: randomBytes(32).toString('base64url'), other: randomBytes(32).toString('base64url'), editor: randomBytes(32).toString('base64url') };
  const keyToken = `mcp_${randomBytes(32).toString('base64url')}`;
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const expiresAt = new Date(Date.now() + 1800000);
  const settings = new Map<string, Setting | null>();
  const ledger = `/private/tmp/${prefix}-recovery.json`;
  const taskIds = { alphaOverdue: id('task_alpha_overdue'), alphaOpen: id('task_alpha_open'), alphaDone: id('task_alpha_done'), bravoOpen: id('task_bravo_open') };
  let captured = false, fixture = false, rootWrites = false, ledgerSaved = false;

  const cookieFor = (who: keyof typeof token, workspace: string) => `msp_session=${token[who]}; sp_workspace=${workspace}`;
  const actorCookie = cookieFor('actor', W.alpha);

  async function http(path: string, opts: { cookie?: string; method?: string; body?: unknown; headers?: Record<string, string>; origin?: string | null } = {}) {
    const headers: Record<string, string> = { ...(opts.origin === null ? {} : { origin: opts.origin ?? base.origin }), ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...opts.headers };
    return fetch(new URL(path, base), { method: opts.method ?? 'GET', redirect: 'manual', signal: AbortSignal.timeout(30000), headers, ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }) });
  }
  const json = async (r: Response): Promise<any> => r.json().catch(() => null);
  const agency = (query = '', opts: Parameters<typeof http>[1] = { cookie: actorCookie }) => http(`/api/agency${query}`, opts);
  async function rpc(method: string, params: unknown, auth: { scope: 'workspace' | 'installation'; bearer?: string; cookie?: string }) {
    const r = await fetch(new URL(`/api/mcp?scope=${auth.scope}`, base), {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { origin: base.origin, 'content-type': 'application/json', ...(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}), ...(auth.cookie ? { cookie: auth.cookie } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    });
    const text = await r.text();
    let body: any = null; try { body = JSON.parse(text); } catch { /* keep null */ }
    return { status: r.status, body, text };
  }
  async function save(key: string, value: unknown) {
    rootWrites = true;
    const r = await http('/api/root/config', { cookie: actorCookie, method: 'PUT', body: { key, value } });
    const b = await json(r);
    check(r.ok && b?.schemaVersion === CONFIG_SCHEMA_VERSION, `Root setting ${key} did not save.`);
  }
  const ids = (list: Array<{ id?: string; workspaceId?: string }>) => list.map(item => item.id ?? item.workspaceId);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const leaks = (text: string, hidden: string[]) => hidden.filter(value => text.includes(value));
  let browser: Browser | undefined;
  // Next streams loading and page boundaries separately; inspect hydrated DOM rather than regex-parsing that transport.
  const pageMain = async (path: string, cookie: string) => {
    browser ??= await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
      await context.addCookies(cookie.split('; ').map(value => { const at = value.indexOf('='); return { name: value.slice(0, at), value: value.slice(at + 1), url: base.origin, httpOnly: true, sameSite: 'Lax' as const }; }));
      await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
      const page = await context.newPage();
      const response = await page.goto(new URL(path, base).href, { waitUntil: 'networkidle', timeout: 30000 });
      await page.locator('#main-content').waitFor({ state: 'visible', timeout: 10000 });
      return { status: response?.status() ?? 0, location: page.url(), main: await page.locator('#main-content').innerHTML(), accessRedirect: new URL(page.url()).pathname === '/access-limited' };
    } finally { await context.close(); }
  };

  try {
    stage = 'preflight and capture exact settings';
    check((await fetch(new URL('/sign-in', base), { redirect: 'manual', signal: AbortSignal.timeout(5000) })).status < 500, 'Local preview unavailable.');
    const objects = await db.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('public.tasks') IS NOT NULL AND to_regclass('public.invitations') IS NOT NULL AND to_regclass('public.workspace_data_purges') IS NOT NULL AS ready`;
    check(objects[0]?.ready, 'Required tasks/invitations/purge tables missing; no fixtures written.');
    for (const key of settingKeys) {
      const value = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
      check(!value?.encrypted, 'Unexpected encrypted probe setting.');
      settings.set(key, value);
    }
    captured = true;
    // Durable private recovery ledger BEFORE any mutation. Contains no session, key or credential values.
    await writeFile(ledger, JSON.stringify({ prefix, userIds, workspaceIds: wsIds, settings: [...settings] }), { mode: 0o600, flag: 'wx' });
    ledgerSaved = true; fixture = true;

    stage = 'create synthetic fixtures';
    for (const userId of userIds) {
      await db.user.create({ data: { id: userId, email: `${userId}@example.test`, name: userId === actorId ? 'Disposable Agency Actor' : Object.values(clientIds).includes(userId) ? clientName(Object.entries(clientIds).find(([, v]) => v === userId)![0] as keyof typeof clientIds) : 'Disposable Agency Person', passwordHash: 'unusable-preview-password', ...(userId === actorId ? { isInstanceOwner: true, totpEnabledAt: new Date() } : {}), ...(userId === clientIds.disabled ? { disabledAt: new Date() } : {}) } });
    }
    for (const [key, workspaceId] of Object.entries(W)) await db.workspace.create({ data: { id: workspaceId, name: name(key as keyof typeof W), slug: workspaceId, timezone: 'UTC' } });
    const member = async (suffix: string, workspaceId: string, userId: string, role: 'owner' | 'admin' | 'editor' | 'client') => { await db.membership.create({ data: { id: id(`m_${suffix}`), workspaceId, userId, role } }); return id(`m_${suffix}`); };
    // The actor owns Alpha, administers Bravo/Delta/Echo/Foxtrot/Golf/Hotel and is only an editor in Charlie. Zulu is foreign.
    await member('alpha_actor', W.alpha, actorId, 'owner');
    await member('bravo_actor', W.bravo, actorId, 'admin'); await member('bravo_owner', W.bravo, otherOwnerId, 'owner');
    await member('charlie_actor', W.charlie, actorId, 'editor'); await member('charlie_editor', W.charlie, editorOnlyId, 'editor'); await member('charlie_owner', W.charlie, foreignOwnerId, 'owner');
    for (const ws of ['delta', 'echo', 'foxtrot', 'golf'] as const) await member(`${ws}_actor`, W[ws], actorId, 'admin');
    const hotelMembership = await member('hotel_actor', W.hotel, actorId, 'admin');
    await member('zulu_owner', W.zulu, foreignOwnerId, 'owner');
    await member('alpha_c1', W.alpha, clientIds.one, 'client'); await member('alpha_c2', W.alpha, clientIds.two, 'client');
    await member('bravo_c3', W.bravo, clientIds.disabled, 'client'); await member('bravo_c4', W.bravo, clientIds.active, 'client');
    await member('charlie_ce', W.charlie, clientIds.editorWs, 'client'); await member('zulu_cf', W.zulu, clientIds.foreign, 'client');
    await db.$executeRaw`UPDATE workspaces SET "suspendedAt" = NOW() WHERE id = ${W.delta}`;
    await db.$executeRaw`UPDATE workspaces SET "disabledModules" = ARRAY['agency']::text[] WHERE id = ${W.foxtrot}`;
    await db.$executeRaw`UPDATE workspaces SET "disabledModules" = ARRAY['agency/clients']::text[] WHERE id = ${W.golf}`;
    await db.$executeRaw`UPDATE memberships SET "disabledModules" = ARRAY['agency/overview']::text[] WHERE id = ${hotelMembership}`;

    const now = new Date();
    for (const [who, userId] of [['actor', actorId], ['other', otherOwnerId], ['editor', editorOnlyId]] as const) await db.session.create({ data: { id: id(`session_${who}`), userId, tokenHash: hashSessionToken(token[who])!, expiresAt, pending: null } });
    const target = (suffix: string, workspaceId: string, enabled: boolean, canPublish: boolean, accessToken: string | null) => db.target.create({ data: { id: id(`target_${suffix}`), workspaceId, type: 'page', providerId: id(`provider_${suffix}`), name: 'Disposable Agency channel', accessToken, enabled, canPublish, createdAt: now } });
    await target('alpha_broken', W.alpha, true, false, null); await target('alpha_ok', W.alpha, true, true, 'synthetic-never-used'); await target('alpha_off', W.alpha, false, false, null);
    await target('bravo_ok', W.bravo, true, true, 'synthetic-never-used');
    for (const ws of ['charlie', 'zulu', 'delta'] as const) await target(`${ws}_broken`, W[ws], true, false, null);
    const post = (suffix: string, workspaceId: string, status: 'scheduled' | 'failed', updatedAt: Date) => db.post.create({ data: { id: id(`post_${suffix}`), workspaceId, authorId: actorId, message: 'Disposable Agency synthetic post', status, ...(status === 'scheduled' ? { scheduledAt: new Date(Date.now() + 86_400_000) } : {}), createdAt: now, updatedAt } });
    await post('alpha_scheduled', W.alpha, 'scheduled', now); await post('alpha_failed', W.alpha, 'failed', now); await post('alpha_failed_old', W.alpha, 'failed', new Date(Date.now() - 90 * 86_400_000));
    for (const ws of ['charlie', 'zulu', 'delta'] as const) await post(`${ws}_failed`, W[ws], 'failed', now);
    const task = (taskId: string, workspaceId: string, status: string, dueOn: string) => db.$executeRaw`INSERT INTO tasks (id, "workspaceId", title, status, "dueOn", "createdAt", "updatedAt") VALUES (${taskId}, ${workspaceId}, 'Disposable Agency task', ${status}, ${dueOn}, NOW(), NOW())`;
    await task(taskIds.alphaOverdue, W.alpha, 'todo', '2000-01-01'); await task(taskIds.alphaOpen, W.alpha, 'doing', '2999-01-01'); await task(taskIds.alphaDone, W.alpha, 'done', '2000-01-01'); await task(taskIds.bravoOpen, W.bravo, 'todo', '2999-01-01');
    for (const ws of ['charlie', 'zulu', 'delta'] as const) for (const n of [1, 2, 3]) await task(id(`task_${ws}_${n}`), W[ws], 'todo', '2000-01-01');
    const invite = (suffix: string, workspaceId: string, role: string, expires: Date, accepted: boolean) => db.$executeRaw`INSERT INTO invitations (id, "workspaceId", email, role, "tokenHash", "invitedById", "expiresAt", "acceptedAt", "acceptedByUserId", "createdAt") VALUES (${id(`invite_${suffix}`)}, ${workspaceId}, ${`${id(`invite_${suffix}`)}@example.test`}, ${role}::"WorkspaceRole", ${hash(randomBytes(16).toString('hex'))}, ${actorId}, ${expires}, ${accepted ? now : null}, ${accepted ? clientIds.one : null}, NOW())`;
    await invite('alpha_pending', W.alpha, 'client', new Date(Date.now() + 7 * 86_400_000), false);
    await invite('alpha_expired', W.alpha, 'client', new Date(Date.now() - 86_400_000), false);
    await invite('alpha_editor', W.alpha, 'editor', new Date(Date.now() + 7 * 86_400_000), false);
    await invite('alpha_accepted', W.alpha, 'client', new Date(Date.now() + 7 * 86_400_000), true);
    await invite('zulu_pending', W.zulu, 'client', new Date(Date.now() + 7 * 86_400_000), false);
    await invite('charlie_pending', W.charlie, 'client', new Date(Date.now() + 7 * 86_400_000), false);
    await db.mcpApiKey.create({ data: { id: id('key'), workspaceId: W.alpha, createdById: actorId, name: 'Disposable Agency probe', tokenHash: hash(keyToken), tokenPrefix: keyToken.slice(0, 12), readFeatures: ['agency/overview', 'agency/clients', 'tasks/board'], writeFeatures: [], expiresAt } });
    // Erasure-in-progress marker last: the purge gate rejects later writes to the workspace.
    await db.workspaceDataPurge.create({ data: { workspaceId: W.echo, status: 'requested', requestedById: actorId, mediaRoot: `/private/tmp/${prefix}-media` } });

    stage = 'enable local features and MCP';
    for (const key of ['entitlements.modules.agency', 'entitlements.modules.tasks', 'entitlements.modules.publishing', 'entitlements.modules.settings', 'entitlements.features.agency/overview', 'entitlements.features.agency/clients', 'entitlements.features.tasks/board', 'entitlements.features.publishing/posts', 'entitlements.features.settings/connections', 'entitlements.features.settings/team'] as const) await save(key, true);
    await save('mcp.enabled', true); await save('mcp.authenticatedRoles', ['owner', 'admin', 'editor']);
    await save('agency.workspaceLimit', 200); await save('agency.searchMaxLength', 200);

    stage = 'overview: owner/admin multi-workspace reads, exclusions and state withholding';
    const overviewResponse = await agency();
    const overviewText = await overviewResponse.text();
    expect(overviewResponse.status === 200, `GET /api/agency returned ${overviewResponse.status}.`);
    expect(overviewResponse.headers.get('cache-control')?.includes('no-store'), 'Overview response is cacheable.');
    const overview = (() => { try { return JSON.parse(overviewText); } catch { return null; } })();
    const rows: Ws[] = overview?.workspaces ?? [];
    const byId = new Map(rows.map(item => [item.id, item]));
    expect(same(ids(rows), [W.delta, W.echo, W.alpha, W.bravo, W.golf]), 'Overview must list exactly Delta, Echo (unavailable first), Alpha, Bravo, Golf by attention then name.');
    expect(leaks(overviewText, [name('charlie'), name('foxtrot'), name('hotel'), name('zulu'), W.charlie, W.foxtrot, W.hotel, W.zulu]).length === 0, 'Overview leaked an editor-only, module-disabled, member-disabled or foreign workspace.');
    expect(!/accessToken|synthetic-never-used/.test(overviewText), 'Overview exposed credential material.');
    expect(byId.get(W.alpha)?.role === 'owner' && byId.get(W.bravo)?.role === 'admin', 'Owner/admin roles were not reported.');
    expect(byId.get(W.delta)?.state === 'suspended' && byId.get(W.delta)?.metrics === null && byId.get(W.delta)?.needsAttention === true, 'Suspended workspace data was not withheld.');
    expect(byId.get(W.echo)?.state === 'deleting' && byId.get(W.echo)?.metrics === null && byId.get(W.echo)?.needsAttention === true, 'Workspace under erasure was not withheld.');
    expect(same(byId.get(W.alpha)?.metrics, { channels: 2, disconnected: 1, scheduled: 1, failed: 1, openTasks: 2, overdueTasks: 1, members: 1, clients: 2 }), 'Alpha counts differ from the synthetic fixture (stale failed post must stay outside the window).');
    expect(byId.get(W.bravo)?.metrics?.channels === 1 && byId.get(W.bravo)?.metrics?.disconnected === 0 && byId.get(W.bravo)?.metrics?.openTasks === 1 && byId.get(W.bravo)?.metrics?.overdueTasks === 0 && byId.get(W.bravo)?.metrics?.members === 2 && byId.get(W.bravo)?.needsAttention === false, 'Bravo counts differ from the synthetic fixture.');
    expect(byId.get(W.golf)?.state === 'available' && byId.get(W.golf)?.metrics?.channels === 0, 'Golf (clients feature off only) must stay in the overview.');
    const totals = overview?.totals;
    expect(totals?.workspaces === 5 && totals?.needingAttention === 3 && totals?.channels === 3 && totals?.disconnected === 1 && totals?.scheduled === 1 && totals?.failed === 1 && totals?.openTasks === 3 && totals?.overdueTasks === 1, 'Totals must be exact sums of the three available fixture workspaces only.');
    expect(['channels', 'publishing', 'tasks', 'team'].every(group => totals?.coverage?.[group]?.covered === 3 && totals.coverage[group].of === 3), 'Coverage must report 3 of 3 available workspaces per group.');

    stage = 'overview: person-wide regardless of selected workspace';
    for (const selected of [W.charlie, W.zulu, W.bravo]) {
      const other = await json(await agency('', { cookie: cookieFor('actor', selected) }));
      expect(same(ids(other?.workspaces ?? []), ids(rows)), `Overview changed with the selected workspace cookie (${selected === W.zulu ? 'foreign' : 'owned'}).`);
    }

    stage = 'overview: other people see only their own workspaces';
    const editorOnly = await agency('', { cookie: cookieFor('editor', W.charlie) });
    const editorBody = await json(editorOnly);
    expect(editorOnly.status === 200 && same(editorBody?.workspaces, []) && editorBody?.totals?.workspaces === 0, 'A person who is only an editor must receive an empty Agency overview.');
    const otherOwner = await json(await agency('', { cookie: cookieFor('other', W.bravo) }));
    expect(same(ids(otherOwner?.workspaces ?? []), [W.bravo]) && otherOwner?.workspaces?.[0]?.role === 'owner', "Another person's overview must contain only the workspace they own.");
    const otherClients = await json(await agency('?view=clients', { cookie: cookieFor('editor', W.charlie) }));
    expect(same(otherClients?.workspaces, []), 'Editor-only person received client data.');

    stage = 'overview: strict filters, sorting, search and bounds';
    for (const query of ['?bogus=1', '?sort=bogus', '?order=sideways', '?attention=maybe', '?attention=false&attention=true', '?q=a&q=b', '?view=bogus', '?view=overview&view=clients', '?view=clients&sort=name', '?view=clients&attention=true', `?q=${'x'.repeat(201)}`]) {
      const r = await agency(query); const b = await json(r);
      expect(r.status === 400 && b?.code === 'invalid_request', `Filter ${query.slice(0, 40)} was not refused with 400 invalid_request (got ${r.status}).`);
    }
    const sorted = await json(await agency('?sort=name&order=asc'));
    expect(same(ids(sorted?.workspaces ?? []), [W.alpha, W.bravo, W.delta, W.echo, W.golf]), 'Name ascending order is wrong.');
    const failed = await json(await agency('?sort=failed&order=desc'));
    expect(failed?.workspaces?.[0]?.id === W.alpha && same(ids(failed?.workspaces?.slice(-2) ?? []), [W.delta, W.echo]), 'Withheld values must sort last.');
    const attention = await json(await agency('?attention=true'));
    expect(same(ids(attention?.workspaces ?? []), [W.delta, W.echo, W.alpha]) && attention?.totals?.workspaces === 5, 'Attention filter must narrow rows but not totals.');
    const search = await json(await agency(`?q=${encodeURIComponent(name('alpha'))}`));
    expect(same(ids(search?.workspaces ?? []), [W.alpha]) && search?.filtered === true && search?.totals?.workspaces === 1, 'Name search failed or totals did not follow it.');
    const wildcard = await agency('?q=%25'); const wildcardBody = await json(wildcard);
    expect(wildcard.status === 200 && same(wildcardBody?.workspaces, []), 'A LIKE wildcard was not matched literally.');
    const noMatch = await agency(`?q=${encodeURIComponent(`${prefix} nothing`)}`);
    expect(noMatch.status === 200 && same((await json(noMatch))?.workspaces, []), 'A search without matches must be an empty list, not an error.');
    await save('agency.workspaceLimit', 2);
    const truncated = await json(await agency());
    expect(truncated?.truncated === true && same(ids(truncated?.workspaces ?? []), [W.alpha, W.bravo]) && truncated?.totals?.workspaces === 2, 'Root workspace limit was not consumed (expected first two by name, truncated).');
    await save('agency.workspaceLimit', 200);
    await save('agency.searchMaxLength', 10);
    const longSearch = await agency(`?q=${'y'.repeat(11)}`);
    expect(longSearch.status === 400, 'Root search length bound was not consumed.');
    await save('agency.searchMaxLength', 200);

    stage = 'clients and invitations: authorization and exclusions';
    const clientsResponse = await agency('?view=clients'); const clientsText = await clientsResponse.text();
    const clients = (() => { try { return JSON.parse(clientsText); } catch { return null; } })();
    const clientRows: Client[] = clients?.workspaces ?? [];
    const client = new Map(clientRows.map(item => [item.workspaceId, item]));
    expect(clientsResponse.status === 200 && same(ids(clientRows as never), [W.alpha, W.bravo, W.delta, W.echo, W.hotel]), 'Clients view must list Alpha, Bravo, Delta, Echo, Hotel only (Golf has clients feature off; Foxtrot module off).');
    expect(leaks(clientsText, [name('charlie'), name('foxtrot'), name('golf'), name('zulu'), clientName('editorWs'), clientName('foreign'), clientName('disabled'), id('invite_zulu_pending'), id('invite_charlie_pending')]).length === 0, 'Clients view leaked foreign, editor-only, feature-off, disabled-user or foreign-invitation data.');
    expect(client.get(W.alpha)?.clientCount === 2 && same(client.get(W.alpha)?.clients.map(item => item.name).sort(), [clientName('one'), clientName('two')].sort()), 'Alpha client accounts differ from fixture.');
    expect(same(client.get(W.alpha)?.invitations.map(item => `${item.email}:${item.status}`).sort(), [`${id('invite_alpha_expired')}@example.test:expired`, `${id('invite_alpha_pending')}@example.test:pending`].sort()), 'Alpha invitations must be exactly the pending and expired client invitations (no editor or accepted ones).');
    expect(typeof client.get(W.alpha)?.invitationsAvailable === 'boolean', 'invitationsAvailable missing.');
    expect(client.get(W.bravo)?.clientCount === 1 && same(client.get(W.bravo)?.clients.map(item => item.name), [clientName('active')]), 'Bravo must list only its enabled client account.');
    expect(client.get(W.hotel)?.state === 'available' && client.get(W.hotel)?.clientCount === 0, 'Hotel (overview off for this member only) must still list clients.');
    expect(client.get(W.delta)?.state === 'suspended' && client.get(W.delta)?.clientCount === null && same(client.get(W.delta)?.clients, []) && same(client.get(W.delta)?.invitations, []), 'Suspended workspace clients/invitations were not withheld.');
    expect(client.get(W.echo)?.state === 'deleting' && client.get(W.echo)?.clientCount === null && same(client.get(W.echo)?.clients, []), 'Workspace under erasure clients were not withheld.');
    // Search is intentionally workspace-name only: matching client names/emails before entitlement checks would let a query infer client identity.
    const clientSearch = await json(await agency(`?view=clients&q=${encodeURIComponent(name('alpha'))}`));
    expect(clientSearch?.filtered === true && same(ids(clientSearch?.workspaces ?? []), [W.alpha]) && clientSearch?.workspaces?.[0]?.clientCount === 2, 'Clients workspace-name search must narrow to the matching workspace with its full client list.');
    for (const probe of [clientName('one'), clientName('active'), `${clientIds.one}@example.test`, clientIds.one]) {
      const r = await agency(`?view=clients&q=${encodeURIComponent(probe)}`); const text = await r.text();
      let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep null */ }
      expect(r.status === 200 && same(parsed?.workspaces, []) && leaks(text, [clientName('one'), clientName('two'), clientName('active'), clientIds.one, clientIds.two, clientIds.active]).length === 0, 'A client name/email/id search must not match or disclose any client association.');
    }

    stage = 'installation switches withhold, not empty';
    await save('entitlements.features.agency/clients', false);
    const clientsOff = await agency('?view=clients'); const clientsOffBody = await json(clientsOff);
    expect(clientsOff.status === 403 && clientsOffBody?.code === 'forbidden', 'Disabled clients feature must be refused (403), not an empty list.');
    expect((await agency()).status === 200, 'Disabling only the clients feature must not disable the overview.');
    await save('entitlements.features.agency/clients', true);
    await save('entitlements.modules.agency', false);
    for (const view of ['', '?view=clients']) { const r = await agency(view); expect(r.status === 403 && (await json(r))?.code === 'forbidden', `Disabled Agency module must be refused for ${view || 'overview'}.`); }
    // PageFrame redirects a module-disabled visitor to /access-limited instead of rendering a service notice.
    for (const path of ['/agency', '/agency/clients']) {
      const off = await pageMain(path, actorCookie);
      const redirected = off.status >= 300 && off.status < 400 && /access-limited/.test(off.location);
      const landed = off.status === 200 && /Access limited|not available/i.test(off.main ?? '');
      expect(redirected || off.accessRedirect || landed, `Module-disabled ${path} must redirect to access-limited (status ${off.status}, location ${off.location || 'none'}).`);
      expect(leaks(off.main ?? '', [name('alpha'), name('bravo'), clientName('one'), 'Data deletion in progress', 'Suspended']).length === 0, `Module-disabled ${path} rendered Agency content.`);
    }
    await save('entitlements.modules.agency', true);
    expect(same(ids((await json(await agency()))?.workspaces ?? []), ids(rows)), 'Overview did not recover after re-enabling Agency.');

    stage = 'header keys, anonymous and method refusals';
    for (const headers of [{ authorization: `Bearer ${keyToken}` }, { 'x-api-key': keyToken }, { authorization: 'Bearer not-a-real-key' }] as Array<Record<string, string>>) {
      const r = await agency('', { cookie: actorCookie, headers }); const text = await r.text();
      expect(r.status === 403 && !text.includes('"workspaces"') && !text.includes(name('alpha')), `A key/bearer header with a valid session was not refused (${r.status}).`);
    }
    const keyOnly = await agency('', { headers: { authorization: `Bearer ${keyToken}` } }); const keyOnlyText = await keyOnly.text();
    expect(keyOnly.status === 403 && !keyOnlyText.includes(name('alpha')), `A workspace key alone must not read Agency (${keyOnly.status}).`);
    const anonymous = await agency('', {});
    expect([307, 308, 401, 403].includes(anonymous.status), `Anonymous GET /api/agency must be refused or redirected to sign-in, got ${anonymous.status}.`);
    expect((await http('/api/agency', { cookie: actorCookie, method: 'POST', body: {} })).status === 405, 'Agency API must be read-only (405 on POST).');

    stage = 'workspace MCP key and sessions cannot reach person-wide Agency tools';
    const hidden = [name('bravo'), name('charlie'), name('delta'), name('echo'), name('golf'), name('hotel'), name('zulu'), W.bravo, W.zulu];
    for (const [label, auth] of [['workspace key', { scope: 'workspace' as const, bearer: keyToken }], ['workspace session', { scope: 'workspace' as const, cookie: actorCookie }], ['installation session', { scope: 'installation' as const, cookie: actorCookie }]] as const) {
      const list = await rpc('tools/list', {}, auth);
      const tools: string[] = (list.body?.result?.tools ?? []).map((tool: { name: string }) => tool.name);
      expect(tools.length > 0, `${label}: tools/list returned no tools (status ${list.status}).`);
      expect(!tools.some(tool => /agency/i.test(tool)), `${label}: catalog advertises an Agency tool.`);
      for (const tool of ['get_agency_overview', 'list_agency_clients']) {
        const call = await rpc('tools/call', { name: tool, arguments: {} }, auth);
        const refused = call.body?.error !== undefined || call.body?.result?.isError === true || call.status >= 400;
        expect(refused, `${label}: ${tool} did not fail.`);
        expect(leaks(call.text, hidden).length === 0 && !call.text.includes('"disconnected"'), `${label}: ${tool} response carried other-workspace data.`);
      }
      const resources = await rpc('resources/list', {}, auth);
      const uris: string[] = (resources.body?.result?.resources ?? []).map((item: { uri: string }) => item.uri);
      expect(!uris.some(uri => /agency/i.test(uri)), `${label}: resources advertise Agency.`);
    }

    stage = 'HTML pages: owner/admin, exclusions and states';
    const page = await pageMain('/agency', actorCookie); const pageText = page.main ?? '';
    expect(page.status === 200 && page.main !== null && (['alpha', 'bravo', 'delta', 'echo', 'golf'] as const).every(ws => pageText.includes(name(ws))), '/agency did not render every administered workspace.');
    expect(leaks(pageText, [name('charlie'), name('foxtrot'), name('hotel'), name('zulu')]).length === 0, '/agency leaked an editor-only, module-disabled, member-disabled or foreign workspace.');
    expect(pageText.includes('Suspended') && pageText.includes('Data deletion in progress'), '/agency did not show suspended and erasure states.');
    const clientsPage = await pageMain('/agency/clients', actorCookie); const clientsPageText = clientsPage.main ?? '';
    expect(clientsPage.status === 200 && clientsPage.main !== null && [name('alpha'), name('bravo'), name('hotel'), clientName('one'), clientName('two'), clientName('active')].every(value => clientsPageText.includes(value)), '/agency/clients did not render administered workspaces and their client accounts.');
    expect(leaks(clientsPageText, [name('charlie'), name('foxtrot'), name('golf'), name('zulu'), clientName('editorWs'), clientName('foreign'), clientName('disabled')]).length === 0, '/agency/clients leaked excluded data.');
    expect(clientsPageText.includes('is suspended') && clientsPageText.includes('Data deletion is in progress'), '/agency/clients did not explain withheld workspaces.');
    const badFilter = await pageMain('/agency?sort=bogus', actorCookie);
    expect(badFilter.status === 200 && (badFilter.main ?? '').includes('Choose valid filters'), '/agency did not show a recoverable invalid-filter notice.');
    const editorRes = await pageMain('/agency', cookieFor('editor', W.charlie)); const editorPage = editorRes.main ?? '';
    expect((editorRes.accessRedirect || (editorRes.status >= 300 && editorRes.status < 400 && editorRes.location.includes('access-limited')) || (editorRes.main !== null && editorPage.includes('You do not own or administer any workspace with Agency access yet.'))) && leaks(editorPage, (Object.keys(W) as Array<keyof typeof W>).map(name)).length === 0, 'Editor-only person did not get the empty Agency state or saw workspace names.');

    stage = 'workspace select action: owned, foreign and request refusals';
    const select = (workspaceId: string, opts: Partial<Parameters<typeof http>[1]> = {}) => http('/api/workspaces/select', { cookie: actorCookie, method: 'POST', body: { workspaceId }, ...opts });
    const cookieOf = (r: Response) => r.headers.getSetCookie().find(item => item.startsWith('sp_workspace='));
    const foreignSelect = await select(W.zulu);
    expect(foreignSelect.status === 404 && !cookieOf(foreignSelect), 'Selecting a foreign workspace must be refused (404) without setting a cookie.');
    expect((await select(id('does_not_exist'))).status === 404, 'Selecting an unknown workspace must be refused.');
    expect((await select(W.bravo, { origin: null })).status === 403, 'Select without an Origin header must be refused.');
    expect((await select(W.bravo, { origin: 'http://evil.example' })).status === 403, 'Cross-origin select must be refused.');
    expect((await http('/api/workspaces/select', { method: 'POST', body: { workspaceId: W.bravo } })).status === 401, 'Anonymous select must be refused (401).');
    expect((await http('/api/workspaces/select', { cookie: actorCookie, method: 'POST', body: { workspaceId: W.bravo, extra: true } })).status === 400, 'Select with unexpected body keys must be refused (400).');
    const chosen = await select(W.bravo); const chosenCookie = cookieOf(chosen);
    expect(chosen.status === 200 && chosenCookie?.startsWith(`sp_workspace=${W.bravo}`) === true, 'Selecting an owned workspace did not set the workspace cookie.');
    expect(/httponly/i.test(chosenCookie ?? '') && /samesite=lax/i.test(chosenCookie ?? '') && /path=\//i.test(chosenCookie ?? ''), 'Workspace cookie lacks HttpOnly/SameSite=Lax/Path=/.');
    // The browser session follows the chosen cookie: a workspace-bound resource resolves only in its own workspace.
    const bravoCookie = `msp_session=${token.actor}; sp_workspace=${W.bravo}`;
    expect((await http(`/api/tasks/${taskIds.bravoOpen}`, { cookie: bravoCookie })).status === 200, 'With Bravo selected, the Bravo task did not resolve.');
    expect((await http(`/api/tasks/${taskIds.alphaOpen}`, { cookie: bravoCookie })).status === 404, 'With Bravo selected, an Alpha task must not resolve.');
    expect((await http(`/api/tasks/${taskIds.alphaOpen}`, { cookie: actorCookie })).status === 200, 'With Alpha selected, the Alpha task did not resolve.');
    const stolen = await http(`/api/tasks/${id('task_zulu_1')}`, { cookie: `msp_session=${token.actor}; sp_workspace=${W.zulu}` });
    expect(stolen.status === 404, 'A forged foreign workspace cookie resolved a foreign task.');

    if (failures.length) throw new ProbeFailure(`Agency expectations not met (${failures.length}):\n- ${failures.join('\n- ')}`);
    console.log('PASS: actual local HTTP/MCP/PostgreSQL Agency overview/clients reads, owner/admin multi-workspace scope, editor-only/foreign/module-off/purge/suspension withholding, strict filters and Root bounds, header-key refusal, MCP key/session exclusion, pages and workspace selection; no provider call.');
  } finally {
    const errors: string[] = [];
    const clean = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch { errors.push(label); } };
    if (captured) for (const key of settingKeys) {
      const old = settings.get(key);
      await clean(`restore ${key}`, () => old
        ? db.appSetting.upsert({ where: { key }, create: { ...old, value: old.value === null ? Prisma.JsonNull : old.value }, update: { value: old.value === null ? Prisma.JsonNull : old.value, encrypted: old.encrypted, updatedAt: old.updatedAt } })
        : db.appSetting.deleteMany({ where: { key } }));
    }
    if (browser) await clean('headless browser', () => browser!.close());
    if (fixture) await clean('exact synthetic fixture cleanup', async () => {
      await db.mcpApiKey.deleteMany({ where: { id: id('key') } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.workspaceDataPurge.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await db.$executeRaw`DELETE FROM invitations WHERE "workspaceId" = ANY(${wsIds}::text[])`;
      await db.$executeRaw`DELETE FROM tasks WHERE "workspaceId" = ANY(${wsIds}::text[])`;
      await db.post.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await db.target.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await db.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ANY(${userIds}::text[]) OR detail->>'workspaceId' = ANY(${wsIds}::text[])`;
      await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ANY(${wsIds}::text[])`;
      await db.membership.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await db.workspace.deleteMany({ where: { id: { in: wsIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    });
    if (fixture) await clean('fixture/audit absence verification', async () => {
      const left = await db.$queryRaw<Array<{ n: bigint }>>`SELECT (
        (SELECT COUNT(*) FROM users WHERE id = ANY(${userIds}::text[])) + (SELECT COUNT(*) FROM workspaces WHERE id = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM memberships WHERE "workspaceId" = ANY(${wsIds}::text[]) OR "userId" = ANY(${userIds}::text[]))
        + (SELECT COUNT(*) FROM sessions WHERE "userId" = ANY(${userIds}::text[])) + (SELECT COUNT(*) FROM mcp_api_keys WHERE "workspaceId" = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM targets WHERE "workspaceId" = ANY(${wsIds}::text[])) + (SELECT COUNT(*) FROM posts WHERE "workspaceId" = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM tasks WHERE "workspaceId" = ANY(${wsIds}::text[])) + (SELECT COUNT(*) FROM invitations WHERE "workspaceId" = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM workspace_data_purges WHERE "workspaceId" = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM root_activities WHERE "actorId" = ANY(${userIds}::text[]) OR detail->>'workspaceId' = ANY(${wsIds}::text[]))
        + (SELECT COUNT(*) FROM activity_logs WHERE "workspaceId" = ANY(${wsIds}::text[])))::bigint AS n`;
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
    else if (fixture || captured) console.log(`All synthetic fixtures and audit rows removed; exact prior Root settings${rootWrites ? ' restored and' : ''} verified.`);
  }
}
main().catch(error => { console.error(`Agency workflow probe failed at ${stage}: ${error instanceof ProbeFailure ? error.message : 'unexpected local failure (details withheld)'}`); process.exitCode = 1; });
