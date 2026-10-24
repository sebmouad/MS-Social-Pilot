import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { requireActiveRoot } from '@/server/root/operations';
import { withRootPublicationOperation } from '@/server/root/publication-operation';
import type { PlatformPublicationActionInput, PlatformPublicationActionResult } from '@/server/platforms/host';
import { readFacebookNativeProof, type FacebookNativeReadProof, type FacebookNativeReadProofBinding } from './read-proof';
import { prepareFacebookNativeStatusRead } from './read-credentials';
import { facebookNativeStatusConfirmation, facebookNativeStatusEligible } from './status-recovery-contract';
export { facebookNativeStatusConfirmation } from './status-recovery-contract';

type Candidate = FacebookNativeReadProofBinding & {
  state: string; conflicted: boolean; knownIds: string[];
  steps: Array<{ phase: string; dispatched: boolean; confirmed: boolean }>;
  parentProvider: string; parentState: string; parentRemoteId: string | null;
  parentPostId: string; parentPostTargetId: string; parentTargetId: string; parentActorId: string;
};
const failure = (code: 'invalid_request' | 'not_found' | 'conflict' | 'unavailable', message: string) => new OperationError(code, message);
const changed = () => failure('conflict', 'This Facebook native receipt changed. Reload its evidence before checking again.');
const schema = z.object({ actionId: z.literal('refresh_native_status'), subjectId: z.string().min(1).max(2048),
  confirmation: z.string().max(400), acknowledged: z.literal(true), fieldValues: z.object({}).strict().optional() }).strict();


async function transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
  const [timeout, maxWait] = await Promise.all([runtimeConfig('publishing.transactionTimeoutMs'), runtimeConfig('publishing.transactionMaxWaitMs')]);
  if (![timeout, maxWait].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)) {
    throw failure('unavailable', 'Publishing transaction limits are unavailable.');
  }
  return prisma.$transaction(run, { timeout: timeout as number, maxWait: maxWait as number });
}

async function candidate(database: Pick<Prisma.TransactionClient, '$queryRaw'>, operationId: string): Promise<Candidate> {
  const rows = await database.$queryRaw<Candidate[]>`SELECT j."operationId",j."workspaceId",j."postId",j."postTargetId",j."targetId",j."actorId",j."remoteTargetId",
    j."sourceFormatId",j.format,j."payloadHash",j."remoteId",j.revision,j.state,j.conflicted,j."knownIds",j.steps,
    a.provider AS "parentProvider", a.state AS "parentState",
    a."remotePostId" AS "parentRemoteId", a."postId" AS "parentPostId", a."postTargetId" AS "parentPostTargetId",
    a."targetId" AS "parentTargetId", a."actorId" AS "parentActorId"
    FROM facebook_native_journal j JOIN publication_attempts a
      ON a.id=j."operationId" AND a."workspaceId"=j."workspaceId"
    WHERE j."operationId"=${operationId} LIMIT 1`;
  if (!rows[0]) throw failure('not_found', 'This native Facebook publication is unavailable.');
  return rows[0];
}


function bindingValid(row: Candidate) {
  if (row.parentProvider !== 'facebook' || row.postId !== row.parentPostId || row.postTargetId !== row.parentPostTargetId ||
    row.targetId !== row.parentTargetId || row.actorId !== row.parentActorId ||
    !(['started', 'uncertain'].includes(row.parentState) && row.parentRemoteId === null ||
      ['submitted', 'receipt_recorded', 'projected'].includes(row.parentState) && row.parentRemoteId === row.remoteId)) throw changed();
}

