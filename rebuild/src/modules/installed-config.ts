import { ROOT_MONITORING_CONFIG } from './root/config';
import { ADS_MODULE_CONFIG } from './ads/config';
import { AGENCY_CONFIG } from './agency/config';
import { ASYNC_POST_EXPORT_CONFIG } from './publishing/server/export/config';
import { ANALYTICS_MODULE_CONFIG } from './analytics/config';
import { FEEDS_CONFIG } from './feeds/config';
import { HISTORY_CONFIG } from './history/config';
import { AI_CONFIG, AGENTS_CONFIG, AGENT_COPY_CONFIG, CAPTION_TESTS_CONFIG, TRANSLATED_POSTS_CONFIG, AI_TOOL_ERROR_CONFIG } from './studio/config';
import { HOME_CONFIG } from './home/config';
import { SHELL_CONFIG } from './shell/config';
import { INBOX_MODULE_CONFIG } from './inbox/config';
import { INTEGRATIONS_CONFIG } from './integrations/config';
import { MEDIA_CONFIG } from './media/config';
import { PUBLISHING_MODULE_CONFIG } from './publishing/config';
import { SETTINGS_MODULE_CONFIG } from './settings/config';
import { SHARING_CONFIG } from './sharing/config';
import { TASKS_CONFIG } from './tasks/config';
import { CALENDAR_EXTRAS_CONFIG } from './calendar-extras/config';
import { LINK_TOOLS_CONFIG } from './publishing/server/link-tools/config';
import { CHAT_CHANNELS_CONFIG } from './notifications/chat-channels/config';

/**
 * Root settings of every installed product module, in installation order. A module adds or
 * changes settings in its own config.ts; this list changes only when a module is installed.
 */
export const INSTALLED_MODULE_CONFIG = [
  ...ROOT_MONITORING_CONFIG,
  ...HOME_CONFIG,
  ...SHELL_CONFIG,
  ...CALENDAR_EXTRAS_CONFIG,
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
  ...TRANSLATED_POSTS_CONFIG,
  ...AI_TOOL_ERROR_CONFIG,
  ...AGENTS_CONFIG,
  ...AGENT_COPY_CONFIG,
  ...CAPTION_TESTS_CONFIG,
  ...ASYNC_POST_EXPORT_CONFIG,
  ...INTEGRATIONS_CONFIG,
  ...HISTORY_CONFIG,
  ...LINK_TOOLS_CONFIG,
  ...CHAT_CHANNELS_CONFIG,
] as const;
