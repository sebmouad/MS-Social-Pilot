import { responseTimeCopyDefaults } from './reports/generation/response-copy';
import { errorCopyDefaults } from './error-copy';
import { recordsCopyDefaults } from './records-copy';
import { workspaceCopyDefaults } from './workspace-copy';
import { demographicsCopyDefaults } from './demographics/copy';
import { z } from 'zod';
import { reportCopyDefaults } from './ui/reports/copy';
import { alertsCopyDefaults } from './alerts/copy';
import { goalsCopyDefaults } from './goals/copy';
import { downloadCopyDefaults } from './ui/reports/download-copy';

/** Browser-safe catalogs; every customer entry has both supported languages. */
export { reportCopyDefaults, goalsCopyDefaults, downloadCopyDefaults, alertsCopyDefaults };
export function analyticsCopySchema<T extends Record<string, { en: string; fr: string }>>(defaults: T) {
  const bilingual = z.object({ en: z.string().trim().min(1).max(4000), fr: z.string().trim().min(1).max(4000) }).strict();
  return z.object(Object.fromEntries(Object.keys(defaults).map(key => [key, bilingual])) as { [K in keyof T]: typeof bilingual }).strict();
}
export const reportCopySchema = analyticsCopySchema(reportCopyDefaults);
export const goalsCopySchema = analyticsCopySchema(goalsCopyDefaults);
export const downloadCopySchema = analyticsCopySchema(downloadCopyDefaults);
export const alertsCopySchema = analyticsCopySchema(alertsCopyDefaults);

export { demographicsCopyDefaults };
export const demographicsCopySchema = analyticsCopySchema(demographicsCopyDefaults);

export { workspaceCopyDefaults };
export const workspaceCopySchema = analyticsCopySchema(workspaceCopyDefaults);

export { recordsCopyDefaults };
export const recordsCopySchema = analyticsCopySchema(recordsCopyDefaults);

export { errorCopyDefaults };
export const errorCopySchema = analyticsCopySchema(errorCopyDefaults);

export { responseTimeCopyDefaults };
export const responseTimeCopySchema = analyticsCopySchema(responseTimeCopyDefaults);
