/** Guarded localhost-only invitation, SMTP-capture, PostgreSQL and MCP verification. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { Prisma, PrismaClient } from '../generated/client';
import { hashSessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new ProbeFailure(message); }
let stage = 'preview guards';
const settingKeys = [
  'mail.enabled', 'mail.publicOrigin', 'mail.smtpHost', 'mail.smtpPort', 'mail.smtpSecure', 'mail.smtpRequireTls',
  'mail.smtpUsername', 'mail.smtpPassword', 'mail.fromAddress', 'settings.invitationsEnabled',
  'mcp.enabled', 'mcp.authenticatedRoles', 'entitlements.features.settings/team',
] as const;
type CapturedMessage = { recipient: string; body: string };

function startSmtpCapture() {
  const messages: CapturedMessage[] = [];
  const clients = new Set<Socket>();
  const server = createServer(socket => {
    clients.add(socket); socket.on('close', () => clients.delete(socket));
    socket.setEncoding('utf8'); socket.write('220 localhost ESMTP ready\r\n');
    let input = ''; let data = false; let recipient = '';
    socket.on('data', chunk => {
      input += chunk;
      while (true) {
        if (data) {
          const end = input.indexOf('\r\n.\r\n');
          if (end < 0) break;
          messages.push({ recipient, body: input.slice(0, end) }); input = input.slice(end + 5); data = false;
          socket.write('250 2.0.0 message captured\r\n'); continue;
        }
        const end = input.indexOf('\r\n'); if (end < 0) break;
        const line = input.slice(0, end); input = input.slice(end + 2); const upper = line.toUpperCase();
        if (upper.startsWith('EHLO ')) socket.write('250-localhost\r\n250 PIPELINING\r\n');
        else if (upper.startsWith('HELO ')) socket.write('250 localhost\r\n');
        else if (upper.startsWith('MAIL FROM:')) socket.write('250 2.1.0 sender accepted\r\n');
        else if (upper.startsWith('RCPT TO:')) {
          const match = line.match(/<([^<>]+)>/); recipient = match?.[1]?.toLowerCase() ?? '';
          socket.write(recipient.endsWith('@example.test') ? '250 2.1.5 recipient accepted\r\n' : '550 5.1.1 recipient denied\r\n');
        } else if (upper === 'DATA') { data = true; socket.write('354 end with <CRLF>.<CRLF>\r\n'); }
        else if (upper === 'RSET') { recipient = ''; socket.write('250 reset\r\n'); }
        else if (upper === 'NOOP') socket.write('250 ok\r\n');
        else if (upper === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
  });
  return { server, clients, messages };
}

function decodeQuotedPrintable(value: string) {
  return value.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
function capturedToken(messages: CapturedMessage[], recipient: string, occurrence = 0) {
  const matching = messages.filter(message => message.recipient === recipient.toLowerCase());
  const message = matching[occurrence];
  if (!message) throw new ProbeFailure('Expected a local invitation message was not captured.');
  const decoded = decodeQuotedPrintable(message.body);
  const match = decoded.match(/\/join#([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/);
  if (match) return match[1]!;
  for (const block of message.body.split(/\r?\n\r?\n/).slice(1)) {
    try {
      const text = Buffer.from(block.replace(/\s/g, ''), 'base64').toString('utf8');
      const token = text.match(/\/join#([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/);
      if (token) return token[1]!;
    } catch { /* Continue without displaying message content. */ }
  }
  throw new ProbeFailure('Captured local invitation email did not contain a canonical fragment token.');
}

