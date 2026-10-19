import { createHash } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import type { PlatformAdapter, PlatformCredential, PublishRequest } from '@/platforms/types';
import { authorizePublishing } from '@/modules/publishing/server/access';
import { readPublishingCredential } from '@/modules/publishing/server/credentials';
import { hasPlatformCapability } from '@/server/entitlements';
import { prisma } from '@/server/data';
import type { NativeHostBinding } from './host';

type BindingRow = {
  workspaceId: string; operationId: string; postId: string; postTargetId: string; targetId: string; actorId: string;
  parentProvider: string; parentState: string; parentPostId: string; parentPostTargetId: string; parentTargetId: string; parentActorId: string;
  destinationStatus: string; destinationRemotePostId: string | null; destinationTargetId: string;
  targetWorkspaceId: string; targetEnabled: boolean; targetCanPublish: boolean; targetKind: string; remoteTargetId: string;
  accountWorkspaceId: string; accountProvider: string; accountInvalidatedAt: Date | null; tokenExpiresAt: Date | null;
  accessToken: string | null; scopes: string; authorId: string; postFormat: string; formatId: string | null;
  message: string; link: string | null; media: unknown; approvalStatus: string; requiresApproval: boolean;
  postTargets: Array<{ targetId: string }>;
};

const conflict = () => new OperationError('conflict', 'This Facebook video no longer matches its saved publication. Refresh its status before continuing.');
const unavailable = () => new OperationError('unavailable', 'Facebook video publishing is currently unavailable.');
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MANAGERS = new Set(['owner', 'admin', 'editor']);

function validId(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value === value.trim() && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizedScopes(value: readonly string[] | undefined): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(scope => typeof scope !== 'string' || !scope.trim() || scope !== scope.trim())) return null;
  return [...new Set(value)].sort();
}

function sameCredential(a: PlatformCredential | null, b: PlatformCredential): boolean {
  if (!a || typeof a.accessToken !== 'string' || typeof b.accessToken !== 'string') return false;
  const aScopes = normalizedScopes(a.grantedScopes);
  const bScopes = normalizedScopes(b.grantedScopes);
  return aScopes !== null && bScopes !== null && a.accessToken === b.accessToken && JSON.stringify(aScopes) === JSON.stringify(bScopes);
}

function savedVideo(row: BindingRow, request: PublishRequest): string | null {
  if (typeof row.message !== 'string' || request.text !== row.message ||
      (request.link ?? null) !== row.link || row.link !== null || request.formatId !== (row.formatId ?? row.postFormat) ||
      row.postFormat !== 'post' || (row.formatId ?? row.postFormat) !== 'post' ||
      !Array.isArray(row.media) || row.media.length !== 1 || !Array.isArray(request.media) || request.media.length !== 1) return null;
  const saved = row.media[0];
  const supplied = request.media[0];
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !supplied || supplied.kind !== 'video' || supplied.localFile) return null;
  const source = saved as Record<string, unknown>;
  if (source.kind !== 'video' || typeof source.url !== 'string' || supplied.kind !== source.kind || supplied.url !== source.url ||
      Object.keys(source).some(key => key !== 'kind' && key !== 'url') || Object.keys(supplied).some(key => key !== 'kind' && key !== 'url')) return null;
  return source.url;
}

/** Resolve the sole existing publication claim into a current, content-bound host authority snapshot.
 * This is read-only: it never claims, locks or updates the parent or child journal.
 */
