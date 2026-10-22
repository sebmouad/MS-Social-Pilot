import { homeErrorCopy } from './server/copy';
import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { readHomeOverview } from './server/overview';
import { listNavigationCommands } from './server/commands';

export const homeToolDefinitions = [
  { name: 'get_home_overview', description: 'Read the workspace overview shown on Home: audience total and trend, views and engagement versus the previous period, top channels, interaction mix, best posting times, upcoming scheduled posts (with app or platform scheduling), open conversations and ad spend. Sections the member cannot use are reported as unavailable; nothing is fetched from providers.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_navigation_commands', description: 'List the pages the current member may open, in sidebar order with sidebar titles. Optional q filters by page, module or feature id. Pages the member cannot use are left out.', inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 200 } }, additionalProperties: false } },
] as const;

/** Home reads across every module the member can use, so restricted (channel-scoped) keys are refused: workspace tool. */
export const HOME_MCP: readonly McpToolGroup[] = [
  {
    id: 'home',
    tools: homeToolDefinitions,
    features: { get_home_overview: 'home/overview', list_navigation_commands: 'home/overview' },
    scope: { workspaceTools: ['get_home_overview', 'list_navigation_commands'] },
    execute: async (viewer, name, args) => {
      if (name === 'list_navigation_commands') return listNavigationCommands({ userId: viewer.userId, workspaceId: viewer.workspaceId }, args);
      if (name !== 'get_home_overview') throw new OperationError('invalid_request', (await homeErrorCopy()).supportedAction);
      return readHomeOverview({ userId: viewer.userId, workspaceId: viewer.workspaceId });
    },
  },
];
