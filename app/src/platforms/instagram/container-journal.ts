import type { PublishRequest } from '@/platforms/types';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { assertInstagramSource } from './source-binding';
import { instagramPolicySchema } from './config';
import { instagramLocale } from './locale';
import { InstagramError } from './transport';

export interface InstagramContainerJournal {
  begin(phase: 'container' | 'publish', ordinal: number): Promise<void>;
  receipt(phase: 'container' | 'publish', ordinal: number, remoteId: string): Promise<void>;
}
export type InstagramJournalFactory = (request: PublishRequest) => InstagramContainerJournal;

/** Durable child intents in the existing audit store; the shared publication attempt remains the resend fence.
 * No captions, URLs, credentials or customer content are stored. A lost response is never replayed.
 */
export const instagramContainerJournal: InstagramJournalFactory = request => {
  const context = request.publication;
  const operationId = request.operationId;
  async function write(phase: 'container' | 'publish', ordinal: number, remoteId?: string) {
    const [timeout, maxWait, configured, locale] = await Promise.all([runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs'), runtimeConfig('instagram.policy'), instagramLocale()]);
    const policy = instagramPolicySchema.parse(configured);
    if (!context || !operationId) throw new InstagramError(policy.copy.permission[locale], 'rejected');
    if (remoteId === undefined) await assertInstagramSource({ workspaceId: context.workspaceId, targetId: context.targetId, remoteTargetId: request.target.id, accessToken: request.credential.accessToken, requiredScopes: policy.publishScopes });
    const id = `instagram:${operationId}:${phase}:${ordinal}`;
    await prisma.$transaction(async tx => {
      const parent = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT a.id FROM publication_attempts a
        JOIN targets t ON t.id=a."targetId" AND t."workspaceId"=a."workspaceId"
        JOIN social_accounts s ON s.id=t."socialAccountId" AND s."workspaceId"=t."workspaceId"
        WHERE a.id=${operationId} AND a.provider='instagram' AND a.state='started'
          AND a."workspaceId"=${context!.workspaceId} AND a."targetId"=${context!.targetId}
          AND a."postId"=${context!.postId} AND a."postTargetId"=${context!.postTargetId} AND a."actorId"=${context!.actorId}
          AND t."providerId"=${request.target.id} AND s.provider='instagram'
          AND (${remoteId !== undefined} OR (t.enabled=true AND s."invalidatedAt" IS NULL AND (s."tokenExpiresAt" IS NULL OR s."tokenExpiresAt">NOW())))
        FOR UPDATE OF a`;
      if (!parent.length) throw new InstagramError(policy.copy.uncertain[locale], 'uncertain');
      if (remoteId === undefined) {
        // A human absence attestation on the generic parent cannot erase a child publish intent/receipt.
        // Until module recovery is integrated, such destinations stay held even across new parent attempts.
        const prior = await tx.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM root_activities r
            JOIN publication_attempts a ON a.id=r.detail->>'operationId'
            WHERE r.action='instagram.publication_step' AND r.detail->>'phase'='publish'
              AND r.detail->>'state' IN ('started','recorded')
              AND a."workspaceId"=${context!.workspaceId} AND a."postTargetId"=${context!.postTargetId}
              AND a.id<>${operationId}
          ) AS blocked`;
        if (prior[0]?.blocked !== false) throw new InstagramError(policy.copy.uncertain[locale], 'uncertain');
        // Unique primary key rejects re-entry even after a crash, before any remote write.
        await tx.$executeRaw`INSERT INTO root_activities (id,"actorId",action,detail,"createdAt")
          VALUES (${id},${context!.actorId},'instagram.publication_step',${JSON.stringify({ workspaceId: context!.workspaceId, operationId, targetId: context!.targetId, phase, ordinal, state: 'started' })}::jsonb,NOW())`;
      } else {
        const changed = await tx.$executeRaw`UPDATE root_activities SET detail=detail || ${JSON.stringify({ state: 'recorded', remoteId })}::jsonb
          WHERE id=${id} AND detail->>'workspaceId'=${context!.workspaceId} AND detail->>'state'='started'`;
        if (changed !== 1) throw new InstagramError(policy.copy.uncertain[locale], 'uncertain');
      }
    }, { timeout, maxWait });
  }
  return { begin: (phase, ordinal) => write(phase, ordinal), receipt: (phase, ordinal, remoteId) => write(phase, ordinal, remoteId) };
};
