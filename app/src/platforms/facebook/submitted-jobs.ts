import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { configuredFacebookAdapter } from '@/platforms/facebook/runtime';
import { runtimeConfig } from '@/server/config/store';
import { withRetries } from '@/server/jobs/retry';
import type { RetryBackoff } from '@/server/jobs/retry';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { lockPublishingTargets } from '@/modules/publishing/server/guard';
import { assertNoPostDeletionForRemoteIdentity } from '@/modules/publishing/server/post-deletion-guard';
import { reconcileSubmittedPublicationInTransaction } from '@/modules/publishing/server/publication';
import type { JobSummary } from '@/server/jobs/types';
import { OperationError } from '@/lib/operation-error';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { withSelectedResourceOperation } from '@/server/platforms/resource-lock';
import { readPublishingCredential } from '@/modules/publishing/server/credentials';
import { withPublishingTransaction } from '@/modules/publishing/server/guard';

type Candidate = {
  id: string; workspaceId: string; postId: string; postTargetId: string; targetId: string;
  provider: string; remoteId: string; remoteTargetId: string; updatedAt: Date; media: unknown; formatId: string | null;
};
type Cursor = { updatedAt: string; id: string };
const empty = (): JobSummary => ({ examined: 0, updated: 0, skipped: 0, failed: 0 });
const requiredScopes = async () => (await runtimeConfig('meta.postReadScopes') as string[]).map(value => value.trim()).filter(Boolean);
const cursorKey = 'meta.submittedStatusCursor';

export function encodeSubmittedStatusCursor(row: Pick<Candidate, 'updatedAt' | 'id'>): string {
  if (typeof row.id !== 'string' || !row.id || row.id.length > 2048 || /[\u0000-\u001f\u007f]/.test(row.id)) throw new Error('Invalid submitted-status cursor identity.');
  const value = JSON.stringify([row.updatedAt.toISOString(), row.id]);
  if (value.length > 4096) throw new Error('Submitted-status cursor exceeds its configured limit.');
  return value;
}
export function decodeSubmittedStatusCursor(value: unknown): Cursor | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string' ||
    parsed[1].length < 1 || parsed[1].length > 2048 || /[\u0000-\u001f\u007f]/.test(parsed[1])) return null;
  const time = new Date(parsed[0]);
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== parsed[0]) return null;
  return { updatedAt: parsed[0], id: parsed[1] };
}
export function submittedContentKind(media: unknown): 'text' | 'image' | 'video' {
  if (!Array.isArray(media)) return 'text';
  if (media.some(item => item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'video')) return 'video';
  if (media.some(item => item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'image')) return 'image';
  return 'text';
}

async function candidates(take: number): Promise<Candidate[]> {
  const setting = await prisma.appSetting.findUnique({ where: { key: cursorKey }, select: { value: true } });
  const cursor = decodeSubmittedStatusCursor(setting?.value);
  const after = async (position: Cursor | null, limit: number) => prisma.$queryRaw<Candidate[]>`
    SELECT a.id, a."workspaceId", a."postId", a."postTargetId", a."targetId", a.provider,
      a."remotePostId" AS "remoteId", t."providerId" AS "remoteTargetId", a."updatedAt", p.media,
      COALESCE(pt."formatId",p.format) AS "formatId"
    FROM publication_attempts a
    JOIN posts p ON p.id=a."postId" AND p."workspaceId"=a."workspaceId"
    JOIN post_targets pt ON pt.id=a."postTargetId" AND pt."postId"=p.id AND pt."targetId"=a."targetId"
    JOIN targets t ON t.id=a."targetId" AND t."workspaceId"=a."workspaceId"
    JOIN social_accounts sa ON sa.id=t."socialAccountId" AND sa."workspaceId"=a."workspaceId"
    WHERE a.state='submitted' AND a."remotePostId" IS NOT NULL AND a.provider='facebook'
      AND pt.status='processing' AND pt."remotePostId" IS NULL AND t.enabled=true AND t.type::text='page'
      AND sa.provider='facebook' AND sa."invalidatedAt" IS NULL
      AND (${position?.updatedAt ?? null}::timestamp IS NULL OR (a."updatedAt",a.id) > (${position?.updatedAt ?? null}::timestamp,${position?.id ?? null}::text))
    ORDER BY a."updatedAt" ASC,a.id ASC LIMIT ${limit}`;
  let rows = await after(cursor, take);
  if (cursor && rows.length < take) rows = rows.concat(await after(null, take - rows.length));
  rows = [...new Map(rows.map(row => [row.id, row])).values()].slice(0, take);
  if (rows.length) {
    const next = encodeSubmittedStatusCursor(rows[rows.length - 1]);
    await prisma.appSetting.upsert({ where: { key: cursorKey }, create: { key: cursorKey, value: next, encrypted: false, updatedAt: new Date() }, update: { value: next, encrypted: false, updatedAt: new Date() } });
  }
  return rows;
}

