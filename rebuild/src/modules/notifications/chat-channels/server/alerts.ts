import { randomUUID } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import type { Prisma } from '../../../../../generated/client';
import { prisma } from '@/server/data';
import { requireActiveRoot, loadRootOperations } from '@/server/root/operations';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { sendTransactionalMail } from '@/server/mail';
import { OperationError } from '@/lib/operation-error';
import { alertCopySchema, alertPolicySchema } from '../alerts-config';
import { chatPolicy } from './policy';
import { deliverChat } from './transport';

export const ALERT_CONFIRMATION = { test: 'TEST SYSTEM ALERT', check: 'CHECK SYSTEM ALERTS' } as const;
const keys = ['worker.down', 'publish.failures', 'backup.failed', 'disk.full'] as const;
type Check = { key: typeof keys[number]; firing: boolean | null };
type Tx = Prisma.TransactionClient;
async function configuration() {
  const [policy, copy] = await Promise.all([runtimeConfig('notifications.systemAlertPolicy'), runtimeConfig('notifications.systemAlertCopy')]);
  return { policy: alertPolicySchema.parse(policy), copy: alertCopySchema.parse(copy) };
}
async function audit(tx: Tx, actorId: string, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}
async function lockRoot(tx: Tx, actorId: string) {
  const actors = await tx.$queryRaw<Array<{ isInstanceOwner: boolean; disabledAt: Date | null }>>`SELECT "isInstanceOwner", "disabledAt" FROM users WHERE id = ${actorId} FOR SHARE`;
  if (!actors[0]?.isInstanceOwner || actors[0].disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
}
export async function listSystemAlerts(actorId: string) {
  await requireActiveRoot(actorId);
  const { policy, copy } = await configuration();
  const timeZone = await runtimeConfig('root.operationalTimezone');
  // Legacy detail may contain private provider errors; never return it.
  const rows = await prisma.$queryRaw<Array<{ id: string; key: string; openedAt: Date; resolvedAt: Date | null }>>`SELECT id, key, "openedAt", "resolvedAt" FROM system_alerts ORDER BY "openedAt" DESC, id DESC LIMIT ${policy.historyLimit + 1}`;
  return { items: rows.slice(0, policy.historyLimit).map(row => ({ id: row.id, key: row.key, openedAt: row.openedAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })), hasMore: rows.length > policy.historyLimit, copy, timeZone };
}

/** Root command and worker-host integration use this same incident writer.
 * Unknown checks are skipped, never treated as a recovery. Advisory locks also
 * protect installations whose legacy table has no partial unique-open index.
 */
export async function checkSystemAlerts(actorId: string, confirmation: unknown) {
  await requireActiveRoot(actorId);
  if (confirmation !== ALERT_CONFIRMATION.check) throw new OperationError('invalid_request', 'Exact incident-check confirmation is required.');
  const { policy } = await configuration();
  const [operations, failures, backups] = await Promise.all([
    loadRootOperations(actorId),
    prisma.postTarget.count({ where: { status: 'failed', updatedAt: { gte: new Date(Date.now() - policy.publishFailureWindowMinutes * 60_000) } } }),
    prisma.$queryRaw<Array<{ status: string; kind: string; finishedAt: Date }>>`SELECT status, kind, "finishedAt" FROM backup_runs ORDER BY "finishedAt" DESC LIMIT 1`,
  ]);
  const lastOffsite = await prisma.$queryRaw<Array<{ finishedAt: Date }>>`SELECT "finishedAt" FROM backup_runs WHERE kind = 'offsite' AND status = 'ok' ORDER BY "finishedAt" DESC LIMIT 1`;
  let disk: boolean | null = null;
  try { const value = await statfs(policy.diskPath); if (value.blocks > 0) disk = (value.blocks - value.bavail) / value.blocks * 100 > policy.diskPercent; } catch { /* unavailable is unknown */ }
  const checks: Check[] = [
    { key: 'worker.down', firing: operations.worker.state === 'stale' ? true : operations.worker.state === 'fresh' ? false : null },
    { key: 'publish.failures', firing: failures >= policy.publishFailureThreshold },
    { key: 'backup.failed', firing: !backups[0] ? null : backups[0].status === 'failed' || !lastOffsite[0] || Date.now() - lastOffsite[0].finishedAt.getTime() > policy.backupStaleHours * 3_600_000 },
    { key: 'disk.full', firing: disk },
  ];
  const timeout = await chatPolicy();
  return prisma.$transaction(async tx => {
    await lockRoot(tx, actorId);
    const opened: string[] = []; const resolved: string[] = [];
    for (const check of checks) {
      if (check.firing === null) continue;
      // Lock namespace is a database coordination protocol, not operator policy.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'rebuild:system-alerts'}), hashtext(${check.key}))`;
      const current = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM system_alerts WHERE key = ${check.key} AND "resolvedAt" IS NULL FOR UPDATE`;
      if (check.firing && !current.length) {
        await tx.$executeRaw`INSERT INTO system_alerts (id, key, detail, "openedAt") VALUES (${randomUUID()}, ${check.key}, ${JSON.stringify({ source: 'rebuild' })}::jsonb, NOW())`;
        opened.push(check.key);
      } else if (!check.firing && current.length) {
        await tx.$executeRaw`UPDATE system_alerts SET "resolvedAt" = NOW() WHERE key = ${check.key} AND "resolvedAt" IS NULL`;
        resolved.push(check.key);
      }
    }
    await audit(tx, actorId, 'system_alerts.checked', { opened, resolved, skipped: checks.filter(check => check.firing === null).map(check => check.key) });
    return { checked: true as const, opened, resolved, skipped: checks.filter(check => check.firing === null).map(check => check.key) };
  }, { timeout: timeout.transactionTimeoutMs, maxWait: timeout.transactionMaxWaitMs });
}

/** Durable intent precedes external delivery; an unfinished test stays visible
 * in Root audit history and is never automatically retried.
 */
export async function testSystemAlert(actorId: string, confirmation: unknown) {
  await requireActiveRoot(actorId);
  if (confirmation !== ALERT_CONFIRMATION.test) throw new OperationError('invalid_request', 'Exact alert-test confirmation is required.');
  const [{ policy, copy }, transport, recipients, token] = await Promise.all([
    configuration(), chatPolicy(), prisma.$queryRaw<Array<{ email: string; locale: string }>>`SELECT email, locale::text AS locale FROM users WHERE id = ${actorId}`, runtimeSecret('notifications.systemAlertTelegramToken'),
  ]);
  const recipient = recipients[0];
  if (!recipient) throw new OperationError('forbidden', 'Installation-owner access is required.');
  const id = randomUUID(); const text = copy[recipient.locale === 'fr' ? 'fr' : 'en'];
  await prisma.$transaction(async tx => { await lockRoot(tx, actorId); await audit(tx, actorId, 'system_alerts.test_started', { id }); });
  const email = await sendTransactionalMail({ to: policy.testEmail || recipient.email, subject: text.testTitle, text: text.testBody, template: 'system-alert' }).catch(() => ({ status: 'uncertain' as const }));
  const telegram = token && policy.telegramChatId ? await deliverChat('telegram', { botToken: token, chatId: policy.telegramChatId }, `${text.testTitle}\n${text.testBody}`, transport) : 'unavailable';
  let auditRecorded = true;
  try { await prisma.$transaction(tx => audit(tx, actorId, 'system_alerts.test_finished', { id, email: email.status, telegram })); } catch { auditRecorded = false; }
  return { id, email: email.status, telegram, auditRecorded };
}
