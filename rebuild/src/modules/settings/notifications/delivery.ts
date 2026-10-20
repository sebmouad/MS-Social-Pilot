import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { publicMailOrigin, sendTransactionalMail } from '@/server/mail';
import { PAGES } from '@/lib/product';
import { loadNotificationPolicy, notificationRecipientEligible, recipientAllowsNotification, txLocale, localizedNotificationCopy, type NotificationEvent } from './server';
import type { NotificationEnqueueInput } from './contracts';

type Tx = Prisma.TransactionClient;
export type NotificationDeliveryStats = { examined: number; sent: number; cancelled: number; failed: number; uncertain: number; skipped: number; purged: number };
type Candidate = { id: string; workspaceId: string; userId: string; eventId: string; kind: NotificationEvent; postId: string | null; noteId: string | null; targetId: string | null; labelId: string | null; accountId?: string | null; attempt: number };
type Claim = { candidate: Candidate; token: string; title: string; body: string };

const emptyStats = (): NotificationDeliveryStats => ({ examined: 0, sent: 0, cancelled: 0, failed: 0, uncertain: 0, skipped: 0, purged: 0 });
const unavailable = () => new OperationError('unavailable', 'Notification delivery is temporarily unavailable.');

async function auditDelivery(tx: Tx, candidate: Candidate, state: string) {
  const inserted = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${`notif_delivery_${randomUUID()}`}, ${candidate.workspaceId}, NULL, 'notifications.delivery', ${JSON.stringify({ notificationId: candidate.id, kind: candidate.kind, state, attempt: candidate.attempt })}::jsonb, NOW())`;
  if (inserted !== 1) throw unavailable();
}

async function runtimeBounds() {
  try {
    const policy = await loadNotificationPolicy();
    const workspaceTimeout = await runtimeConfig('data.workspaceOperationTimeoutMs');
    if (typeof workspaceTimeout !== 'number' || policy.transactionTimeoutMs + policy.transactionMaxWaitMs >= workspaceTimeout) throw unavailable();
    return policy;
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

function enqueueInput(row: Candidate): NotificationEnqueueInput {
  return {
    eventId: row.eventId, workspaceId: row.workspaceId, userId: row.userId, kind: row.kind,
    ...(row.accountId ? { accountId: row.accountId } : {}), ...(row.postId ? { postId: row.postId } : {}), ...(row.noteId ? { noteId: row.noteId } : {}),
    ...(row.targetId ? { targetId: row.targetId } : {}), ...(row.labelId ? { labelId: row.labelId } : {}),
  };
}

async function execute<T>(workspaceId: string, policy: Awaited<ReturnType<typeof runtimeBounds>>, fn: (tx: Tx) => Promise<T>) {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(fn, { timeout: policy.transactionTimeoutMs, maxWait: policy.transactionMaxWaitMs }));
}

async function uncertainExpired(now: Date, workspaceId: string | undefined) {
  const filter = workspaceId ?? null;
  return prisma.$executeRaw`WITH changed AS (UPDATE rebuild_notifications SET "emailState" = 'uncertain', "claimToken" = NULL, "claimUntil" = NULL, "nextAt" = NULL, "safeReason" = 'claim_expired', "updatedAt" = NOW() WHERE "emailState" = 'sending' AND "claimUntil" <= ${now} AND (${filter}::text IS NULL OR "workspaceId" = ${filter}) RETURNING id, "workspaceId", kind, attempt)
    INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt")
    SELECT ${`notif_expired_${randomUUID()}_`} || id, "workspaceId", NULL, 'notifications.delivery', jsonb_build_object('notificationId', id, 'kind', kind, 'state', 'uncertain', 'attempt', attempt), NOW() FROM changed`;
}

async function claim(tx: Tx, id: string, now: Date, policy: Awaited<ReturnType<typeof runtimeBounds>>): Promise<{ claim: Claim | null; outcome: 'skipped' | null }> {
  const rows = await tx.$queryRaw<Candidate[]>`SELECT n.id, n."workspaceId", n."userId", n."eventId", n.kind, n."postId", n."noteId", n."targetId", n."labelId", n."accountId", n.attempt
    FROM rebuild_notifications n WHERE n.id = ${id} AND n."emailState" = 'pending' AND n."nextAt" <= ${now} FOR UPDATE OF n`;
  const row = rows[0];
  if (!row) return { claim: null, outcome: 'skipped' };
  const token = randomUUID();
  const claimUntil = new Date(now.getTime() + policy.claimLeaseSeconds * 1000);
  const changed = await tx.$executeRaw`UPDATE rebuild_notifications SET "emailState" = 'sending', attempt = attempt + 1, "lastAttemptAt" = ${now}, "updatedAt" = NOW(), "claimToken" = ${token}, "claimUntil" = ${claimUntil}, "nextAt" = NULL, "safeReason" = NULL WHERE id = ${id} AND "emailState" = 'pending' AND "nextAt" <= ${now}`;
  if (changed !== 1) return { claim: null, outcome: 'skipped' };
  await auditDelivery(tx, { ...row, attempt: row.attempt + 1 }, 'sending');
  const copy = localizedNotificationCopy(policy.eventCopy[row.kind], await txLocale(tx, row.userId));
  return { claim: { candidate: { ...row, attempt: row.attempt + 1 }, token, title: copy.title, body: copy.body }, outcome: null };
}

async function lockEventResources(tx: Tx, row: Candidate) {
  let ids: string[] = [];
  if (row.kind === 'note_mention') {
    const note = await tx.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM posts p JOIN post_notes n ON n."postId" = p.id WHERE p.id = ${row.postId!} AND p."workspaceId" = ${row.workspaceId} AND n.id = ${row.noteId!} AND n."mentionIds" @> ARRAY[${row.userId}]::text[] FOR SHARE OF p, n`;
    if (!note.length) return false;
    const context = await tx.$queryRaw<Array<{ targetId: string }>>`SELECT pt."targetId" FROM posts p JOIN post_targets pt ON pt."postId" = p.id WHERE p.id = ${row.postId!} AND p."workspaceId" = ${row.workspaceId} ORDER BY pt."targetId" FOR SHARE OF p, pt`;
    ids = context.map(item => item.targetId);
  } else if (row.kind === 'mix_dry') {
    const rules = await tx.$queryRaw<Array<{ id: string }>>`SELECT r.id FROM content_mix_rules r JOIN labels l ON l.id = r."labelId" AND l."workspaceId" = r."workspaceId" LEFT JOIN page_group_targets pgt ON pgt."groupId" = r."groupId" AND pgt."targetId" = ${row.targetId!} WHERE r."workspaceId" = ${row.workspaceId} AND (r."targetId" = ${row.targetId!} OR (r."targetId" IS NULL AND r."groupId" IS NOT NULL AND pgt."groupId" IS NOT NULL)) AND (${row.labelId ?? null}::text IS NULL OR r."labelId" = ${row.labelId ?? null}) AND r."dryNotifiedAt" IS NOT NULL FOR SHARE OF r, l`;
    if (!rules.length) return false;
    ids = [row.targetId!];
  }
  if (row.accountId) {
    const account = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM social_accounts WHERE id = ${row.accountId} AND "workspaceId" = ${row.workspaceId} FOR SHARE`;
    if (!account.length) return false;
  }
  if (row.postId && row.kind !== 'note_mention') {
    const posts = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM posts WHERE id = ${row.postId} AND "workspaceId" = ${row.workspaceId} FOR SHARE`;
    if (!posts.length) return false;
    const targets = await tx.$queryRaw<Array<{ targetId: string }>>`SELECT "targetId" FROM post_targets WHERE "postId" = ${row.postId} ORDER BY "targetId" FOR SHARE`;
    ids = targets.map(item => item.targetId);
  } else if (row.targetId && row.kind !== 'mix_dry') ids = [row.targetId];
  if (ids.length) {
    const targets = await tx.$queryRaw<Array<{ id: string; socialAccountId: string | null }>>`SELECT t.id, t."socialAccountId" FROM targets t WHERE t."workspaceId" = ${row.workspaceId} AND t.id = ANY(${ids}::text[]) ORDER BY t.id FOR SHARE OF t`;
    if (targets.length !== new Set(ids).size) return false;
    const accounts = await tx.$queryRaw<Array<{ socialAccountId: string }>>`SELECT DISTINCT t."socialAccountId" FROM targets t WHERE t."workspaceId" = ${row.workspaceId} AND t.id = ANY(${ids}::text[]) AND t."socialAccountId" IS NOT NULL ORDER BY t."socialAccountId"`;
    const accountIds = accounts.map(item => item.socialAccountId);
    if (accountIds.length) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM social_accounts WHERE "workspaceId" = ${row.workspaceId} AND id = ANY(${accountIds}::text[]) ORDER BY id FOR SHARE`;
      if (locked.length !== new Set(accountIds).size) return false;
    }
  }
  return true;
}

async function deliverUnderGuards(claimed: Claim, now: Date, policy: Awaited<ReturnType<typeof runtimeBounds>>, ioStarted: { value: boolean }) {
  const { candidate, token } = claimed;
  return withWorkspaceOperation(candidate.workspaceId, () => prisma.$transaction(async tx => {
    const current = await tx.$queryRaw<Array<{ email: string; emailVerifiedAt: Date | null; disabledAt: Date | null }>>`SELECT u.email, u."emailVerifiedAt", u."disabledAt" FROM rebuild_notifications n JOIN users u ON u.id = n."userId" JOIN memberships m ON m."userId" = u.id AND m."workspaceId" = n."workspaceId" WHERE n.id = ${candidate.id} AND n."workspaceId" = ${candidate.workspaceId} AND n."userId" = ${candidate.userId} AND n."emailState" = 'sending' AND n."claimToken" = ${token} AND n."claimUntil" > clock_timestamp() FOR UPDATE OF n, m, u`;
    const user = current[0];
    if (!user) {
      await tx.$executeRaw`UPDATE rebuild_notifications SET "emailState" = 'uncertain', "claimToken" = NULL, "claimUntil" = NULL, "nextAt" = NULL, "safeReason" = 'claim_expired', "updatedAt" = NOW() WHERE id = ${candidate.id} AND "emailState" = 'sending' AND "claimToken" = ${token} AND "claimUntil" <= clock_timestamp()`;
      return { state: 'uncertain' as const };
    }
    if (!user || user.disabledAt || !user.emailVerifiedAt || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(user.email)) {
      const changed = await tx.$executeRaw`UPDATE rebuild_notifications SET "emailState" = 'cancelled', "claimToken" = NULL, "claimUntil" = NULL, "nextAt" = NULL, "safeReason" = 'recipient_unavailable', "updatedAt" = NOW() WHERE id = ${candidate.id} AND "claimToken" = ${token}`;
      if (changed === 1) await auditDelivery(tx, candidate, 'cancelled');
      return { state: changed === 1 ? 'cancelled' : 'uncertain' as const };
    }
    if (!await lockEventResources(tx, candidate)) {
      const changed = await tx.$executeRaw`UPDATE rebuild_notifications SET "emailState" = 'cancelled', "claimToken" = NULL, "claimUntil" = NULL, "nextAt" = NULL, "safeReason" = 'resource_unavailable', "updatedAt" = NOW() WHERE id = ${candidate.id} AND "claimToken" = ${token}`;
      if (changed === 1) await auditDelivery(tx, candidate, 'cancelled');
      return { state: changed === 1 ? 'cancelled' : 'uncertain' as const };
    }
    let eligible = false;
    try { eligible = await notificationRecipientEligible(tx, enqueueInput(candidate)) && await recipientAllowsNotification(tx, enqueueInput(candidate)); }
    catch (error) {
      if (!(error instanceof OperationError && ['unauthorized', 'forbidden', 'not_found'].includes(error.code))) throw error;
    }
    if (!eligible) {
      const changed = await tx.$executeRaw`UPDATE rebuild_notifications SET "emailState" = 'cancelled', "claimToken" = NULL, "claimUntil" = NULL, "nextAt" = NULL, "safeReason" = 'authorization_changed', "updatedAt" = NOW() WHERE id = ${candidate.id} AND "claimToken" = ${token}`;
      if (changed === 1) await auditDelivery(tx, candidate, 'cancelled');
      return { state: changed === 1 ? 'cancelled' : 'uncertain' as const };
    }
    const origin = await publicMailOrigin();
    if (!origin) throw unavailable();
    const centerPath = PAGES.find(page => page.id === 'settings/notifications')?.href;
    if (!centerPath) throw unavailable();
    const centerUrl = new URL(centerPath, origin).toString();
    const centerLabel = await txLocale(tx, candidate.userId) === 'fr' ? 'Ouvrir votre centre de notifications' : 'Open your notification center';
    ioStarted.value = true;
    let mail: Awaited<ReturnType<typeof sendTransactionalMail>>;
    try {
      mail = await sendTransactionalMail({ to: user.email, subject: claimed.title, text: `${claimed.body}\n\n${centerLabel}: ${centerUrl}`, template: `notification_${candidate.kind}`, workspaceId: candidate.workspaceId });
    } catch { mail = { status: 'uncertain' }; }
    const result = mail.status === 'sent' ? 'sent' : mail.status === 'failed' ? 'failed' : mail.status === 'uncertain' ? 'uncertain' : 'retry';
    const state = result === 'retry' && candidate.attempt >= policy.maxAttempts ? 'failed' : result === 'retry' ? 'pending' : result;
    const nextAt = state === 'pending' ? new Date(now.getTime() + policy.retryDelaySeconds * 1000) : null;
    const reason = result === 'retry' ? 'mail_unavailable' : result === 'failed' ? 'mail_failed' : result === 'uncertain' ? 'mail_uncertain' : null;
    const changed = await tx.$executeRaw`UPDATE rebuild_notifications SET "emailState" = ${state}, "claimToken" = NULL, "claimUntil" = NULL, "nextAt" = ${nextAt}, "safeReason" = ${reason}, "emailSentAt" = CASE WHEN ${state} = 'sent' THEN NOW() ELSE NULL END, "updatedAt" = NOW() WHERE id = ${candidate.id} AND "workspaceId" = ${candidate.workspaceId} AND "userId" = ${candidate.userId} AND "emailState" = 'sending' AND "claimToken" = ${token}`;
    if (changed === 1) await auditDelivery(tx, candidate, state);
    return { state: changed === 1 ? state : 'uncertain' };
  }, { timeout: policy.deliveryOperationTimeoutMs, maxWait: policy.deliveryOperationMaxWaitMs }));
}

async function retryBeforeIo(claimed: Claim, now: Date, policy: Awaited<ReturnType<typeof runtimeBounds>>) {
  const candidate = claimed.candidate;
  const state = candidate.attempt >= policy.maxAttempts ? 'failed' : 'pending';
  const nextAt = state === 'pending' ? new Date(now.getTime() + policy.retryDelaySeconds * 1000) : null;
  return execute(candidate.workspaceId, policy, async tx => {
  const changed = await tx.$executeRaw`UPDATE rebuild_notifications SET "emailState" = ${state}, "claimToken" = NULL, "claimUntil" = NULL, "nextAt" = ${nextAt}, "safeReason" = 'preflight_unavailable', "emailSentAt" = NULL, "updatedAt" = NOW() WHERE id = ${candidate.id} AND "workspaceId" = ${candidate.workspaceId} AND "emailState" = 'sending' AND "claimToken" = ${claimed.token}`;
  if (changed === 1) await auditDelivery(tx, candidate, state);
  return changed === 1 ? state : 'uncertain';
  });
}

/** Deliver only currently eligible, verified recipients. Ambiguous SMTP results and expired leases are never retried automatically. */
export async function deliverNotifications(now: Date = new Date(), workspaceId?: string): Promise<NotificationDeliveryStats> {
  const policy = await runtimeBounds();
  const stats = emptyStats();
  stats.uncertain += await uncertainExpired(now, workspaceId);
  const workspace = workspaceId ?? null;
  const ids = await prisma.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT n.id, n."workspaceId" FROM rebuild_notifications n JOIN workspaces w ON w.id = n."workspaceId" WHERE n."emailState" = 'pending' AND n."nextAt" <= ${now} AND w."suspendedAt" IS NULL AND (${workspace}::text IS NULL OR n."workspaceId" = ${workspace}) ORDER BY n."nextAt", n."createdAt", n.id LIMIT ${policy.deliveryBatchSize}`;
  for (const item of ids) {
    stats.examined += 1;
    let claimed: Claim | null = null;
    try {
      const outcome = await execute(item.workspaceId, policy, tx => claim(tx, item.id, now, policy));
      claimed = outcome.claim;
      if (!claimed) { stats.skipped += 1; continue; }
    } catch {
      try {
        const deferred = await prisma.$executeRaw`UPDATE rebuild_notifications SET "nextAt" = ${new Date(now.getTime() + policy.retryDelaySeconds * 1000)}, "safeReason" = 'preflight_unavailable' WHERE id = ${item.id} AND "workspaceId" = ${item.workspaceId} AND "emailState" = 'pending' AND "nextAt" <= ${now}`;
        if (deferred !== 1) stats.skipped += 1;
      } catch { stats.skipped += 1; }
      continue;
    }
    const ioStarted = { value: false };
    let state: string;
    try {
      const finished = await deliverUnderGuards(claimed, now, policy, ioStarted);
      state = finished.state;
    } catch {
      if (ioStarted.value) state = 'uncertain';
      else {
        try { state = await retryBeforeIo(claimed, now, policy); }
        catch { state = 'uncertain'; }
      }
    }
    if (state === 'sent') stats.sent += 1;
    else if (state === 'cancelled') stats.cancelled += 1;
    else if (state === 'failed') stats.failed += 1;
    else if (state === 'uncertain') stats.uncertain += 1;
    else stats.skipped += 1;
  }
  const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);
  const purgeWorkspace = workspaceId ?? null;
  stats.purged = Number(await prisma.$executeRaw`WITH deleted AS (DELETE FROM rebuild_notifications WHERE id IN (SELECT id FROM rebuild_notifications WHERE "createdAt" < ${cutoff} AND "emailState" IN ('sent', 'failed', 'cancelled') AND (${purgeWorkspace}::text IS NULL OR "workspaceId" = ${purgeWorkspace}) ORDER BY "createdAt" ASC, id ASC LIMIT ${policy.deliveryBatchSize}) RETURNING id, "workspaceId", kind, attempt)
    INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt")
    SELECT ${`notif_retention_${randomUUID()}_`} || id, "workspaceId", NULL, 'notifications.retention', jsonb_build_object('notificationId', id, 'kind', kind, 'attempt', attempt), NOW() FROM deleted`);
  return stats;
}
