import { defaultAdsText } from '@/modules/ads/copy';
import type { AdsOpsHost } from './types';

/**
 * Installed module-owned operation hosts. The host application registers each
 * module explicitly at assembly time; shared code never imports a provider.
 */
const hosts = new Map<string, AdsOpsHost>();
export function registerAdsOpsHost(host: AdsOpsHost) {
  if (hosts.has(host.provider)) throw new Error(defaultAdsText('validation006', { value0: host.provider }));
  hosts.set(host.provider, host);
}
export function adsOpsHostFor(provider: string): AdsOpsHost | null { return hosts.get(provider) ?? null; }
/** Test seam. */
export function clearAdsOpsHosts() { hosts.clear(); }
