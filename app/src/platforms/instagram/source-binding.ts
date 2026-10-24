import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { decryptSecret } from '@/server/secret-crypto';
import { connectionState } from '@/lib/connection-status';
import { instagramPolicySchema } from './config';
import { instagramLocale } from './locale';
import { InstagramError, object } from './transport';

export interface InstagramSourceInput {
  workspaceId?: string;
  /** Local destination id, when the shared operation supplies it. */
  targetId?: string;
  remoteTargetId?: string;
  accessToken: string;
  requiredScopes?: readonly string[];
}

/** A cloned Page credential remains usable only while its selected source remains valid.
 * This supplements the shared service's actor/tenant authorization; it never grants access.
 */
export async function assertInstagramSource(input: InstagramSourceInput): Promise<void> {
  const [configured, enabled, locale] = await Promise.all([
    runtimeConfig('instagram.policy'), runtimeConfig('platforms.instagram.enabled'), instagramLocale(),
  ]);
  const policy = instagramPolicySchema.parse(configured);
  const denied = () => new InstagramError(policy.copy.permission[locale], 'rejected');
  if (enabled !== true || !input.accessToken) throw denied();
  const required = input.requiredScopes ?? policy.readScopes;
  if (!required.length) throw denied();
  const now = new Date();
  const targets = await prisma.target.findMany({
    where: {
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.targetId ? { id: input.targetId } : {}),
      ...(input.remoteTargetId ? { providerId: input.remoteTargetId } : {}),
      type: 'instagram', enabled: true,
      socialAccount: { is: { ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}), provider: 'instagram', invalidatedAt: null } },
    },
    select: { id: true, workspaceId: true, providerId: true, type: true, enabled: true, accessToken: true,
      socialAccount: { select: { id: true, workspaceId: true, provider: true, providerUserId: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
    orderBy: { id: 'asc' }, take: policy.connectionMaxPages + 1,
  });
  if (targets.length > policy.connectionMaxPages) throw denied();
  for (const target of targets) {
    const source = target.socialAccount;
    if (!target.enabled || target.type !== 'instagram' || !source || source.provider !== 'instagram' || source.workspaceId !== target.workspaceId || source.providerUserId !== target.providerId || connectionState(source, now) !== 'connected') continue;
    // Repeat supplied identities after reading; never infer scope from a shared token.
    if (input.workspaceId && target.workspaceId !== input.workspaceId || input.targetId && target.id !== input.targetId || input.remoteTargetId && target.providerId !== input.remoteTargetId) continue;
    const grants = source.scopes.split(',').map(scope => scope.trim()).filter(Boolean);
    if (!required.every(scope => grants.includes(scope))) continue;
    try { if (!target.accessToken || decryptSecret(target.accessToken) !== input.accessToken) continue; }
    catch { continue; }
    // The existing database column is intentionally absent from the narrow rebuild Prisma mapping.
    const bindings = await prisma.$queryRaw<Array<{ meta: unknown }>>`SELECT meta FROM social_accounts
      WHERE id=${source.id} AND "workspaceId"=${target.workspaceId} AND provider='instagram'`;
    const meta = object(bindings[0]?.meta);
    if (typeof meta.pageId !== 'string' || !meta.pageId || typeof meta.sourceId !== 'string' || !meta.sourceId || typeof meta.remotePageId !== 'string' || !meta.remotePageId) continue;
    const page = await prisma.target.findFirst({
      where: { id: meta.pageId, workspaceId: target.workspaceId, providerId: meta.remotePageId, type: 'page', enabled: true,
        socialAccountId: meta.sourceId, socialAccount: { is: { id: meta.sourceId, workspaceId: target.workspaceId, provider: 'facebook', invalidatedAt: null } } },
      select: { id: true, workspaceId: true, providerId: true, type: true, enabled: true, socialAccountId: true, accessToken: true,
        socialAccount: { select: { id: true, workspaceId: true, provider: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
    });
    const parent = page?.socialAccount;
    if (!page || !page.enabled || page.type !== 'page' || page.id !== meta.pageId || page.providerId !== meta.remotePageId || page.workspaceId !== target.workspaceId || page.socialAccountId !== meta.sourceId || !parent || parent.id !== meta.sourceId || parent.provider !== 'facebook' || parent.workspaceId !== target.workspaceId || connectionState(parent, now) !== 'connected') continue;
    const parentGrants = parent.scopes.split(',').map(scope => scope.trim()).filter(Boolean);
    if (!required.every(scope => parentGrants.includes(scope))) continue;
    try { if (page.accessToken && decryptSecret(page.accessToken) === input.accessToken) return; }
    catch { /* A broken or rotated credential never authorizes the cloned source. */ }
  }
  throw denied();
}
