import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { requireConfirmation, type McpToolGroup } from '@/server/mcp/kit';
import { downloadWorkspaceExport, listWorkspaceExports, requestWorkspaceExport } from './server/exports';

const names = ['list_workspace_exports', 'request_workspace_export', 'download_workspace_export'];
export const WORKSPACE_EXPORT_MCP: McpToolGroup = {
  id: 'settings-exports',
  tools: [
    { name: names[0], description: 'List workspace ZIP export jobs, their current status and expiry. Workspace owners and admins only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: names[1], description: 'Request a durable background workspace ZIP archive, using the shared archive coverage. Exact confirmation: REQUEST WORKSPACE EXPORT <workspaceId>. Workspace owners and admins only.', inputSchema: { type: 'object', required: ['confirmation'], properties: { confirmation: { type: 'string', maxLength: 400 } }, additionalProperties: false } },
    { name: names[2], description: 'Download a ready, unexpired workspace ZIP export as base64 content. Current owner/admin authority is checked again; expired exports cannot be downloaded.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } }, additionalProperties: false } },
  ],
  features: Object.fromEntries(names.map(name => [name, 'settings/data'])),
  writeTools: ['request_workspace_export'],
  selfLockedWrites: ['request_workspace_export'],
  scope: { workspaceTools: names, resources: ['msp://data/exports'] },
  managers: [{ tools: new Set(names), message: 'Only workspace owners and admins can manage workspace exports.', hideFromList: true, beforeArguments: true, inExecutor: true }],
  resources: [{ uri: 'msp://data/exports', name: 'Workspace ZIP exports', description: 'Durable workspace ZIP export status and expiry. Download ready jobs with download_workspace_export.', mimeType: 'application/json', feature: 'settings/data', readTool: 'list_workspace_exports', managerOnly: true, guardedRead: true }],
  execute: async (viewer, name, args) => {
    const actor = { userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.apiKeyId ? { apiKeyId: viewer.apiKeyId } : {}) };
    if (name === 'list_workspace_exports') {
      if (Object.keys(args).length) throw new OperationError('invalid_request', 'Export lists take no arguments.');
      return { jobs: await listWorkspaceExports(actor) };
    }
    if (name === 'request_workspace_export') {
      requireConfirmation(args, `REQUEST WORKSPACE EXPORT ${viewer.workspaceId}`);
      if (Object.keys(args).some(key => key !== 'confirmation')) throw new OperationError('invalid_request', 'Invalid export request.');
      return { job: await requestWorkspaceExport(actor, args.confirmation as string) };
    }
    if (name === 'download_workspace_export') {
      const input = z.object({ id: z.string().min(1).max(200) }).strict().safeParse(args);
      if (!input.success) throw new OperationError('invalid_request', 'A valid export id is required.');
      const archive = await downloadWorkspaceExport(actor, input.data.id);
      return { id: archive.id, mimeType: 'application/zip', contentBase64: archive.content.toString('base64') };
    }
    throw new OperationError('invalid_request', 'Unknown export action.');
  },
};
