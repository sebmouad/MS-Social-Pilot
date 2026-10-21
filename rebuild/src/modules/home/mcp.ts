import { homeErrorCopy } from './server/copy';
import { OperationError } from '@/lib/operation-error';
import type { McpToolGroup } from '@/server/mcp/kit';
import { readHomeOverview } from './server/overview';

export const homeToolDefinitions = [
  { name: 'get_home_overview', description: 'Read the workspace overview shown on Home: audience total and trend, views and engagement versus the previous period, top channels, interaction mix, best posting times, upcoming scheduled posts (with app or platform scheduling), open conversations and ad spend. Sections the member cannot use are reported as unavailable; nothing is fetched from providers.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
] as const;

/** Home reads across every module the member can use, so restricted (channel-scoped) keys are refused: workspace tool. */
export const HOME_MCP: readonly McpToolGroup[] = [
  {
    id: 'home',
    tools: homeToolDefinitions,
    features: { get_home_overview: 'home/overview' },
    scope: { workspaceTools: ['get_home_overview'] },
    execute: async (viewer, name) => {
      if (name !== 'get_home_overview') throw new OperationError('invalid_request', (await homeErrorCopy()).supportedAction);
      return readHomeOverview({ userId: viewer.userId, workspaceId: viewer.workspaceId });
    },
  },
];
