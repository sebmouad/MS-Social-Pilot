import { homeErrorCopy } from './server/copy';
import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { readHomeOverview } from './server/overview';
import { listNavigationCommands } from './server/commands';

export const homeToolDefinitions = [
  { name: 'get_home_overview', description: 'Read the workspace overview shown on Home: audience total, trend and delta, views, engagement and link clicks versus the previous period, top channels, interaction mix, best posting times, upcoming scheduled posts (with app or platform scheduling), open conversations with recent rows, ad spend, and the needs-attention counts (failed and partly failed posts, pending approvals, waiting conversations, connections to reconnect). Optional channelIds narrows every figure to those channels. Sections the member cannot use are reported as unavailable; nothing is fetched from providers.', inputSchema: { type: 'object', properties: { channelIds: { type: 'array', maxItems: 500, items: { type: 'string', maxLength: 200 } } }, additionalProperties: false } },
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
      const channelIds = Array.isArray(args.channelIds) && args.channelIds.every(id => typeof id === 'string') ? (args.channelIds as string[]) : undefined;
      return readHomeOverview({ userId: viewer.userId, workspaceId: viewer.workspaceId }, new Date(), channelIds ? { channelIds } : {});
    },
  },
];
