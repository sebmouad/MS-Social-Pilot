import { statfs } from 'node:fs/promises';
import { Locale, PostTargetStatus, Prisma } from '@prisma/client';

import { prisma } from './prisma';
import { env } from './env';
import { sendEmail } from './email/send';
import { translate } from './email/templates';
import { sendTelegram } from './chat';
import { currentAppUsage } from './facebook/budget';

/**
 * Alerts to root when something on the installation breaks: the worker has
 * stopped, publications are failing, a profile is disconnected or its token is
 * about to expire, the disk is filling up, a backup failed, or Meta's call
 * limit is close.
 *
 * One message when an incident opens and one when it clears — never a message
 * per check. Incidents are rows in `SystemAlert`; a check that fires while its
 * incident is open does nothing.
 *
 * The worker runs every check except its own heartbeat, which the web server
 * checks (src/instrumentation-node.ts): a stopped worker cannot report itself.
 */

export const ALERT_KEYS = [
  'worker.down',
  'publish.failures',
  'accounts.disconnected',
  'accounts.expiring',
  'disk.full',
  'backup.failed',
  'meta.usage',
] as const;
export type AlertKey = (typeof ALERT_KEYS)[number];

export interface CheckResult {
  key: AlertKey;
  firing: boolean;
  params: Record<string, string | number>;
}

const WORKER_DOWN_MS = 5 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function checkWorker(now = Date.now()): Promise<CheckResult> {
  const newest = await prisma.workerHeartbeat.findFirst({ orderBy: { seenAt: 'desc' }, select: { seenAt: true } });
  // No heartbeat ever: the worker was never started here, which setup reports.
  const minutes = newest ? Math.round((now - newest.seenAt.getTime()) / 60_000) : 0;
  return { key: 'worker.down', firing: newest !== null && now - newest.seenAt.getTime() > WORKER_DOWN_MS, params: { minutes } };
}

export async function checkPublishFailures(now = Date.now()): Promise<CheckResult> {
  const count = await prisma.postTarget.count({
    where: { status: PostTargetStatus.failed, updatedAt: { gte: new Date(now - HOUR) } },
  });
  return { key: 'publish.failures', firing: count >= env.alertsPublishFailures, params: { count } };
}

export async function checkAccounts(now = Date.now()): Promise<CheckResult[]> {
  const [disconnected, expiring] = await Promise.all([
    prisma.socialAccount.count({ where: { invalidatedAt: { not: null } } }),
    prisma.socialAccount.count({
      where: { invalidatedAt: null, tokenExpiresAt: { not: null, lte: new Date(now + 7 * DAY), gt: new Date(now) } },
    }),
  ]);
  return [
    { key: 'accounts.disconnected', firing: disconnected > 0, params: { count: disconnected } },
    { key: 'accounts.expiring', firing: expiring > 0, params: { count: expiring } },
  ];
}

export async function checkDisk(path = '/'): Promise<CheckResult> {
  const stats = await statfs(path);
  const used = Math.round(((stats.blocks - stats.bavail) / stats.blocks) * 100);
  return { key: 'disk.full', firing: used > env.alertsDiskPercent, params: { percent: used } };
}

export async function checkBackups(now = Date.now()): Promise<CheckResult> {
  const [latest, lastOffsite] = await Promise.all([
    prisma.backupRun.findFirst({ orderBy: { finishedAt: 'desc' } }),
    prisma.backupRun.findFirst({ where: { kind: 'offsite', status: 'ok' }, orderBy: { finishedAt: 'desc' } }),
  ]);
  // Nothing recorded: off-site backups are not set up, which the Backups screen says.
  if (!latest) return { key: 'backup.failed', firing: false, params: {} };
  const stale = !lastOffsite || now - lastOffsite.finishedAt.getTime() > 2 * DAY;
  return {
    key: 'backup.failed',
    firing: latest.status === 'failed' || stale,
    params: { detail: latest.status === 'failed' ? (latest.detail ?? latest.kind) : 'no off-site copy for 2 days' },
  };
}

export function checkMetaUsage(now = Date.now()): CheckResult {
  const percent = currentAppUsage(now);
  return { key: 'meta.usage', firing: percent !== null && percent >= 90, params: { percent: Math.round(percent ?? 0) } };
}

/** Root's language, for the messages. */
async function rootRecipient(): Promise<{ email: string; locale: Locale } | null> {
  const root = await prisma.user.findFirst({ where: { isInstanceOwner: true }, select: { email: true, locale: true } });
  if (!root) return null;
  return { email: env.alertsEmail.trim() || root.email, locale: root.locale };
}

/** Email and Telegram; failures are logged, never thrown — an alert must not break the checks. */
export async function notify(key: AlertKey, state: 'open' | 'resolved' | 'test', params: Record<string, string | number>): Promise<void> {
  const recipient = await rootRecipient();
  if (!recipient) return;
  const name = key.replace('.', '_');
  const t = (k: string) => translate(recipient.locale, k, params);
  const title =
    state === 'resolved' ? t('alerts.resolvedPrefix') + t(`alerts.${name}.title`) : state === 'test' ? t('alerts.testTitle') : t(`alerts.${name}.title`);
  const body = state === 'test' ? t('alerts.testBody') : state === 'resolved' ? t('alerts.resolvedBody') : t(`alerts.${name}.body`);
  const link = `${env.appUrl}/root/alerts`;

  await sendEmail({
    to: recipient.email,
    subject: title,
    text: `${body}\n\n${link}`,
    html: `<p>${body}</p><p><a href="${link}">${link}</a></p>`,
    template: 'system-alert',
  }).catch((error) => console.error('[alerts] email failed', error));

  const token = env.alertsTelegramBotToken;
  const chat = env.alertsTelegramChatId.trim();
  if (token && chat) {
    await sendTelegram(token, chat, `${title}\n${body}\n${link}`).catch((error) => console.error('[alerts] telegram failed', error));
  }
}

/** Open or close incidents from check results, telling root once each way. */
export async function applyChecks(results: CheckResult[]): Promise<{ opened: AlertKey[]; resolved: AlertKey[] }> {
  const opened: AlertKey[] = [];
  const resolved: AlertKey[] = [];
  for (const result of results) {
    const open = await prisma.systemAlert.findFirst({ where: { key: result.key, resolvedAt: null } });
    if (result.firing && !open) {
      await prisma.systemAlert.create({ data: { key: result.key, detail: result.params as Prisma.InputJsonValue } });
      await notify(result.key, 'open', result.params);
      opened.push(result.key);
    } else if (!result.firing && open) {
      await prisma.systemAlert.update({ where: { id: open.id }, data: { resolvedAt: new Date() } });
      await notify(result.key, 'resolved', (open.detail ?? {}) as Record<string, string | number>);
      resolved.push(result.key);
    }
  }
  return { opened, resolved };
}

/** Every check the worker can run (all but its own heartbeat). */
export async function runWorkerAlertChecks(now = Date.now()) {
  const results: CheckResult[] = [
    await checkPublishFailures(now),
    ...(await checkAccounts(now)),
    await checkBackups(now),
    checkMetaUsage(now),
  ];
  try {
    results.push(await checkDisk());
  } catch {
    // statfs is not available everywhere (some containers); skip the disk check there.
  }
  return applyChecks(results);
}
