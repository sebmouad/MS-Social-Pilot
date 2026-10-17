import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';

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
  let originalSetting: { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date } | null = null;
  let settingCaptured = false;
  let originalAuditIds = new Set<string>();
  let rootCookie = '';
  let changedSetting = false;
  const configKey = 'ads.reportingFilters';
  const audits = async () => db.$queryRaw<Array<{ id: string; detail: unknown }>>`SELECT id, detail FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ${configKey}`;
  const rpc = async (name: string, args: object, workspaceKey = false) => {
    const response = await fetch(`${previewOrigin.origin}/api/mcp?scope=${workspaceKey ? 'workspace' : 'installation'}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', ...(workspaceKey ? { authorization: `Bearer ${bearer}` } : { cookie: rootCookie }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }), redirect: 'manual',
    });
    const body = await response.json();
    return { response, body, data: body.result?.structuredContent };
  };
  const rootConfig = (value: unknown) => fetch(`${previewOrigin.origin}/api/root/config`, {
    method: 'PUT', headers: { origin, cookie: rootCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ key: configKey, value }), redirect: 'manual',
  });
  const restore = async () => {
    if (!changedSetting) return;
    if (originalSetting) {
      await db.appSetting.upsert({ where: { key: configKey }, create: { ...originalSetting, value: originalSetting.value === null ? Prisma.JsonNull : originalSetting.value }, update: { value: originalSetting.value === null ? Prisma.JsonNull : originalSetting.value, encrypted: originalSetting.encrypted, updatedAt: originalSetting.updatedAt } });
    } else await db.appSetting.deleteMany({ where: { key: configKey } });
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
    originalSetting = await db.appSetting.findUnique({ where: { key: configKey }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
    settingCaptured = true;
    check(!originalSetting || !originalSetting.encrypted, 'Ads report policy fixture must be a non-secret setting.');
    originalAuditIds = new Set((await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ${configKey}`).map(row => row.id));
    rootCookie = cookie(rootToken, workspaceId);

    stage = 'temporary identity';
    await db.user.create({ data: { id: rootId, email: rootEmail, name: 'Disposable Ads Root owner', passwordHash: 'unused-preview-password', isInstanceOwner: true } });
    await db.user.create({ data: { id: userId, email, name: 'Disposable Ads policy probe', passwordHash: 'unused-preview-password' } });
    await db.membership.create({ data: { id: memberId, userId, workspaceId, role: 'owner' } });
    await db.session.create({ data: { id: rootSessionId, userId: rootId, tokenHash: hashLegacySessionToken(rootToken)!, expiresAt, pending: null } });
    await db.session.create({ data: { id: sessionId, userId, tokenHash: hashLegacySessionToken(userToken)!, expiresAt, pending: null } });
    await db.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: userId, name: 'Disposable Ads report reader', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['ads/campaigns'], writeFeatures: [], expiresAt } });
    const userCookie = cookie(userToken, workspaceId);
    check((await fetch(`${previewOrigin.origin}/api/root/config`, { headers: { cookie: userCookie } })).status === 404, 'Workspace owner must not read Root configuration.');
    changedSetting = true;
    const deniedRootSave = await fetch(`${previewOrigin.origin}/api/root/config`, { method: 'PUT', headers: { origin, cookie: userCookie, 'content-type': 'application/json' }, body: JSON.stringify({ key: configKey, value: policy }), redirect: 'manual' });
    check(deniedRootSave.status === 404, 'Workspace owner must not change Root configuration.');
    const keyRootGet = await fetch(`${previewOrigin.origin}/api/root/config`, { headers: { authorization: `Bearer ${bearer}` } });
    check(keyRootGet.status === 401, 'Workspace API key must not read Root configuration.');
    const keyRootSet = await rpc('set_root_config', { key: configKey, value: policy, confirmation: `SET ROOT CONFIG ${configKey}` }, true);
    check(keyRootSet.body.error || keyRootSet.body.result?.isError || !keyRootSet.response.ok, 'Workspace key must not change Root configuration.');

    stage = 'Root validation and save';
    const before = await audits();
    const invalid = await rootConfig({ ...policy, defaultPreset: 'missing' });
    check(invalid.status === 400 && (await audits()).length === before.length, 'Invalid Root policy must not audit or persist.');
    const afterInvalid = await db.appSetting.findUnique({ where: { key: configKey }, select: { value: true, encrypted: true, updatedAt: true } });
    check(JSON.stringify(afterInvalid) === JSON.stringify(originalSetting && { value: originalSetting.value, encrypted: originalSetting.encrypted, updatedAt: originalSetting.updatedAt }), 'Invalid Root policy must leave the prior setting unchanged.');
    const httpSave = await rootConfig(policy);
    check(httpSave.ok && (await httpSave.json()).schemaVersion === 52, 'Valid Root HTTP policy save must apply schema version 52.');
    const mcpSave = await rpc('set_root_config', { key: configKey, value: policy, confirmation: `SET ROOT CONFIG ${configKey}` });
    check(mcpSave.response.ok && !mcpSave.body.result?.isError && mcpSave.data?.saved === true && mcpSave.data?.schemaVersion === 52, 'Confirmed Root MCP policy save must apply schema version 52.');
    const newAudits = (await audits()).filter(row => !originalAuditIds.has(row.id));
    check(newAudits.length === before.length - originalAuditIds.size + 2 && newAudits.every(row => !JSON.stringify(row.detail).includes(policy.presets[0]!.label)), 'Both saves must have value-free Root audits.');

    stage = 'customer Ads reports';
    const accountList = await rpc('list_ad_accounts', {}, true);
    const account = accountList.data?.accounts?.[0];
    check(accountList.response.ok && account?.id, 'Readonly Ads key must list a selected fixture account.');
    const readPerformance = async (args: object) => rpc('get_ads_performance', args, true);
    const defaults = await readPerformance({});
    check(!defaults.body.result?.isError && defaults.data?.reportOptions?.defaultPreset === '14d' && defaults.data?.reportOptions?.maxRangeDays === 14 && defaults.data?.reportOptions?.presets?.some((item: { id: string; label: string }) => item.id === '14d' && item.label === policy.presets[0]!.label), 'Customer MCP must expose the saved preset, label and configured maximum.');
    check(defaults.data?.range?.endExclusive === true && defaults.data.range.to === new Date(new Date(defaults.data.range.from).getTime() + 14 * 86_400_000).toISOString(), 'Default MCP period must report an exclusive end and cover exactly 14 UTC days.');
    const explicitPreset = await readPerformance({ period: '14d' });
    check(!explicitPreset.body.result?.isError && explicitPreset.data?.range?.endExclusive === true && explicitPreset.data?.range?.to === new Date(new Date(explicitPreset.data.range.from).getTime() + 14 * 86_400_000).toISOString(), 'Explicit configured 14d preset must be accepted with the bounded UTC range.');
    const exact = await readPerformance({ period: 'custom', start: '2026-10-01', end: '2026-10-14', accountId: account.id });
    check(!exact.body.result?.isError && exact.data?.range?.from === '2026-10-01T00:00:00.000Z' && exact.data?.range?.to === '2026-10-15T00:00:00.000Z', 'Inclusive maximum custom range must be accepted with exclusive UTC end.');
    const over = await readPerformance({ period: 'custom', start: '2026-10-01', end: '2026-10-15', accountId: account.id });
    check(over.body.result?.isError === true, 'Custom range above the configured ceiling must be refused.');
    const endOnly = await readPerformance({ end: '2026-10-17', accountId: account.id });
    check(!endOnly.body.result?.isError && endOnly.data?.range?.from === '2026-10-04T00:00:00.000Z' && endOnly.data?.range?.to === '2026-10-18T00:00:00.000Z', 'End-only query must anchor to the configured default duration.');
    const stale = await readPerformance({ period: '30d' });
    check(stale.body.result?.isError === true && stale.data?.range === undefined, 'Unknown stale preset must fail before returning or broadening a report.');

    stage = 'server-rendered Ads UI';
    for (const path of ['/ads', '/ads/campaigns']) {
      const response = await fetch(`${previewOrigin.origin}${path}`, { headers: { cookie: userCookie }, redirect: 'manual' });
      const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
      const selectedPreset = html.match(/<option\b[^>]*value="14d"[^>]*>/)?.[0] ?? '';
      check(response.ok && selectedPreset.includes('selected') && html.includes(policy.presets[0]!.label) && html.includes('14 days'), `${path} must render the selected configured preset and range limit.`);
    }
    console.log(JSON.stringify({ adsPolicyHttpMcpAndRenderedUi: true, customPresetAndUtcBounds: true, invalidAndStaleInputsRefused: true, workspaceOwnerAndKeyRootAccessDenied: true, providerRequests: false }));
  } finally {
    try {
      await restore();
      if (settingCaptured) {
        const restored = await db.appSetting.findUnique({ where: { key: configKey }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
        check(JSON.stringify(restored) === JSON.stringify(originalSetting), 'Original Ads report policy row must be restored exactly.');
        console.log('Original Ads report policy setting restoration verified.');
      }
    } finally {
      try {
        if (workspaceId) {
          const created = (await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ${configKey}`).map(row => row.id).filter(id => !originalAuditIds.has(id));
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
