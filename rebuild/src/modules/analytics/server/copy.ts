import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';

/** One catalog read per request, shared by server screens and serialized client controls. */
export const analyticsCopy = cache(async () => {
  const [reports, goals, downloads, demographics, workspace, records, errors] = await Promise.all([
    runtimeConfig('analytics.reportsCopy'), runtimeConfig('analytics.goalsCopy'), runtimeConfig('analytics.downloadCopy'), runtimeConfig('analytics.demographicsCopy'), runtimeConfig('analytics.workspaceCopy'), runtimeConfig('analytics.recordsCopy'), runtimeConfig('analytics.errorCopy'),
  ]);
  return { reports, goals, downloads, demographics, workspace, records, errors };
});