async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required.');
  const database = new URL(databaseUrl), previewOrigin = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only an isolated loopback _preview database is allowed.');
  check(previewOrigin.origin === origin && previewOrigin.protocol === 'http:' && previewOrigin.hostname === 'localhost' && previewOrigin.port === '3200', 'Only the explicit localhost:3200 HTTP preview origin is allowed.');

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_invite62_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = `${prefix}_workspace`, rootId = `${prefix}_root`, recipientId = `${prefix}_recipient`;
  const ownerSession = randomBytes(32).toString('base64url'), recipientSession = randomBytes(32).toString('base64url'), pendingSession = randomBytes(32).toString('base64url');
  const readBearer = `mcp_${randomBytes(32).toString('base64url')}`, writeBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const keyIds = [`${prefix}_read_key`, `${prefix}_write_key`]; const expiresAt = new Date(Date.now() + 30 * 60_000);
  const rootEmail = `${rootId}@example.test`, recipientEmail = 'only@example.test';
  const newEmail = 'new-registration@example.test', revokedEmail = 'revoked@example.test', expiredEmail = 'expired@example.test';
  const rootCookie = `msp_session=${ownerSession}; sp_workspace=${workspaceId}`;
  const recipientCookie = `msp_session=${recipientSession}; sp_workspace=${workspaceId}`;
  const pendingCookie = `msp_session=${pendingSession}; sp_workspace=${workspaceId}`;
  const originalSettings = new Map<string, { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date } | null>();
  const priorConfigAuditIds = new Set<string>(); const changedConfigAuditIds = new Set<string>();
  const smtp = startSmtpCapture(); let smtpPort = 0, fixtureStarted = false, settingsCaptured = false, newUserId: string | null = null;
  let responseCookie = '';
  const appSettingKeys = [...settingKeys];
  const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');

  async function http(path: string, method = 'GET', body?: unknown, cookie?: string) {
    return fetch(new URL(path, previewOrigin), { method, redirect: 'manual', headers: { origin: previewOrigin.origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function json(response: Response): Promise<any> { try { return await response.json(); } catch { return null; } }
  async function saveRootSetting(key: string, value?: unknown, clear = false) {
    const response = await http('/api/root/config', 'PUT', clear ? { key, clear: true } : { key, value }, rootCookie);
    check(response.ok, 'Root preview setting change failed validation or authorization.');
    const body = await json(response); check(body?.ok === true, 'Root preview setting change was not confirmed.');
  }
  async function configureRootAndMail() {
    await saveRootSetting('mail.enabled', true);
    await saveRootSetting('mail.publicOrigin', previewOrigin.origin);
    await saveRootSetting('mail.smtpHost', '127.0.0.1');
    await saveRootSetting('mail.smtpPort', smtpPort);
    await saveRootSetting('mail.smtpSecure', false);
    await saveRootSetting('mail.smtpRequireTls', false);
    await saveRootSetting('mail.smtpUsername', '');
    await saveRootSetting('mail.smtpPassword', undefined, true);
    await saveRootSetting('mail.fromAddress', 'noreply@example.test');
    await saveRootSetting('settings.invitationsEnabled', true);
    await saveRootSetting('mcp.enabled', true);
    await saveRootSetting('mcp.authenticatedRoles', ['owner', 'admin']);
    await saveRootSetting('entitlements.features.settings/team', true);
  }
  function cookieWithInvitation(sessionCookie: string, setCookie: string) {
    const match = setCookie.match(/(?:^|,\s*)msp_join=([^;]+)/);
    check(match, 'Invitation preview did not establish the encrypted continuation cookie.');
    const parts = sessionCookie.split(';').map(part => part.trim()).filter(Boolean);
    return [...parts, `msp_join=${match[1]}`].join('; ');
  }
  async function previewInvitation(token: string, sessionCookie = '') {
    const response = await http('/api/auth/invitations/preview', 'POST', { token }, sessionCookie || undefined);
    const body = await json(response);
    check(response.headers.get('cache-control') === 'no-store' && response.headers.get('referrer-policy') === 'no-referrer', 'Invitation preview response must be private and suppress referrers.');
    if (response.ok) {
      const setCookie = response.headers.get('set-cookie') ?? '';
      responseCookie = cookieWithInvitation(sessionCookie, setCookie);
    }
    return { response, body };
  }
  async function createInvitation(email: string, role = 'editor') {
    const response = await http('/api/settings/team/invitations', 'POST', { email, role, confirmation: `INVITE MEMBER ${email}` }, rootCookie);
    const body = await json(response);
    check(response.ok && body?.delivery === 'sent' && typeof body.id === 'string', 'Invitation creation did not return a confirmed local delivery.');
    return body as { id: string; delivery: string; expiresAt: string };
  }
  async function mcp(name: string, args: unknown = {}, bearer = writeBearer) {
    const authorized = await fetch(new URL('/api/mcp?scope=workspace', previewOrigin), { method: 'POST', redirect: 'manual', headers: { origin: previewOrigin.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    return { response: authorized, body: await json(authorized) };
  }

  try {
    stage = 'capture initial settings and start local SMTP only';
    const originals = await db.appSetting.findMany({ where: { key: { in: appSettingKeys } }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
    for (const key of settingKeys) originalSettings.set(key, originals.find(row => row.key === key) ?? null);
    settingsCaptured = true;
    const rootAudits = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...settingKeys]}::text[])`;
    for (const row of rootAudits) priorConfigAuditIds.add(row.id);
    await new Promise<void>((resolve, reject) => { smtp.server.once('error', reject); smtp.server.listen(0, '127.0.0.1', resolve); });
    const address = smtp.server.address(); check(address && typeof address !== 'string', 'Local SMTP capture did not bind a TCP port.'); smtpPort = (address as AddressInfo).port;

    stage = 'create isolated Root and workspace identities';
    fixtureStarted = true;
    await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: 'Disposable invitation verification', timezone: 'UTC' } });
    await db.user.create({ data: { id: rootId, email: rootEmail, name: 'Disposable Root actor', passwordHash: 'unusable-preview-password', isInstanceOwner: true, totpEnabledAt: new Date() } });
    await db.user.create({ data: { id: recipientId, email: recipientEmail, name: 'Disposable invited account', passwordHash: 'unusable-preview-password', totpEnabledAt: new Date() } });
    await db.$executeRaw`UPDATE users SET "emailVerifiedAt" = NOW() WHERE id = ANY(${[rootId, recipientId]}::text[])`;
    await db.membership.create({ data: { id: `${prefix}_membership`, userId: rootId, workspaceId, role: 'owner' } });
    await db.session.create({ data: { id: `${prefix}_root_session`, userId: rootId, tokenHash: hashSessionToken(ownerSession)!, expiresAt, pending: null } });
    await db.session.create({ data: { id: `${prefix}_recipient_session`, userId: recipientId, tokenHash: hashSessionToken(recipientSession)!, expiresAt, pending: null } });
    await db.session.create({ data: { id: `${prefix}_pending_session`, userId: recipientId, tokenHash: hashSessionToken(pendingSession)!, expiresAt, pending: 'verify' } });
    for (const [index, bearer] of [readBearer, writeBearer].entries()) await db.mcpApiKey.create({ data: { id: keyIds[index]!, workspaceId, createdById: rootId, name: 'Disposable invitation verification key', tokenHash: tokenHash(bearer), tokenPrefix: bearer.slice(0, 12), expiresAt, readFeatures: ['settings/team'], writeFeatures: index === 1 ? ['settings/team'] : [] } });
    await configureRootAndMail();

    stage = 'create and reissue a local email invitation';
    const first = await createInvitation(recipientEmail); const firstToken = capturedToken(smtp.messages, recipientEmail);
    check(!JSON.stringify(first).includes(firstToken), 'Invitation API must never return the raw token.');
    const second = await createInvitation(recipientEmail); const currentToken = capturedToken(smtp.messages, recipientEmail, 1);
    check(second.id === first.id && firstToken !== currentToken, 'Reissue must replace the single invitation row with a fresh token.');
    const stale = await previewInvitation(firstToken);
    check(stale.response.status === 409 && !JSON.stringify(stale.body).includes(firstToken), 'Reissued token must be unusable and never appear in API feedback.');

    stage = 'reject wrong account, existing-account registration and pending MFA session';
    const existingPreview = await previewInvitation(currentToken, rootCookie);
    check(existingPreview.response.ok && existingPreview.body.existingAccount === true && existingPreview.body.workspaceId === workspaceId, 'Preview must identify the existing recipient and correct workspace.');
    let joinedCookie = responseCookie;
    const overwrite = await http('/api/auth/invitations/register', 'POST', { name: 'Overwrite attempt', password: 'A safe synthetic password 123!', confirmation: `CREATE ACCOUNT AND JOIN ${second.id}` }, joinedCookie);
    check(overwrite.status === 409 && await db.user.count({ where: { id: recipientId } }) === 1, 'Existing-account registration must conflict without overwriting that user.');
    const wrongAccount = await http('/api/auth/invitations/accept', 'POST', { confirmation: `ACCEPT INVITATION ${second.id}` }, responseCookie.replace(`msp_session=${ownerSession}`, `msp_session=${ownerSession}`));
    check(wrongAccount.status === 403 && await db.membership.count({ where: { userId: recipientId, workspaceId } }) === 0, 'A fully verified account with a different email must not accept.');
    joinedCookie = cookieWithInvitation(pendingCookie, responseCookie.slice(responseCookie.indexOf('msp_join=')));
    const pending = await http('/api/auth/invitations/accept', 'POST', { confirmation: `ACCEPT INVITATION ${second.id}` }, joinedCookie);
    check(pending.status === 401, 'A session pending two-step verification must not accept an invitation.');
    const correctPreview = await previewInvitation(currentToken, recipientCookie); joinedCookie = responseCookie;
    const accepted = await http('/api/auth/invitations/accept', 'POST', { confirmation: `ACCEPT INVITATION ${second.id}` }, joinedCookie);
    const acceptedBody = await json(accepted);
    check(accepted.ok && acceptedBody?.joined === true && acceptedBody.workspaceId === workspaceId, 'The active verified invited account must join the current workspace.');
    check(correctPreview.body.signedInEmail === recipientEmail, 'Preview must bind the continuation to the signed-in matching account.');
    check(await db.membership.count({ where: { userId: recipientId, workspaceId } }) === 1, 'Existing-account acceptance must create exactly one membership.');

    stage = 'register a new invited account without creating a session';
    const registration = await createInvitation(newEmail); const registrationToken = capturedToken(smtp.messages, newEmail);
    const registerPreview = await previewInvitation(registrationToken);
    check(registerPreview.response.ok && registerPreview.body.existingAccount === false, 'New recipient preview must offer account registration.');
    const registered = await http('/api/auth/invitations/register', 'POST', { name: 'Disposable New Invitee', password: 'A safe synthetic password 123!', confirmation: `CREATE ACCOUNT AND JOIN ${registration.id}` }, responseCookie);
    const registeredBody = await json(registered); const newUser = await db.user.findUnique({ where: { email: newEmail }, select: { id: true, isInstanceOwner: true, totpEnabledAt: true } });
    newUserId = newUser?.id ?? null;
    const emailVerification = newUser ? await db.$queryRaw<Array<{ emailVerifiedAt: Date | null }>>`SELECT "emailVerifiedAt" FROM users WHERE id = ${newUser.id}` : [];
    check(registered.ok && registeredBody?.created === true && registeredBody.workspaceId === workspaceId, 'New invitation registration must create the account and join the invited workspace.');
    check(newUser && emailVerification[0]?.emailVerifiedAt !== null && !newUser.isInstanceOwner && !newUser.totpEnabledAt, 'Registered user must be email-verified by the invitation, non-Root and have no MFA bypass state.');
    check(await db.membership.count({ where: { userId: newUser.id, workspaceId } }) === 1 && await db.session.count({ where: { userId: newUser.id } }) === 0, 'Registration must create membership but no authenticated session.');
    const scope = await db.$queryRaw<Array<{ allPages: boolean; grants: bigint }>>`SELECT m."allPages", (SELECT COUNT(*)::bigint FROM member_page_access a WHERE a."membershipId" = m.id) AS grants FROM memberships m WHERE m."userId" = ${newUser.id} AND m."workspaceId" = ${workspaceId}`;
    check(scope[0]?.allPages === false && scope[0]?.grants === BigInt(0), 'New non-manager membership must start with no channel access.');

    stage = 'MCP invitation directory and write-key parity';
    const mcpList = await mcp('list_workspace_invitations', { limit: 100 }, readBearer);
    check(mcpList.response.ok && mcpList.body.result?.structuredContent?.invitations?.length >= 2, 'Read-scoped workspace MCP key must list invitations.');
    const revocable = await createInvitation(revokedEmail); const revokedToken = capturedToken(smtp.messages, revokedEmail);
    const readonlyRevoke = await mcp('revoke_workspace_invitation', { id: revocable.id, confirmation: `REVOKE INVITATION ${revocable.id}` }, readBearer);
    check(readonlyRevoke.body.result?.isError === true && readonlyRevoke.body.result?.structuredContent?.code === 'forbidden', 'Read-only MCP key must not revoke invitations.');
    const writableRevoke = await mcp('revoke_workspace_invitation', { id: revocable.id, confirmation: `REVOKE INVITATION ${revocable.id}` }, writeBearer);
    check(writableRevoke.response.ok && writableRevoke.body.result?.structuredContent?.revoked === true, 'Write-scoped workspace MCP key must revoke through the shared service.');
    const revoked = await previewInvitation(revokedToken);
    check(revoked.response.status === 409, 'Revoked invitation token must be unusable.');

    stage = 'reject expired link and verify bounded privacy views';
    const expiring = await createInvitation(expiredEmail); const expiredToken = capturedToken(smtp.messages, expiredEmail);
    await db.$executeRaw`UPDATE invitations SET "expiresAt" = NOW() - INTERVAL '1 minute' WHERE id = ${expiring.id} AND "workspaceId" = ${workspaceId}`;
    check((await previewInvitation(expiredToken)).response.status === 409, 'Expired invitation token must be unusable.');
    const httpList = await http('/api/settings/team/invitations', 'GET', undefined, rootCookie); const listBody = await json(httpList);
    check(httpList.ok && listBody?.available === true && listBody.invitations.some((item: { status: string }) => item.status === 'accepted')
      && listBody.invitations.some((item: { status: string }) => item.status === 'expired'), 'HTTP invitation list must report accepted and expired states accurately.');
    const readJson = JSON.stringify({ http: listBody, mcp: mcpList.body.result?.structuredContent });
    check(!readJson.includes(firstToken) && !readJson.includes(currentToken) && !readJson.includes(registrationToken) && !readJson.includes(revokedToken) && !readJson.includes(expiredToken), 'HTTP and MCP directories must never contain invitation tokens.');
    check((await http('/api/auth/invitations/accept', 'POST', { confirmation: `ACCEPT INVITATION ${second.id}` }, joinedCookie)).status === 409, 'Accepted invitation replay must be refused.');
    console.log('PASS: local SMTP capture, invite reissue and one-use tokens, existing-account verification and acceptance, new-account registration without a session, no channel grants, expired/revoked/replayed denial, Root privacy and MCP key authorization.');
  } finally {
    stage = `cleanup after ${stage}`;
    for (const socket of smtp.clients) socket.destroy();
    await new Promise<void>(resolve => { if (smtp.server.listening) smtp.server.close(() => resolve()); else resolve(); });
    const cleanupErrors: string[] = [];
    async function cleanup(label: string, action: () => Promise<unknown>) { try { await action(); } catch { cleanupErrors.push(label); } }
    if (settingsCaptured) {
      for (const key of appSettingKeys) {
        const previous = originalSettings.get(key);
        await cleanup(`setting:${key}`, async () => {
          await db.appSetting.deleteMany({ where: { key } });
          if (previous) await db.appSetting.create({ data: { ...previous, value: previous.value as Prisma.InputJsonValue } });
        });
      }
    }
    const allUserIds = [rootId, recipientId, ...(newUserId ? [newUserId] : [])];
    await cleanup('root config audit discovery', async () => {
      const auditRows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId" = ${rootId} AND action = 'config.changed' AND detail->>'key' = ANY(${[...settingKeys]}::text[])`;
      for (const row of auditRows) if (!priorConfigAuditIds.has(row.id)) changedConfigAuditIds.add(row.id);
      if (changedConfigAuditIds.size) await db.$executeRaw`DELETE FROM root_activities WHERE id = ANY(${[...changedConfigAuditIds]}::text[])`;
    });
    await cleanup('MCP keys', () => db.mcpApiKey.deleteMany({ where: { id: { in: keyIds } } }));
    await cleanup('sessions', () => db.session.deleteMany({ where: { userId: { in: allUserIds } } }));
    await cleanup('workspace activity', () => db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ${workspaceId}`);
    await cleanup('email logs', () => db.$executeRaw`DELETE FROM email_logs WHERE "workspaceId" = ${workspaceId}`);
    await cleanup('invitations', () => db.$executeRaw`DELETE FROM invitations WHERE "workspaceId" = ${workspaceId}`);
    await cleanup('memberships', () => db.membership.deleteMany({ where: { workspaceId } }));
    await cleanup('users', () => db.user.deleteMany({ where: { id: { in: allUserIds } } }));
    await cleanup('workspace', () => db.workspace.deleteMany({ where: { id: workspaceId } }));
    if (fixtureStarted) await cleanup('fixture verification', async () => check(await db.user.count({ where: { id: { in: allUserIds } } }) === 0
      && await db.workspace.count({ where: { id: workspaceId } }) === 0 && await db.session.count({ where: { userId: { in: allUserIds } } }) === 0
      && await db.mcpApiKey.count({ where: { id: { in: keyIds } } }) === 0
      && await db.membership.count({ where: { workspaceId } }) === 0
      && (await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${workspaceId}`)[0]?.count === BigInt(0)
      && (await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM root_activities WHERE id = ANY(${[...changedConfigAuditIds]}::text[])`)[0]?.count === BigInt(0)
      && (await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM invitations WHERE "workspaceId" = ${workspaceId}`)[0]?.count === BigInt(0)
      && (await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM email_logs WHERE "workspaceId" = ${workspaceId}`)[0]?.count === BigInt(0), 'Invitation fixtures, memberships, sessions, keys, mail logs, audits and workspace must be removed.'));
    for (const key of settingKeys) {
      await cleanup(`setting verification:${key}`, async () => {
        const restored = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
        check(JSON.stringify(restored) === JSON.stringify(originalSettings.get(key)), 'A changed Root setting was not restored to its original stored row.');
      });
    }
    await db.$disconnect().catch(() => { cleanupErrors.push('database disconnect'); });
    check(cleanupErrors.length === 0, 'One or more disposable records or Root settings could not be restored and verified.');
    console.log('Disposable invitation fixture cleanup and exact Root setting restoration verified. No provider calls or external email.');
  }
}
main().catch(error => { console.error(`Invitation probe failed at ${stage}: ${error instanceof ProbeFailure ? error.message : 'unexpected local verification failure (details withheld)'}`); process.exitCode = 1; });
