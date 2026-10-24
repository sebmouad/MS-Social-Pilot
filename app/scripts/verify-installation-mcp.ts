import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '../generated/client';
import { hashStoredPassword, hashSessionToken } from '../src/server/auth';
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
  const targetId = `${id}_target`;
  const targetEmail = `${targetId}@example.test`;
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
    await client.user.create({ data: { id, email, name: 'Installation MCP probe', passwordHash: hashStoredPassword(password), isInstanceOwner: true, totpSecret: encryptSecret(totp), totpEnabledAt: new Date() } });
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
    check(listed.headers.get('cache-control') === 'no-store' && names.length === 10 && names.every((name: string) => /root/.test(name)), 'Installation discovery must be private and Root-only.');
    check((await rpc('workspace', 'tools/list')).status === 401, 'Explicit workspace scope must require real membership.');
    const denied = await (await rpc('installation', 'tools/call', { name: 'list_posts', arguments: {} })).json();
    check(denied.result.structuredContent.code === 'forbidden', 'Private context must refuse customer data.');
    const resources = await (await rpc('installation', 'resources/list')).json();
    check(resources.result.resources.length === 6 && resources.result.resources.every((resource: { uri: string }) => resource.uri.startsWith('msp://root/')), 'Installation resources must be Root-only.');
    const operations = await (await rpc('installation', 'tools/call', { name: 'get_root_operations', arguments: { moduleId: 'inbox' } })).json();
    check(!operations.result.isError && operations.result.structuredContent.jobs.every((job: { moduleId: string }) => job.moduleId === 'inbox'), 'Private operations must respect product ownership.');
    check(!/"error"|"summary"|"owner"|"workerId"/.test(JSON.stringify(operations.result.structuredContent)), 'Operational telemetry must exclude raw errors, summaries and worker hostnames.');
    const scope = 'product:home';
    const invalidDiagnostic = await (await rpc('installation', 'tools/call', { name: 'run_root_diagnostics', arguments: { scope, confirmation: 'wrong' } })).json();
    check(invalidDiagnostic.result.structuredContent.code === 'invalid_request', 'Diagnostic exact confirmation must be enforced.');
    const diagnostic = await (await rpc('installation', 'tools/call', { name: 'run_root_diagnostics', arguments: { scope, confirmation: `RUN DIAGNOSTICS ${scope}` } })).json();
    const receipt = diagnostic.result.structuredContent;
    check(!diagnostic.result.isError && receipt.auditRecorded && receipt.checks.some((item: { status: string }) => item.status === 'pass'), 'MCP diagnostic must return checked results and recorded audit.');
    const diagnosticHttp = await fetch(new URL(`/api/root/diagnostics?scope=${encodeURIComponent(scope)}`, origin), { headers: { cookie } });
    check(diagnosticHttp.ok && (await diagnosticHttp.json()).history.some((item: { id: string }) => item.id === receipt.id), 'HTTP must expose the same MCP diagnostic receipt.');
    const repeated = await (await rpc('installation', 'tools/call', { name: 'run_root_diagnostics', arguments: { scope, confirmation: `RUN DIAGNOSTICS ${scope}` } })).json();
    check(repeated.result.structuredContent.code === 'conflict', 'Cross-interface diagnostic cooldown must be enforced.');
    const diagnosticResource = await (await rpc('installation', 'resources/read', { uri: 'msp://root/diagnostics' })).json();
    check(diagnosticResource.result.contents.length === 1, 'Private diagnostic resource must read without membership.');
    const config = await (await rpc('installation', 'tools/call', { name: 'get_root_config', arguments: {} })).json();
    const value = config.result.structuredContent.values.find((item: { key: string }) => item.key === configKey).value;
    const secretKeys = new Set(config.result.structuredContent.definitions.filter((item: { kind: string }) => item.kind === 'secret').map((item: { key: string }) => item.key));
    check(config.result.structuredContent.values.filter((item: { key: string }) => secretKeys.has(item.key)).every((item: { value: unknown }) => item.value === ''), 'Root secret reads must stay masked.');
    settingTouched = true;
    const changed = await (await rpc('installation', 'tools/call', { name: 'set_root_config', arguments: { key: configKey, value, confirmation: `SET ROOT CONFIG ${configKey}` } })).json();
    check(changed.result.structuredContent.saved === true, 'Membership-free owner configuration write must succeed.');
    const audit = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${id} AND action = 'config.changed' AND detail->>'key' = ${configKey}`;
    check(Number(audit[0]?.count) === 1, 'Configuration change must have its transactional domain audit.');
    // Real HTTP/MCP account controls affect only this disposable synthetic target.
    await client.user.create({ data: { id: targetId, email: targetEmail, name: 'Disposable user control probe', passwordHash: hashStoredPassword(randomBytes(24).toString('base64url')), totpSecret: encryptSecret(newTotpSecret()), totpEnabledAt: new Date() } });
    const targetToken = randomBytes(32).toString('base64url');
    await client.session.create({ data: { id: `${targetId}_active`, userId: targetId, tokenHash: hashSessionToken(targetToken)!, expiresAt: new Date(Date.now() + 300000), pending: null } });
    await client.session.create({ data: { id: `${targetId}_pending`, userId: targetId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 300000), pending: 'verify' } });
    await client.passkey.create({ data: { id: `${targetId}_passkey`, userId: targetId, credentialId: randomUUID(), publicKey: Buffer.from('synthetic-unused-public-key'), counter: 0, transports: [], name: 'Synthetic unused credential', createdAt: new Date() } });
    await client.recoveryCode.create({ data: { id: `${targetId}_recovery`, userId: targetId, codeHash: randomUUID(), createdAt: new Date() } });
    const userRead = await (await rpc('installation', 'tools/call', { name: 'list_root_users', arguments: { q: targetEmail } })).json();
    check(userRead.result.structuredContent.users.length === 1 && userRead.result.structuredContent.users[0]._count.sessions === 1, 'User directory must count only active verified sessions.');
    check(!/passwordHash|totpSecret|tokenHash|publicKey|codeHash/.test(JSON.stringify(userRead)), 'User directory must not expose credential or factor material.');
    const nonRootRead = await fetch(new URL('/api/root/users', origin), { headers: { cookie: `msp_session=${targetToken}` } });
    check(nonRootRead.status === 404, 'Non-Root sessions must not read the private user directory.');
    const manage = async (userId: string, action: string, confirmation: string) => (await (await rpc('installation', 'tools/call', { name: 'manage_root_user', arguments: { userId, action, confirmation } })).json()).result;
    check((await manage(targetId, 'disable', 'wrong')).structuredContent.code === 'invalid_request', 'Wrong account confirmation must be refused.');
    check((await manage(id, 'disable', `DISABLE ${email}`)).structuredContent.code === 'conflict', 'Root self actions must be refused.');
    check((await manage(targetId, 'disable', `DISABLE ${targetEmail}`)).structuredContent.sessionsRevoked === 2, 'Disabling must revoke all target sessions.');
    check((await client.user.findUnique({ where: { id: targetId } }))?.disabledAt && await client.session.count({ where: { userId: targetId } }) === 0, 'Disabled account and session removal must persist.');
    check((await manage(targetId, 'enable', `ENABLE ${targetEmail}`)).structuredContent.changed === true, 'Re-enable must persist.');
    await client.session.create({ data: { id: `${targetId}_new`, userId: targetId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 300000) } });
    check((await manage(targetId, 'sign-out', `SIGN OUT ${targetEmail}`)).structuredContent.sessionsRevoked === 1, 'Sign out must revoke target sessions.');
    check(!(await manage(targetId, 'reset-two-step', `RESET TWO-STEP ${targetEmail}`)).isError, 'Non-Root factor reset must complete.');
    const reset = await client.user.findUnique({ where: { id: targetId } });
    check(reset?.totpSecret === null && reset.totpEnabledAt === null && await client.passkey.count({ where: { userId: targetId } }) === 0 && await client.recoveryCode.count({ where: { userId: targetId } }) === 0, 'Factor reset must clear stored target factors and recovery codes.');
    const userAudits = await client.$queryRaw<Array<{ action: string }>>`SELECT action FROM root_activities WHERE "actorId" = ${id} AND action LIKE 'root.user_%'`;
    check(userAudits.length === 4 && ['root.user_disabled','root.user_enabled','root.user_signed_out','root.user_two_step_reset'].every(action => userAudits.some(row => row.action === action)), 'All four user controls must have their transactional domain audit.');
    const rawKey = `mcp_${randomBytes(32).toString('base64url')}`;
    await client.workspace.create({ data: { id: workspaceId, name: 'Installation scope probe', slug: workspaceId, timezone: 'UTC', memberships: { create: { id: membershipId, userId: fixture.id, role: 'owner' } } } });
    await client.mcpApiKey.create({ data: { id: keyId, name: 'Installation boundary probe', workspaceId, createdById: fixture.id, tokenHash: createHash('sha256').update(rawKey).digest('hex'), tokenPrefix: rawKey.slice(0, 12), readFeatures: ['publishing/posts'], writeFeatures: [], expiresAt: new Date(Date.now() + 300000) } });
    const keyTools = await (await rpc(null, 'tools/list', {}, `Bearer ${rawKey}`)).json();
    check(keyTools.result.tools.length === 1 && keyTools.result.tools[0].name === 'list_posts', 'Workspace bearer must keep its own scope despite the owner cookie.');
    check((await rpc('installation', 'tools/list', {}, `Bearer ${rawKey}`)).status === 401, 'Workspace bearer must not enter installation context.');
    const keyUserControl = await (await rpc(null, 'tools/call', { name: 'manage_root_user', arguments: { userId: targetId, action: 'disable', confirmation: `DISABLE ${targetEmail}` } }, `Bearer ${rawKey}`)).json();
    check(keyUserControl.result.structuredContent.code === 'forbidden', 'Owner-created workspace keys must not manage users.');
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
    console.log(JSON.stringify({ passwordAndTotp: true, pendingDenied: true, memberships: 0, rootTools: names.length, privateResources: 6, diagnosticsHttpMcpAndAudit: true, diagnosticsCooldown: true, operationsScopedAndSafe: true, workspaceCallsDenied: true, configDomainAudit: true, bearerScopeEnforced: true, ownerCreatedKeySuspensionDenied: true, restoredKeyRead: true, ownerUiRecovery: true, demotionAndDisableDenied: true, userDirectorySafe: true, userControlsAndAudits: true, nonRootAndKeyUserDenial: true }));
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
        await tx.session.deleteMany({ where: { userId: targetId } });
        await tx.passkey.deleteMany({ where: { userId: targetId } });
        await tx.recoveryCode.deleteMany({ where: { userId: targetId } });
        await tx.user.deleteMany({ where: { id: { in: [id, targetId] } } });
      });
      const audit = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${id}`;
      check(await client.user.count({ where: { id: { in: [id, targetId] } } }) === 0 && await client.session.count({ where: { userId: { in: [id, targetId] } } }) === 0 && await client.passkey.count({ where: { userId: targetId } }) === 0 && await client.recoveryCode.count({ where: { userId: targetId } }) === 0 && await client.mcpApiKey.count({ where: { id: keyId } }) === 0 && await client.workspace.count({ where: { id: workspaceId } }) === 0 && await client.membership.count({ where: { id: membershipId } }) === 0 && Number(audit[0]?.count) === 0, 'Temporary user, sessions, key, workspace, membership and audits must be removed.');
      if (settingTouched) {
        const restored = await client.appSetting.findUnique({ where: { key: configKey } });
        check(savedSetting ? restored?.encrypted === savedSetting.encrypted && restored.updatedAt.getTime() === savedSetting.updatedAt.getTime() && JSON.stringify(restored.value) === JSON.stringify(savedSetting.value) : restored === null, 'Original configuration record must be restored.');
      }
      console.log('Installation MCP probe cleanup verified.');
    } finally { await client.$disconnect(); }
  }
}
main().catch(error => { console.error(error instanceof ProbeFailure ? error.message : 'Unexpected local installation MCP probe failure.'); process.exitCode = 1; });
