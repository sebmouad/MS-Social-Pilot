import { configValueOrDefault } from '@/server/config/config-or-default';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';

/** One catalog read per request, shared by server screens and serialized client controls. */
export const analyticsCopy = cache(async () => {
  const [reports, goals, downloads, demographics, workspace, records, errors, alerts] = await Promise.all([
    configValueOrDefault('analytics.reportsCopy'), configValueOrDefault('analytics.goalsCopy'), configValueOrDefault('analytics.downloadCopy'), configValueOrDefault('analytics.demographicsCopy'), configValueOrDefault('analytics.workspaceCopy'), configValueOrDefault('analytics.recordsCopy'), configValueOrDefault('analytics.errorCopy'), configValueOrDefault('analytics.alertsCopy'),
  ]);
  return { reports, goals, downloads, demographics, workspace, records, errors, alerts };
});
