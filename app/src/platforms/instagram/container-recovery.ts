import type { PlatformPublicationRecovery } from '@/server/platforms/host';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { configuredInstagramPolicy } from './runtime';
import { instagramLocale } from './locale';

type Step = { id: string; operationId: string; phase: string; state: string; remoteId: string | null; createdAt: Date };

/** Register in the shared safety registry before activation. No provider requests or credentials are involved. */
export const instagramPublicationRecovery: PlatformPublicationRecovery = {
  async assertSettled(tx, workspaceId, targetIds) {
    if (targetIds?.length === 0) return;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT a.id FROM rebuild_publication_attempts a
      WHERE a.provider='instagram' AND a."workspaceId"=${workspaceId}
        AND (${targetIds === undefined} OR a."targetId"=ANY(${[...(targetIds ?? [])]}::text[]))
        AND EXISTS (SELECT 1 FROM root_activities r WHERE r.action='instagram.publication_step'
          AND r.detail->>'operationId'=a.id AND r.detail->>'phase'='publish'
          AND r.detail->>'state'='started')
      LIMIT 1`;
    if (rows.length) throw new OperationError('conflict', (await configuredInstagramPolicy()).copy.uncertain[await instagramLocale()]);
  },
  async assertOutcome(tx, workspaceId, operationId, outcome, remotePostId) {
    const rows = await tx.$queryRaw<Step[]>`
      SELECT r.id, r.detail->>'operationId' AS "operationId", r.detail->>'phase' AS phase,
        r.detail->>'state' AS state, r.detail->>'remoteId' AS "remoteId", r."createdAt"
      FROM root_activities r JOIN rebuild_publication_attempts a ON a.id=r.detail->>'operationId'
      WHERE r.action='instagram.publication_step' AND a.provider='instagram'
        AND a."workspaceId"=${workspaceId} AND a.id=${operationId} AND r.detail->>'phase'='publish'
      FOR UPDATE OF r`;
    if (!rows.length) return; // No publish dispatch: containers alone cannot publish a post.
    if (rows.length !== 1 || outcome === 'ABSENT' || rows[0]?.state !== 'recorded' || rows[0]?.remoteId !== remotePostId) {
      throw new OperationError('conflict', (await configuredInstagramPolicy()).copy.uncertain[await instagramLocale()]);
    }
  },
  async readEvidence(operationId, resultCap) {
    const limit = await runtimeConfig('publishing.publicationHistoryLimit');
    if (!Number.isSafeInteger(limit) || limit < 1 || resultCap !== undefined && (!Number.isSafeInteger(resultCap) || resultCap < 1)) throw new OperationError('invalid_request', (await configuredInstagramPolicy()).copy.invalid[await instagramLocale()]);
    const cap = Math.min(limit, resultCap ?? limit);
    const rows = await prisma.$queryRaw<Step[]>`
      SELECT r.id, r.detail->>'operationId' AS "operationId", r.detail->>'phase' AS phase,
        r.detail->>'state' AS state, r.detail->>'remoteId' AS "remoteId", r."createdAt"
      FROM root_activities r JOIN rebuild_publication_attempts a ON a.id=r.detail->>'operationId'
      WHERE r.action='instagram.publication_step' AND a.provider='instagram'
        AND (${operationId === undefined} OR a.id=${operationId ?? null})
      ORDER BY r."createdAt" DESC, r.id DESC LIMIT ${cap + 1}`;
    const [policy, locale] = await Promise.all([configuredInstagramPolicy(), instagramLocale()]);
    return {
      title: policy.copy.recoveryTitle[locale], description: policy.copy.recoveryDescription[locale],
      columns: [
        { key: 'operationId', label: policy.copy.operation[locale] }, { key: 'phase', label: policy.copy.phase[locale] },
        { key: 'state', label: policy.copy.state[locale] }, { key: 'remoteId', label: policy.copy.remoteId[locale] },
        { key: 'createdAt', label: policy.copy.recordedAt[locale] },
      ],
      items: rows.slice(0, cap).map(row => ({ id: row.id, operationId: row.operationId, phase: row.phase, state: row.state, remoteId: row.remoteId, createdAt: row.createdAt.toISOString() })),
      truncated: rows.length > cap,
    };
  },
};