/** Read-only provider status checks for durable Facebook submission identities. */
export async function syncFacebookSubmittedPosts(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  if (await runtimeConfig('platforms.facebook.enabled') !== true) return empty();
  const limit = await runtimeConfig('sync.maxItemsPerJob') as number;
  const rows = await candidates(limit);
  const result: JobSummary = { ...empty(), examined: rows.length };
  for (const row of rows) {
    try {
      const verified = await withWorkspaceOperation(row.workspaceId, async () => withSelectedResourceOperation(row.workspaceId, { kind: 'target', id: row.targetId }, async (tx, signal) => {
        const key = JSON.stringify(['publishing-post', row.workspaceId, row.postId]);
        const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key},0)) AS acquired`;
        if (lock[0]?.acquired !== true) return false;
        await lockPublishingTargets(tx, row.workspaceId, [row.targetId]);
        await assertNoPostDeletionForRemoteIdentity(tx, row.workspaceId, row.targetId, row.remoteId);
        const freshBinding = async () => {
          await assertWorkspaceJobAccess(row.workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] });
          if (await runtimeConfig('platforms.facebook.enabled') !== true) throw new OperationError('forbidden', 'Facebook jobs are disabled.');
          const scopes = await requiredScopes();
          const binding = await prisma.$queryRaw<Array<{ remotePostId: string; targetWorkspaceId: string; providerId: string; enabled: boolean; targetToken: string | null; accountId: string; accountWorkspaceId: string; accountToken: string; scopes: string; tokenExpiresAt: Date | null; invalidatedAt: Date | null; formatId: string | null; media: unknown }>>`
            SELECT a."remotePostId",t."workspaceId" AS "targetWorkspaceId",t."providerId",t.enabled,t."accessToken" AS "targetToken",
              sa.id AS "accountId",sa."workspaceId" AS "accountWorkspaceId",sa."accessToken" AS "accountToken",sa.scopes,sa."tokenExpiresAt",sa."invalidatedAt",COALESCE(pt."formatId",p.format) AS "formatId",p.media
            FROM publication_attempts a JOIN post_targets pt ON pt.id=a."postTargetId" AND pt."postId"=a."postId" AND pt."targetId"=a."targetId"
            JOIN posts p ON p.id=a."postId" AND p."workspaceId"=a."workspaceId"
            JOIN targets t ON t.id=a."targetId" AND t."workspaceId"=a."workspaceId"
            JOIN social_accounts sa ON sa.id=t."socialAccountId" AND sa."workspaceId"=a."workspaceId"
            WHERE a.id=${row.id} AND a."workspaceId"=${row.workspaceId} AND a."postId"=${row.postId} AND a."postTargetId"=${row.postTargetId}
              AND a."targetId"=${row.targetId} AND a.provider='facebook' AND a.state='submitted' AND a."remotePostId"=${row.remoteId}
              AND pt.status='processing' AND pt."remotePostId" IS NULL AND t.type::text='page' AND t.enabled=true AND t."providerId"=${row.remoteTargetId}
              AND sa.provider='facebook' AND sa."invalidatedAt" IS NULL`;
          const current = binding[0];
          const nowAt = new Date(Math.max(now.getTime(), Date.now()));
          if (!current || current.remotePostId !== row.remoteId || current.targetWorkspaceId !== row.workspaceId || current.accountWorkspaceId !== row.workspaceId || current.invalidatedAt || (current.tokenExpiresAt && current.tokenExpiresAt <= nowAt) || !scopes.length || !scopes.every(scope => current.scopes.split(/[\s,]+/).filter(Boolean).includes(scope)) || !current.targetToken) throw new OperationError('forbidden', 'Facebook job access is no longer available.');
          const adapter = await configuredFacebookAdapter();
          const credentialTarget = { accessToken: current.targetToken, socialAccount: { workspaceId: current.accountWorkspaceId, accessToken: current.accountToken, scopes: current.scopes, tokenExpiresAt: current.tokenExpiresAt, invalidatedAt: current.invalidatedAt } };
          const credential = readPublishingCredential(credentialTarget, adapter, 'remoteStatus', nowAt);
          if (!credential || !adapter.getRemoteStatus || !adapter.statusPolicyFingerprint) throw new OperationError('forbidden', 'Facebook status reads are unavailable.');
          return { adapter, credential, target: { id: row.remoteTargetId, name: '', kind: 'page' }, fingerprint: adapter.statusPolicyFingerprint,
            formatId: current.formatId, contentKind: submittedContentKind(current.media),
            bindingFingerprint: JSON.stringify({ formatId: current.formatId, contentKind: submittedContentKind(current.media), accountId: current.accountId, accountWorkspaceId: current.accountWorkspaceId, providerId: current.providerId,
              targetWorkspaceId: current.targetWorkspaceId, enabled: current.enabled, scopes: current.scopes, tokenExpiresAt: current.tokenExpiresAt?.toISOString() ?? null,
              invalidatedAt: null }) };
        };
        const before = await withPublishingTransaction(signal, async configTx => {
          await configTx.$executeRaw`LOCK TABLE app_settings IN SHARE MODE`;
          return freshBinding();
        });
        signal.throwIfAborted();
        const status = await withRetries(() => before.adapter.getRemoteStatus!({ credential: before.credential, target: before.target, remoteId: row.remoteId, formatId: before.formatId ?? undefined, contentKind: before.contentKind, signal }), retryLimit, retryBackoff);
        signal.throwIfAborted();
        await tx.$executeRaw`LOCK TABLE app_settings IN SHARE MODE`;
        await tx.$queryRaw`SELECT t.id FROM targets t JOIN social_accounts s ON s.id=t."socialAccountId" WHERE t.id=${row.targetId} AND t."workspaceId"=${row.workspaceId} AND s."workspaceId"=${row.workspaceId} FOR SHARE OF t,s`;
        await tx.$executeRaw`LOCK TABLE memberships IN SHARE MODE`;
        await tx.$queryRaw`SELECT m.id FROM memberships m JOIN users u ON u.id=m."userId" WHERE m."workspaceId"=${row.workspaceId} AND m.role::text='owner' AND u."disabledAt" IS NULL ORDER BY m.id FOR SHARE OF m,u`;
        const after = await freshBinding();
        if (before.fingerprint !== after.fingerprint || before.bindingFingerprint !== after.bindingFingerprint || before.credential.accessToken !== after.credential.accessToken ||
          JSON.stringify(before.credential.grantedScopes ?? []) !== JSON.stringify(after.credential.grantedScopes ?? []) ||
          status.state !== 'published' || status.remoteId !== row.remoteId || status.targetId !== row.remoteTargetId) return false;
        await assertWorkspaceJobAccess(row.workspaceId, { provider: 'facebook', anyFeatureOf: ['publishing/posts'] });
        signal.throwIfAborted();
        return reconcileSubmittedPublicationInTransaction(tx, { workspaceId: row.workspaceId, userId: null }, { operationId: row.id, postId: row.postId, postTargetId: row.postTargetId, targetId: row.targetId, provider: 'facebook', remoteId: row.remoteId, remoteTargetId: row.remoteTargetId }, status);
      }));
      if (verified) result.updated++; else result.skipped++;
    } catch (error) { if (error instanceof OperationError && ['forbidden', 'not_found', 'conflict'].includes(error.code)) result.skipped++; else result.failed++; }
  }
  return result;
}
