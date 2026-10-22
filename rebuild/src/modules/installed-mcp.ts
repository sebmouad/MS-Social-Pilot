import type { McpToolGroup } from '@/server/mcp/kit';
import { ADS_MCP } from './ads/mcp';
import { TASKS_MCP } from './tasks/mcp';
import { SHARING_MCP } from './sharing/mcp';
import { ANALYTICS_MCP } from './analytics/mcp';
import { SETTINGS_MCP } from './settings/mcp';
import { PUBLISHING_MCP } from './publishing/mcp';
import { INBOX_MCP } from './inbox/mcp';
import { MEDIA_MCP } from './media/mcp';
import { AI_MCP } from './ai/mcp';
import { AI_CONTENT_TOOLS_MCP } from './ai/content-tools/mcp';
import { CAPTION_TESTS_MCP } from './caption-tests/mcp';
import { AGENTS_MCP } from './agents/mcp';
import { ASYNC_POST_EXPORT_MCP, ASYNC_POST_EXPORT_READ_MCP } from './publishing/server/export/entry-points';
import { FEEDS_MCP } from './feeds/mcp';
import { INTEGRATIONS_MCP } from './integrations/mcp';
import { HOME_MCP } from './home/mcp';
import { HISTORY_MCP } from './history/mcp';
import { CALENDAR_EXTRAS_MCP } from './calendar-extras/mcp';
import { LINK_TOOLS_MCP } from './publishing/server/link-tools/mcp';
import { AI_TRANSLATED_MCP } from './ai/server/translated/mcp';
import { CHAT_CHANNELS_MCP } from './notifications/chat-channels/mcp';

/**
 * MCP tool groups of every installed product module, in listing order. A module adds tools,
 * resources, confirmations and scope classifications in its own mcp.ts; this list changes only
 * when a module is installed.
 */
export function installedMcpGroups(): readonly McpToolGroup[] {
  return [...HOME_MCP, ...ADS_MCP, ...TASKS_MCP, ...SHARING_MCP, ...ANALYTICS_MCP, ...SETTINGS_MCP, ...PUBLISHING_MCP, ...ASYNC_POST_EXPORT_MCP, ...ASYNC_POST_EXPORT_READ_MCP, ...INBOX_MCP, ...MEDIA_MCP, ...FEEDS_MCP, ...AI_MCP, AI_CONTENT_TOOLS_MCP, ...CAPTION_TESTS_MCP, ...AGENTS_MCP, ...INTEGRATIONS_MCP, ...HISTORY_MCP, ...CALENDAR_EXTRAS_MCP, LINK_TOOLS_MCP, AI_TRANSLATED_MCP, ...CHAT_CHANNELS_MCP];
}
