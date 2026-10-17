import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }

/** Synthetic preview only. Exercises live app authorization, never provider APIs. */
async function main() {
  const rawDatabase = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const rawOrigin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(rawDatabase && rawOrigin && process.env.DATABASE_URL === rawDatabase && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin required.');
  const database = new URL(rawDatabase); const origin = new URL(rawOrigin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === rawOrigin && rawOrigin === 'http://localhost:3200', 'Origin must be explicit local preview.');
  const client = new PrismaClient({ datasources: { db: { url: rawDatabase } } });
  const id = `preview_access_${randomUUID()}`; const workspaceId = 'preview_workspace'; const userId = 'preview_qa_user';
  const sessionToken = randomBytes(32).toString('base64url'); const bearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const sessionId = `${id}_session`; const keyId = `${id}_key`;
  const cookie = `msp_session=${sessionToken}; sp_workspace=${workspaceId}`;
  const keys = ['platforms.facebook.includedByDefault', 'platforms.facebook.planFeatures'];
  const previous = await client.appSetting.findMany({ where: { key: { in: keys } } });
  const baselineTargets = await client.target.findMany({ where: { workspaceId }, select: { id: true, enabled: true }, orderBy: { id: 'asc' } });
  const workspaceBefore = await client.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM workspaces WHERE id=${workspaceId}`;
  let changed = false;
  let suspensionChanged = false;
  const rpc = async (method: string, params: object, root = false) => {
    const response = await fetch(new URL(`/api/mcp?scope=${root ? 'installation' : 'workspace'}`, origin), {
      method: 'POST', headers: { origin: origin.origin, 'content-type': 'application/json', ...(root ? { cookie } : { authorization: `Bearer ${bearer}` }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }), redirect: 'manual',
    });
    const body = await response.json();
    check(response.ok && response.headers.get('cache-control') === 'no-store', 'Authenticated MCP must respond without caching.');
    return body;
  };
  const call = async (name: string, args: object = {}, root = false) => rpc('tools/call', { name, arguments: args }, root);
  const save = async (key: string, value: unknown) => {
    const body = await call('set_root_config', { key, value, confirmation: `SET ROOT CONFIG ${key}` }, true);
    check(body.result?.structuredContent?.saved && body.result.structuredContent.key === key, 'Root configuration must confirm the matching saved key.');
  };
  const get = (path: string) => fetch(new URL(path, origin), { headers: { cookie }, redirect: 'manual' });
  try {
    check(await client.user.count({ where: { id: userId, isInstanceOwner: true, disabledAt: null, memberships: { some: { workspaceId, role: 'owner' } } } }) === 1, 'Seeded synthetic installation/workspace owner required.');
    check(workspaceBefore.length === 1 && workspaceBefore[0]?.suspendedAt === null, 'Synthetic preview workspace must initially be active.');
    await client.session.create({ data: { id: sessionId, userId, tokenHash: hashLegacySessionToken(sessionToken)!, pending: null, expiresAt: new Date(Date.now() + 600_000) } });
    await client.mcpApiKey.create({ data: { id: keyId, workspaceId, createdById: userId, name: 'Disposable platform access probe', tokenHash: createHash('sha256').update(bearer).digest('hex'), tokenPrefix: bearer.slice(0, 12),
      readFeatures: ['settings/connections', 'publishing/posts', 'inbox/conversations', 'analytics/overview', 'ads/campaigns'], writeFeatures: ['settings/connections'], expiresAt: new Date(Date.now() + 600_000) } });
    const before = await call('list_pages');
    check(before.result?.structuredContent?.items?.length > 0, 'Preview must initially expose selected synthetic destinations.');
    changed = true; // A lost save response must still restore both policies.
    await save(keys[0]!, false); await save(keys[1]!, []);
    const pages = await call('list_pages'); const resources = await rpc('resources/read', { uri: 'msp://targets' });
    check(pages.result?.structuredContent?.items?.length === 0 && JSON.parse(resources.result.contents[0].text).length === 0, 'Workspace tool/resource must immediately hide unentitled destinations.');
    const inbox = await call('list_inbox'); const analytics = await call('get_analytics_overview'); const ads = await call('get_ads_performance');
    check(inbox.result?.structuredContent?.items?.length === 0, 'Inbox must hide unentitled stored activity.');
    check(analytics.result?.structuredContent?.selectedTargetCount === 0 && analytics.result.structuredContent.adAccountCount === 0 && analytics.result.structuredContent.metricCount === 0, 'Analytics must not load an unentitled provider.');
    check(ads.result?.structuredContent?.accountCount === 0 && ads.result.structuredContent.resultCount === 0, 'Ads must hide unentitled accounts and reports.');
    const analyticsHttp = await get('/api/analytics'); const analyticsData = await analyticsHttp.json();
    const inboxHttp = await get('/api/inbox'); const inboxData = await inboxHttp.json();
    check(analyticsHttp.ok && analyticsData.options.channels.length === 0 && analyticsData.options.adAccounts.length === 0 && inboxHttp.ok && inboxData.items.length === 0, 'HTTP and MCP resource visibility must agree.');
    const postsHttp = await get('/api/publishing/posts'); const postsData = await postsHttp.json();
    check(postsHttp.ok && postsData.posts.every((post: { targets: unknown[] }) => post.targets.length === 0), 'Publishing must exclude all destination-bound posts while preserving authorized local drafts.');
    const selection = await call('set_connection_selection', { kind: 'target', id: 'preview_target_unselected', enabled: true, confirmation: 'SET CONNECTION target preview_target_unselected ENABLED' });
    check(selection.result?.isError && selection.result.structuredContent.code === 'unavailable', 'A direct MCP selection must not bypass platform policy.');
    const httpSelection = await fetch(new URL('/api/connections', origin), { method: 'PATCH', headers: { cookie, origin: origin.origin, 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ kind: 'target', id: 'preview_target_unselected', enabled: true }] }) });
    check(httpSelection.status === 409 && httpSelection.headers.get('cache-control') === 'no-store' && (await httpSelection.json()).code === 'unavailable', 'HTTP selection must share the same safe typed denial.');
    const start = await fetch(new URL('/api/connections/facebook/start', origin), { method: 'POST', headers: { cookie, origin: origin.origin } });
    const callback = await get('/api/connections/facebook/callback?code=never-exchange');
    check(start.status === 404 && callback.status === 303 && callback.headers.get('location')?.endsWith('/settings/connections?notice=connect_failed'), 'OAuth must deny before starting or exchanging a provider code.');
    const root = await get('/root/platforms/facebook');
    check(root.ok && (await root.text()).includes('Facebook'), 'Private Root inspection must remain available.');
    suspensionChanged = true;
    const suspended = await call('set_root_workspace_access', { workspaceId, suspended: true, confirmation: `SUSPEND WORKSPACE ${workspaceId}` }, true);
    check(suspended.result?.structuredContent?.suspended === true, 'Private Root must confirm preview suspension.');
    const suspendedStart = await fetch(new URL('/api/connections/facebook/start', origin), { method: 'POST', headers: { cookie, origin: origin.origin } });
    const suspendedRoot = await get('/root/platforms/facebook');
    check(suspendedStart.status === 401 && suspendedRoot.ok, 'An instance owner must not use customer OAuth in a suspended workspace while private Root stays available.');
    const restoredWorkspace = await call('set_root_workspace_access', { workspaceId, suspended: false, confirmation: `RESTORE WORKSPACE ${workspaceId}` }, true);
    check(restoredWorkspace.result?.structuredContent?.suspended === false, 'Private Root must restore the synthetic workspace.');
    suspensionChanged = false;
    check(JSON.stringify(await client.target.findMany({ where: { workspaceId }, select: { id: true, enabled: true }, orderBy: { id: 'asc' } })) === JSON.stringify(baselineTargets), 'Denied operations must not change resource selections.');
    console.log(JSON.stringify({ rootPoliciesApplied: true, mcpResourcesScoped: true, httpResourcesScoped: true, inboxAnalyticsAdsScoped: true, directSelectionDenied: true, oauthDeniedBeforeProvider: true, suspendedOwnerCustomerDenied: true, rootInspectionRetained: true, selectionsRetained: true, providerRequests: 0 }));
    if (process.env.REBUILD_PREVIEW_INTERACTIVE === '1') {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try { await input.question('Preview platform access disabled for browser check. Press Enter to restore settings.\n'); } finally { input.close(); }
    }
  } finally {
    try {
      let auditedRestoreFailed = false;
      if (suspensionChanged) {
        try { await call('set_root_workspace_access', { workspaceId, suspended: false, confirmation: `RESTORE WORKSPACE ${workspaceId}` }, true); }
        catch { auditedRestoreFailed = true; }
        finally { await client.$executeRaw`UPDATE workspaces SET "suspendedAt"=NULL WHERE id=${workspaceId}`; }
      }
      if (changed) {
        // Restore through the audited service first, then original row presence/time.
        for (const key of keys) {
          try { await save(key, previous.find(row => row.key === key)?.value ?? CONFIG_BY_KEY.get(key)!.defaultValue); }
          catch { auditedRestoreFailed = true; }
        }
        // API failure cannot skip exact database snapshot restoration.
        for (const key of keys) {
          const row = previous.find(candidate => candidate.key === key);
          if (row) await client.appSetting.update({ where: { key }, data: { value: row.value === null ? Prisma.JsonNull : row.value, encrypted: row.encrypted, updatedAt: row.updatedAt } });
          else await client.appSetting.deleteMany({ where: { key } });
        }
        const sort = <T extends { key: string }>(rows: T[]) => rows.sort((a, b) => a.key.localeCompare(b.key));
        check(JSON.stringify(sort(await client.appSetting.findMany({ where: { key: { in: keys } } }))) === JSON.stringify(sort(previous)), 'Original policy rows must be restored exactly.');
        check((await client.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM workspaces WHERE id=${workspaceId}`)[0]?.suspendedAt === null, 'Preview workspace must be restored active.');
        const restored = await call('list_pages');
        check(restored.result?.structuredContent?.items?.length > 0, 'Workspace destinations must return after policy restoration.');
      }
      check(!auditedRestoreFailed, 'Exact preview settings restored, but an audited restoration request failed; inspect local test activity.');
    } finally {
      try {
        await client.mcpApiKey.deleteMany({ where: { id: keyId, workspaceId } });
        await client.session.deleteMany({ where: { id: sessionId, userId } });
        check(await client.mcpApiKey.count({ where: { id: keyId } }) === 0 && await client.session.count({ where: { id: sessionId } }) === 0, 'Temporary access credentials must be removed.');
      } finally { await client.$disconnect(); }
    }
    console.log(JSON.stringify({ policiesRestored: true, temporaryAccessRemoved: true }));
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Platform access probe failed; inspect private preview logs without displaying credentials.'); process.exitCode = 1; });
