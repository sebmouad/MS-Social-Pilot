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

/**
 * MCP tool groups of every installed product module, in listing order. A module adds tools,
 * resources, confirmations and scope classifications in its own mcp.ts; this list changes only
 * when a module is installed.
 */
export function installedMcpGroups(): readonly McpToolGroup[] {
  return [...ADS_MCP, ...TASKS_MCP, ...SHARING_MCP, ...ANALYTICS_MCP, ...SETTINGS_MCP, ...PUBLISHING_MCP, ...INBOX_MCP, ...MEDIA_MCP, ...AI_MCP];
}
