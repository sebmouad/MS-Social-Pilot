import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { PLATFORM_MODULES } from '@/platforms';
import { PLATFORM_HOSTS } from '@/server/platforms';
import type { PlatformApiUsageScope, PlatformHost } from '@/server/platforms/host';
import { assertRootActor } from '@/modules/root/server/admin/authz';
import { rootResultLimit } from '@/modules/root/server/admin/policy';
import { OperationError } from '@/lib/operation-error';
import { apiUsagePolicySchema } from '../api-usage-config';

export type RootApiUsage = {
  platforms: Array<{ providerId: string; name: string; scopes: PlatformApiUsageScope[]; unavailable: boolean }>;
};

/** Private, read-only: latest provider-reported API usage per installed platform. Installation owner only. */
export async function readRootApiUsage(actorId: string, input: { providerId?: unknown; locale?: 'en' | 'fr'; resultCap?: number } = {}): Promise<RootApiUsage> {
  await assertRootActor(prisma, actorId);
  const policy = apiUsagePolicySchema.parse(await runtimeConfig('root.apiUsagePolicy'));
  if (input.providerId !== undefined && (typeof input.providerId !== 'string' || !PLATFORM_MODULES.some(module => module.id === input.providerId))) throw new OperationError('invalid_request', 'Choose an installed platform.');
  const limit = rootResultLimit(policy.scopeLimit, input.resultCap);
  const locale = input.locale ?? 'en';
  const platforms = await Promise.all(PLATFORM_MODULES.filter(module => !input.providerId || module.id === input.providerId).map(async module => {
    const host = (PLATFORM_HOSTS as Record<string, PlatformHost>)[module.id];
    if (!host?.apiUsage) return { providerId: module.id, name: module.name, scopes: [], unavailable: true };
    try { return { providerId: module.id, name: module.name, scopes: await host.apiUsage.read(limit, locale), unavailable: false }; }
    catch { return { providerId: module.id, name: module.name, scopes: [], unavailable: true }; }
  }));
  return { platforms };
}
