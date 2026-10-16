import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '../generated/client';
import { hashLegacyPassword } from '../src/server/auth';
import { newTotpSecret, totpCode, timeStep } from '../src/server/totp';
import { encryptSecret } from '../src/server/secret-crypto';

// Identifiable HTTP/auth probe only. Requires the isolated seeded preview, never
// accepts remote databases/origins, never prints credentials or session cookies.
class ProbeFailure extends Error {}
function check(value: unknown, label: string): asserts value { if (!value) throw new ProbeFailure(label); }

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
  const originValue = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && originValue, 'Set preview database and origin explicitly.');
  const database = new URL(databaseUrl);
  const origin = new URL(originValue);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Database must be isolated loopback _preview.');
  check(origin.origin === originValue && origin.protocol === 'http:' && origin.hostname === 'localhost', 'Origin must be an explicit localhost HTTP origin.');
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const id = `preview_installation_${randomUUID()}`;
  const keyId = `${id}_key`;
  const workspaceId = `${id}_workspace`;
  const membershipId = `${id}_membership`;
  const email = `${id}@example.test`;
  const password = randomBytes(24).toString('base64url');
  const totp = newTotpSecret();
  const configKey = 'root.activityPageSize';
  let savedSetting: Awaited<ReturnType<typeof client.appSetting.findUnique>> = null;
  let settingTouched = false;
  let cookie = '';
  const responseCookie = (response: Response) => {
    const value = response.headers.getSetCookie().find(item => item.startsWith('msp_session='));
    if (value) cookie = value.split(';')[0];
  };
  const post = async (path: string, body: unknown, authorization?: string) => {
    const response = await fetch(new URL(path, origin), { method: 'POST', headers: { origin: origin.origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body), redirect: 'manual' });
    responseCookie(response);
    return response;
  };
  const rpc = (scope: string | null, method: string, params = {}, authorization?: string) => post(`/api/mcp${scope ? `?scope=${scope}` : ''}`, { jsonrpc: '2.0', id: 1, method, params }, authorization);
  try {
    const fixture = await client.user.findUnique({ where: { email: 'preview-qa@example.test' }, select: { id: true, memberships: { select: { workspaceId: true } } } });
    check(fixture?.memberships.length, 'The seeded preview fixture is required.');
    savedSetting = await client.appSetting.findUnique({ where: { key: configKey } });
    await client.user.create({ data: { id, email, name: 'Installation MCP probe', passwordHash: hashLegacyPassword(password), isInstanceOwner: true, totpSecret: encryptSecret(totp), totpEnabledAt: new Date() } });
    check(await client.membership.count({ where: { userId: id } }) === 0, 'Probe user must have no memberships.');
    const signedIn = await post('/api/auth/sign-in', { email, password });
    check(signedIn.ok && (await signedIn.json()).next === 'verify' && cookie, 'Password login must require second-step verification.');
    check((await rpc('installation', 'tools/list')).status === 401, 'Pending sessions must not use installation MCP.');
    const verified = await post('/api/auth/two-step/verify', { code: totpCode(totp, timeStep()) });
    check(verified.ok && (await verified.json()).ok === true, 'TOTP verification must complete the session.');
    const initialized = await (await rpc(null, 'initialize')).json();
    check(initialized.result.instructions.includes('Private installation access'), 'Membership-free owner must receive automatic private context.');
    const listed = await rpc('installation', 'tools/list');
    const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
    check(listed.headers.get('cache-control') === 'no-store' && names.length === 5 && names.every((name: string) => /root/.test(name)), 'Installation discovery must be private and Root-only.');
    check((await rpc('workspace', 'tools/list')).status === 401, 'Explicit workspace scope must require real membership.');
    const denied = await (await rpc('installation', 'tools/call', { name: 'list_posts', arguments: {} })).json();
    check(denied.result.structuredContent.code === 'forbidden', 'Private context must refuse customer data.');
    const resources = await (await rpc('installation', 'resources/list')).json();
    check(resources.result.resources.length === 3 && resources.result.resources.every((resource: { uri: string }) => resource.uri.startsWith('msp://root/')), 'Installation resources must be Root-only.');
    const config = await (await rpc('installation', 'tools/call', { name: 'get_root_config', arguments: {} })).json();
    const value = config.result.structuredContent.values.find((item: { key: string }) => item.key === configKey).value;
    const secretKeys = new Set(config.result.structuredContent.definitions.filter((item: { kind: string }) => item.kind === 'secret').map((item: { key: string }) => item.key));
    check(config.result.structuredContent.values.filter((item: { key: string }) => secretKeys.has(item.key)).every((item: { value: unknown }) => item.value === ''), 'Root secret reads must stay masked.');
    settingTouched = true;
    const changed = await (await rpc('installation', 'tools/call', { name: 'set_root_config', arguments: { key: configKey, value, confirmation: `SET ROOT CONFIG ${configKey}` } })).json();
    check(changed.result.structuredContent.saved === true, 'Membership-free owner configuration write must succeed.');
    const audit = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${id} AND action = 'config.changed' AND detail->>'key' = ${configKey}`;
    check(Number(audit[0]?.count) === 1, 'Configuration change must have its transactional domain audit.');
    const rawKey = `mcp_${randomBytes(32).toString('base64url')}`;
    await client.workspace.create({ data: { id: workspaceId, name: 'Installation scope probe', slug: workspaceId, timezone: 'UTC', memberships: { create: { id: membershipId, userId: fixture.id, role: 'owner' } } } });
    await client.mcpApiKey.create({ data: { id: keyId, name: 'Installation boundary probe', workspaceId, createdById: fixture.id, tokenHash: createHash('sha256').update(rawKey).digest('hex'), tokenPrefix: rawKey.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: [], expiresAt: new Date(Date.now() + 300000) } });
    const keyTools = await (await rpc(null, 'tools/list', {}, `Bearer ${rawKey}`)).json();
    check(keyTools.result.tools.length === 1 && keyTools.result.tools[0].name === 'list_posts', 'Workspace bearer must keep its own scope despite the owner cookie.');
    check((await rpc('installation', 'tools/list', {}, `Bearer ${rawKey}`)).status === 401, 'Workspace bearer must not enter installation context.');
    const suspend = await (await rpc('installation', 'tools/call', { name: 'set_root_workspace_access', arguments: { workspaceId, suspended: true, confirmation: `SUSPEND WORKSPACE ${workspaceId}` } })).json();
    check(suspend.result.structuredContent.suspended === true, 'Membership-free owner must suspend the disposable workspace.');
    const suspendedRead = await (await rpc(null, 'tools/call', { name: 'list_posts', arguments: {} }, `Bearer ${rawKey}`)).json();
    check(suspendedRead.result.structuredContent.code === 'forbidden', 'Owner-created workspace keys must not inherit suspension inspection.');
    const restore = await (await rpc('installation', 'tools/call', { name: 'set_root_workspace_access', arguments: { workspaceId, suspended: false, confirmation: `RESTORE WORKSPACE ${workspaceId}` } })).json();
    check(restore.result.structuredContent.suspended === false, 'Membership-free owner must restore the disposable workspace.');
    const resumedRead = await (await rpc(null, 'tools/call', { name: 'list_posts', arguments: {} }, `Bearer ${rawKey}`)).json();
    check(!resumedRead.result.isError && Array.isArray(resumedRead.result.structuredContent.items), 'Permitted workspace reads must resume after restoration.');
    const rootPage = await fetch(new URL('/no-workspace', origin), { headers: { cookie }, redirect: 'manual' });
    const html = await rootPage.text();
    const headerRedirect = rootPage.status >= 300 && rootPage.status < 400 && new URL(rootPage.headers.get('location')!, origin).pathname === '/root';
    const streamingRedirect = rootPage.status === 200 && html.includes('id="__next-page-redirect"') && html.includes('content="1;url=/root"');
    check(headerRedirect || streamingRedirect, 'Membership-free owner must recover into Root UI.');
    const controlCenter = await fetch(new URL('/root', origin), { headers: { cookie } });
    check(controlCenter.ok && (await controlCenter.text()).includes('Installation MCP access'), 'Membership-free owner must load the private control center.');
    await client.user.update({ where: { id }, data: { isInstanceOwner: false } });
    check((await rpc('installation', 'tools/list')).status === 401, 'Demoted owner must lose private context immediately.');
    await client.user.update({ where: { id }, data: { isInstanceOwner: true, disabledAt: new Date() } });
    check((await rpc('installation', 'tools/list')).status === 401, 'Disabled owner must lose private context immediately.');
    console.log(JSON.stringify({ passwordAndTotp: true, pendingDenied: true, memberships: 0, rootTools: names.length, privateResources: 3, workspaceCallsDenied: true, configDomainAudit: true, bearerScopeEnforced: true, ownerCreatedKeySuspensionDenied: true, restoredKeyRead: true, ownerUiRecovery: true, demotionAndDisableDenied: true }));
  } finally {
    try {
      await client.$transaction(async tx => {
        await tx.mcpApiKey.deleteMany({ where: { id: keyId } });
        await tx.workspace.deleteMany({ where: { id: workspaceId } });
        if (settingTouched) {
          if (savedSetting) {
            const stored = { ...savedSetting, value: savedSetting.value === null ? Prisma.JsonNull : savedSetting.value };
            await tx.appSetting.upsert({ where: { key: configKey }, create: stored, update: stored });
          }
          else await tx.appSetting.deleteMany({ where: { key: configKey } });
        }
        await tx.$executeRaw`DELETE FROM root_activities WHERE "actorId" = ${id}`;
        await tx.user.deleteMany({ where: { id } });
      });
      const audit = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${id}`;
      check(await client.user.count({ where: { id } }) === 0 && await client.session.count({ where: { userId: id } }) === 0 && await client.mcpApiKey.count({ where: { id: keyId } }) === 0 && await client.workspace.count({ where: { id: workspaceId } }) === 0 && await client.membership.count({ where: { id: membershipId } }) === 0 && Number(audit[0]?.count) === 0, 'Temporary user, sessions, key, workspace, membership and audits must be removed.');
      if (settingTouched) {
        const restored = await client.appSetting.findUnique({ where: { key: configKey } });
        check(savedSetting ? restored?.encrypted === savedSetting.encrypted && restored.updatedAt.getTime() === savedSetting.updatedAt.getTime() && JSON.stringify(restored.value) === JSON.stringify(savedSetting.value) : restored === null, 'Original configuration record must be restored.');
      }
      console.log('Installation MCP probe cleanup verified.');
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Unexpected local installation MCP probe failure.'); process.exitCode = 1; });
