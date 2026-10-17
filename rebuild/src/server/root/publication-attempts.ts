import { z } from 'zod';
import type { Prisma } from '../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { adoptLegacyPublicationInTransaction, projectPublicationInTransaction, recordPublicationOutcomeInTransaction } from '@/modules/publishing/server/publication';
import { requireActiveRoot } from './operations';
import { withRootPublicationOperation } from './publication-operation';

type Attempt = { id: string; workspaceId: string; postId: string; postTargetId: string; targetId: string; provider: string; state: string; reason: string | null; remotePostId: string | null; remoteUrl: string | null; createdAt: Date; updatedAt: Date; workspaceName: string | null; targetName: string | null };
const inputSchema = z.object({ operationId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), outcome: z.enum(['PUBLISHED', 'ABSENT']), remotePostId: z.string().optional(), remoteUrl: z.string().optional(), verifiedExternally: z.literal(true), confirmation: z.string() }).strict();

/** Bounded content-free Root view of durable publication attempts. */
export async function listRootPublicationAttempts(userId: string, cap?: number) {
  await requireActiveRoot(userId);
  if (cap !== undefined && (!Number.isSafeInteger(cap) || cap < 1)) throw new OperationError('invalid_request', 'Choose a valid Publishing recovery result limit.');
  const [limit, timeZone] = await Promise.all([runtimeConfig('publishing.publicationHistoryLimit'), runtimeConfig('root.operationalTimezone')]);
  const rows = await prisma.$queryRaw<Attempt[]>`
    SELECT a.id, a."workspaceId", a."postId", a."postTargetId", a."targetId", a.provider, a.state, a.reason,
      a."remotePostId", a."remoteUrl", a."createdAt", a."updatedAt", w.name AS "workspaceName", t.name AS "targetName"
    FROM rebuild_publication_attempts a
    LEFT JOIN workspaces w ON w.id = a."workspaceId"
    LEFT JOIN targets t ON t.id = a."targetId" AND t."workspaceId" = a."workspaceId"
    ORDER BY a."updatedAt" DESC, a.id DESC LIMIT ${Math.min(limit, cap ?? limit)}
  `;
  const legacyProcessing = await prisma.$queryRaw<Array<{ workspaceId: string; workspaceName: string | null; postId: string; postTargetId: string; targetId: string; targetName: string | null; provider: string }>>`
    SELECT p."workspaceId", w.name AS "workspaceName", pt."postId", pt.id AS "postTargetId", pt."targetId", t.name AS "targetName", sa.provider
    FROM post_targets pt JOIN posts p ON p.id=pt."postId" JOIN targets t ON t.id=pt."targetId" AND t."workspaceId"=p."workspaceId"
    JOIN social_accounts sa ON sa.id=t."socialAccountId"
    LEFT JOIN workspaces w ON w.id=p."workspaceId"
    WHERE pt.status='processing' AND pt."remotePostId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM rebuild_publication_attempts a WHERE a."workspaceId"=p."workspaceId" AND a."postTargetId"=pt.id AND a.state NOT IN ('rejected','attested_absent'))
    ORDER BY pt."updatedAt" DESC, pt.id DESC LIMIT ${Math.min(limit, cap ?? limit) + 1}
  `;
  return { timeZone, items: rows.map(row => ({ operationId: row.id, workspaceId: row.workspaceId, workspaceName: row.workspaceName ?? row.workspaceId, postId: row.postId, postTargetId: row.postTargetId, targetId: row.targetId, targetName: row.targetName, provider: row.provider, state: row.state, reason: row.reason, remotePostId: row.remotePostId, remoteUrl: row.remoteUrl, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })), legacyProcessing: legacyProcessing.slice(0, Math.min(limit, cap ?? limit)).map(row => ({ ...row, workspaceName: row.workspaceName ?? row.workspaceId })), legacyTruncated: legacyProcessing.length > Math.min(limit, cap ?? limit) };
}

