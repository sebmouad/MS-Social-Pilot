import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
import { encryptSecret } from '../src/server/secret-crypto';
class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }
async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin, 'Set an explicit isolated preview database and origin.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(process.env.NODE_ENV !== 'production' && ['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only isolated loopback preview databases are accepted.');
  check(origin.origin === rawOrigin && origin.protocol === 'http:' && origin.hostname === 'localhost', 'Origin must be explicit localhost HTTP.');
  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_analytics_${randomUUID()}`; const userId = `${id}_viewer`; const membershipId = `${id}_member`;
  const workspaceId = 'preview_workspace'; const ownerId = 'preview_qa_user';
  const channelId = `${id}_channel`; const sourceId = `${id}_source`; const adSourceId = `${id}_ad_source`; const adId = `${id}_ad`;
  const metric = `probe_${randomUUID().replaceAll('-', '_')}`;
  const end = new Date('2026-10-02T00:00:00Z'); const day = (offset: number) => new Date(end.getTime() + offset * 86400000);
  const ownerToken = randomBytes(32).toString('base64url'); const viewerToken = randomBytes(32).toString('base64url');
  const bearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const keyId = `${id}_key`; const ownerSession = `${id}_owner`; const viewerSession = `${id}_viewer_session`;
  const get = (path: string, token = ownerToken) => fetch(new URL(path, origin), { headers: { cookie: `msp_session=${token}; sp_workspace=${workspaceId}` }, redirect: 'manual' });
  const rpc = async (name: string, args: unknown) => {
    const response = await fetch(new URL('/api/mcp?scope=workspace', origin), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return { response, data: await response.json() };
  };
  const query = new URLSearchParams({ start: day(-59).toISOString().slice(0, 10), end: '2026-10-02', compare: 'previous', filter: '1', channel: channelId, adFilter: '1', search: metric });
  let priorRoles: string[] | null = null;
  const setRoles = async (roles: string[]) => {
    const response = await fetch(new URL('/api/root/config', origin), { method: 'PUT', headers: { origin: origin.origin, 'content-type': 'application/json', cookie: `msp_session=${ownerToken}` }, body: JSON.stringify({ key: 'mcp.authenticatedRoles', value: roles }) });
    check(response.ok, 'Audited local Root role policy update must succeed.');
  };
  try {
    check(await client.user.count({ where: { id: ownerId, disabledAt: null, isInstanceOwner: true } }) === 1, 'The synthetic preview owner is required.');
    const fakeCredential = encryptSecret(`FAKE_ANALYTICS_${randomUUID()}`);
    await client.socialAccount.create({ data: { id: sourceId, workspaceId, provider: 'facebook', providerUserId: id, name: 'Temporary Analytics example', accessToken: fakeCredential, scopes: '' } });
    await client.target.create({ data: { id: channelId, workspaceId, socialAccountId: sourceId, type: 'page', providerId: id, name: 'Temporary Analytics example', enabled: true, canPublish: false, createdAt: new Date() } });
    // Deliberately no channel on this source: ads must work independently.
    await client.socialAccount.create({ data: { id: adSourceId, workspaceId, provider: 'facebook', providerUserId: `${id}_ads`, name: 'Temporary ads-only source', accessToken: fakeCredential, scopes: '' } });
    await client.adAccount.create({ data: { id: adId, workspaceId, socialAccountId: adSourceId, actId: id, name: 'Temporary Analytics ads', currency: 'USD', enabled: true } });
    const observations = Array.from({ length: 60 }, (_, index) => ({ id: `${id}_point_${index}`, targetId: channelId, metric, period: 'day', endTime: day(index - 59), value: index + 1, numeric: index + 1, fetchedAt: new Date() }));
    await client.pageInsight.createMany({ data: [...observations,
      { id: `${id}_previous`, targetId: channelId, metric, period: 'day', endTime: day(-60), value: 20, numeric: 20, fetchedAt: new Date() },
      { id: `${id}_categories`, targetId: channelId, metric: `${metric}_categories`, period: 'day', endTime: end, value: Object.fromEntries(Array.from({ length: 58 }, (_, i) => [`Category ${i + 1}`, i + 1])), numeric: null, fetchedAt: new Date() },
      ...[[-2, 100], [0, 210], [1, 999]].map(([offset, value]) => ({ id: `${id}_audience_${offset}`, targetId: channelId, metric: 'page_follows', period: 'day', endTime: day(offset!), value: value!, numeric: value!, fetchedAt: new Date() })),
    ] });
    await client.adInsight.create({ data: { id: `${id}_ad_insight`, adAccountId: adId, level: 'account', objectId: adId, date: end, spend: 12, impressions: 100, clicks: 10, reach: 80, fields: {}, fetchedAt: new Date() } });
    await client.user.create({ data: { id: userId, email: `${id}@example.test`, name: 'Temporary scoped Analytics reader', passwordHash: 'unusable-test-password' } });
    await client.membership.create({ data: { id: membershipId, userId, workspaceId, role: 'viewer' } });
    await client.$executeRaw`UPDATE memberships SET "allPages" = false WHERE id = ${membershipId}`;
    await client.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") VALUES (${membershipId}, ${channelId})`;
    for (const [sessionId, sessionUser, token] of [[ownerSession, ownerId, ownerToken], [viewerSession, userId, viewerToken]]) await client.session.create({ data: { id: sessionId!, userId: sessionUser!, tokenHash: hashLegacySessionToken(token)!, pending: null, expiresAt: new Date(Date.now() + 300000) } });
    await client.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: userId, name: 'Temporary Analytics reader', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12), readFeatures: ['analytics/overview'], writeFeatures: [], expiresAt: new Date(Date.now() + 300000) } });
    const roleSetting = await client.appSetting.findUnique({ where: { key: 'mcp.authenticatedRoles' } });
    priorRoles = (roleSetting?.value ?? CONFIG_BY_KEY.get('mcp.authenticatedRoles')!.defaultValue) as string[];
    await setRoles([...new Set([...priorRoles, 'viewer'])]);
    const response = await get(`/api/analytics?${query}`, viewerToken); const data = await response.json();
    check(response.ok && response.headers.get('cache-control') === 'no-store', 'Scoped HTTP read must succeed privately.');
    check(data.options.channels.length === 1 && data.options.channels[0].id === channelId && data.audience.total === 210, 'Current grants and historical audience cutoff must be applied.');
    const scalar = data.metrics.items.find((item: any) => item.key === `facebook:${metric}::day`);
    check(scalar?.total === 60 && data.comparisons[scalar.key]?.previous === 20 && data.comparisons[scalar.key]?.delta === 40, 'Latest-per-resource comparison must use the prior equal-duration window.');
    query.set('metric', scalar.key); query.set('pointPage', '2');
    const detail = await (await get(`/api/analytics?${query}`, viewerToken)).json();
    check(detail.detail.points.total === 60 && detail.detail.points.page === 2 && detail.detail.points.items.length === 10, 'All stored dated values must be reachable after the first detail page.');
    const category = data.metrics.items.find((item: any) => item.kind === 'breakdown');
    query.set('metric', category.key); query.set('rowPage', '2'); query.delete('pointPage');
    const categories = await (await get(`/api/analytics?${query}`, viewerToken)).json();
    check(categories.detail.rows.total === 58 && categories.detail.rows.items.length === 8, 'All stored category rows must be reachable.');
    const mcp = await rpc('get_analytics_overview', { start: query.get('start'), end: '2026-10-02', compare: 'previous', targetIds: [channelId], adAccountIds: [], search: metric, limit: 1 });
    check(!mcp.data.result?.isError && mcp.data.result?.structuredContent?.metrics[0]?.total === data.metrics.items[0]?.total && mcp.data.result?.structuredContent?.metricCount === data.metrics.total, 'Bearer MCP and HTTP must share stored metric aggregation and selection.');
    const removed = await rpc('get_page_analytics', { pageId: 'unassigned' });
    check(removed.data.error?.code === -32602, 'The unsafe duplicate Analytics tool must remain unavailable.');
    const resourceResponse = await fetch(new URL('/api/mcp?scope=workspace', origin), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'msp://analytics/overview' } }) });
    const resourceBody = await resourceResponse.json();
    const resource = JSON.parse(resourceBody.result?.contents?.[0]?.text ?? '{}');
    check(resource.selectedTargetCount === 1 && resource.selectedTargets[0]?.id === channelId, 'The Analytics MCP resource must share current channel scope.');
    const mcpDetail = await rpc('get_analytics_metric_details', { start: query.get('start'), end: '2026-10-02', targetIds: [channelId], adAccountIds: [], metricKey: scalar.key, kind: 'points', offset: 50, limit: 10 });
    check(!mcpDetail.data.result?.isError && mcpDetail.data.result?.structuredContent?.items.length === 10 && mcpDetail.data.result.structuredContent.nextOffset === null, 'MCP details must reach the final dated values.');
    const csv = await get(`/api/reports/export?${query}`);
    check(csv.ok && csv.headers.get('x-export-truncated') === 'false' && (await csv.text()).includes('comparison_status'), 'CSV must export the full matching snapshot with comparison provenance.');
    check((await get('/api/analytics?start=2026-02-31')).status === 400 && (await get('/api/analytics?start=2026-10-01&start=2026-10-02')).status === 400, 'Invalid and ambiguous dates must fail safely.');
    check((await get('/api/analytics?filter=1&channel=preview_target_north', viewerToken)).status === 403, 'Unassigned channels must be refused.');
    const adOnly = await (await get(`/api/analytics?start=2026-10-02&end=2026-10-02&filter=1&adFilter=1&adAccount=${adId}`)).json();
    check(adOnly.selected.channelIds.length === 0 && adOnly.metrics.items.some((item: any) => item.resourceKind === 'ad-account' && item.total === 12), 'Ads metrics must survive an empty channel selection.');
    const ui = await get(`/analytics?${query}`, viewerToken);
    check(ui.ok && (await ui.text()).includes('Performance'), 'A scoped read-only member must reach the Analytics page.');
    await client.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
    check((await get(`/api/analytics?${query}`, viewerToken)).status === 403, 'Current channel revocation must apply immediately.');
    const revoked = await rpc('get_analytics_overview', { targetIds: [channelId] });
    check(revoked.data.result?.structuredContent?.code === 'forbidden', 'Bearer reads must recheck revoked member grants.');
    await client.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    check((await get('/api/analytics', viewerToken)).status === 401, 'Disabled accounts must be refused.');
    await client.mcpApiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    check((await rpc('get_analytics_overview', {})).response.status === 401, 'Revoked bearer keys must be refused.');
    console.log(JSON.stringify({ scopedUiHttp: true, historicalAudience: true, periodComparison: true, fullSeriesAndCategories: true, httpMcpParity: true, mcpResourceScope: true, duplicateToolRemoved: true, csvProvenance: true, invalidFiltersDenied: true, adOnly: true, grantRevocation: true, disabledUserAndRevokedKey: true }));
  } finally {
    try {
      if (priorRoles) await setRoles(priorRoles);
      await client.$transaction(async tx => {
        await tx.mcpApiKey.deleteMany({ where: { id: keyId } });
        await tx.session.deleteMany({ where: { id: { in: [ownerSession, viewerSession] } } });
        await tx.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${membershipId}`;
        await tx.membership.deleteMany({ where: { id: membershipId } }); await tx.user.deleteMany({ where: { id: userId } });
        await tx.pageInsight.deleteMany({ where: { targetId: channelId } }); await tx.adInsight.deleteMany({ where: { adAccountId: adId } });
        await tx.adAccount.deleteMany({ where: { id: adId } }); await tx.target.deleteMany({ where: { id: channelId } }); await tx.socialAccount.deleteMany({ where: { id: { in: [sourceId, adSourceId] } } });
      });
      const counts = await Promise.all([
        client.user.count({ where: { id: userId } }), client.membership.count({ where: { id: membershipId } }),
        client.session.count({ where: { id: { in: [ownerSession, viewerSession] } } }), client.mcpApiKey.count({ where: { id: keyId } }),
        client.target.count({ where: { id: channelId } }), client.socialAccount.count({ where: { id: { in: [sourceId, adSourceId] } } }),
        client.adAccount.count({ where: { id: adId } }), client.pageInsight.count({ where: { targetId: channelId } }), client.adInsight.count({ where: { adAccountId: adId } }),
      ]);
      check(counts.every(count => count === 0), 'Temporary Analytics fixture cleanup must be verified.');
      console.log('Analytics probe cleanup verified. No remote provider operation was dispatched.');
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Unexpected isolated Analytics probe failure.'); process.exitCode = 1; });
