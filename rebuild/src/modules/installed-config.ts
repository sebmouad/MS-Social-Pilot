import { ADS_MODULE_CONFIG } from './ads/config';
import { AGENCY_CONFIG } from './agency/config';
import { AI_CONFIG } from './ai/config';
import { ANALYTICS_MODULE_CONFIG } from './analytics/config';
import { FEEDS_CONFIG } from './feeds/config';
import { HOME_CONFIG } from './home/config';
import { INBOX_MODULE_CONFIG } from './inbox/config';
import { INTEGRATIONS_CONFIG } from './integrations/config';
import { MEDIA_CONFIG } from './media/config';
import { PUBLISHING_MODULE_CONFIG } from './publishing/config';
import { SETTINGS_MODULE_CONFIG } from './settings/config';
import { SHARING_CONFIG } from './sharing/config';
import { TASKS_CONFIG } from './tasks/config';

/**
 * Root settings of every installed product module, in installation order. A module adds or
 * changes settings in its own config.ts; this list changes only when a module is installed.
 */
export const INSTALLED_MODULE_CONFIG = [
  ...HOME_CONFIG,
  ...ADS_MODULE_CONFIG,
  ...ANALYTICS_MODULE_CONFIG,
  ...SETTINGS_MODULE_CONFIG,
  ...PUBLISHING_MODULE_CONFIG,
  ...MEDIA_CONFIG,
  ...FEEDS_CONFIG,
  ...INBOX_MODULE_CONFIG,
  ...TASKS_CONFIG,
  ...AGENCY_CONFIG,
  ...SHARING_CONFIG,
  ...AI_CONFIG,
  ...INTEGRATIONS_CONFIG,
] as const;
