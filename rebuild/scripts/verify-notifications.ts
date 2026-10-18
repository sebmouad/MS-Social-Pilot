/** Guarded synthetic-only HTTP/MCP/PostgreSQL/SMTP proof for notification delivery. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { open, rename, unlink } from 'node:fs/promises';
import { Prisma, PrismaClient } from '../generated/client';
import { hashLegacySessionToken } from '../src/server/auth';
import { encryptSecret } from '../src/server/secret-crypto';
import { enqueueNotification } from '../src/modules/settings/notifications/server';
import { deliverNotifications } from '../src/modules/settings/notifications/delivery';
import { notificationConfirmation } from '../src/modules/settings/notifications/contracts';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
let stage = 'preview guards';
const stopController = new AbortController();
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { interrupted = true; stopController.abort(); });
async function fetchGuarded(input: string | URL, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(20_000);
  const signal = init.signal ? AbortSignal.any([stopController.signal, init.signal, timeout]) : AbortSignal.any([stopController.signal, timeout]);
  return fetch(input, { ...init, signal });
}
type CapturedMessage = { recipient: string; raw: string };
function startSmtpCapture() {
  const messages: CapturedMessage[] = [], clients = new Set<Socket>();
  const server = createServer(socket => {
    clients.add(socket); socket.on('close', () => clients.delete(socket)); socket.setEncoding('utf8'); socket.write('220 localhost ESMTP ready\r\n');
    let input = '', data = false, recipient = '';
    socket.on('data', chunk => {
      input += chunk;
      while (true) {
        if (data) { const end = input.indexOf('\r\n.\r\n'); if (end < 0) break; messages.push({ recipient, raw: input.slice(0, end) }); input = input.slice(end + 5); data = false; socket.write('250 2.0.0 message captured\r\n'); continue; }
        const end = input.indexOf('\r\n'); if (end < 0) break;
        const line = input.slice(0, end); input = input.slice(end + 2); const upper = line.toUpperCase();
        if (upper.startsWith('EHLO ')) socket.write('250-localhost\r\n250 PIPELINING\r\n');
        else if (upper.startsWith('HELO ')) socket.write('250 localhost\r\n');
        else if (upper.startsWith('MAIL FROM:')) socket.write('250 2.1.0 sender accepted\r\n');
        else if (upper.startsWith('RCPT TO:')) { recipient = line.match(/<([^<>]+)>/)?.[1]?.toLowerCase() ?? ''; socket.write(recipient.endsWith('@example.test') ? '250 2.1.5 recipient accepted\r\n' : '550 5.1.1 recipient denied\r\n'); }
        else if (upper === 'DATA') { data = true; socket.write('354 end with <CRLF>.<CRLF>\r\n'); }
        else if (upper === 'RSET') { recipient = ''; socket.write('250 reset\r\n'); }
        else if (upper === 'NOOP') socket.write('250 ok\r\n');
        else if (upper === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
  });
  return { server, clients, messages };
}
function decodeQuotedPrintable(value: string) { return value.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))); }
function decodeMimeText(raw: string) {
  const separator = raw.indexOf('\r\n\r\n');
  check(separator >= 0, 'Captured synthetic email has no MIME body.');
  const headers = raw.slice(0, separator), body = raw.slice(separator + 4);
  if (/content-transfer-encoding:\s*base64/i.test(headers)) return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) return decodeQuotedPrintable(body);
  return body;
}

const settingKeys = [
  'mcp.enabled', 'mcp.authenticatedRoles', 'entitlements.features.publishing/posts', 'entitlements.features.publishing/collaboration',
  'entitlements.features.settings/notifications', 'publishing.collab.notePageSize',
  'mail.enabled', 'mail.publicOrigin', 'mail.smtpHost', 'mail.smtpPort', 'mail.smtpSecure', 'mail.smtpRequireTls',
  'mail.smtpUsername', 'mail.smtpPassword', 'mail.fromAddress', 'mail.fromName', 'mail.connectionTimeoutMs', 'mail.socketTimeoutMs',
] as const;
type Setting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };
async function main() {
  const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL, origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(databaseUrl && databaseUrl === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Explicit matching preview database and origin are required; production is refused.');
  const database = new URL(databaseUrl), base = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(database.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    && decodeURIComponent(database.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => database.searchParams.has(key)), 'Only isolated loopback preview PostgreSQL is allowed.');
  check(base.origin === origin && base.protocol === 'http:' && base.hostname === 'localhost' && base.port === '3200', 'Only localhost:3200 HTTP preview is allowed.');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `preview_notifications_${randomUUID().replaceAll('-', '')}`;
  const workspaceId = `${prefix}_workspace`, foreignWorkspaceId = `${prefix}_foreign`, rootId = `${prefix}_root`, ownerId = `${prefix}_owner`, adminId = `${prefix}_admin`;
  const ownerMembershipId = `${prefix}_owner_membership`, adminMembershipId = `${prefix}_admin_membership`, rootMembershipId = `${prefix}_root_membership`;
  const rootSessionId = `${prefix}_root_session`, ownerSessionId = `${prefix}_owner_session`, adminSessionId = `${prefix}_admin_session`;
  const socialId = `${prefix}_social`, targetId = `${prefix}_target`, postId = `${prefix}_post`, foreignPostId = `${prefix}_foreign_post`;
  const ownerKeyId = `${prefix}_owner_key`, readKeyId = `${prefix}_read_key`, adminKeyId = `${prefix}_admin_key`;
  const rootSession = randomBytes(32).toString('base64url'), ownerSession = randomBytes(32).toString('base64url'), adminSession = randomBytes(32).toString('base64url');
  const ownerBearer = `mcp_${randomBytes(32).toString('base64url')}`, readBearer = `mcp_${randomBytes(32).toString('base64url')}`, adminBearer = `mcp_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000), settings = new Map<string, Setting | null>(), priorRootAuditIds = new Set<string>();
  const smtp = startSmtpCapture(); let smtpPort = 0, fixtureStarted = false, settingsCaptured = false, rootWrites = false, ledgerSaved = false;
  const noteIds: string[] = [], notificationIds: string[] = [], activityIds = new Set<string>();
  const recoveryLedgerPath = `/private/tmp/${prefix}-recovery.json`;
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const cookie = (session: string, workspace = workspaceId) => `msp_session=${session}; sp_workspace=${workspace}`;
  const rootCookie = cookie(rootSession), ownerCookie = cookie(ownerSession), adminCookie = cookie(adminSession);
  async function persistLedger(phase: string) {
    let operation = 'serialize';
    try {
      const ledger = { probe: 'verify-notifications', phase, prefix, capturedAt: new Date().toISOString(), settings: [...settings.values()].filter((row): row is Setting => row !== null), absentSettings: [...settings].filter(([, row]) => row === null).map(([key]) => key), priorRootAuditIds: [...priorRootAuditIds], fixtures: { workspaceId, foreignWorkspaceId, rootId, ownerId, adminId, ownerMembershipId, adminMembershipId, rootMembershipId, rootSessionId, ownerSessionId, adminSessionId, socialId, targetId, postId, foreignPostId, ownerKeyId, readKeyId, adminKeyId, noteIds: [...noteIds], notificationIds: [...notificationIds], activityIds: [...activityIds] } };
      const temporaryPath = `${recoveryLedgerPath}.${randomUUID()}.tmp`, handle = await open(temporaryPath, 'wx', 0o600);
      try { operation = 'write and flush private recovery ledger'; await handle.writeFile(JSON.stringify(ledger), { encoding: 'utf8' }); await handle.sync(); } finally { await handle.close(); }
      operation = 'atomically install private recovery ledger'; await rename(temporaryPath, recoveryLedgerPath); ledgerSaved = true;
    } catch { throw new ProbeFailure(`Private recovery ledger could not complete: ${operation}.`); }
  }
  function checkpoint() { if (stopController.signal.aborted) throw new ProbeFailure('Probe interrupted; guarded cleanup is running.'); }
  async function json(response: Response): Promise<any> { try { return await response.json(); } catch { return null; } }
  async function http(path: string, method = 'GET', body?: unknown, session = ownerSession) {
    return fetchGuarded(new URL(path, base), { method, redirect: 'manual', headers: { origin: base.origin, cookie: cookie(session), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function rpc(name: string, args: unknown = {}, bearer = ownerBearer) {
    const response = await fetchGuarded(new URL('/api/mcp?scope=workspace', base), { method: 'POST', redirect: 'manual', headers: { origin: base.origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    return { response, body: await json(response) };
  }
  async function saveSetting(key: string, value: unknown, clear = false) {
    checkpoint(); rootWrites = true;
    const response = await http('/api/root/config', 'PUT', clear ? { key, clear: true } : { key, value }, rootSession), result = await json(response);
    check(response.ok && result?.schemaVersion === CONFIG_SCHEMA_VERSION && result?.ok === true, `Root setting ${key} did not apply.`);
  }
  async function count(query: Promise<Array<{ count: bigint }>>) { return Number((await query)[0]?.count ?? 0); }
  try {
    stage = 'check required preview tables and localhost preflight';
    const requiredTables = ['workspaces','users','memberships','sessions','mcp_api_keys','app_settings','root_activities','activity_logs','social_accounts','targets','posts','post_targets','post_notes','notification_settings','notification_mutes','rebuild_notifications'];
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY(${requiredTables}::text[])`;
    check(tables.length === requiredTables.length, `Required preview tables unavailable (${tables.length}/${requiredTables.length}); no fixtures written.`);
    const preflight = await fetchGuarded(new URL('/sign-in', base), { redirect: 'manual' }); check(preflight.status < 500, 'Expected localhost preview is not responding.');
    stage = 'capture exact Root settings including encrypted SMTP secret';
    for (const key of settingKeys) { const row = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } }); settings.set(key, row); }
    check(settings.get('mail.smtpPassword') === null || settings.get('mail.smtpPassword')?.encrypted === true, 'SMTP password setting is not encrypted at rest.');
    settingsCaptured = true;
    const oldAudits = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`; oldAudits.forEach(row => priorRootAuditIds.add(row.id));
    await new Promise<void>((resolve, reject) => { smtp.server.once('error', reject); smtp.server.listen(0, '127.0.0.1', resolve); });
    const address = smtp.server.address(); check(address && typeof address !== 'string', 'Local SMTP capture did not bind a TCP port.'); smtpPort = (address as AddressInfo).port;
    stage = 'persist private recovery ledger before first fixture or configuration write'; await persistLedger('before first write');
    fixtureStarted = true;
    stage = 'create disposable workspace';
    await db.workspace.create({ data: { id: workspaceId, slug: workspaceId, name: 'Disposable notification workspace', timezone: 'UTC' } });
    await db.workspace.create({ data: { id: foreignWorkspaceId, slug: foreignWorkspaceId, name: 'Disposable foreign notification workspace', timezone: 'UTC' } });
    stage = 'create disposable users';
    for (const [id, email, name, isRoot] of [[rootId, `${rootId}@example.test`, 'Disposable notification Root', true], [ownerId, `${ownerId}@example.test`, 'Disposable notification owner', false], [adminId, `${adminId}@example.test`, 'Disposable notification admin', false]] as const) {
      await db.user.create({ data: { id, email, name, passwordHash: 'unusable-preview-password', isInstanceOwner: isRoot, totpEnabledAt: isRoot ? new Date() : null } });
    }
    stage = 'verify disposable recipient email';
    await db.$executeRaw`UPDATE users SET "emailVerifiedAt"=NOW() WHERE id=${adminId}`;
    stage = 'create disposable memberships';
    for (const [id, userId, role] of [[rootMembershipId, rootId, 'owner'], [ownerMembershipId, ownerId, 'owner'], [adminMembershipId, adminId, 'admin']] as const) await db.membership.create({ data: { id, userId, workspaceId, role } });
    await db.$executeRaw`UPDATE memberships SET "allPages"=true WHERE "workspaceId"=${workspaceId}`;
    stage = 'create disposable sessions';
    await db.session.create({ data: { id: rootSessionId, userId: rootId, tokenHash: hashLegacySessionToken(rootSession)!, expiresAt, pending: null } });
    stage = 'create disposable sessions';
    await db.session.create({ data: { id: ownerSessionId, userId: ownerId, tokenHash: hashLegacySessionToken(ownerSession)!, expiresAt, pending: null } });
    stage = 'create disposable sessions';
    await db.session.create({ data: { id: adminSessionId, userId: adminId, tokenHash: hashLegacySessionToken(adminSession)!, expiresAt, pending: null } });
    stage = 'create disposable connection';
    await db.socialAccount.create({ data: { id: socialId, workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`, name: 'Disposable notification channel', accessToken: encryptSecret('synthetic-no-provider-credential'), scopes: 'pages_manage_posts' } });
    stage = 'create disposable target';
    await db.target.create({ data: { id: targetId, workspaceId, socialAccountId: socialId, type: 'page', providerId: `${prefix}_page`, name: 'Disposable notification channel', accessToken: encryptSecret('synthetic-no-provider-credential'), enabled: true, canPublish: true, createdAt: new Date() } });
    stage = 'create disposable post';
    await db.$executeRaw`INSERT INTO posts (id,"workspaceId","authorId",message,status,"createdAt","updatedAt") VALUES (${postId},${workspaceId},${ownerId},'Synthetic notification draft','draft'::"PostStatus",NOW(),NOW())`;
    stage = 'create disposable post destination';
    await db.$executeRaw`INSERT INTO post_targets (id,"postId","targetId",status,"updatedAt") VALUES (${`${prefix}_post_target`},${postId},${targetId},'pending'::"PostTargetStatus",NOW())`;
    stage = 'create disposable MCP keys';
    await db.mcpApiKey.create({ data: { id: ownerKeyId, workspaceId, createdById: ownerId, name: 'Disposable notification owner key', tokenHash: sha256(ownerBearer), tokenPrefix: ownerBearer.slice(0,12), readFeatures: ['publishing/posts','publishing/collaboration','settings/notifications'], writeFeatures: ['publishing/posts','publishing/collaboration','settings/notifications'], expiresAt } });
    stage = 'create disposable MCP keys';
    await db.mcpApiKey.create({ data: { id: readKeyId, workspaceId, createdById: ownerId, name: 'Disposable notification read key', tokenHash: sha256(readBearer), tokenPrefix: readBearer.slice(0,12), readFeatures: ['settings/notifications'], writeFeatures: [], expiresAt } });
    await db.mcpApiKey.create({ data: { id: adminKeyId, workspaceId, createdById: adminId, name: 'Disposable recipient key', tokenHash: sha256(adminBearer), tokenPrefix: adminBearer.slice(0,12), readFeatures: ['settings/notifications'], writeFeatures: ['settings/notifications'], expiresAt } });
    await persistLedger('identities and target created');
    stage = 'enable only disposable Root, feature, MCP and local SMTP settings';
    await saveSetting('mcp.enabled', true); await saveSetting('mcp.authenticatedRoles', ['owner','admin']);
    await saveSetting('entitlements.features.publishing/posts', true); await saveSetting('entitlements.features.publishing/collaboration', true); await saveSetting('entitlements.features.settings/notifications', true);
    await saveSetting('publishing.collab.notePageSize', 20);
    await saveSetting('mail.enabled', true); await saveSetting('mail.publicOrigin', base.origin); await saveSetting('mail.smtpHost', '127.0.0.1'); await saveSetting('mail.smtpPort', smtpPort);
    await saveSetting('mail.smtpSecure', false); await saveSetting('mail.smtpRequireTls', false); await saveSetting('mail.smtpUsername', ''); await saveSetting('mail.smtpPassword', '', true);
    await saveSetting('mail.fromAddress', `${rootId}@example.test`); await saveSetting('mail.fromName', 'Notification preview'); await saveSetting('mail.connectionTimeoutMs', 5000); await saveSetting('mail.socketTimeoutMs', 5000);
    stage = 'owner creates internal note mentioning a verified workspace admin';
    const noteBody = { postId, body: 'Synthetic note for @Disposable notification admin', mentionIds: [adminId], confirmation: `ADD NOTE ${postId}` };
    const noteResponse = await http('/api/publishing/notes', 'POST', noteBody, ownerSession), noteResult = await json(noteResponse);
    check(noteResponse.status === 201 && noteResult?.mentionIds?.includes(adminId) && noteResult?.notified === 'queued' && typeof noteResult?.id === 'string', 'Owner note did not atomically enqueue the verified admin mention.');
    noteIds.push(noteResult.id); await persistLedger('note created and mention notification enqueued');
    const actual = await db.$queryRaw<Array<{ id: string; emailState: string; postId: string; noteId: string; eventId: string }>>`SELECT id,"emailState","postId","noteId","eventId" FROM rebuild_notifications WHERE "workspaceId"=${workspaceId} AND "userId"=${adminId}`;
    check(actual.length === 1 && actual[0]?.emailState === 'pending' && actual[0]?.postId === postId && actual[0]?.noteId === noteResult.id, 'Atomic notification row does not match the stored note.');
    notificationIds.push(actual[0]!.id); await persistLedger('notification row id captured');
    const noteRow = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM post_notes WHERE id=${noteResult.id} AND "postId"=${postId} AND "authorId"=${ownerId}`;
    check(noteRow.length === 1, 'Mention note is not stored under the owner draft.');
    stage = 'verify same-event-recipient idempotency';
    const input = { eventId: actual[0]!.eventId, workspaceId, userId: adminId, kind: 'note_mention' as const, postId, noteId: noteResult.id };
    await db.$transaction(async tx => { const first = await enqueueNotification(tx, input), second = await enqueueNotification(tx, input); check(!first.inserted && !second.inserted, 'Repeated enqueue inserted a duplicate notification.'); });
    check(await count(db.$queryRaw`SELECT COUNT(*)::bigint AS count FROM rebuild_notifications WHERE "workspaceId"=${workspaceId} AND "eventId"=${actual[0]!.eventId} AND "userId"=${adminId}`) === 1, 'Idempotent event/recipient key does not hold one row.');
    stage = 'verify recipient-only list, foreign scope refusal, confirmations and read-only key';
    const list = await http('/api/notifications', 'GET', undefined, adminSession), listBody = await json(list);
    check(list.ok && listBody?.notifications?.items?.some((row: any) => row.id === actual[0]!.id && row.postId === postId && row.noteId === noteResult.id), 'Verified recipient cannot read the owner mention in the app.');
    const ownerList = await http('/api/notifications', 'GET', undefined, ownerSession), ownerListBody = await json(ownerList);
    check(ownerList.ok && !ownerListBody?.notifications?.items?.some((row: any) => row.id === actual[0]!.id), 'Notification leaked to the note author.');
    const invalidRead = await http(`/api/notifications?id=${encodeURIComponent(actual[0]!.id)}`, 'PATCH', { confirmation: 'READ NOTIFICATION wrong' }, adminSession);
    check(invalidRead.status === 400, 'Incorrect notification confirmation was accepted.');
    const foreignMutation = await http(`/api/notifications?id=${encodeURIComponent(actual[0]!.id)}`, 'PATCH', { confirmation: notificationConfirmation.read(actual[0]!.id) }, ownerSession);
    check(foreignMutation.status >= 400, 'A different member mutated the recipient notification.');
    const readOnly = await rpc('mark_notification_read', { id: actual[0]!.id, confirmation: notificationConfirmation.read(actual[0]!.id) }, readBearer);
    check(readOnly.body?.result?.isError === true || readOnly.body?.error, 'Read-only MCP key changed a notification.');
    const tools = await fetchGuarded(new URL('/api/mcp?scope=workspace', base), { method: 'POST', headers: { origin: base.origin, authorization: `Bearer ${ownerBearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' }) });
    const toolBody = await json(tools), expectedTools = ['get_notification_preferences','update_notification_preferences','list_notifications','mark_notification_read','delete_notification'];
    check(expectedTools.every(name => toolBody?.result?.tools?.some((tool: any) => tool.name === name)), 'MCP metadata omits a required notification tool.');
    const mcpList = await rpc('list_notifications', {}, ownerBearer);
    check(mcpList.response.ok && Array.isArray(mcpList.body?.result?.structuredContent?.items) && !mcpList.body.result.structuredContent.items.some((row: any) => row.id === actual[0]!.id), 'Author MCP key exposed another recipient notification.');
    const mcpRead = await rpc('mark_notification_read', { id: actual[0]!.id, confirmation: notificationConfirmation.read(actual[0]!.id) }, ownerBearer);
    check(mcpRead.body?.result?.isError === true || mcpRead.body?.error, 'MCP write allowed the note author to mutate another recipient row.');
    const recipientList = await rpc('list_notifications', {}, adminBearer);
    check(recipientList.body?.result?.structuredContent?.items?.some((row: any) => row.id === actual[0]!.id), 'Recipient MCP key cannot read its own alert.');
    const recipientRead = await rpc('mark_notification_read', { id: actual[0]!.id, confirmation: notificationConfirmation.read(actual[0]!.id) }, adminBearer);
    check(recipientRead.body?.result?.structuredContent?.read === true, 'Recipient MCP key cannot mark its own alert read.');
    stage = 'verify email opt-out retains in-app item and cancels delivery';
    const optout = await http('/api/notifications', 'PUT', { onNoteMention: false, confirmation: notificationConfirmation.updatePreferences() }, adminSession);
    check(optout.ok, 'Recipient could not opt out of notification email.');
    const optoutNote = await http('/api/publishing/notes', 'POST', { ...noteBody, body: 'Second synthetic note for @Disposable notification admin' }, ownerSession), optoutNoteBody = await json(optoutNote);
    check(optoutNote.status === 201 && optoutNoteBody?.notified === 'queued', 'Email opt-out suppressed the in-app note alert.');
    noteIds.push(optoutNoteBody.id); await persistLedger('opt-out note created');
    const cancelledRows = await db.$queryRaw<Array<{ id: string; emailState: string }>>`SELECT id,"emailState" FROM rebuild_notifications WHERE "noteId"=${optoutNoteBody.id} AND "userId"=${adminId}`;
    check(cancelledRows.length === 1 && cancelledRows[0]?.emailState === 'cancelled', 'Opt-out did not cancel only the email delivery state.');
    notificationIds.push(cancelledRows[0]!.id); await persistLedger('cancelled notification row captured');
    const seesOptoutInApp = await http('/api/notifications', 'GET', undefined, adminSession), seesOptoutBody = await json(seesOptoutInApp);
    check(seesOptoutInApp.ok && seesOptoutBody?.notifications?.items?.some((row: any) => row.id === cancelledRows[0]!.id), 'Email opt-out removed the in-app alert.');
    const foreignList = await http('/api/notifications', 'GET', undefined, ownerSession);
    check(foreignList.ok && !(await json(foreignList))?.notifications?.items?.some((row: any) => row.id === cancelledRows[0]!.id), 'Foreign account sees the recipient opt-out alert.');
    stage = 'verify exact read/delete confirmations';
    const readResponse = await http(`/api/notifications?id=${encodeURIComponent(cancelledRows[0]!.id)}`, 'PATCH', { confirmation: notificationConfirmation.read(cancelledRows[0]!.id) }, adminSession);
    check(readResponse.ok && (await json(readResponse))?.read === true, 'Exact read confirmation failed.');
    const deleteResponse = await http(`/api/notifications?id=${encodeURIComponent(cancelledRows[0]!.id)}`, 'DELETE', { confirmation: notificationConfirmation.delete(cancelledRows[0]!.id) }, adminSession);
    check(deleteResponse.ok && (await json(deleteResponse))?.deleted === true, 'Exact deletion confirmation failed.');
    stage = 'revoke channel grants and ensure notification history loses private resource ids';
    await db.$executeRaw`DELETE FROM member_page_access WHERE "membershipId"=${adminMembershipId}`;
    await db.$executeRaw`UPDATE memberships SET "allPages"=false, role='editor'::"WorkspaceRole" WHERE id=${adminMembershipId}`;
    const hiddenList = await http('/api/notifications', 'GET', undefined, adminSession), hiddenBody = await json(hiddenList);
    const hidden = hiddenBody?.notifications?.items?.find((row: any) => row.id === actual[0]!.id);
    check(hiddenList.ok && hidden && hidden.available === false && hidden.postId === null && hidden.noteId === null && hidden.targetId === null && hidden.labelId === null, 'Revoked channel access did not redact notification resource references.');
    stage = 'verify Root feature-off refusal';
    await saveSetting('entitlements.features.settings/notifications', false);
    const featureOffHttp = await http('/api/notifications', 'GET', undefined, adminSession), featureOffMcp = await rpc('list_notifications', {}, ownerBearer);
    check(!featureOffHttp.ok && (featureOffMcp.body?.result?.isError === true || featureOffMcp.body?.error), 'Notification feature-off did not block HTTP and MCP.');
    await saveSetting('entitlements.features.settings/notifications', true);
    await db.$executeRaw`UPDATE memberships SET "allPages"=true, role='admin'::"WorkspaceRole" WHERE id=${adminMembershipId}`;
    stage = 'verify successful SMTP capture is sent once and never retried';
    await http('/api/notifications', 'PUT', { onNoteMention: true, confirmation: notificationConfirmation.updatePreferences() }, adminSession);
    const smtpNote = await http('/api/publishing/notes', 'POST', { ...noteBody, body: 'Email synthetic note for @Disposable notification admin' }, ownerSession), smtpNoteBody = await json(smtpNote);
    check(smtpNote.status === 201 && smtpNoteBody?.notified === 'queued', 'SMTP test mention was not queued.');
    noteIds.push(smtpNoteBody.id); await persistLedger('SMTP note created');
    const emailRows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_notifications WHERE "noteId"=${smtpNoteBody.id} AND "userId"=${adminId} AND "emailState"='pending'`;
    check(emailRows.length === 1, 'Expected one pending synthetic SMTP notification.'); notificationIds.push(emailRows[0]!.id); await persistLedger('SMTP notification id captured');
    const sentStats = await deliverNotifications(new Date(Date.now() + 1000), workspaceId);
    check(sentStats.sent === 2 && smtp.messages.filter(message => message.recipient === `${adminId}@example.test`).length === 2, 'SMTP capture did not receive exactly two local messages for the two pending mentions.');
    const captured = smtp.messages.find(message => message.recipient === `${adminId}@example.test`), decoded = captured ? decodeMimeText(captured.raw) : '';
    check(decoded.includes('/settings/notifications') && !decoded.includes('Email synthetic note') && !decoded.includes(adminId), 'Email content did not use generic copy or included private note/identity data.');
    const sentAgain = await deliverNotifications(new Date(Date.now() + 2000), workspaceId);
    check(sentAgain.sent === 0 && smtp.messages.length === 2, 'Repeated worker run resent an already-sent email.');
    const sentRow = await db.$queryRaw<Array<{ state: string; sentAt: Date | null }>>`SELECT "emailState" AS state,"emailSentAt" AS "sentAt" FROM rebuild_notifications WHERE id=${emailRows[0]!.id}`;
    check(sentRow[0]?.state === 'sent' && sentRow[0]?.sentAt, 'Successful SMTP outcome was not durably recorded.');
    stage = 'verify expired SMTP claim becomes uncertain and is held from resend';
    const expiredEventId = `${prefix}_expired_event`;
    await db.$executeRaw`INSERT INTO rebuild_notifications (id,"eventId","workspaceId","userId",kind,"postId","noteId","createdAt","emailState",attempt,"lastAttemptAt","claimUntil","claimToken","nextAt") VALUES (${`${prefix}_expired_notification`},${expiredEventId},${workspaceId},${adminId},'note_mention',${postId},${smtpNoteBody.id},NOW(),'sending',1,NOW(),${new Date(Date.now()-60_000)},${randomUUID()},NULL)`;
    notificationIds.push(`${prefix}_expired_notification`); await persistLedger('expired sending row captured');
    const expiredStats = await deliverNotifications(new Date(), workspaceId);
    const uncertainRow = await db.$queryRaw<Array<{ state: string; reason: string | null }>>`SELECT "emailState" AS state,"safeReason" AS reason FROM rebuild_notifications WHERE id=${`${prefix}_expired_notification`}`;
    check(expiredStats.uncertain === 1 && uncertainRow[0]?.state === 'uncertain' && uncertainRow[0]?.reason === 'claim_expired', 'Expired sending lease was not held as uncertain.');
    const afterExpired = await deliverNotifications(new Date(Date.now()+1000), workspaceId);
    check(afterExpired.sent === 0 && smtp.messages.length === 2, 'Expired SMTP claim was resent automatically.');
    stage = 'verify delivery and retention audits without note content';
    const deliveryAudits = await db.$queryRaw<Array<{ detail: Prisma.JsonValue }>>`SELECT detail FROM activity_logs WHERE "workspaceId"=${workspaceId} AND action='notifications.delivery'`;
    check(deliveryAudits.some(row => (row.detail as any)?.state === 'sending') && deliveryAudits.some(row => (row.detail as any)?.state === 'sent') && deliveryAudits.some(row => (row.detail as any)?.state === 'uncertain'), 'Delivery transition audits are missing.');
    check(deliveryAudits.every(row => !JSON.stringify(row.detail).includes('Synthetic note') && !JSON.stringify(row.detail).includes('@example.test')), 'Delivery audit contains private email or note content.');
    await db.$executeRaw`UPDATE rebuild_notifications SET "createdAt"=${new Date('1900-01-01T00:00:00Z')} WHERE id=${actual[0]!.id} AND "workspaceId"=${workspaceId}`;
    const retention = await deliverNotifications(new Date(), workspaceId);
    check(retention.purged === 1, 'Retention did not remove exactly the aged terminal fixture.');
    check(await count(db.$queryRaw`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId"=${workspaceId} AND action='notifications.retention' AND detail->>'notificationId'=${actual[0]!.id}`) === 1, 'Retention audit was not committed with deletion.');
    console.log('PASS: synthetic owner note and admin mention, atomic/idempotent persistence, personal scope and permissions, opt-out/in-app behavior, confirmations, redaction, feature gates, local SMTP sent-once and uncertain-lease hold.');
  } finally {
    stage = `cleanup after ${stage}`;
    for (const socket of smtp.clients) socket.destroy();
    await new Promise<void>(resolve => { if (smtp.server.listening) smtp.server.close(() => resolve()); else resolve(); });
    const errors: string[] = [];
    async function cleanup(label: string, action: () => Promise<unknown>) { try { await action(); } catch { errors.push(label); } }
    if (fixtureStarted) {
      await cleanup('notification rows', () => db.$executeRaw`DELETE FROM rebuild_notifications WHERE "workspaceId"=${workspaceId}`);
      await cleanup('notification mutes/settings', () => db.$executeRaw`DELETE FROM notification_mutes WHERE "userId"=ANY(${[rootId,ownerId,adminId]}::text[])`);
      await cleanup('notification settings', () => db.$executeRaw`DELETE FROM notification_settings WHERE "userId"=ANY(${[rootId,ownerId,adminId]}::text[]) AND "workspaceId"=${workspaceId}`);
      await cleanup('notes', () => db.$executeRaw`DELETE FROM post_notes WHERE "postId"=ANY(${[postId,foreignPostId]}::text[])`);
      await cleanup('post targets and posts', async () => { await db.$executeRaw`DELETE FROM post_targets WHERE "postId"=ANY(${[postId,foreignPostId]}::text[])`; await db.$executeRaw`DELETE FROM posts WHERE id=ANY(${[postId,foreignPostId]}::text[]) AND "workspaceId"=ANY(${[workspaceId,foreignWorkspaceId]}::text[])`; });
      await cleanup('channel targets', () => db.target.deleteMany({ where: { id: targetId } }));
      await cleanup('social account', () => db.socialAccount.deleteMany({ where: { id: socialId } }));
      await cleanup('MCP keys', () => db.mcpApiKey.deleteMany({ where: { id: { in: [ownerKeyId, readKeyId, adminKeyId] } } }));
      await cleanup('sessions', () => db.session.deleteMany({ where: { id: { in: [rootSessionId, ownerSessionId, adminSessionId] } } }));
      // Both workspaces are disposable probe fixtures. Include system-authored
      // delivery audits, and remove mail logs before their FK becomes NULL.
      await cleanup('activity log entries', () => db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId"=ANY(${[workspaceId,foreignWorkspaceId]}::text[])`);
      await cleanup('email log entries', () => db.$executeRaw`DELETE FROM email_logs WHERE "workspaceId"=ANY(${[workspaceId,foreignWorkspaceId]}::text[])`);
      await cleanup('new Root config audits', async () => { const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM root_activities WHERE "actorId"=${rootId} AND action='config.changed' AND detail->>'key'=ANY(${[...settingKeys]}::text[])`; const ids = rows.map(row => row.id).filter(id => !priorRootAuditIds.has(id)); if (ids.length) await db.$executeRaw`DELETE FROM root_activities WHERE id=ANY(${ids}::text[])`; });
      await cleanup('memberships', () => db.membership.deleteMany({ where: { id: { in: [rootMembershipId, ownerMembershipId, adminMembershipId] } } }));
      await cleanup('workspaces', () => db.workspace.deleteMany({ where: { id: { in: [workspaceId, foreignWorkspaceId] } } }));
      await cleanup('users', () => db.user.deleteMany({ where: { id: { in: [rootId, ownerId, adminId] } } }));
      await cleanup('synthetic fixture verification', async () => {
        const residue = await db.$queryRaw<Array<{ count: bigint }>>`SELECT (SELECT COUNT(*) FROM rebuild_notifications WHERE "workspaceId"=${workspaceId})+(SELECT COUNT(*) FROM post_notes WHERE "postId"=ANY(${[postId,foreignPostId]}::text[]))+(SELECT COUNT(*) FROM posts WHERE id=ANY(${[postId,foreignPostId]}::text[]))+(SELECT COUNT(*) FROM activity_logs WHERE "workspaceId"=${workspaceId}) AS count`;
        check(residue[0]?.count === BigInt(0) && await db.user.count({ where: { id: { in: [rootId,ownerId,adminId] } } }) === 0, 'Synthetic notification records remain after cleanup.');
      });
    }
    if (settingsCaptured && rootWrites) await cleanup('exact Root settings restoration', async () => {
      for (const key of settingKeys) { await db.appSetting.deleteMany({ where: { key } }); const prior = settings.get(key); if (prior) await db.appSetting.create({ data: { ...prior, value: prior.value as Prisma.InputJsonValue } }); }
      for (const key of settingKeys) { const row = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } }); check(JSON.stringify(row) === JSON.stringify(settings.get(key)), `Root setting ${key} did not restore exactly.`); }
    });
    await db.$disconnect().catch(() => errors.push('database disconnect'));
    if (errors.length === 0 && ledgerSaved) await unlink(recoveryLedgerPath).catch(() => errors.push('recovery ledger removal'));
    if (errors.length) console.error(`Recovery ledger retained at ${recoveryLedgerPath}; cleanup issues: ${errors.join(', ')}.`);
    check(errors.length === 0, 'Cleanup or exact Root setting restoration failed.');
  }
}
main().catch(error => { console.error(`Notification verifier failed at ${stage}: ${error instanceof ProbeFailure ? error.message : `unexpected ${error instanceof Error ? error.name : 'local'} failure${error instanceof Prisma.PrismaClientKnownRequestError ? ` (${error.code})` : ''} (details withheld)`}`); process.exitCode = 1; });
