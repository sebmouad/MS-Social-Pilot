import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'guards';

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && origin && process.env.NODE_ENV !== 'production' && databaseUrl === process.env.DATABASE_URL, 'Explicit matching isolated preview database and origin required.');
  const database = new URL(databaseUrl);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only isolated loopback preview databases are permitted.');
  let previewOrigin: URL;
  try { previewOrigin = new URL(origin); } catch { throw new ProbeFailure('Explicit localhost HTTP preview origin required.'); }
  check(previewOrigin.origin === origin && previewOrigin.protocol === 'http:' && previewOrigin.hostname === 'localhost', 'Only an explicit localhost HTTP origin is permitted.');

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_ads_policy_${randomUUID().replaceAll('-', '')}`;
  const rootId = `${prefix}_root`, rootEmail = `${prefix}_root@example.test`, rootSessionId = `${prefix}_root_session`, rootToken = randomBytes(32).toString('base64url');
  const userId = `${prefix}_user`, memberId = `${prefix}_membership`, sessionId = `${prefix}_session`, keyId = `${prefix}_key`;
  const email = `${prefix}@example.test`, userToken = randomBytes(32).toString('base64url');
  const bearer = `mcp_${randomBytes(32).toString('base64url')}`, expiresAt = new Date(Date.now() + 300_000);
  const cookie = (token: string, workspaceId: string) => `msp_session=${token}; sp_workspace=${workspaceId}`;
  const policy = { presets: [{ id: '14d', days: 14, label: 'Last 14 days Root Probe' }], defaultPreset: '14d', maxRangeDays: 14, maxFilterCharacters: 200 };
  let workspaceId = '';
  const configKeys = ['ads.reportingFilters', 'ads.reportPageSize', 'ads.reportMaxRows'] as const;
  type AdsConfigKey = typeof configKeys[number];
  type SettingRow = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };
  const originalSettings = new Map<AdsConfigKey, SettingRow | null>();
  let settingsCaptured = false;
  let originalAuditIds = new Set<string>();
  let rootCookie = '';
  let rootWriteAttempted = false;
  const audits = async () => db.$queryRaw<Array<{ id: string; detail: unknown }>>`SELECT id, detail FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...configKeys]})`;
  const rpc = async (name: string, args: object, workspaceKey = false) => {
    const response = await fetch(`${previewOrigin.origin}/api/mcp?scope=${workspaceKey ? 'workspace' : 'installation'}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', ...(workspaceKey ? { authorization: `Bearer ${bearer}` } : { cookie: rootCookie }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual',
    });
    const body = await response.json();
    return { response, body, data: body.result?.structuredContent };
  };
  const rootConfig = (key: AdsConfigKey, value: unknown) => fetch(`${previewOrigin.origin}/api/root/config`, {
    method: 'PUT', headers: { origin, cookie: rootCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }), redirect: 'manual',
  });
  const restore = async () => {
    if (!rootWriteAttempted || !settingsCaptured) return;
    for (const key of configKeys) {
      const original = originalSettings.get(key);
      if (original) {
        await db.appSetting.upsert({ where: { key }, create: { ...original, value: original.value === null ? Prisma.JsonNull : original.value }, update: { value: original.value === null ? Prisma.JsonNull : original.value, encrypted: original.encrypted, updatedAt: original.updatedAt } });
      } else await db.appSetting.deleteMany({ where: { key } });
    }
  };
  const writeRootConfig = async (key: AdsConfigKey, value: unknown) => {
    rootWriteAttempted = true;
    return rootConfig(key, value);
  };

  try {
    const fixture = await db.user.findUnique({ where: { email: 'preview-qa@example.test' }, select: { id: true, isInstanceOwner: true, memberships: { select: { workspaceId: true } } } });
    check(fixture?.isInstanceOwner && fixture.memberships.length > 0, 'Seeded Root owner and preview workspace fixture required.');
    for (const membership of fixture.memberships) {
      const selected = await db.adAccount.findMany({ where: { workspaceId: membership.workspaceId, enabled: true }, select: { id: true }, take: 1 });
      if (selected.length) { workspaceId = membership.workspaceId; break; }
    }
    const accounts = workspaceId ? await db.adAccount.findMany({ where: { workspaceId, enabled: true }, select: { id: true } }) : [];
    check(accounts.length > 0, 'At least one enabled fixture ad account is required.');
    for (const key of configKeys) {
      const setting = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
      check(!setting || !setting.encrypted, `Ads setting ${key} must not be encrypted.`);
      originalSettings.set(key, setting);
    }
    settingsCaptured = true;
    originalAuditIds = new Set((await audits()).map(row => row.id));
    rootCookie = cookie(rootToken, workspaceId);

    stage = 'temporary identity';
    await db.user.create({ data: { id: rootId, email: rootEmail, name: 'Disposable Ads Root owner', passwordHash: 'unused-preview-password', isInstanceOwner: true } });
    await db.user.create({ data: { id: userId, email, name: 'Disposable Ads policy probe', passwordHash: 'unused-preview-password' } });
    await db.membership.create({ data: { id: memberId, userId, workspaceId, role: 'owner' } });
    await db.session.create({ data: { id: rootSessionId, userId: rootId, tokenHash: hashSessionToken(rootToken)!, expiresAt, pending: null } });
    await db.session.create({ data: { id: sessionId, userId, tokenHash: hashSessionToken(userToken)!, expiresAt, pending: null } });
    await db.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: userId, name: 'Disposable Ads report reader', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['ads/campaigns'], writeFeatures: [], expiresAt } });
    const userCookie = cookie(userToken, workspaceId);
    check((await fetch(`${previewOrigin.origin}/api/root/config`, { headers: { cookie: userCookie } })).status === 404, 'Workspace owner must not read Root configuration.');
    rootWriteAttempted = true;
    const deniedRootSave = await fetch(`${previewOrigin.origin}/api/root/config`, { method: 'PUT', headers: { origin, cookie: userCookie, 'content-type': 'application/json' }, body: JSON.stringify({ key: configKeys[0], value: policy }), redirect: 'manual' });
    check(deniedRootSave.status === 404, 'Workspace owner must not change Root configuration.');
    const keyRootGet = await fetch(`${previewOrigin.origin}/api/root/config`, { headers: { authorization: `Bearer ${bearer}` } });
    check(keyRootGet.status === 401, 'Workspace API key must not read Root configuration.');
    rootWriteAttempted = true;
    const keyRootSet = await rpc('set_root_config', { key: configKeys[0], value: policy, confirmation: `SET ROOT CONFIG ${configKeys[0]}` }, true);
    check(keyRootSet.body.error || keyRootSet.body.result?.isError || !keyRootSet.response.ok, 'Workspace key must not change Root configuration.');

    stage = 'Root validation and save';
    const before = await audits();
    const invalid = await writeRootConfig(configKeys[0], { ...policy, defaultPreset: 'missing' });
    check(invalid.status === 400 && (await audits()).length === before.length, 'Invalid Root policy must not audit or persist.');
    const afterInvalid = await db.appSetting.findUnique({ where: { key: configKeys[0] }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
    check(JSON.stringify(afterInvalid) === JSON.stringify(originalSettings.get(configKeys[0])), 'Invalid Root policy must leave the prior setting unchanged.');
    const httpSave = await writeRootConfig(configKeys[0], policy);
    check(httpSave.ok && (await httpSave.json()).schemaVersion === CONFIG_SCHEMA_VERSION, 'Valid Root HTTP policy save must apply the current build schema version.');
    const mcpSave = await rpc('set_root_config', { key: configKeys[0], value: policy, confirmation: `SET ROOT CONFIG ${configKeys[0]}` });
    check(mcpSave.response.ok && !mcpSave.body.result?.isError && mcpSave.data?.saved === true && mcpSave.data?.schemaVersion === CONFIG_SCHEMA_VERSION, 'Confirmed Root MCP policy save must apply the current build schema version.');

    stage = 'customer Ads reports';
    const accountList = await rpc('list_ad_accounts', {}, true);
    const firstAccount = accountList.data?.accounts?.[0];
    check(accountList.response.ok && firstAccount?.id, 'Readonly Ads key must list a selected fixture account.');
    const readPerformance = async (args: object) => rpc('get_ads_performance', args, true);
    const pageSizeSave = await writeRootConfig(configKeys[1], 1);
    check(pageSizeSave.ok && (await pageSizeSave.json()).schemaVersion === CONFIG_SCHEMA_VERSION, 'Root must save the one-row Ads report page size.');
    const maxRowsReset = await writeRootConfig(configKeys[2], 20000);
    check(maxRowsReset.ok && (await maxRowsReset.json()).schemaVersion === CONFIG_SCHEMA_VERSION, 'Root must set a sufficient row ceiling before pagination checks.');
    const defaults = await readPerformance({});
    check(!defaults.body.result?.isError && defaults.data?.reportOptions?.defaultPreset === '14d' && defaults.data?.reportOptions?.maxRangeDays === 14 && defaults.data?.reportOptions?.presets?.some((item: { id: string; label: string }) => item.id === '14d' && item.label === policy.presets[0]!.label), 'Customer MCP must expose the saved preset, label and configured maximum.');
    check(defaults.data?.range?.endExclusive === true && defaults.data.range.to === new Date(new Date(defaults.data.range.from).getTime() + 14 * 86_400_000).toISOString(), 'Default MCP period must report an exclusive end and cover exactly 14 UTC days.');
    check(defaults.data?.resultCount > 1 && defaults.data.performance.length <= 1 && defaults.data.nextOffset === 1, 'MCP Ads performance must use the Root page size and expose a continuation for seeded results.');
    const secondPage = await readPerformance({ offset: defaults.data.nextOffset });
    check(!secondPage.body.result?.isError && secondPage.data?.resultCount === defaults.data.resultCount && secondPage.data.performance.length <= 1 && secondPage.data.performance[0]?.id !== defaults.data.performance[0]?.id, 'MCP Ads performance must return a distinct next page with the same result count.');
    const explicitPreset = await readPerformance({ period: '14d' });
    check(!explicitPreset.body.result?.isError && explicitPreset.data?.range?.endExclusive === true && explicitPreset.data?.range?.to === new Date(new Date(explicitPreset.data.range.from).getTime() + 14 * 86_400_000).toISOString(), 'Explicit configured 14d preset must be accepted with the bounded UTC range.');
    const exact = await readPerformance({ period: 'custom', start: '2026-10-01', end: '2026-10-14', accountId: firstAccount.id });
    check(!exact.body.result?.isError && exact.data?.range?.from === '2026-10-01T00:00:00.000Z' && exact.data?.range?.to === '2026-10-15T00:00:00.000Z', 'Inclusive maximum custom range must be accepted with exclusive UTC end.');
    const over = await readPerformance({ period: 'custom', start: '2026-10-01', end: '2026-10-15', accountId: firstAccount.id });
    check(over.body.result?.isError === true, 'Custom range above the configured ceiling must be refused.');
    const endOnly = await readPerformance({ end: '2026-10-17', accountId: firstAccount.id });
    check(!endOnly.body.result?.isError && endOnly.data?.range?.from === '2026-10-04T00:00:00.000Z' && endOnly.data?.range?.to === '2026-10-18T00:00:00.000Z', 'End-only query must anchor to the configured default duration.');
    const stale = await readPerformance({ period: '30d' });
    check(stale.body.result?.isError === true && stale.data?.range === undefined, 'Unknown stale preset must fail before returning or broadening a report.');

    stage = 'server-rendered Ads pagination';
    const accountCandidates = accountList.data.accounts as Array<{ id: string }>;
    let pagedAccount: { id: string } | undefined;
    for (const candidate of accountCandidates) {
      const report = await readPerformance({ period: 'custom', start: '2026-10-01', end: '2026-10-14', accountId: candidate.id });
      if (!report.body.result?.isError && report.data?.resultCount > 1) { pagedAccount = candidate; break; }
    }
    check(pagedAccount, 'Seeded fixture data must include a selected account with multiple campaign report objects.');
    check((accountList.data.accountCount ?? accountCandidates.length) > 1, 'Seeded fixtures must include multiple ad accounts for overview pagination.');
    const htmlPage = async (path: '/ads' | '/ads/campaigns', page: 1 | 2, accountId?: string) => {
      const query = new URLSearchParams({ period: 'custom', since: '2026-10-01', until: '2026-10-14' });
      if (accountId) query.set('account', accountId);
      if (page === 2) query.set('page', '2');
      const response = await fetch(`${previewOrigin.origin}${path}?${query}`, { headers: { cookie: userCookie }, redirect: 'manual' });
      const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
      check(response.ok && html.includes('Showing ') && html.includes(`Page ${page} of`), `${path} must render report counts and page state.`);
      check(html.includes('2026-10-01') && html.includes('2026-10-14') && (!accountId || html.includes(accountId)), `${path} must render its selected date and account filters.`);
      const navLabel = path === '/ads' ? 'Account report pages' : 'Object report pages';
      check(html.includes(`aria-label="${navLabel}"`), `${path} must render report page navigation.`);
      if (page === 1) {
        const nextHref = html.match(/href="([^"]*page=2[^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
        check(nextHref, `${path} must offer a link to page 2.`);
        const next = new URL(nextHref, previewOrigin.origin);
        check(next.searchParams.get('period') === 'custom' && next.searchParams.get('since') === '2026-10-01' && next.searchParams.get('until') === '2026-10-14' && next.searchParams.get('account') === (accountId ?? null), `${path} page links must retain report filters.`);
      }
    };
    for (const path of ['/ads', '/ads/campaigns'] as const) {
      await htmlPage(path, 1, path === '/ads/campaigns' ? pagedAccount.id : undefined);
      await htmlPage(path, 2, path === '/ads/campaigns' ? pagedAccount.id : undefined);
    }

    stage = 'Ads maximum row bound';
    const maxRowsSave = await writeRootConfig(configKeys[2], 1);
    check(maxRowsSave.ok && (await maxRowsSave.json()).schemaVersion === CONFIG_SCHEMA_VERSION, 'Root must save the one-row Ads report ceiling.');
    const boundedRead = await readPerformance({ period: 'custom', start: '2026-10-01', end: '2026-10-14', accountId: pagedAccount.id });
    const boundedData = boundedRead.body.result?.structuredContent;
    check(boundedRead.response.ok && boundedRead.body.result?.isError === true && !boundedData?.performance && boundedData?.resultCount === undefined, 'MCP must refuse an over-limit report without partial rows or a count.');
    for (const path of ['/ads', '/ads/campaigns'] as const) {
      const query = new URLSearchParams({ period: 'custom', since: '2026-10-01', until: '2026-10-14', account: pagedAccount.id });
      const response = await fetch(`${previewOrigin.origin}${path}?${query}`, { headers: { cookie: userCookie }, redirect: 'manual' });
      const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
      check(response.ok && html.includes('Report could not be loaded completely') && html.includes('No partial report is shown'), `${path} must render the actionable report limit state.`);
      check(!html.includes('class="metric-grid"') && !html.includes('class="ads-results-panel"') && html.includes('2026-10-01') && html.includes('2026-10-14') && html.includes(pagedAccount.id), `${path} must not render partial metrics and must retain selected filters.`);
    }
    const newAudits = (await audits()).filter(row => !originalAuditIds.has(row.id));
    check(newAudits.length === 5 && newAudits.every(row => {
      if (!row.detail || typeof row.detail !== 'object') return false;
      const detail = row.detail as Record<string, unknown>;
      return configKeys.includes(detail.key as AdsConfigKey) && !Object.hasOwn(detail, 'value') && !JSON.stringify(detail).includes(policy.presets[0]!.label);
    }), 'Root writes must produce scoped, value-free configuration audits.');
    console.log(JSON.stringify({ adsPolicyHttpMcpAndRenderedUi: true, reportPaginationAndBounds: true, invalidAndStaleInputsRefused: true, workspaceOwnerAndKeyRootAccessDenied: true, providerRequests: false }));
  } finally {
    try {
      await restore();
      if (settingsCaptured) {
        for (const key of configKeys) {
          const restored = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
          check(JSON.stringify(restored) === JSON.stringify(originalSettings.get(key)), `Original Ads setting ${key} must be restored exactly.`);
        }
        console.log('Original Ads report settings restoration verified.');
      }
    } finally {
      try {
        if (workspaceId) {
          const created = (await audits()).map(row => row.id).filter(id => !originalAuditIds.has(id));
          if (created.length) await db.$executeRaw`DELETE FROM root_activities WHERE id = ANY(${created})`;
        }
        await db.mcpApiKey.deleteMany({ where: { id: keyId, workspaceId } });
        await db.session.deleteMany({ where: { id: { in: [rootSessionId, sessionId] }, userId: { in: [rootId, userId] } } });
        await db.membership.deleteMany({ where: { id: memberId, userId, workspaceId } });
        await db.user.deleteMany({ where: { OR: [{ id: rootId, email: rootEmail }, { id: userId, email }] } });
        check(await db.user.count({ where: { id: { in: [rootId, userId] } } }) === 0 && await db.session.count({ where: { id: { in: [rootSessionId, sessionId] } } }) === 0 && await db.mcpApiKey.count({ where: { id: keyId } }) === 0 && await db.membership.count({ where: { id: memberId } }) === 0, 'Disposable identities, sessions, key and membership must be removed.');
        console.log('Ads report policy probe identity cleanup verified.');
      } finally { await db.$disconnect(); }
    }
  }
}

main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : `Ads report policy probe failed at ${stage}; sensitive details withheld.`); process.exitCode = 1; });
