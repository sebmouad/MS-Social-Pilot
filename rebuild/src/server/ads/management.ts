import { adsDirectoryManagementPort, registerAdsDirectoryManagementPort } from '@/modules/ads/directory/management-port';
import { describeAdsManagement, listAdsOperations } from '@/modules/ads/management/server';

/** Neutral host composition. Each entry bundle installs its own optional port. */
export function ensureAdsManagement() {
  if (adsDirectoryManagementPort()) return;
  registerAdsDirectoryManagementPort({
    async describe(actor, accountId) {
      const result = await describeAdsManagement(actor, accountId);
      return { ...result, operations: result.operations.map(operation => ({ ...operation, objectTypes: [...operation.objectTypes] })) };
    },
    async listChanges(actor) { return (await listAdsOperations(actor)).items; },
  });
}