/** Root attestation records only a verified human outcome; no provider call is made. */
export async function recordRootPublicationOutcome(userId: string, input: unknown) {
  await requireActiveRoot(userId);
  const parsed = inputSchema.safeParse(input);
  const expected = parsed.success ? `ROOT RECORD PUBLICATION ${parsed.data.operationId} ${parsed.data.outcome}` : '';
  if (!parsed.success || parsed.data.confirmation !== expected || parsed.data.outcome === 'ABSENT' && (parsed.data.remotePostId !== undefined || parsed.data.remoteUrl !== undefined)) throw new OperationError('invalid_request', 'Verify the current destination result and enter its exact confirmation.');
  if (parsed.data.remoteUrl !== undefined) {
    let url: URL;
    try { url = new URL(parsed.data.remoteUrl); } catch { throw new OperationError('invalid_request', 'Enter a valid public post link.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new OperationError('invalid_request', 'Enter a valid public post link.');
  }
  const found = await prisma.$queryRaw<Array<{ id: string; workspaceId: string; postId: string; targetId: string; state: string }>>`SELECT id, "workspaceId", "postId", "targetId", state FROM rebuild_publication_attempts WHERE id = ${parsed.data.operationId}`;
  const initial = found[0];
  if (!initial) throw new OperationError('not_found', 'This publication operation is unavailable.');
  if (!['started', 'uncertain'].includes(initial.state)) throw new OperationError('conflict', 'This publication can no longer be manually attested.');
  return rootWorkspaceOperation(userId, initial.workspaceId, initial.postId, initial.targetId, tx => recordPublicationOutcomeInTransaction(tx, userId, { workspaceId: initial.workspaceId, operationId: parsed.data.operationId, outcome: parsed.data.outcome, ...(parsed.data.remotePostId ? { remotePostId: parsed.data.remotePostId } : {}), ...(parsed.data.remoteUrl ? { remoteUrl: parsed.data.remoteUrl } : {}) }));
}

async function rootWorkspaceOperation(userId: string, workspaceId: string, postId: string, targetId: string, run: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  return withRootPublicationOperation(userId, { workspaceId, postId, targetId }, tx => run(tx));
}

export async function finishRootPublicationProjection(userId: string, input: unknown) {
  await requireActiveRoot(userId);
  const parsed = z.object({ operationId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), confirmation: z.string().max(300) }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== `ROOT FINISH PUBLICATION ${parsed.data.operationId}`) throw new OperationError('invalid_request', 'Confirm the exact publication to finish its local update.');
  const rows = await prisma.$queryRaw<Array<{ workspaceId: string; postId: string; targetId: string }>>`SELECT "workspaceId", "postId", "targetId" FROM rebuild_publication_attempts WHERE id=${parsed.data.operationId}`;
  const row = rows[0];
  if (!row) throw new OperationError('not_found', 'This publication operation is unavailable.');
  return rootWorkspaceOperation(userId, row.workspaceId, row.postId, row.targetId, tx => projectPublicationInTransaction(tx, { userId, workspaceId: row.workspaceId }, parsed.data.operationId).then(ok => ({ ok, operationId: parsed.data.operationId, state: ok ? 'projected' : 'receipt_recorded' })));
}

export async function adoptRootLegacyPublication(userId: string, input: unknown) {
  await requireActiveRoot(userId);
  const parsed = z.object({ postTargetId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), confirmation: z.string().max(300) }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== `ROOT ADOPT PUBLICATION ${parsed.data.postTargetId}`) throw new OperationError('invalid_request', 'Check the destination and confirm this exact legacy record.');
  const row = await prisma.postTarget.findFirst({ where: { id: parsed.data.postTargetId }, select: { id: true, postId: true, targetId: true, status: true, remotePostId: true, post: { select: { workspaceId: true } }, target: { select: { workspaceId: true, socialAccount: { select: { provider: true } } } } } });
  if (!row || row.status !== 'processing' || row.remotePostId || row.post.workspaceId !== row.target.workspaceId || !row.target.socialAccount?.provider) throw new OperationError('conflict', 'This destination does not need legacy publication recovery.');
  return rootWorkspaceOperation(userId, row.post.workspaceId, row.postId, row.targetId, tx => adoptLegacyPublicationInTransaction(tx, { userId, workspaceId: row.post.workspaceId }, { postId: row.postId, postTargetId: row.id, targetId: row.targetId, provider: row.target.socialAccount!.provider }));
}
