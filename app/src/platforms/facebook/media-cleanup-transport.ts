import { prisma } from '@/server/data';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { decryptSecret } from '@/server/secret-crypto';
import type { FacebookMediaDeletionBinding, FacebookMediaDeletion } from './media-cleanup-transport-port';
import { FacebookApiError } from './publishing';
import { isFacebookDefiniteRejection } from './protocol';

type CleanupCredentials = { token: string };
type CleanupTarget = {
  id: string;
  workspaceId: string;
  providerId: string;
  accessToken: string | null;
  socialAccount: {
    provider: string;
    workspaceId: string;
    scopes: string;
    invalidatedAt: Date | null;
    tokenExpiresAt: Date | null;
  } | null;
};

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function configuredScopes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(scope => typeof scope !== 'string' || !scope.trim())) return [];
  return [...new Set(value.map(scope => (scope as string).trim()))];
}

async function currentCredentials(binding: FacebookMediaDeletionBinding): Promise<CleanupCredentials> {
  const [enabled, readConfig, deleteConfig, proofEnabled, appSecret] = await Promise.all([
    runtimeConfig('meta.manualMediaCleanupEnabled'), runtimeConfig('meta.mediaReadScopes'),
    runtimeConfig('meta.mediaDeleteScopes'), runtimeConfig('meta.appSecretProofEnabled'),
    runtimeSecret('meta.appSecret').catch(() => null),
  ]);
  if (enabled !== true || typeof proofEnabled !== 'boolean' || (proofEnabled && !appSecret?.trim())) throw new Error('not ready');
  const required = [...configuredScopes(readConfig), ...configuredScopes(deleteConfig)];
  if (!configuredScopes(readConfig).length || !configuredScopes(deleteConfig).length) throw new Error('not ready');

  const target = await prisma.target.findFirst({
    where: { id: binding.targetId, workspaceId: binding.workspaceId, providerId: binding.remoteTargetId },
    select: { id: true, workspaceId: true, providerId: true, accessToken: true,
      socialAccount: { select: { provider: true, workspaceId: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  }) as CleanupTarget | null;
  const connection = target?.socialAccount;
  if (!target || target.id !== binding.targetId || target.workspaceId !== binding.workspaceId || target.providerId !== binding.remoteTargetId ||
    !connection || connection.provider !== 'facebook' || connection.workspaceId !== binding.workspaceId || connection.invalidatedAt ||
    (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) || typeof target.accessToken !== 'string' || !target.accessToken) throw new Error('not ready');
  const granted = new Set(connection.scopes.split(/[\s,]+/).filter(Boolean));
  if (required.some(scope => !granted.has(scope))) throw new Error('not ready');
  const token = decryptSecret(target.accessToken);
  if (!token.trim()) throw new Error('not ready');
  return { token };
}

function safeState(state: { id: unknown; page_story_id?: unknown; can_delete: unknown }, expectedId: string): boolean {
  if (state.id !== expectedId || !validId(state.id) || state.can_delete !== true) return false;
  if (!Object.hasOwn(state, 'page_story_id') || state.page_story_id === null) return true;
  // A positive story link, empty-but-present value, or malformed provider value is not deletion evidence.
  return false;
}

/** Prepare all local policy and credential checks before Root records a durable delete intent. */
export async function prepareFacebookMediaDeletion(binding: FacebookMediaDeletionBinding): Promise<FacebookMediaDeletion> {
  if (!validId(binding.workspaceId) || !validId(binding.targetId) || !validId(binding.remoteTargetId) || !validId(binding.remotePhotoId)) {
    throw new Error('Facebook staged photo cleanup is not currently ready.');
  }
  const pinnedBinding = { ...binding };
  try {
    await currentCredentials(pinnedBinding);
    const { configuredFacebookEngine } = await import('./runtime');
    await configuredFacebookEngine(); // Validate endpoint and app-secret proof configuration without sending a request.
  } catch {
    throw new Error('Facebook staged photo cleanup is not currently ready.');
  }

  return async (signal: AbortSignal) => {
    if (signal.aborted) return 'rejected';
    let credentials: CleanupCredentials;
    let engine: Awaited<ReturnType<typeof import('./runtime').configuredFacebookEngine>>;
    try {
      credentials = await currentCredentials(pinnedBinding);
      if (signal.aborted) return 'rejected';
      const { configuredFacebookEngine } = await import('./runtime');
      engine = await configuredFacebookEngine({ signal });
      // Recheck mutable local policy and credentials before the final provider read.
      credentials = await currentCredentials(pinnedBinding);
      if (signal.aborted) return 'rejected';
      const state = await engine.getPhotoCleanupState(credentials.token, pinnedBinding.remotePhotoId);
      if (signal.aborted || !safeState(state, pinnedBinding.remotePhotoId)) return 'rejected';
      // Policy and grants can change while the provider read is in flight.
      credentials = await currentCredentials(pinnedBinding);
      if (signal.aborted) return 'rejected';
    } catch {
      return 'rejected';
    }

    let dispatched = false;
    let confirmedResponse = false;
    try {
      await engine.deletePhoto(credentials.token, pinnedBinding.remotePhotoId,
        () => { dispatched = true; }, () => { confirmedResponse = true; });
      return 'confirmed';
    } catch (error) {
      if (confirmedResponse) return 'confirmed';
      if (!dispatched) return 'rejected';
      if (error instanceof FacebookApiError && isFacebookDefiniteRejection(error.status, error.code, error.transient)) return 'rejected';
      return 'uncertain';
    }
  };
}
