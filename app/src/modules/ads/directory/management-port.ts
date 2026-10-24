import type { AdsReadActor } from '../server/access';
import type { AdsOperationSupport, AdsOpsLimits } from '../management/types';

export type AdsDirectoryObjectLevel = 'campaign' | 'adset' | 'ad';
export type AdsDirectoryOperation = AdsOperationSupport;
export type AdsDirectoryManagement = { canManage: boolean; /** True when management is withheld only because the connection must be reconnected (for example the advertising-changes grant is missing). */ needsReconnect?: boolean; operations: AdsDirectoryOperation[]; canListCreatives?: boolean; limits?: AdsOpsLimits };
export type AdsDirectoryChange = { id: string; operationType: string; objectType: string; objectId: string; status: string; createdAt: string; needsResolution: boolean; onHold?: boolean; resolutionNote: string | null };

/** Optional host-owned management read surface. Ads reads remain usable without it. */
export type AdsDirectoryManagementPort = {
  describe(actor: AdsReadActor, accountId: string): Promise<AdsDirectoryManagement>;
  listChanges(actor: AdsReadActor): Promise<AdsDirectoryChange[]>;
};

const KEY = '__socialpilotAdsDirectoryManagementPort' as const;
type Holder = typeof globalThis & { [KEY]?: AdsDirectoryManagementPort };

export function registerAdsDirectoryManagementPort(port: AdsDirectoryManagementPort | null): void {
  const holder = globalThis as Holder;
  if (port) holder[KEY] = port;
  else delete holder[KEY];
}

export function adsDirectoryManagementPort(): AdsDirectoryManagementPort | null {
  return (globalThis as Holder)[KEY] ?? null;
}
