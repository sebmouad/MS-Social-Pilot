/**
 * Disposable schema-only PostgreSQL + loopback SMTP proof for scheduled Reports.
 * Never points the worker at the existing preview database: the parent creates a
 * uniquely named scratch database, copies schema only, and starts this file again
 * with the scratch URL. All recipient domains are example.invalid.
 */
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { Prisma, PrismaClient } from '../generated/client';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }

function readPrivateEnv(path: string): Record<string, string> {
  const fs = require('node:fs') as typeof import('node:fs');
  const stat = fs.statSync(path);
  check((stat.mode & 0o077) === 0, 'Private preview environment file must be mode 0600 or stricter.');
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]!] = value;
  }
  return result;
}

function docker(args: string[], input?: Buffer) {
  const result = spawnSync('docker', args, { input, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  if (result.status !== 0) {
    const error = Buffer.from(result.stderr ?? '').toString('utf8').replace(/\s+/g, ' ').slice(0, 500);
    throw new ProbeFailure(`Disposable database command failed (${result.status ?? 'signal'}): ${error || 'no diagnostic output'}`);
  }
  return result.stdout;
}

function pgAs(containerArgs: string[], password: string) {
  return docker(['exec', '-i', 'msp-test-pg', 'sh', '-c', 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec "$@"', 'reports82', ...containerArgs], Buffer.from(`${password}\n`));
}

async function child(databaseUrl: string) {
  check(databaseUrl === process.env.DATABASE_URL && databaseUrl === process.env.REBUILD_PREVIEW_DATABASE_URL, 'Child requires identical scratch database URLs.');
  const url = new URL(databaseUrl);
  check(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '55432' && decodeURIComponent(url.pathname).includes('reports82_delivery_') && url.pathname.endsWith('_preview'), 'Child refuses any database except its disposable loopback scratch database.');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const prefix = `r82d_${randomUUID().replaceAll('-', '')}`;
  const ids = (part: string) => `${prefix}_${part}`;
  const workspaceId = ids('workspace'), ownerId = ids('owner'), membershipId = ids('membership'), connectionId = ids('connection'), channelId = ids('channel'), insightId = ids('insight');
  const acceptedSchedule = ids('accepted_schedule'), uncertainSchedule = ids('uncertain_schedule'), revokedSchedule = ids('revoked_schedule');
  const acceptedTo = `${ids('accepted')}@example.invalid`, uncertainTo = `${ids('uncertain')}@example.invalid`;
  const revokedFirst = `${ids('revoked1')}@example.invalid`, revokedSecond = `${ids('revoked2')}@example.invalid`;
  const smtpMessages: Array<{ recipient: string; body: string }> = [];
  const clients = new Set<Socket>();
  let smtpPort = 0, dropAfterData = false, revokeOnData = false;
  const smtp = createServer(socket => {
    clients.add(socket); socket.on('close', () => clients.delete(socket)); socket.setEncoding('utf8'); socket.write('220 localhost ESMTP ready\r\n');
    let input = '', dataMode = false, recipient = '';
    socket.on('data', async chunk => {
      input += chunk;
      while (true) {
        if (dataMode) {
          const end = input.indexOf('\r\n.\r\n'); if (end < 0) break;
          const body = input.slice(0, end); input = input.slice(end + 5); dataMode = false; smtpMessages.push({ recipient, body });
          if (revokeOnData) { revokeOnData = false; await db.$executeRaw`UPDATE users SET "disabledAt"=NOW() WHERE id=${ownerId}`; }
          if (dropAfterData) { dropAfterData = false; socket.destroy(); }
          else socket.write('250 2.0.0 captured locally\r\n');
          continue;
        }
        const end = input.indexOf('\r\n'); if (end < 0) break;
        const line = input.slice(0, end); input = input.slice(end + 2); const upper = line.toUpperCase();
        if (upper.startsWith('EHLO ')) socket.write('250-localhost\r\n250 PIPELINING\r\n');
        else if (upper.startsWith('HELO ')) socket.write('250 localhost\r\n');
        else if (upper.startsWith('MAIL FROM:')) socket.write('250 2.1.0 sender accepted\r\n');
        else if (upper.startsWith('RCPT TO:')) { recipient = line.match(/<([^<>]+)>/)?.[1]?.toLowerCase() ?? ''; socket.write(recipient.endsWith('@example.invalid') ? '250 2.1.5 accepted\r\n' : '550 5.1.1 refused\r\n'); }
        else if (upper === 'DATA') { dataMode = true; socket.write('354 end with <CRLF>.<CRLF>\r\n'); }
        else if (upper === 'RSET') { recipient = ''; socket.write('250 reset\r\n'); }
        else if (upper === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
  });
  const settings: Array<[string, Prisma.InputJsonValue]> = [
    ['platforms.facebook.enabled', true], ['entitlements.modules.analytics', true], ['entitlements.features.analytics/reports', true],
    ['analytics.reports.deliveryEnabled', true], ['jobs.enabled', true],
    ['mail.enabled', true], ['mail.publicOrigin', 'http://localhost:3200'], ['mail.smtpHost', '127.0.0.1'], ['mail.smtpSecure', false],
    ['mail.smtpRequireTls', false], ['mail.smtpUsername', ''], ['mail.fromAddress', `${ids('sender')}@example.invalid`], ['mail.fromName', 'Disposable Reports verifier'],
    ['mail.connectionTimeoutMs', 3000], ['mail.socketTimeoutMs', 3000],
  ];
  const setSetting = (key: string, value: Prisma.InputJsonValue) => db.appSetting.upsert({ where: { key }, create: { key, value, encrypted: false, updatedAt: new Date() }, update: { value, encrypted: false, updatedAt: new Date() } });
  let portsOpen = false;
  try {
    await new Promise<void>((resolve, reject) => { smtp.once('error', reject); smtp.listen(0, '127.0.0.1', resolve); });
    portsOpen = true; smtpPort = (smtp.address() as AddressInfo).port;
    await setSetting('mail.smtpPort', smtpPort);
    await Promise.all(settings.map(([key, value]) => setSetting(key, value)));
    await db.workspace.create({ data: { id: workspaceId, name: 'Disposable Reports delivery workspace', slug: workspaceId, timezone: 'UTC' } });
    await db.user.create({ data: { id: ownerId, email: `${ownerId}@example.invalid`, name: 'Disposable Reports owner', passwordHash: 'unusable', isInstanceOwner: false } });
    await db.membership.create({ data: { id: membershipId, userId: ownerId, workspaceId, role: 'owner' } });
    await db.$executeRaw`UPDATE memberships SET "allPages"=true WHERE id=${membershipId}`;
    await db.socialAccount.create({ data: { id: connectionId, workspaceId, provider: 'facebook', providerUserId: ids('provider'), name: 'Synthetic Reports connection', accessToken: 'synthetic-unused', scopes: '' } });
    await db.target.create({ data: { id: channelId, workspaceId, socialAccountId: connectionId, type: 'page', providerId: ids('provider_channel'), name: 'Synthetic Reports channel', enabled: true, canPublish: false, createdAt: new Date() } });
    const now = new Date();
    await db.pageInsight.create({ data: { id: insightId, targetId: channelId, metric: 'page_follows', period: 'day', endTime: new Date(now.getTime() - 86_400_000), value: 17, numeric: 17, fetchedAt: now } });
    const templateId = ids('template');
    await db.$executeRaw`INSERT INTO report_templates (id,"workspaceId",name,sections,"rangeKey","createdAt") VALUES (${templateId},${workspaceId},'Disposable scheduled report',${JSON.stringify(['analysis'])}::jsonb,'last_7_days',NOW())`;
    const due = new Date(Date.now() - 10_000);
    const addSchedule = (id: string, recipients: string[]) => db.$executeRaw`INSERT INTO report_schedules (id,"workspaceId","templateId","targetId",frequency,recipients,"nextRunAt","aiRecap","createdById","createdAt") VALUES (${id},${workspaceId},${templateId},${channelId},'daily',${recipients}::text[],${due},false,${ownerId},NOW())`;
    await addSchedule(acceptedSchedule, [acceptedTo]);
    await addSchedule(uncertainSchedule, [uncertainTo]);
    await addSchedule(revokedSchedule, [revokedFirst, revokedSecond]);

    const { ensureReportWorkflows, runScheduledReports } = await import('../src/server/analytics/report-workflows');
    await ensureReportWorkflows();
    // Isolate scenarios by making exactly one schedule due at a time.
    const park = async (id: string) => db.$executeRaw`UPDATE report_schedules SET "nextRunAt"=${new Date(Date.now() + 86400_000)} WHERE id=${id}`;
    await park(uncertainSchedule); await park(revokedSchedule);
    const accepted = await runScheduledReports(new Date());
    check(accepted.completed === 1 && accepted.examined === 1, 'Normal scheduled report did not complete through the real engine.');
    check(smtpMessages.filter(m => m.recipient === acceptedTo).length === 1, 'SMTP capture did not accept exactly one scheduled report.');
    const acceptedState = await db.$queryRaw<Array<{ status: string; deliveries: unknown }>>`SELECT status,deliveries FROM report_runs WHERE "scheduleId"=${acceptedSchedule} AND "workspaceId"=${workspaceId}`;
    check(acceptedState[0]?.status === 'completed' && JSON.stringify(acceptedState[0]?.deliveries).includes('sent'), 'Accepted mail lacks durable completed run and recipient outcome.');
    const log = await db.$queryRaw<Array<{ status: string; to: string }>>`SELECT status,"to" FROM email_logs WHERE "workspaceId"=${workspaceId} AND "to"=${acceptedTo}`;
    check(log.length === 1 && log[0]?.status === 'sent', 'Accepted mail has no matching successful email_log row.');
    const again = await runScheduledReports(new Date());
    check(again.examined === 0 && smtpMessages.filter(m => m.recipient === acceptedTo).length === 1, 'Second worker job resent accepted mail.');

    await park(acceptedSchedule);
    await db.$executeRaw`UPDATE report_schedules SET "nextRunAt"=${due} WHERE id=${uncertainSchedule}`;
    dropAfterData = true;
    const uncertain = await runScheduledReports(new Date());
    check(uncertain.uncertain === 1, 'SMTP disconnect after DATA was not stored as an uncertain run.');
    const uncertainState = await db.$queryRaw<Array<{ status: string; deliveries: unknown }>>`SELECT status,deliveries FROM report_runs WHERE "scheduleId"=${uncertainSchedule} AND "workspaceId"=${workspaceId}`;
    check(uncertainState[0]?.status === 'uncertain' && JSON.stringify(uncertainState[0]?.deliveries).includes('uncertain'), 'Ambiguous SMTP attempt lacks durable uncertain recipient state.');
    const uncertainCount = smtpMessages.filter(m => m.recipient === uncertainTo).length;
    check(uncertainCount === 1, 'SMTP capture did not observe exactly one ambiguous post-DATA message.');
    const uncertainLog = await db.$queryRaw<Array<{ status: string; error: string | null }>>`SELECT status,error FROM email_logs WHERE "workspaceId"=${workspaceId} AND "to"=${uncertainTo}`;
    check(uncertainLog.length === 1 && uncertainLog[0]?.status === 'failed' && uncertainLog[0]?.error === 'delivery_unconfirmed', 'Ambiguous SMTP result was not recorded as an unconfirmed email log.');
    const uncertainAgain = await runScheduledReports(new Date());
    check(uncertainAgain.examined === 0 && smtpMessages.filter(m => m.recipient === uncertainTo).length === 1, 'Second worker job resent an uncertain message.');

    await park(uncertainSchedule);
    await db.$executeRaw`UPDATE report_schedules SET "nextRunAt"=${due} WHERE id=${revokedSchedule}`;
    // Revoke the schedule author's account when the first DATA body reaches SMTP.
    // The second recipient boundary must re-read current authority and stop.
    revokeOnData = true;
    const revoked = await runScheduledReports(new Date());
    check(revoked.partial === 1 || revoked.skipped === 1, 'Authority revocation did not stop the schedule at a recipient boundary.');
    check(smtpMessages.filter(m => m.recipient === revokedFirst).length === 1 && smtpMessages.filter(m => m.recipient === revokedSecond).length === 0, 'Revoked current authority allowed another recipient email.');
    const revokedState = await db.$queryRaw<Array<{ status: string; deliveries: unknown }>>`SELECT status,deliveries FROM report_runs WHERE "scheduleId"=${revokedSchedule} AND "workspaceId"=${workspaceId}`;
    check(['partial','skipped'].includes(revokedState[0]?.status ?? '') && JSON.stringify(revokedState[0]?.deliveries).includes('skipped'), 'Revoked authority outcome was not durably recorded.');
    console.log(JSON.stringify({ ok: true, scratchOnly: true, scenarios: ['accepted_and_logged', 'repeat_job_no_resend', 'smtp_disconnect_after_data_uncertain_no_resend', 'revoked_authority_stops_second_recipient'], capturedMessages: smtpMessages.length }));
  } finally {
    for (const socket of clients) socket.destroy();
    if (portsOpen) await new Promise<void>(resolve => smtp.close(() => resolve()));
    await db.$executeRaw`DELETE FROM report_runs WHERE "workspaceId"=${workspaceId}`.catch(() => undefined);
    await db.$executeRaw`DELETE FROM report_schedules WHERE "workspaceId"=${workspaceId}`.catch(() => undefined);
    await db.$executeRaw`DELETE FROM report_templates WHERE "workspaceId"=${workspaceId}`.catch(() => undefined);
    await db.$executeRaw`DELETE FROM page_insights WHERE id=${insightId}`.catch(() => undefined);
    await db.$executeRaw`DELETE FROM targets WHERE id=${channelId}`.catch(() => undefined);
    await db.$executeRaw`DELETE FROM social_accounts WHERE id=${connectionId}`.catch(() => undefined);
    await db.membership.deleteMany({ where: { id: membershipId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: ownerId } }).catch(() => undefined);
    await db.workspace.deleteMany({ where: { id: workspaceId } }).catch(() => undefined);
    for (const [key] of settings) await db.appSetting.deleteMany({ where: { key } }).catch(() => undefined);
    await db.$disconnect();
  }
}

async function orchestrate() {
  const fs = require('node:fs') as typeof import('node:fs');
  const env = readPrivateEnv('/private/tmp/socialpilot-rebuild-preview.env');
  const sourceValue = env.REBUILD_PREVIEW_DATABASE_URL ?? env.DATABASE_URL;
  check(sourceValue, 'Private loopback preview database URL is unavailable.');
  const source = new URL(sourceValue);
  check(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname) && source.port === '55432' && source.pathname.endsWith('_preview') && !['host','hostaddr','socket'].some(k => source.searchParams.has(k)), 'Source must be the expected local preview database on port 55432.');
  const user = decodeURIComponent(source.username), password = decodeURIComponent(source.password), sourceDb = decodeURIComponent(source.pathname.slice(1));
  check(user && password, 'Loopback PostgreSQL credentials are required.');
  const scratchDb = `reports82_delivery_${Date.now()}_${randomUUID().slice(0, 8)}_preview`;
  const work = `/tmp/${scratchDb}`;
  const scratchUrl = new URL(sourceValue); scratchUrl.pathname = `/${scratchDb}`;
  let created = false;
  try {
    pgAs(['mkdir', '-p', work], password);
    pgAs(['pg_dump', '-h', '127.0.0.1', '-U', user, '-d', sourceDb, '--schema-only', '-Fc', '--no-owner', '--no-acl', '-f', `${work}/schema.dump`], password);
    pgAs(['createdb', '-h', '127.0.0.1', '-U', user, scratchDb], password); created = true;
    pgAs(['pg_restore', '-h', '127.0.0.1', '-U', user, '--no-owner', '--no-privileges', '--exit-on-error', '-d', scratchDb, `${work}/schema.dump`], password);
    const childEnv = { ...process.env, ...env, DATABASE_URL: scratchUrl.toString(), REBUILD_PREVIEW_DATABASE_URL: scratchUrl.toString(), NODE_ENV: 'test' as const };
    // Credentials go only to the child environment, never stdout/stderr or an argument.
    const run = spawnSync(process.execPath, ['--import', 'tsx', __filename, '--child'], { cwd: process.cwd(), env: childEnv, encoding: 'utf8', timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    if (run.status !== 0) {
      const safe = (run.stderr ?? '').split(/\r?\n/).filter(line => !line.includes(password) && !line.includes(user)).slice(-18).join('\n');
      throw new ProbeFailure(`Scheduled Reports child failed (${run.status ?? 'signal'}).${safe ? `\n${safe}` : ''}`);
    }
    process.stdout.write(run.stdout.trim() + '\n');
  } finally {
    if (created) pgAs(['dropdb', '-h', '127.0.0.1', '-U', user, scratchDb], password);
    pgAs(['rm', '-rf', work], password);
    // Retain only a truthful terminal status; never emit database credentials or captured bodies.
    if (!fs.existsSync(`/tmp/${scratchDb}`)) process.stderr.write('Disposable schema database and dump removed.\n');
  }
}

async function main() {
  try { if (process.argv.includes('--child')) await child(process.env.REBUILD_PREVIEW_DATABASE_URL ?? ''); else await orchestrate(); }
  catch (error) { process.stderr.write(`REPORTS82_DELIVERY_FAILED: ${error instanceof Error ? error.message : 'unknown probe failure'}\n`); process.exitCode = 1; }
}
void main();
