import type { CapabilityDeclaration, PlatformAdapter } from '@/platforms/types';
import { PLATFORM_MODULES, platformModule } from '@/platforms';
import type { PlatformModule } from '@/platforms/module';
import { runtimeConfig } from '@/server/config/store';
import { PLATFORM_HOSTS, type PlatformHost } from './index';
import type { PlatformJobName, JobSummary } from '@/server/jobs/types';
import type { RetryBackoff } from '@/server/jobs/retry';

/**
 * Product code reaches platforms only through here: by provider ID and
 * capability. A module that Root switched off behaves as if it were not
 * installed — customers cannot see, connect or use it; its data stays stored.
 */
function hostFor(provider: string): PlatformHost | undefined {
  return platformModule(provider) ? (PLATFORM_HOSTS as Record<string, PlatformHost>)[provider] : undefined;
}

export async function isPlatformEnabled(provider: string): Promise<boolean> {
  const module = platformModule(provider);
  if (!module || !hostFor(provider)) return false;
  return await runtimeConfig(module.enabledKey as never) === true;
}

export async function platformFor(provider: string, capability: keyof CapabilityDeclaration): Promise<PlatformAdapter | null> {
  const host = hostFor(provider);
  if (!host || !await isPlatformEnabled(provider)) return null;
  const adapter = await host.adapter();
  return adapter.capabilities[capability] === 'supported' ? adapter : null;
}

export interface PlatformStatus {
  module: PlatformModule;
  enabled: boolean;
  /** Root has filled in what a customer needs to connect. */
  ready: boolean;
}

/** Every installed module with its switch and setup state — for Root. */
export async function platformStatuses(): Promise<PlatformStatus[]> {
  return Promise.all((PLATFORM_MODULES as readonly PlatformModule[]).map(async (module) => {
    const host = hostFor(module.id)!;
    const enabled = await isPlatformEnabled(module.id);
    return { module, enabled, ready: await host.connection.isReady() };
  }));
}

/** Modules a customer can connect now: switched on and set up. */
export async function connectablePlatforms(): Promise<PlatformModule[]> {
  return (await platformStatuses()).filter((status) => status.enabled && status.ready).map((status) => status.module);
}

/** The connection flow of an installed, switched-on module. */
export async function connectionFlow(provider: string): Promise<PlatformHost['connection'] | null> {
  const host = hostFor(provider);
  if (!host || !await platformFor(provider, 'connection')) return null;
  return host.connection;
}

/** IDs of the installed modules that Root has switched on. */
export async function enabledPlatformIds(): Promise<string[]> {
  const ids = (PLATFORM_MODULES as readonly PlatformModule[]).map((module) => module.id);
  const on = await Promise.all(ids.map((id) => isPlatformEnabled(id)));
  return ids.filter((_, index) => on[index]);
}

/**
 * Prisma filter for channels, ad accounts and connections that belong to a
 * switched-on platform. Every customer-facing list applies it, so a module that
 * is off disappears everywhere at once while its data stays stored.
 */
export async function enabledSocialAccountWhere() {
  return { provider: { in: await enabledPlatformIds() } };
}

/** Run a job hook for each installed and enabled module that provides it. */
export async function runEnabledPlatformJob(job: PlatformJobName, now: Date, retryLimit: number, retryBackoff: RetryBackoff): Promise<JobSummary> {
  const results = await Promise.all((PLATFORM_MODULES as readonly PlatformModule[]).map(async module => {
    if (!await isPlatformEnabled(module.id)) return null;
    const hook = hostFor(module.id)?.jobs?.[job];
    return hook ? hook(now, retryLimit, retryBackoff) : null;
  }));
  return results.filter((value): value is JobSummary => value !== null).reduce((total, value) => ({
    examined: total.examined + value.examined, updated: total.updated + value.updated,
    skipped: total.skipped + value.skipped, failed: total.failed + value.failed,
  }), { examined: 0, updated: 0, skipped: 0, failed: 0 });
}
