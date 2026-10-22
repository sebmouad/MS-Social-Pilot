import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'guards';

type ProbeSettingKey = 'ads.reportPageSize' | 'ads.reportMaxRows' | 'ads.detailMaxBytes' | 'ads.exportMaxBytes' | 'mcp.authenticatedRoles';
type SavedSetting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };
const settingKeys: readonly ProbeSettingKey[] = ['ads.reportPageSize', 'ads.reportMaxRows', 'ads.detailMaxBytes', 'ads.exportMaxBytes', 'mcp.authenticatedRoles'];

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && origin && process.env.NODE_ENV !== 'production' && databaseUrl === process.env.DATABASE_URL,
    'Set matching DATABASE_URL and REBUILD_PREVIEW_DATABASE_URL plus an explicit preview origin; production is refused.');
  let database: URL;
  let previewOrigin: URL;
  try { database = new URL(databaseUrl); } catch { throw new ProbeFailure('Only a loopback PostgreSQL preview database is permitted.'); }
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)),
  'Only isolated loopback PostgreSQL databases ending in _preview are permitted; database host overrides are refused.');
  try { previewOrigin = new URL(origin); } catch { throw new ProbeFailure('Only an explicit localhost HTTP preview origin is permitted.'); }
  check(previewOrigin.origin === origin && previewOrigin.protocol === 'http:' && previewOrigin.hostname === 'localhost',
    'Only an explicit localhost HTTP preview origin is permitted.');

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_ads_export_${randomUUID().replaceAll('-', '')}`;
  const rootId = `${prefix}_root`, rootEmail = `${prefix}_root@example.test`, rootSessionId = `${prefix}_root_session`;
  const viewerId = `${prefix}_viewer`, viewerEmail = `${prefix}_viewer@example.test`, viewerSessionId = `${prefix}_viewer_session`;
  const membershipId = `${prefix}_membership`, readKeyId = `${prefix}_read_key`, deniedKeyId = `${prefix}_denied_key`;
  const insightIds = [randomUUID(), randomUUID(), randomUUID()];
  const rootToken = randomBytes(32).toString('base64url'), viewerToken = randomBytes(32).toString('base64url');
  const readBearer = `mcp_${randomBytes(32).toString('base64url')}`, deniedBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const savedSettings = new Map<ProbeSettingKey, SavedSetting | null>();
  let settingsCaptured = false, rootWriteAttempted = false, workspaceId = '', scopedTargetId = '', scopedAccountId = '';
  let configWriteCount = 0;
  let rootCookie = '', viewerCookie = '';
  let insightsCreated = false, grantCreated = false;
  const cookie = (token: string) => `msp_session=${token}; sp_workspace=${workspaceId}`;
  const audits = () => db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...settingKeys]})`;
  const saveSetting = async (key: ProbeSettingKey, value: unknown) => {
    rootWriteAttempted = true;
    const response = await fetch(new URL('/api/root/config', previewOrigin), {
      method: 'PUT', headers: { origin, cookie: rootCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ key, value }), redirect: 'manual',
    });
    const body = await response.json();
    check(response.ok && body.schemaVersion === CONFIG_SCHEMA_VERSION, `Root must apply the current schema for ${key}.`);
    configWriteCount++;
  };
  const rpc = async (name: string, args: unknown, authorization: 'root' | 'read' | 'denied' = 'read') => {
    const headers: Record<string, string> = { origin: previewOrigin.origin, 'content-type': 'application/json' };
    if (authorization === 'root') headers.cookie = rootCookie;
    else headers.authorization = `Bearer ${authorization === 'read' ? readBearer : deniedBearer}`;
    const response = await fetch(new URL('/api/mcp?scope=workspace', previewOrigin), {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: name === 'resources/read' ? name : name === 'tools/list' ? name : 'tools/call',
        params: name === 'resources/read' ? args : name === 'tools/list' ? {} : { name, arguments: args } }),
      redirect: 'manual',
    });
    return { response, body: await response.json() };
  };
  const restoreSettings = async () => {
    if (!rootWriteAttempted || !settingsCaptured) return;
    for (const key of settingKeys) {
      const original = savedSettings.get(key);
      if (original) {
        await db.appSetting.upsert({ where: { key }, create: { ...original, value: original.value === null ? Prisma.JsonNull : original.value },
          update: { value: original.value === null ? Prisma.JsonNull : original.value, encrypted: original.encrypted, updatedAt: original.updatedAt } });
      } else await db.appSetting.deleteMany({ where: { key } });
    }
    for (const key of settingKeys) {
      const restored = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
      check(JSON.stringify(restored) === JSON.stringify(savedSettings.get(key)), `Original Ads setting ${key} must be restored exactly.`);
    }
  };

  try {
    stage = 'synthetic Ads fixture discovery';
    const fixture = await db.user.findUnique({ where: { email: 'preview-qa@example.test' }, select: { id: true, isInstanceOwner: true, disabledAt: true, memberships: { select: { workspaceId: true } } } });
    check(fixture && fixture.isInstanceOwner && !fixture.disabledAt && fixture.memberships.length > 0, 'Active seeded preview Root owner and workspace fixtures are required.');
    for (const membership of fixture.memberships) {
      const accounts = await db.adAccount.findMany({ where: { workspaceId: membership.workspaceId, enabled: true, socialAccountId: { not: null } },
        select: { id: true, socialAccountId: true }, orderBy: { id: 'asc' } });
      const socialIds = [...new Set(accounts.flatMap(account => account.socialAccountId ? [account.socialAccountId] : []))];
      if (!socialIds.length) continue;
      const targets = await db.target.findMany({ where: { workspaceId: membership.workspaceId, socialAccountId: { in: socialIds }, enabled: true },
        select: { id: true, socialAccountId: true }, orderBy: { id: 'asc' } });
      const targetBySocial = new Map<string, string>();
      for (const target of targets) if (target.socialAccountId && !targetBySocial.has(target.socialAccountId)) targetBySocial.set(target.socialAccountId, target.id);
      const candidate = accounts.find(account => account.socialAccountId && targetBySocial.has(account.socialAccountId));
      if (candidate?.socialAccountId) { workspaceId = membership.workspaceId; scopedAccountId = candidate.id; scopedTargetId = targetBySocial.get(candidate.socialAccountId)!; break; }
    }
    check(workspaceId && scopedAccountId && scopedTargetId, 'Seeded preview workspace must have an enabled ad account connected to an enabled channel.');
    for (const key of settingKeys) {
      const setting = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
      check(!setting || !setting.encrypted, `Ads setting ${key} must not be encrypted.`);
      savedSettings.set(key, setting);
    }
    settingsCaptured = true;

    stage = 'temporary scoped identities';
    await db.user.create({ data: { id: rootId, email: rootEmail, name: 'Disposable Ads report Root probe', passwordHash: 'unused-preview-password', isInstanceOwner: true } });
    await db.user.create({ data: { id: viewerId, email: viewerEmail, name: 'Disposable Ads report viewer', passwordHash: 'unused-preview-password' } });
    await db.membership.create({ data: { id: `${prefix}_root_membership`, userId: rootId, workspaceId, role: 'owner' } });
    await db.membership.create({ data: { id: membershipId, userId: viewerId, workspaceId, role: 'viewer' } });
    await db.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await db.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, ${scopedTargetId})`;
    grantCreated = true;
    await db.session.create({ data: { id: rootSessionId, userId: rootId, tokenHash: hashSessionToken(rootToken)!, expiresAt, pending: null } });
    await db.session.create({ data: { id: viewerSessionId, userId: viewerId, tokenHash: hashSessionToken(viewerToken)!, expiresAt, pending: null } });
    await db.mcpApiKey.create({ data: { id: readKeyId, workspaceId, createdById: viewerId, name: 'Disposable Ads report reader',
      tokenHash: createHash('sha256').update(readBearer).digest('hex'), tokenPrefix: readBearer.slice(0, 12), readFeatures: ['ads/campaigns'], writeFeatures: [], expiresAt } });
    await db.mcpApiKey.create({ data: { id: deniedKeyId, workspaceId, createdById: viewerId, name: 'Disposable Ads report denied key',
      tokenHash: createHash('sha256').update(deniedBearer).digest('hex'), tokenPrefix: deniedBearer.slice(0, 12), readFeatures: ['analytics/overview'], writeFeatures: [], expiresAt } });
    rootCookie = cookie(rootToken); viewerCookie = cookie(viewerToken);

    const accountList = await rpc('list_ad_accounts', { limit: 200 }, 'root');
    const listedAccounts = accountList.body.result?.structuredContent?.accounts as Array<{ id: string }> | undefined;
    check(accountList.response.ok && listedAccounts?.some(account => account.id === scopedAccountId), 'The selected fixture ad account must be usable by the workspace owner.');
    const appRoot = await fetch(new URL('/api/root/config', previewOrigin), { headers: { cookie: viewerCookie } });
    check(appRoot.status === 404, 'Workspace viewer must not access private Root configuration.');

    const date = new Date(); date.setUTCHours(0, 0, 0, 0);
    const day = date.toISOString().slice(0, 10);
    const fetchedAt = new Date();
    const secretMarker = `report-probe-secret-${randomUUID()}`;
    const baseRow = {
      adAccountId: scopedAccountId, level: 'campaign', date, spend: 123.45, impressions: 1200, clicks: 37, reach: 900,
      cpc: 3.3364, cpm: 102.875, cpp: 0.1372, ctr: 3.0833, frequency: 1.3333,
      actions: [{ action_type: 'purchase', value: '4' }] as Prisma.InputJsonValue,
      fields: { additional_metric: 817, nested: { safe_label: 'preserved' }, access_token: secretMarker, retained_bytes: 'report payload '.repeat(180) } as Prisma.InputJsonValue,
      fetchedAt,
    };
    const objectIds = [`campaign_${randomUUID()}`, `campaign_${randomUUID()}`];
    await db.adInsight.createMany({ data: [
      { id: insightIds[0]!, ...baseRow, objectId: objectIds[0]!, objectName: 'Synthetic Ads report row A' },
      { id: insightIds[1]!, ...baseRow, objectId: objectIds[1]!, objectName: 'Synthetic Ads report row B', spend: 55.5, impressions: 88, clicks: 9, reach: 80 },
    ] });
    insightsCreated = true;

    stage = 'bounded Root settings';
    await saveSetting('ads.reportPageSize', 100);
    await saveSetting('ads.reportMaxRows', 100_000);
    await saveSetting('ads.detailMaxBytes', 100_000);
    await saveSetting('ads.exportMaxBytes', 100_000);
    await saveSetting('mcp.authenticatedRoles', ['owner', 'admin', 'viewer']);

    const filter = new URLSearchParams({ period: 'custom', start: day, end: day, accountId: scopedAccountId });
    const exactFilters = new URLSearchParams(filter); exactFilters.set('level', 'campaign'); exactFilters.set('objectId', objectIds[0]!);
    const httpRowsResponse = await fetch(new URL(`/api/ads/report/rows?${exactFilters}`, previewOrigin), { headers: { cookie: viewerCookie }, redirect: 'manual' });
    const httpRows = await httpRowsResponse.json();
    check(httpRowsResponse.ok && httpRows.format === 'ms-social-pilot-ads-daily' && httpRows.rows?.length === 1, 'HTTP rows must return the exact scoped synthetic object.');
    const httpRow = httpRows.rows[0];
    check(httpRow.id === insightIds[0] && httpRow.fetchedAt === fetchedAt.toISOString() && httpRow.spend === 123.45 && httpRow.impressions === 1200
      && httpRow.clicks === 37 && httpRow.reach === 900 && httpRow.cpc === 3.3364 && httpRow.cpm === 102.875 && httpRow.cpp === 0.1372
      && httpRow.ctr === 3.0833 && httpRow.frequency === 1.3333 && httpRow.actions?.[0]?.action_type === 'purchase'
      && httpRow.fields?.additional_metric === 817 && httpRow.fields?.nested?.safe_label === 'preserved'
      && httpRow.fields?.access_token === '[REDACTED]' && httpRowsResponse.headers.get('cache-control') === 'no-store',
    'HTTP rows must preserve metrics, actions, extra fields and fetch time while redacting credentials.');
    check(!JSON.stringify(httpRows).includes(secretMarker), 'HTTP response must not contain the synthetic credential marker.');
    const anonymousRows = await fetch(new URL(`/api/ads/report/rows?${exactFilters}`, previewOrigin), { redirect: 'manual' });
    check(anonymousRows.status === 401, 'HTTP Ads report rows must reject an unauthenticated request.');
    const duplicateFilters = new URLSearchParams(exactFilters); duplicateFilters.append('accountId', scopedAccountId);
    const duplicateFilterResponse = await fetch(new URL(`/api/ads/report/rows?${duplicateFilters}`, previewOrigin), { headers: { cookie: viewerCookie }, redirect: 'manual' });
    check(duplicateFilterResponse.status === 400, 'HTTP Ads report rows must refuse repeated filter parameters.');

    const mcpRowsCall = await rpc('get_ads_report_rows', { period: 'custom', start: day, end: day, accountId: scopedAccountId, level: 'campaign', objectId: objectIds[0] });
    const mcpRows = mcpRowsCall.body.result?.structuredContent;
    const mcpRowCheck = { httpOk: mcpRowsCall.response.ok, isError: mcpRowsCall.body.result?.isError === true, hasRows: Array.isArray(mcpRows?.rows), rowCount: mcpRows?.rows?.length,
      idMatches: mcpRows?.rows?.[0]?.id === insightIds[0], fetchedAtMatches: mcpRows?.rows?.[0]?.fetchedAt === fetchedAt.toISOString(), redacted: mcpRows?.rows?.[0]?.fields?.access_token === '[REDACTED]' };
    check(mcpRowsCall.response.ok && !mcpRowsCall.body.result?.isError && mcpRows?.rows?.length === 1 && mcpRows.rows[0].id === insightIds[0]
      && mcpRows.rows[0].fetchedAt === fetchedAt.toISOString() && mcpRows.rows[0].fields?.access_token === '[REDACTED]',
    `MCP rows must share the HTTP service result and redaction. Safe check: ${JSON.stringify(mcpRowCheck)}`);
    check(!JSON.stringify(mcpRows).includes(secretMarker), 'MCP response must not contain the synthetic credential marker.');

    stage = 'complete HTTP and MCP CSV export';
    const httpCsvResponse = await fetch(new URL(`/api/ads/report/export?${exactFilters}`, previewOrigin), { headers: { cookie: viewerCookie }, redirect: 'manual' });
    const httpCsv = await httpCsvResponse.text();
    check(httpCsvResponse.ok && httpCsvResponse.headers.get('content-type')?.includes('text/csv') && httpCsvResponse.headers.get('content-disposition')?.includes('.csv')
      && httpCsvResponse.headers.get('x-msp-row-count') === '1' && Number(httpCsvResponse.headers.get('x-msp-export-bytes')) === Buffer.byteLength(httpCsv, 'utf8')
      && httpCsv.startsWith('row_id,account_id,account_name,currency,level,object_id,object_name,date,fetched_at,spend,')
      && httpCsv.includes(fetchedAt.toISOString()) && httpCsv.includes('123.45,1200,37,900,3.3364,102.875,0.1372,3.0833,1.3333')
      && httpCsv.includes('purchase') && httpCsv.includes('additional_metric') && httpCsv.includes('[REDACTED]'),
    'HTTP CSV must contain one complete UTF-8 row with metrics, actions, extra fields, fetch time and redaction.');
    check(!httpCsv.includes(secretMarker), 'HTTP CSV must not contain the synthetic credential marker.');

    const mcpCsvCall = await rpc('export_ads_report', { period: 'custom', start: day, end: day, accountId: scopedAccountId, level: 'campaign', objectId: objectIds[0] });
    const mcpCsv = mcpCsvCall.body.result?.structuredContent;
    check(mcpCsvCall.response.ok && !mcpCsvCall.body.result?.isError && mcpCsv?.rowCount === 1 && mcpCsv?.byteLength === Buffer.byteLength(mcpCsv.csv, 'utf8')
      && mcpCsv?.csv.includes(fetchedAt.toISOString()) && mcpCsv?.csv.includes('additional_metric') && mcpCsv?.csv.includes('[REDACTED]'),
    'MCP CSV must return the same complete normalized export.');
    check(!JSON.stringify(mcpCsv).includes(secretMarker), 'MCP CSV must not contain the synthetic credential marker.');

    stage = 'MCP daily report resource';
    const resource = await rpc('resources/read', { uri: 'msp://ads/daily' });
    const resourceText = resource.body.result?.contents?.[0]?.text;
    check(resource.response.ok && typeof resourceText === 'string' && resourceText.includes('ms-social-pilot-ads-daily')
      && resourceText.includes(insightIds[0]!) && resourceText.includes(fetchedAt.toISOString()) && resourceText.includes('additional_metric')
      && resourceText.includes('purchase') && resourceText.includes('[REDACTED]'), 'msp://ads/daily must expose the authorized bounded daily dataset, lossless metrics/actions and safe fetch provenance.');
    check(!resourceText.includes(secretMarker), 'MCP daily resource must not contain the synthetic credential marker.');

    stage = 'current resource scope and feature denial';
    await db.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
    grantCreated = false;
    const scopedDeniedResponse = await fetch(new URL(`/api/ads/report/rows?${exactFilters}`, previewOrigin), { headers: { cookie: viewerCookie }, redirect: 'manual' });
    const scopedDenied = await scopedDeniedResponse.json();
    check(!scopedDeniedResponse.ok && scopedDenied.rows === undefined && scopedDenied.code === 'unavailable', 'Removing the viewer channel grant must immediately deny that account report.');
    const scopedMcpDenied = await rpc('get_ads_report_rows', { period: 'custom', start: day, end: day, accountId: scopedAccountId, level: 'campaign', objectId: objectIds[0] });
    const mcpScopeCheck = { status: scopedMcpDenied.response.status, isError: scopedMcpDenied.body.result?.isError === true,
      code: scopedMcpDenied.body.result?.structuredContent?.code, rowsPresent: scopedMcpDenied.body.result?.structuredContent?.rows !== undefined };
    check(scopedMcpDenied.body.result?.isError === true && scopedMcpDenied.body.result?.structuredContent?.code === 'unavailable'
      && scopedMcpDenied.body.result?.structuredContent?.rows === undefined,
    `MCP must apply current viewer resource scope after grant removal. Safe check: ${JSON.stringify(mcpScopeCheck)}`);
    const noFeatureList = await rpc('tools/list', {}, 'denied');
    check(noFeatureList.response.ok && !noFeatureList.body.result?.tools?.some((tool: { name: string }) => tool.name === 'get_ads_report_rows' || tool.name === 'export_ads_report'),
      'MCP tools without the Ads feature grant must not advertise Ads reporting.');
    const noFeatureCall = await rpc('get_ads_report_rows', {}, 'denied');
    check(noFeatureCall.response.ok && noFeatureCall.body.result?.isError === true && noFeatureCall.body.result?.structuredContent?.code === 'forbidden',
      'MCP must deny Ads report calls without the Ads feature grant.');
    await db.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, ${scopedTargetId})`;
    grantCreated = true;

    stage = 'complete-or-refused row ceiling';
    await saveSetting('ads.reportMaxRows', 1);
    const fullRowsLimit = await fetch(new URL(`/api/ads/report/rows?${filter}`, previewOrigin), { headers: { cookie: viewerCookie }, redirect: 'manual' });
    const fullRowsLimitBody = await fullRowsLimit.json();
    check(!fullRowsLimit.ok && fullRowsLimitBody.rows === undefined && fullRowsLimitBody.code === 'invalid_request', 'HTTP report must refuse an over-row dataset without partial rows.');
    const mcpRowsLimit = await rpc('get_ads_report_rows', { period: 'custom', start: day, end: day, accountId: scopedAccountId });
    check(mcpRowsLimit.body.result?.isError === true && mcpRowsLimit.body.result?.structuredContent?.rows === undefined,
      'MCP report must refuse an over-row dataset without partial rows.');
    await saveSetting('ads.reportMaxRows', 100_000);

    stage = 'complete-or-refused response byte ceiling';
    await saveSetting('ads.detailMaxBytes', 1024);
    const detailLimit = await fetch(new URL(`/api/ads/report/rows?${exactFilters}`, previewOrigin), { headers: { cookie: viewerCookie }, redirect: 'manual' });
    const detailLimitBody = await detailLimit.json();
    check(!detailLimit.ok && detailLimitBody.rows === undefined && detailLimitBody.code === 'invalid_request', 'HTTP detail response must refuse an over-byte result without partial rows.');
    const mcpDetailLimit = await rpc('get_ads_report_rows', { period: 'custom', start: day, end: day, accountId: scopedAccountId, level: 'campaign', objectId: objectIds[0] });
    check(mcpDetailLimit.body.result?.isError === true && mcpDetailLimit.body.result?.structuredContent?.rows === undefined,
      'MCP detail response must refuse an over-byte result without partial rows.');
    await saveSetting('ads.detailMaxBytes', 100_000);

    await saveSetting('ads.exportMaxBytes', 1024);
    const exportLimit = await fetch(new URL(`/api/ads/report/export?${exactFilters}`, previewOrigin), { headers: { cookie: viewerCookie }, redirect: 'manual' });
    const exportLimitBody = await exportLimit.json();
    check(!exportLimit.ok && exportLimit.headers.get('content-type')?.includes('application/json') && exportLimitBody.csv === undefined
      && exportLimitBody.code === 'invalid_request', 'HTTP export must refuse an over-byte result without a partial file.');
    const mcpExportLimit = await rpc('export_ads_report', { period: 'custom', start: day, end: day, accountId: scopedAccountId, level: 'campaign', objectId: objectIds[0] });
    check(mcpExportLimit.body.result?.isError === true && mcpExportLimit.body.result?.structuredContent?.csv === undefined,
      'MCP export must refuse an over-byte result without a partial file.');
    const changedAudits = await db.$queryRaw<Array<{ id: string; detail: unknown }>>`SELECT id, detail FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...settingKeys]})`;
    check(changedAudits.length === configWriteCount && changedAudits.every(row => {
      if (!row.detail || typeof row.detail !== 'object') return false;
      const detail = row.detail as Record<string, unknown>;
      return settingKeys.includes(detail.key as ProbeSettingKey) && detail.change === 'value updated'
        && detail.schemaVersion === CONFIG_SCHEMA_VERSION && !Object.hasOwn(detail, 'value') && !JSON.stringify(detail).includes(secretMarker);
    }), 'Root setting changes must have matching value-free configuration audits.');
    console.log(JSON.stringify({ syntheticRowsHttpAndMcp: true, completeCsvHttpAndMcp: true, dailyResource: true, metricsActionsExtraFieldsFetchedAtAndRedaction: true,
      currentScopeAndFeatureDenial: true, anonymousAndRepeatedFilterDenial: true, completeOrRefusedRowAndByteLimits: true, rootAuditsValueFree: true, providerRequests: false }));
  } finally {
    try {
      await restoreSettings();
      if (settingsCaptured) console.log('Original Ads report bounds, output settings and MCP role setting restoration verified.');
    } finally {
      try {
        const createdAudits = (await audits()).map(row => row.id);
        if (createdAudits.length) await db.$executeRaw`DELETE FROM root_activities WHERE id = ANY(${createdAudits})`;
        if (grantCreated) await db.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
        if (insightsCreated) await db.adInsight.deleteMany({ where: { id: { in: insightIds } } });
        await db.mcpApiKey.deleteMany({ where: { id: { in: [readKeyId, deniedKeyId] }, workspaceId } });
        await db.session.deleteMany({ where: { id: { in: [rootSessionId, viewerSessionId] }, userId: { in: [rootId, viewerId] } } });
        await db.membership.deleteMany({ where: { id: { in: [`${prefix}_root_membership`, membershipId] }, userId: { in: [rootId, viewerId] }, workspaceId } });
        await db.user.deleteMany({ where: { OR: [{ id: rootId, email: rootEmail }, { id: viewerId, email: viewerEmail }] } });
        check(await db.adInsight.count({ where: { id: { in: insightIds } } }) === 0 && await db.session.count({ where: { id: { in: [rootSessionId, viewerSessionId] } } }) === 0
          && await db.mcpApiKey.count({ where: { id: { in: [readKeyId, deniedKeyId] } } }) === 0 && await db.membership.count({ where: { id: { in: [`${prefix}_root_membership`, membershipId] } } }) === 0
          && await db.user.count({ where: { id: { in: [rootId, viewerId] } } }) === 0,
        'Disposable Ads rows, identities, sessions, keys and memberships must be removed.');
        check((await audits()).length === 0, 'Disposable Root configuration audit records must be removed.');
        check(Number((await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM member_page_access WHERE "membershipId" = ${membershipId}`).at(0)?.count ?? -1) === 0,
          'Disposable Ads viewer channel grants must be removed.');
        console.log('Synthetic Ads report rows, scoped identities and audit cleanup verified; seeded preview examples retained.');
      } finally { await db.$disconnect(); }
    }
  }
}

main().catch(error => {
  console.error(error instanceof ProbeFailure ? error.message : `Ads report export probe failed at ${stage}; sensitive details withheld.`);
  process.exitCode = 1;
});