async function lockCandidate(tx: Prisma.TransactionClient, original: Candidate) {
  const parents = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM publication_attempts
    WHERE id=${original.operationId} AND "workspaceId"=${original.workspaceId} FOR UPDATE`;
  if (parents.length !== 1) throw changed();
  await tx.$queryRaw`SELECT "operationId" FROM facebook_native_journal
    WHERE "operationId"=${original.operationId} AND "workspaceId"=${original.workspaceId} FOR UPDATE`;
  const row = await candidate(tx, original.operationId);
  for (const key of ['workspaceId','operationId','postId','postTargetId','targetId','actorId','remoteTargetId','sourceFormatId','format','payloadHash','remoteId'] as const) {
    if (row[key] !== original[key]) throw changed();
  }
  return row;
}

async function audit(tx: Prisma.TransactionClient, actorId: string, row: Candidate, proofId: string, outcome: string, accepted: boolean) {
  await tx.$executeRaw`INSERT INTO root_activities (id,"actorId",action,detail,"createdAt")
    VALUES (${randomUUID()},${actorId},'facebook.native_status_observed',
      ${JSON.stringify({ workspaceId: row.workspaceId, operationId: row.operationId, targetId: row.targetId, proofId, outcome, accepted })}::jsonb,CURRENT_TIMESTAMP)`;
}

/** Root-only recovery: repeatable GET observations, never a publication claim or remote mutation. */
export async function refreshFacebookNativeStatus(userId: string, input: PlatformPublicationActionInput): Promise<PlatformPublicationActionResult> {
  await requireActiveRoot(userId);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw failure('invalid_request', 'Acknowledge this status check and enter its exact confirmation.');
  }
  const action = parsed.data;
  const initial = await candidate(prisma, action.subjectId);
  if (action.confirmation !== facebookNativeStatusConfirmation(initial.operationId, initial.revision)) {
    throw failure('invalid_request', 'The receipt changed or its confirmation is incorrect. Reload the evidence and confirm its current revision.');
  }
  bindingValid(initial);
  if (!facebookNativeStatusEligible(initial)) throw changed();
  return withRootPublicationOperation(userId, { workspaceId: initial.workspaceId, postId: initial.postId, targetId: initial.targetId }, async (_outer, signal) => {
    await requireActiveRoot(userId);
    const prepared = await transaction(async tx => {
      // Keep the trust snapshot and actual transport construction on one stable
      // configuration epoch, including default/absent rows and secret settings.
      await tx.$executeRaw`LOCK TABLE app_settings IN SHARE MODE`;
      return prepareFacebookNativeStatusRead(initial, signal);
    });
    const frozen = await transaction(async tx => {
      const row = await lockCandidate(tx, initial);
      bindingValid(row);
      if (!facebookNativeStatusEligible(row) || row.revision !== initial.revision) throw changed();
      if (row.parentState === 'started') {
        const count = await tx.$executeRaw`UPDATE publication_attempts SET state='uncertain',reason='outcome_unknown',"updatedAt"=clock_timestamp()
          WHERE id=${row.operationId} AND "workspaceId"=${row.workspaceId} AND state='started'`;
        if (count !== 1) throw changed();
      }
      // Invalidate the creator revision before reading. This never grants a new phase.
      const count = await tx.$executeRaw`UPDATE facebook_native_journal SET state='uncertain',revision=revision+1,"updatedAt"=clock_timestamp()
        WHERE "operationId"=${row.operationId} AND "workspaceId"=${row.workspaceId} AND revision=${row.revision}`;
      if (count !== 1) throw changed();
      await tx.$executeRaw`INSERT INTO root_activities (id,"actorId",action,detail,"createdAt") VALUES
        (${randomUUID()},${userId},'facebook.native_status_started',${JSON.stringify({ workspaceId: row.workspaceId, operationId: row.operationId, revision: row.revision + 1 })}::jsonb,CURRENT_TIMESTAMP)`;
      return { ...row, state: 'uncertain', revision: row.revision + 1 };
    });
    let currentAuthority = !signal.aborted;
    try { await prepared.assertCurrent(); } catch { currentAuthority = false; }
    // A revoked grant after the durable hold still produces an audited unknown
    // observation. An already-aborted read performs no provider request.
    const proof = await readFacebookNativeProof(frozen, prepared.transport, currentAuthority ? signal : AbortSignal.abort());
    try { await prepared.assertCurrent(); } catch { currentAuthority = false; }
    // Preserve the observation even if credentials, selection or revision changed.
    // Only a current, identity-bound, positive observation may settle the child.
    const accepted = await transaction(async tx => {
      const row = await lockCandidate(tx, frozen);
      // These locks cover the short acceptance window, never the remote GET.
      // SHARE also covers absent/default setting rows against concurrent inserts.
      await tx.$executeRaw`LOCK TABLE app_settings IN SHARE MODE`;
      await tx.$queryRaw`SELECT s.id FROM social_accounts s JOIN targets t ON t."socialAccountId"=s.id
        WHERE t.id=${row.targetId} AND t."workspaceId"=${row.workspaceId} AND s."workspaceId"=${row.workspaceId} FOR SHARE OF s`;
      await tx.$queryRaw`SELECT id FROM targets WHERE id=${row.targetId} AND "workspaceId"=${row.workspaceId} FOR SHARE`;
      try { await prepared.assertCurrent(); } catch { currentAuthority = false; }
      let parentValid = true;
      try { bindingValid(row); } catch { parentValid = false; }
      const accept = currentAuthority && !signal.aborted && parentValid && row.revision === frozen.revision &&
        facebookNativeStatusEligible(row) && proof.outcome === 'published';
      if (accept) {
        const count = await tx.$executeRaw`UPDATE facebook_native_journal SET state='confirmed',revision=revision+1,"updatedAt"=clock_timestamp()
          WHERE "operationId"=${row.operationId} AND "workspaceId"=${row.workspaceId} AND revision=${frozen.revision} AND NOT conflicted`;
        if (count !== 1) throw changed();
      }
      const proofId = randomUUID();
      await appendProof(tx, userId, frozen, proof, proofId, accept);
      await audit(tx, userId, frozen, proofId, proof.outcome, accept);
      return accept;
    });
    return { ok: accepted, actionId: action.actionId, subjectId: action.subjectId, operationId: initial.operationId,
      state: accepted ? 'confirmed' : 'needs_review', message: accepted
        ? 'Facebook confirmed the final publication identity and Page. Its native receipt is verified; review the shared publication outcome separately.'
        : `Observed Facebook status: ${proof.outcome}. This observation did not resolve the publication. Review its latest evidence; no content was sent or removed.` };
  }, { remote: true });
}

async function appendProof(tx: Prisma.TransactionClient, actorId: string, row: Candidate, proof: FacebookNativeReadProof, id: string, accepted: boolean) {
  await tx.$executeRaw`INSERT INTO facebook_native_status_proofs
    (id,"workspaceId","operationId","observedRevision","appliedRevision","payloadHash",format,"remoteTargetId","remoteId","actorId",outcome,detail,"observedAt",accepted)
    VALUES (${id},${row.workspaceId},${row.operationId},${row.revision},${accepted ? row.revision + 1 : null},${row.payloadHash},${row.format},
      ${row.remoteTargetId},${row.remoteId},${actorId},${proof.outcome},${proof.detail},${proof.observedAt},${accepted})`;
}
