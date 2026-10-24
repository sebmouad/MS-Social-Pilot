import { OperationError } from '@/lib/operation-error';
import { pageIdsFor, type McpToolGroup } from '@/server/mcp/kit';
import { changeWatermark, readWatermark } from './service';

const names = ['get_workspace_watermark', 'save_workspace_watermark', 'remove_workspace_watermark', 'apply_image_watermark'];
const writeTools = names.slice(1);
export const WATERMARK_MCP: McpToolGroup = {
  id: 'settings-watermark',
  tools: [
    { name: names[0]!, description: 'Read workspace watermark settings. Null means no logo configured. No image is changed automatically.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: names[1]!, description: 'Save workspace image watermark. Upload PNG/JPEG logo bytes as base64; omit logoBase64 to retain the saved logo. Scale fits the logo inside this fraction of image width and height. Confirmation: SAVE WATERMARK.', inputSchema: { type: 'object', required: ['position', 'opacity', 'scale', 'confirmation'], properties: { logoBase64: { type: 'string', maxLength: 12000000 }, position: { type: 'string', enum: ['northwest', 'northeast', 'center', 'southwest', 'southeast'] }, opacity: { type: 'number', minimum: 0, maximum: 1 }, scale: { type: 'number', minimum: 0.01, maximum: 1 }, confirmation: { type: 'string', const: 'SAVE WATERMARK' } }, additionalProperties: false } },
    { name: names[2]!, description: 'Remove workspace logo/settings. Existing watermarked copies are retained. Confirmation: REMOVE WATERMARK.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string', const: 'REMOVE WATERMARK' } }, additionalProperties: false } },
    { name: names[3]!, description: 'Explicitly watermark a workspace media image, producing a new PNG media reference to attach to a post. Original unchanged. Still PNG/JPEG only. Confirmation: APPLY WATERMARK.', inputSchema: { type: 'object', required: ['imageId', 'confirmation'], properties: { imageId: { type: 'string', format: 'uuid' }, confirmation: { type: 'string', const: 'APPLY WATERMARK' } }, additionalProperties: false } },
  ],
  features: { get_workspace_watermark: 'settings/workspace', save_workspace_watermark: 'settings/workspace', remove_workspace_watermark: 'settings/workspace', apply_image_watermark: 'publishing/posts' },
  writeTools, selfLockedWrites: writeTools,
  scope: { workspaceTools: names },
  managers: [{ tools: new Set(names.slice(0, 3)), message: 'Only workspace managers can configure watermarks.', inExecutor: true }],
  execute: async (viewer, name, args) => {
    const actor = { userId: viewer.userId, workspaceId: viewer.workspaceId, allowedChannelIds: pageIdsFor(viewer) };
    if (name === names[0]) {
      if (Object.keys(args).length) throw new OperationError('invalid_request', 'No arguments are accepted.');
      return readWatermark(actor);
    }
    const action = name === names[1] ? 'save' : name === names[2] ? 'remove' : name === names[3] ? 'apply' : null;
    if (!action || 'action' in args) throw new OperationError('invalid_request', 'Unknown watermark action.');
    return changeWatermark(actor, { ...args, action });
  },
};
