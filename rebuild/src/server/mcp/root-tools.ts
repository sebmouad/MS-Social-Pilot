import { z } from 'zod';
import { prisma } from '../data';
import { readConfig, runtimeConfig, saveConfig } from '../config/store';
import { CONFIG_BY_KEY, CONFIG_SCHEMA_VERSION, safeConfigShape } from '@/lib/config/registry';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { setRootWorkspaceAccess } from '../root/workspace-access';
import { listRootWorkspaces } from '../root/directory';
import { listRootActivity } from '../root/activity';
import type { RootMcpActor } from './types';

export const rootToolDefinitions = [
  { name: 'get_root_config', description: 'Read installation configuration definitions and safe values. Only available to the signed-in instance owner; secrets are masked.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_root_workspaces', description: 'Private installation-owner workspace directory, including access state and record counts. Workspace API keys cannot use this tool.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'list_root_activity', description: 'Private installation-owner audit history. Search actions or people; filter exact workspace ID and inclusive UTC dates. Raw audit detail is omitted. Follow olderCursor/newerCursor with the same filters. Workspace API keys cannot use this tool.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, workspaceId: { type: 'string' }, from: { type: 'string', description: 'UTC date, YYYY-MM-DD.' }, to: { type: 'string', description: 'Inclusive UTC date, YYYY-MM-DD.' }, limit: { type: 'integer', minimum: 1 }, cursor: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_root_workspace_access', description: 'Suspend or restore workspace member access and new app operations. Only signed-in installation owners. Confirmation must exactly match SUSPEND WORKSPACE <workspaceId> or RESTORE WORKSPACE <workspaceId>. Data is retained; existing provider content is not deleted.', inputSchema: { type: 'object', required: ['workspaceId', 'suspended', 'confirmation'], properties: { workspaceId: { type: 'string' }, suspended: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_root_config', description: 'Validate and save an installation setting. Only available to the signed-in instance owner. Confirmation must exactly match SET ROOT CONFIG <key> or CLEAR ROOT SECRET <key>.', inputSchema: { type: 'object', required: ['key', 'confirmation'], properties: { key: { type: 'string' }, value: {}, clear: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
];

export const rootTools = new Set(rootToolDefinitions.map(tool => tool.name));
export const canUseRootTool = (viewer: RootMcpActor) => viewer.isInstanceOwner === true && !viewer.apiKeyId;
const resourceDefinitions = [
  { uri: 'msp://root/config', name: 'Root configuration', description: 'Installation setting definitions and safe values.', tool: 'get_root_config' },
  { uri: 'msp://root/workspaces', name: 'Installation workspaces', description: 'Private bounded workspace directory and access state.', tool: 'list_root_workspaces' },
  { uri: 'msp://root/activity', name: 'Installation activity', description: 'Private bounded audit history with safe metadata.', tool: 'list_root_activity' },
];
export const rootResources = resourceDefinitions.map(({ tool: _tool, ...resource }) => ({ ...resource, mimeType: 'application/json' }));
export const rootResourceTool = (uri: string) => resourceDefinitions.find(resource => resource.uri === uri)?.tool;
const configInput = z.object({ key: z.string().min(1), value: z.unknown().optional(), clear: z.boolean().optional(), confirmation: z.string().min(1) }).strict();

/** Shared private dispatcher: never depends on a workspace or its write lock. */
export async function runRootTool(viewer: RootMcpActor, name: string, args: Record<string, unknown>) {
  try {
    if (!canUseRootTool(viewer)) throw new OperationError('forbidden', 'Installation-owner access is required.');
    const actor = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { isInstanceOwner: true, disabledAt: true } });
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new OperationError('invalid_request', 'Tool arguments must be an object.');
    switch (name) {
      case 'get_root_config':
        if (Object.keys(args).length) throw new OperationError('invalid_request', 'This read does not accept filters.');
        return { schemaVersion: CONFIG_SCHEMA_VERSION, definitions: safeConfigShape(), values: await readConfig() };
      case 'list_root_activity':
        return await listRootActivity(viewer.userId, args, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
      case 'list_root_workspaces': {
        if (Object.keys(args).some(key => !['q', 'page'].includes(key)) || args.q !== undefined && typeof args.q !== 'string' || args.page !== undefined && (typeof args.page !== 'number' || !Number.isSafeInteger(args.page) || args.page < 1)) throw new OperationError('invalid_request', 'Choose a valid workspace query and page.');
        const cap = viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems'));
        return await listRootWorkspaces({ q: args.q as string | undefined, page: args.page === undefined ? undefined : String(args.page) }, Math.min(cap, Number(await runtimeConfig('root.directoryPageSize'))));
      }
      case 'set_root_workspace_access':
        if (Object.keys(args).some(key => !['workspaceId', 'suspended', 'confirmation'].includes(key)) || typeof args.workspaceId !== 'string' || !args.workspaceId.trim() || typeof args.suspended !== 'boolean' || typeof args.confirmation !== 'string' || !args.confirmation.length) throw new OperationError('invalid_request', 'Invalid workspace access change.');
        return await setRootWorkspaceAccess(viewer.userId, args.workspaceId, args.suspended, args.confirmation);
      case 'set_root_config': {
        const parsed = configInput.safeParse(args);
        if (!parsed.success) throw new OperationError('invalid_request', 'Enter a valid configuration change and exact confirmation.');
        const input = parsed.data;
        const definition = CONFIG_BY_KEY.get(input.key);
        if (!definition) throw new OperationError('invalid_request', 'Unknown configuration key.');
        const clear = input.clear === true;
        if (clear && definition.kind !== 'secret') throw new OperationError('invalid_request', 'Only secret values can be cleared.');
        if (!clear && (!definition.schema.safeParse(input.value).success || definition.kind === 'secret' && input.value === '')) throw new OperationError('invalid_request', 'Choose a valid value for this setting, or use its clear-secret action.');
        const expected = `${clear ? 'CLEAR ROOT SECRET' : 'SET ROOT CONFIG'} ${input.key}`;
        if (input.confirmation !== expected) throw new OperationError('invalid_request', `Confirmation required. Repeat the call with confirmation exactly: ${expected}`);
        // The shared service commits the setting and value-free audit atomically.
        // A separate after-commit MCP audit must not turn a saved change into a failure.
        await saveConfig({ key: input.key, value: input.value, clear }, viewer.userId);
        return { key: input.key, saved: true, schemaVersion: CONFIG_SCHEMA_VERSION };
      }
      default: throw new OperationError('invalid_request', 'Unknown installation tool.');
    }
  } catch (error) {
    const failure = operationFailure(error, 'The installation operation could not be completed. Please try again.');
    throw new OperationError(failure.code, failure.error);
  }
}
