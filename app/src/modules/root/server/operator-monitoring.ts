import { WORKER_PREFIX } from '@/server/jobs/identity';
import { randomUUID } from 'node:crypto';
import { sendTransactionalMail } from '@/server/mail';
import { mailCopySchema } from '../config';
import { enqueueOperatorIncident } from '@/modules/notifications/chat-channels/server/delivery';
import { statfs } from 'node:fs/promises';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { monitoringPolicySchema } from '../config';
import { assertRootActor, lockRootActor } from '@/modules/root/server/admin/authz';
import { rootResultLimit, rootTransaction } from '@/modules/root/server/admin/policy';
import { writeRootAudit } from '@/modules/root/server/admin/audit';
import { OperationError } from '@/lib/operation-error';

export const MONITORING_TEST_CONFIRMATION = 'TEST ROOT MONITORING';
export const MONITORING_CONFIRMATION = 'EVALUATE ROOT MONITORING';
type Check = { key: string; firing: boolean; detail: Record<string, number | string> };
const policyFor = async () => monitoringPolicySchema.parse(await runtimeConfig('root.monitoringPolicy'));

/** Worker and manual callers share the same measurements and atomic incident transitions. */
export async function runOperatorMonitoring(now: Date = new Date(), actorId?: string) {
  const policy = await policyFor();
  const [heartbeat, failures, accounts, backups, offsiteAge] = await Promise.all([
    prisma.$queryRaw<Array<{ seenAt: Date }>>`SELECT "seenAt" FROM worker_heartbeats WHERE LEFT("workerId", ${WORKER_PREFIX.length}::int) = ${WORKER_PREFIX} ORDER BY "seenAt" DESC LIMIT 1`,
    prisma.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM post_targets WHERE status = 'failed' AND "updatedAt" >= ${new Date(now.getTime() - policy.publishFailureWindowSeconds * 1000)}`,
    prisma.$queryRaw<Array<{ disconnected: number; expiring: number }>>`SELECT COUNT(*) FILTER (WHERE "invalidatedAt" IS NOT NULL)::int AS disconnected, COUNT(*) FILTER (WHERE "invalidatedAt" IS NULL AND "tokenExpiresAt" > ${now} AND "tokenExpiresAt" <= ${new Date(now.getTime() + policy.tokenExpiryWarningDays * 86400000)})::int AS expiring FROM social_accounts`,
    prisma.$queryRaw<Array<{ status: string; lastOk: Date | null }>>`SELECT status, (SELECT MAX("finishedAt") FROM backup_runs WHERE kind = 'offsite' AND status = 'ok') AS "lastOk" FROM backup_runs ORDER BY "finishedAt" DESC LIMIT 1`,
    runtimeConfig('root.admin.offsiteBackupMaxAgeHours'),
  ]);
  const worker = Boolean(heartbeat[0] && heartbeat[0].seenAt <= now && now.getTime() - heartbeat[0].seenAt.getTime() <= policy.workerStaleSeconds * 1000);
  const checks: Check[] = [
    { key: 'worker.down', firing: !worker, detail: { staleSeconds: policy.workerStaleSeconds } },
    { key: 'publish.failures', firing: (failures[0]?.count ?? 0) >= policy.publishFailureThreshold, detail: { count: failures[0]?.count ?? 0 } },
    { key: 'accounts.disconnected', firing: (accounts[0]?.disconnected ?? 0) > 0, detail: { count: accounts[0]?.disconnected ?? 0 } },
    { key: 'accounts.expiring', firing: (accounts[0]?.expiring ?? 0) > 0, detail: { count: accounts[0]?.expiring ?? 0 } },
    { key: 'backup.failed', firing: Boolean(backups[0] && (backups[0].status !== 'ok' || !backups[0].lastOk || now.getTime() - backups[0].lastOk.getTime() > Number(offsiteAge) * 3600000)), detail: {} },
  ];
  // An unsupported disk probe is unknown and must not resolve an existing incident.
  try { const disk = await statfs(policy.diskPath); if (disk.blocks > 0) { const percent = Math.round((disk.blocks - disk.bavail) / disk.blocks * 100); checks.push({ key: 'disk.full', firing: percent >= policy.diskUsedPercent, detail: { percent } }); } } catch { /* Unknown measurement is omitted. */ }
  let app = false;
  try { const response = await fetch(policy.healthUrl, { signal: AbortSignal.timeout(policy.healthTimeoutMs), redirect: 'error', cache: 'no-store' }); app = response.ok && (await response.json()).status === 'ok'; } catch { /* Failed probe is not an observed uptime minute. */ }
  const result = await rootTransaction(async tx => {
    if (actorId) await lockRootActor(tx, actorId);
    // Persistence namespace ensures manual and leased worker runs cannot duplicate transitions.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('rebuild:operator-monitoring'))::text`;
    const opened: string[] = [], resolved: string[] = [];
    for (const check of checks) {
      const existing = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM system_alerts WHERE key = ${check.key} AND "resolvedAt" IS NULL FOR UPDATE`;
      if (check.firing && !existing.length) {
        await tx.$executeRaw`INSERT INTO system_alerts (id, key, detail, "openedAt") VALUES (${randomUUID()}, ${check.key}, ${JSON.stringify(check.detail)}::jsonb, ${now})`;
        const eventId = randomUUID();
        await tx.$executeRaw`INSERT INTO monitoring_deliveries (id, key, state, status) VALUES (${eventId}, ${check.key}, 'open', 'pending')`;
        await enqueueOperatorIncident(tx, { eventId, state: 'open', workspaceId: policy.chatWorkspaceId });
        opened.push(check.key);
      } else if (!check.firing && existing.length) {
        await tx.$executeRaw`UPDATE system_alerts SET "resolvedAt" = ${now} WHERE key = ${check.key} AND "resolvedAt" IS NULL`;
        const eventId = randomUUID();
        await tx.$executeRaw`INSERT INTO monitoring_deliveries (id, key, state, status) VALUES (${eventId}, ${check.key}, 'resolved', 'pending')`;
        await enqueueOperatorIncident(tx, { eventId, state: 'resolved', workspaceId: policy.chatWorkspaceId });
        resolved.push(check.key);
      }
    }
    // Unique minute claims make retries and manual/job overlap idempotent.
    const minute = new Date(Math.floor(now.getTime() / 60000) * 60000);
    const day = minute.toISOString().slice(0, 10);
    for (const component of [...(app ? ['app'] : []), ...(worker ? ['worker'] : [])]) {
      await tx.$executeRaw`WITH claimed AS (INSERT INTO uptime_samples (minute, component) VALUES (${minute}, ${component}) ON CONFLICT DO NOTHING RETURNING component) INSERT INTO uptime_days (day, component, minutes) SELECT ${day}, component, 1 FROM claimed ON CONFLICT (day, component) DO UPDATE SET minutes = LEAST(uptime_days.minutes + 1, 1440)`;
    }
    await tx.$executeRaw`DELETE FROM uptime_samples WHERE minute < ${new Date(now.getTime() - policy.historyDays * 86400000)}`;
    if (actorId) await writeRootAudit(tx, actorId, 'root.monitoring_evaluated', { opened, resolved, app, worker });
    return { opened, resolved, checks, uptime: { app, worker } };
  });
  await deliverMonitoringAlerts(policy);
  return result;
}

export async function runRootOperatorMonitoring(actorId: string, confirmation: unknown) {
  await assertRootActor(prisma, actorId);
  if (confirmation !== MONITORING_CONFIRMATION) throw new OperationError('invalid_request', 'Enter the exact monitoring confirmation.');
  const [{ createWorker }, { createWorkerDependencies }] = await Promise.all([
    import('@/server/jobs/worker'), import('@/server/jobs/runtime'),
  ]);
  let result: Awaited<ReturnType<typeof runOperatorMonitoring>> | undefined;
  let failure: unknown;
  const dependencies = createWorkerDependencies(() => undefined);
  dependencies.execute = async (_job, now) => {
    try {
      result = await runOperatorMonitoring(now, actorId);
      return `opened=${result.opened.length} resolved=${result.resolved.length} checks=${result.checks.length}`;
    } catch (error) { failure = error; throw error; }
  };
  const runner = createWorker(dependencies, `monitoring-manual-${randomUUID()}`, { jobs: ['operatorMonitoring'], heartbeat: false });
  const executed = await runner.runNow('operatorMonitoring');
  if (failure) throw failure;
  if (!executed || !result) throw new OperationError('conflict', 'Monitoring is already running. Refresh its results before trying again.');
  return result;
}

export async function readRootOperatorMonitoring(actorId: string, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const policy = await policyFor();
  const limit = rootResultLimit(policy.alertLimit, resultCap);
  const firstDay = new Date(Date.now() - (policy.historyDays - 1) * 86400000).toISOString().slice(0, 10);
  const [alerts, uptime, deliveries, incidentHistory] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; key: string; openedAt: Date }>>`SELECT id, key, "openedAt" FROM system_alerts WHERE "resolvedAt" IS NULL ORDER BY "openedAt" DESC, id LIMIT ${limit}`,
    prisma.$queryRaw<Array<{ day: string; component: string; minutes: number }>>`SELECT day, component, minutes FROM uptime_days WHERE day >= ${firstDay} AND component IN ('app', 'worker') ORDER BY day, component LIMIT ${Math.min(policy.historyDays * 2, resultCap ?? policy.historyDays * 2)}`,
    prisma.$queryRaw<Array<{ id: string; key: string; state: string; status: string; createdAt: Date; finishedAt: Date | null }>>`SELECT id, key, state, status, "createdAt", "finishedAt" FROM monitoring_deliveries ORDER BY "createdAt" DESC, id LIMIT ${limit}`,
    prisma.$queryRaw<Array<{ id: string; key: string; openedAt: Date; resolvedAt: Date | null }>>`SELECT id, key, "openedAt", "resolvedAt" FROM system_alerts ORDER BY "openedAt" DESC, id LIMIT ${limit}`,
  ]);
  return { incidentHistory: incidentHistory.map(row => ({ ...row, openedAt: row.openedAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })), alerts: alerts.map(row => ({ ...row, openedAt: row.openedAt.toISOString() })), uptime, deliveries: deliveries.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null })), policy, confirmation: MONITORING_CONFIRMATION, testConfirmation: MONITORING_TEST_CONFIRMATION };
}

/** Exact consent creates one durable intent shared by email and chat delivery.
 * The worker drains pending mail; uncertain sends remain held for review.
 */
export async function testRootOperatorMonitoring(actorId: string, confirmation: unknown) {
  await assertRootActor(prisma, actorId);
  if (confirmation !== MONITORING_TEST_CONFIRMATION) throw new OperationError('invalid_request', 'Enter the exact monitoring test confirmation.');
  const policy = await policyFor();
  const id = randomUUID();
  await rootTransaction(async tx => {
    await lockRootActor(tx, actorId);
    await tx.$executeRaw`INSERT INTO monitoring_deliveries (id, key, state, status) VALUES (${id}, ${'monitoring.test'}, 'open', 'pending')`;
    await enqueueOperatorIncident(tx, { eventId: id, state: 'test', workspaceId: policy.chatWorkspaceId });
    await writeRootAudit(tx, actorId, 'root.monitoring_test_queued', { id });
  });
  return { id, queued: true as const };
}

/** Claims are committed before transport. Uncertain sends are never automatically replayed. */
async function deliverMonitoringAlerts(policy: Awaited<ReturnType<typeof policyFor>>) {
  const copy = mailCopySchema.parse(await runtimeConfig('root.monitoringMailCopy'));
  const rows = await rootTransaction(async tx => {
    await tx.$executeRaw`UPDATE monitoring_deliveries SET status = 'uncertain' WHERE status = 'sending' AND "claimedAt" < NOW() - ${policy.deliveryLeaseSeconds} * INTERVAL '1 second'`;
    return tx.$queryRaw<Array<{ id: string; key: string; state: 'open' | 'resolved' }>>`WITH candidates AS (SELECT id FROM monitoring_deliveries WHERE status = 'pending' ORDER BY "createdAt", id LIMIT ${policy.deliveryBatchSize} FOR UPDATE SKIP LOCKED) UPDATE monitoring_deliveries d SET status = 'sending', "claimedAt" = NOW() FROM candidates c WHERE d.id = c.id RETURNING d.id, d.key, d.state`;
  });
  const recipients = await prisma.$queryRaw<Array<{ email: string; locale: string }>>`SELECT email, locale FROM users WHERE "isInstanceOwner" = true AND "disabledAt" IS NULL ORDER BY id LIMIT 1`;
  for (const row of rows) {
    let status = 'unavailable';
    if (recipients[0]) {
      const recipient = recipients[0]; const text = copy[recipient.locale === 'fr' ? 'fr' : 'en'];
      try { status = (await sendTransactionalMail({ to: recipient.email, subject: row.key === 'monitoring.test' ? text.test : text[row.state], text: text.body.replace('{key}', row.key), template: 'system-alert' })).status; } catch { status = 'uncertain'; }
    }
    await prisma.$executeRaw`UPDATE monitoring_deliveries SET status = ${status}, "finishedAt" = NOW() WHERE id = ${row.id} AND status = 'sending'`;
  }
}