export async function loadFacebookNativeHostBinding(
  request: PublishRequest,
  deps: {
    adapter: Pick<PlatformAdapter, 'canUseCredential'>;
    expectedConfigurationFingerprint: string;
    configurationFingerprint(): Promise<string>;
  },
): Promise<NativeHostBinding> {
  if (!validId(request?.operationId)) throw conflict();
  if (!request.target || request.target.kind !== 'page' || !validId(request.target.id) ||
      request.formatId !== 'post' || !request.credential || typeof request.text !== 'string' ||
      !Array.isArray(request.media) || request.media.length !== 1) throw conflict();

  try {
    const initialEpoch = await deps.configurationFingerprint();
    if (!initialEpoch || initialEpoch !== deps.expectedConfigurationFingerprint) throw unavailable();
    const rows = await prisma.$queryRaw<BindingRow[]>`
      SELECT a."workspaceId", a.id AS "operationId", a."postId", a."postTargetId", a."targetId", a."actorId",
        a.provider AS "parentProvider", a.state AS "parentState",
        a."postId" AS "parentPostId", a."postTargetId" AS "parentPostTargetId", a."targetId" AS "parentTargetId", a."actorId" AS "parentActorId",
        pt.status::text AS "destinationStatus", pt."remotePostId" AS "destinationRemotePostId", pt."targetId" AS "destinationTargetId",
        t."workspaceId" AS "targetWorkspaceId", t.enabled AS "targetEnabled", t."canPublish" AS "targetCanPublish",
        t.type::text AS "targetKind", t."providerId" AS "remoteTargetId", s."workspaceId" AS "accountWorkspaceId",
        s.provider AS "accountProvider", s."invalidatedAt" AS "accountInvalidatedAt", s."tokenExpiresAt",
        t."accessToken", s.scopes, p."authorId", p.format AS "postFormat", pt."formatId", p.message, p.link, p.media,
        p."approvalStatus"::text AS "approvalStatus", w."requiresApproval",
        ARRAY(SELECT all_pt."targetId" FROM post_targets all_pt WHERE all_pt."postId"=p.id ORDER BY all_pt."targetId") AS "postTargets"
      FROM rebuild_publication_attempts a
      JOIN posts p ON p.id=a."postId" AND p."workspaceId"=a."workspaceId"
      JOIN post_targets pt ON pt.id=a."postTargetId" AND pt."postId"=p.id AND pt."targetId"=a."targetId"
      JOIN targets t ON t.id=pt."targetId" AND t."workspaceId"=a."workspaceId"
      JOIN social_accounts s ON s.id=t."socialAccountId" AND s."workspaceId"=a."workspaceId"
      JOIN workspaces w ON w.id=a."workspaceId"
      WHERE a.id=${request.operationId} LIMIT 1`;
    const row = rows[0];
    if (!row || row.parentProvider !== 'facebook' || row.parentState !== 'started' ||
        row.operationId !== request.operationId || row.parentPostId !== row.postId ||
        row.parentPostTargetId !== row.postTargetId || row.parentTargetId !== row.targetId || row.parentActorId !== row.actorId ||
        row.destinationStatus !== 'processing' || row.destinationRemotePostId !== null || row.destinationTargetId !== row.targetId ||
        row.targetWorkspaceId !== row.workspaceId || row.targetEnabled !== true || row.targetCanPublish !== true ||
        row.targetKind !== 'page' || row.remoteTargetId !== request.target.id || row.accountWorkspaceId !== row.workspaceId ||
        row.accountProvider !== 'facebook' || row.accountInvalidatedAt !== null ||
        row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() <= Date.now() ||
        typeof row.accessToken !== 'string' || !row.accessToken || !validId(row.actorId) || !validId(row.workspaceId) ||
        !validId(row.postId) || !validId(row.postTargetId) || !validId(row.targetId) || !validId(row.remoteTargetId) ||
        !validId(row.scopes)) throw conflict();

    const authorization = await authorizePublishing({ userId: row.actorId, workspaceId: row.workspaceId }, 'publishing/posts', 'write');
    if (authorization.actor.userId !== row.actorId || authorization.actor.workspaceId !== row.workspaceId ||
        authorization.actor.allowedTargetIds !== undefined && (!authorization.actor.allowedTargetIds.includes(row.targetId) ||
          row.postTargets.some(item => !authorization.actor.allowedTargetIds!.includes(item.targetId)))) throw conflict();
    if (!hasPlatformCapability(authorization.entitlements, 'facebook')) throw conflict();
    if (!MANAGERS.has(authorization.role) && row.authorId !== row.actorId) throw conflict();
    if (row.requiresApproval && !MANAGERS.has(authorization.role) && row.approvalStatus !== 'approved') throw conflict();

    const url = savedVideo(row, request);
    if (!url) throw conflict();
    const source = { accessToken: row.accessToken, socialAccount: { scopes: row.scopes, invalidatedAt: row.accountInvalidatedAt, tokenExpiresAt: row.tokenExpiresAt } };
    const credential = readPublishingCredential(source, deps.adapter, 'publishing');
    if (!sameCredential(credential, request.credential)) throw conflict();

    const finalEpoch = await deps.configurationFingerprint();
    if (finalEpoch !== initialEpoch || finalEpoch !== deps.expectedConfigurationFingerprint) throw unavailable();
    const grantedScopes = normalizedScopes(credential!.grantedScopes)!;
    const authorityFingerprint = digest({
      workspaceId: row.workspaceId, operationId: row.operationId, postId: row.postId, postTargetId: row.postTargetId,
      targetId: row.targetId, actorId: row.actorId, remoteTargetId: row.remoteTargetId, sourceFormatId: row.formatId ?? row.postFormat,
      role: authorization.role, allowedTargetIds: authorization.actor.allowedTargetIds?.slice().sort() ?? null,
      entitlement: true, scopes: grantedScopes, token: digest(credential!.accessToken),
      content: digest({ text: row.message, link: row.link, media: row.media }), configurationEpoch: finalEpoch,
    });
    return {
      workspaceId: row.workspaceId, operationId: row.operationId, postId: row.postId, postTargetId: row.postTargetId,
      targetId: row.targetId, actorId: row.actorId, remoteTargetId: row.remoteTargetId,
      sourceFormatId: row.formatId ?? row.postFormat, claimState: 'started', credential: credential!,
      formatId: 'post', authorityFingerprint,
    };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw unavailable();
  }
}
