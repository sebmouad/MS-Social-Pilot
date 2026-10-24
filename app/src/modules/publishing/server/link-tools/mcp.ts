import { OperationError } from '@/lib/operation-error';
import { publishingActor, type McpToolGroup } from '@/server/mcp/kit';
import type { McpViewer } from '@/server/mcp/types';
import type { ToolViewerActor } from '@/modules/studio/server/tool-kit';
import { LINK_FEATURE, linkTools } from './service';

export const linkToolDefinitions = [
  { name: 'get_page_details', description: 'Read the details a public web page describes for search engines (articles, products, events, recipes, jobs, courses, places) and return ready captions built from them. Private and loopback addresses are refused; requests are limited per workspace per hour. Saves nothing.', inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', minLength: 1, maxLength: 8000 } }, additionalProperties: false } },
] as const;

/** Same actor construction as the other Publishing composer tools; the key's permission ceiling reaches the service check. */
const actorOf = (viewer: McpViewer): ToolViewerActor => ({ ...publishingActor(viewer), ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}) } as ToolViewerActor);

export async function executeLinkTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  if (name === 'get_page_details') return linkTools(actorOf(viewer), args);
  throw new OperationError('invalid_request', 'Choose a supported link action.');
}

/** Reads a public page only; no channel data is touched, so a restricted-channel credential may use it like get_link_preview. */
export const LINK_TOOLS_MCP: McpToolGroup = {
  id: 'publishing-link-tools',
  tools: linkToolDefinitions,
  features: { get_page_details: LINK_FEATURE },
  scope: { resourceTools: ['get_page_details'] },
  execute: (viewer, name, args) => executeLinkTool(viewer, name, args),
};
