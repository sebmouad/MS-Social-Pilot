import { runtimeConfig } from '@/server/config/store';
import { handleAgencyPersonMessage } from '@/modules/agency/person-mcp';
import { OperationError, operationFailure, type OperationErrorCode } from '@/lib/operation-error';
import { adsNoDispatchMetadata } from '@/modules/ads/management/errors';
import { installedMcpGroups } from '@/modules/installed-mcp';
import { resourceAllowedForScope, scopeRefusalMessage, toolAllowedForScope } from '@/modules/settings/mcp-access/tool-policy';
import { canUseFeature } from '../entitlements';
import { canAccessFeature } from '../permissions';
import { assertWorkspaceNotPurging, withWorkspaceOperation } from '../data-control/guard';
import { canManageData, type McpResourceDeclaration, type McpToolDefinition, type McpToolGroup } from './kit';
import type { McpIdentity, McpViewer } from './types';
export type { McpIdentity, McpViewer, McpInstallationViewer } from './types';
import { rootToolDefinitions, rootTools, canUseRootTool, rootResources, rootResourceTool, runRootTool } from './root-tools';

type JsonRpcId = string | number | null;

// Supported wire versions require implemented protocol handling, rather than a Root switch.
const SUPPORTED_MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const textResult = (value: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: Array.isArray(value) ? { items: value } : value,
});
/** Above this, a result would flood an AI client's context; the caller is asked to narrow the request instead. */
const MAX_RESULT_CHARACTERS = 200_000;
function sizedResult(value: unknown) {
  const result = textResult(value);
  const size = result.content[0]!.text.length;
  if (size <= MAX_RESULT_CHARACTERS) return result;
  return { ...textResult({ error: `This result is about ${Math.ceil(size / 1000)} KB, above the ${MAX_RESULT_CHARACTERS / 1000} KB limit. Narrow it with the tool's filters (limit, dates, channel, key or group) and try again.`, code: 'result_too_large' }), isError: true };
}

/** Tool hints for clients that auto-approve reads and confirm destructive or external actions (MCP tool annotations). */
const DESTRUCTIVE_TOOL = /^(delete|remove|revoke|disconnect|prune|purge|cancel|undo|transfer|disable)_|^set_root_workspace_access$/;
const OPEN_WORLD_TOOL = /publish|reply|sync|send_|moderate|ads_change|^create_ad_|^update_ad$|connection|webhook|chat_channel|generate_ai|start_ai|ai_assist|suggest_|import_media|link_preview|page_details|content_feed|recipe|^delete_post$|^delete_inbox_comment$/;
function annotate<T extends { name: string; annotations?: Record<string, unknown> }>(tool: T, write: boolean): T {
  return { ...tool, annotations: { readOnlyHint: !write, destructiveHint: write && DESTRUCTIVE_TOOL.test(tool.name), openWorldHint: OPEN_WORLD_TOOL.test(tool.name), ...tool.annotations } };
}
const ROOT_READ_TOOL = /^(list|get|export|preview)_/;
/** Ready-made workspace tasks for AI clients. They only describe which tools to use; every write still needs its exact confirmation. */
const WORKSPACE_PROMPTS = [
  { name: 'weekly_report', description: 'Summarize the last 7 days: key numbers vs the previous week and the best posts.',
    text: 'Write a short weekly report for this workspace. Use get_analytics_overview for the last 7 days with compare "previous", then get_analytics_posts for the same days sorted by the main measure, descending. Give the headline numbers with their change, the 3 best posts and one suggestion. Say when a figure is unknown instead of guessing.' },
  { name: 'reply_to_unanswered', description: 'Find comments that still need a reply and draft answers for review.',
    text: 'Use list_inbox with kind "comment", state "open" and quick ["unanswered"] to find comments waiting for a reply. For each, read it with get_inbox_thread and draft a short reply in the language of the comment. Show me the drafts first; only call reply_to_inbox for the ones I approve.' },
  { name: 'plan_next_week', description: 'Propose next week\'s posting plan from best times, the queue and content sources.',
    text: 'Plan next week. Use get_best_times for the selected channels, list_queue_times and list_posts with status "scheduled" to see what is already planned, and list_content_feeds or get_recipe_source for available content. Propose a day-by-day plan that fills the gaps without posting the same content on two channels the same day. Do not create or schedule anything until I confirm.' },
] as const;

/** Optional `toolsets` narrows the listed tools to feature areas (the part of a tool's feature before the slash). */
export type McpRequestOptions = { toolsets?: readonly string[] };

/**
 * Host view of the installed module declarations. Modules own their tools, features, write
 * flags, lock and manager rules, resources and scope classes; nothing here is per capability.
 */
type Host = {
  groups: readonly McpToolGroup[];
  tools: readonly McpToolDefinition[];
  groupOf: ReadonlyMap<string, McpToolGroup>;
  toolFeatures: Readonly<Record<string, string>>;
  writeTools: ReadonlySet<string>;
  selfLockedWrites: ReadonlySet<string>;
  lockedReads: ReadonlySet<string>;
  purgeCheckExempt: ReadonlySet<string>;
  resources: readonly { group: McpToolGroup; resource: McpResourceDeclaration }[];
};
let installed: Host | undefined;
function host(): Host {
  if (installed) return installed;
  const groups = installedMcpGroups();
  const groupOf = new Map<string, McpToolGroup>();
  for (const group of groups) for (const tool of group.tools) {
    if (groupOf.has(tool.name) || rootTools.has(tool.name)) throw new Error(`Duplicate MCP tool declaration: ${tool.name}`);
    groupOf.set(tool.name, group);
  }
  const all = (pick: (group: McpToolGroup) => Iterable<string> | undefined) => new Set(groups.flatMap(group => [...(pick(group) ?? [])]));
  installed = {
    groups,
    tools: [...rootToolDefinitions, ...groups.flatMap(group => group.tools)],
    groupOf,
    toolFeatures: Object.assign({}, ...groups.map(group => group.features)),
    // Root writes keep their own audit and lock handling in root-tools.ts.
    writeTools: new Set(['run_root_platform_publication_action', 'manage_root_user', 'set_root_config', 'set_root_workspace_access', ...all(group => group.writeTools)]),
    selfLockedWrites: all(group => group.selfLockedWrites),
    lockedReads: all(group => group.lockedReads),
    purgeCheckExempt: all(group => group.purgeCheckExempt),
    resources: groups.flatMap(group => (group.resources ?? []).map(resource => ({ group, resource }))),
  };
  return installed;
}

/** Registered workspace feature scopes; customer key choices must not promise unimplemented tools. */
export function workspaceMcpFeatureIds(): readonly string[] { return [...new Set(Object.values(host().toolFeatures))]; }

function managerRefusal(viewer: McpViewer, name: string, stage: 'beforeArguments' | 'inExecutor' | 'hideFromList') {
  const rule = host().groupOf.get(name)?.managers?.find(candidate => candidate[stage] && candidate.tools.has(name));
  return rule && !canManageData(viewer) ? rule.message : null;
}

async function runTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  if (!toolAllowedForScope(viewer, name)) throw new OperationError('forbidden', scopeRefusalMessage);
  if (rootTools.has(name)) return runRootTool(viewer, name, args);
  const boundary = host().groupOf.get(name)?.errorBoundary;
  if (boundary?.applies(name)) return boundary.wrap(() => executeTool(viewer, name, args));
  return executeTool(viewer, name, args);
}

async function executeTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  const { groupOf, toolFeatures, writeTools, purgeCheckExempt } = host();
  const managerMessage = managerRefusal(viewer, name, 'inExecutor');
  if (managerMessage) throw new OperationError('forbidden', managerMessage);
  if (rootTools.has(name) && !canUseRootTool(viewer)) throw new OperationError('forbidden', 'Installation-owner access is required.');
  const feature = toolFeatures[name];
  if (feature && !canUseFeature(viewer.entitlements, feature)) throw new OperationError('forbidden', 'This feature is unavailable.');
  if (feature && (!viewer.permissions || !canAccessFeature(viewer.permissions, feature, writeTools.has(name) ? 'write' : 'read'))) throw new OperationError('forbidden', 'You do not have permission to use this feature.');
  if (writeTools.has(name) && !purgeCheckExempt.has(name) && !rootTools.has(name)) {
    await assertWorkspaceNotPurging(viewer.workspaceId);
  }
  const cap = viewer.maxResultItems ?? await runtimeConfig('mcp.maxResultItems');
  const group = groupOf.get(name);
  if (!group) throw new OperationError('invalid_request', `Unknown tool: ${name}`);
  return group.execute(viewer, name, args, cap);
}

/** Each group's current availability; null means every declared tool is available. */
async function availability(viewer: McpViewer, pick: 'available' | 'listFilter') {
  const filters = new Map<McpToolGroup, (name: string) => boolean>();
  for (const group of host().groups) {
    const filter = group[pick];
    if (filter) filters.set(group, await filter(viewer));
  }
  return (name: string) => {
    const group = host().groupOf.get(name);
    const filter = group && filters.get(group);
    return !filter || filter(name);
  };
}

export async function handleMcpMessage(viewer: McpIdentity, message: Record<string, unknown>, options: McpRequestOptions = {}) {
  const inToolset = (name: string) => !options.toolsets?.length || rootTools.has(name) || options.toolsets.includes((host().toolFeatures[name] ?? '').split('/')[0]!);
  const validId = message.id === undefined || message.id === null || typeof message.id === 'string' || (typeof message.id === 'number' && Number.isFinite(message.id));
  const id = (validId ? message.id ?? null : null) as JsonRpcId;
  const method = message.method;
  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>;
  const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result }, { headers: { 'cache-control': 'no-store' } });
  const error = (code: number, text: string, operationCode?: OperationErrorCode) => Response.json({ jsonrpc: '2.0', id, error: { code, message: text, ...(operationCode ? { data: { code: operationCode } } : {}) } }, { headers: { 'cache-control': 'no-store' } });
  if (message.jsonrpc !== '2.0' || typeof method !== 'string' || !validId || (message.params !== undefined && (!message.params || typeof message.params !== 'object' || Array.isArray(message.params)))) return error(-32600, 'Invalid request.');
  if (message.id === undefined && method !== 'initialize') return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });
  if (viewer.scope === 'person') return handleAgencyPersonMessage(viewer, message);
  for (const group of host().groups) group.init?.();
  if (method === 'ping') return reply({});
  if (method === 'initialize') {
    const requested = String(params.protocolVersion ?? '');
    return reply({ protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_MCP_PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, ...(viewer.scope === 'workspace' ? { prompts: { listChanged: false } } : {}) }, serverInfo: { name: 'ms-social-pilot', version: '0.1.0' }, instructions: viewer.scope === 'installation' ? 'Private installation access. Only Root controls are available here. Workspace operations require an authorized workspace context. Every write requires an exact confirmation; shared domain services record changes in the audit history.' : `Workspace-scoped access for ${viewer.workspace.name}. Writes can manage local posts, publish posts, sync provider status, change channel/ad account selections, or manage connected-platform Inbox items. Publishing, remote post deletion, Inbox replies, and comment moderation contact social platforms. Every write requires an explicit confirmation string. Times use ${viewer.workspace.timezone}.` });
  }
  if (method === 'tools/list') {
    if (viewer.scope === 'installation') return reply({ tools: canUseRootTool(viewer) ? rootToolDefinitions.map(tool => annotate(tool, !ROOT_READ_TOOL.test(tool.name))) : [] });
    const { tools, toolFeatures, writeTools } = host();
    const listed = await availability(viewer, 'listFilter');
    const available = await availability(viewer, 'available');
    return reply({ tools: tools.filter(tool => inToolset(tool.name) && listed(tool.name) && toolAllowedForScope(viewer, tool.name) && available(tool.name) && (rootTools.has(tool.name) ? canUseRootTool(viewer) : canUseFeature(viewer.entitlements, toolFeatures[tool.name]!) && Boolean(viewer.permissions && canAccessFeature(viewer.permissions, toolFeatures[tool.name]!, writeTools.has(tool.name) ? 'write' : 'read')) && !managerRefusal(viewer, tool.name, 'hideFromList'))).map(tool => annotate(tool, rootTools.has(tool.name) ? !ROOT_READ_TOOL.test(tool.name) : writeTools.has(tool.name))) });
  }
  if (method === 'tools/call') {
    const name = String(params.name ?? '');
    const { tools, groupOf, writeTools, selfLockedWrites, lockedReads } = host();
    if (!tools.some(tool => tool.name === name)) return error(-32602, `Unknown tool: ${name}`);
    if (!inToolset(name)) return error(-32602, `Tool ${name} is outside the requested toolsets.`);
    try {
      if (viewer.scope === 'workspace' && !toolAllowedForScope(viewer, name)) throw new OperationError('forbidden', scopeRefusalMessage);
      if (rootTools.has(name)) return reply(sizedResult(await runRootTool(viewer, name, (params.arguments === undefined ? {} : params.arguments) as Record<string, unknown>)));
      if (viewer.scope === 'installation') throw new OperationError('forbidden', 'Workspace access is required for this operation.');
      const group = groupOf.get(name)!;
      group.beforeCall?.(viewer, name, writeTools.has(name));
      const managerMessage = managerRefusal(viewer, name, 'beforeArguments');
      if (managerMessage) throw new OperationError('forbidden', managerMessage);
      if (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments))) throw new OperationError('invalid_request', 'Tool arguments must be an object.');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (group.available && !(await group.available(viewer))(name)) throw new OperationError('unavailable', 'This action is unavailable.');
      // Services that own their workspace operation lock run without the outer one.
      const result = (writeTools.has(name) && !selfLockedWrites.has(name)) || lockedReads.has(name)
        ? await withWorkspaceOperation(viewer.workspaceId, () => runTool(viewer, name, args))
        : await runTool(viewer, name, args);
      return reply(sizedResult(result));
    }
    catch (failure) {
      const safe = operationFailure(failure, writeTools.has(name)
        ? 'The outcome could not be confirmed. Check the current state before repeating this action.'
        : 'This operation could not be completed. Please try again.');
      // A rejected request also says which arguments the tool takes, so a client can correct itself.
      const schema = safe.code === 'invalid_request' ? tools.find(tool => tool.name === name)?.inputSchema as { required?: string[]; properties?: Record<string, unknown> } | undefined : undefined;
      const expected = schema ? { expectedArguments: { required: schema.required ?? [], allowed: Object.keys(schema.properties ?? {}) } } : {};
      return reply({ ...textResult({ error: safe.error, code: safe.code, ...expected, ...adsNoDispatchMetadata(failure) }), isError: true });
    }
  }
  if (method === 'resources/list') {
    if (viewer.scope === 'installation') return reply({ resources: canUseRootTool(viewer) ? rootResources : [] });
    const listed = await availability(viewer, 'listFilter');
    const available = await availability(viewer, 'available');
    const visible = ({ resource }: { resource: McpResourceDeclaration }) => (!resource.requiresAvailableTool || (listed(resource.readTool) && available(resource.readTool)))
      && resourceAllowedForScope(viewer, resource.uri) && toolAllowedForScope(viewer, resource.readTool) && (!resource.managerOnly || canManageData(viewer))
      && (resource.feature === null || (canUseFeature(viewer.entitlements, resource.feature) && Boolean(viewer.permissions && canAccessFeature(viewer.permissions, resource.feature, 'read'))));
    return reply({ resources: [
      ...(resourceAllowedForScope(viewer, 'msp://workspace') ? [{ uri: 'msp://workspace', name: 'Workspace', description: 'Current workspace details.', mimeType: 'application/json' }] : []),
      ...host().resources.filter(visible).map(({ resource }) => ({ uri: resource.uri, name: resource.name, description: resource.description, mimeType: resource.mimeType })),
      ...(canUseRootTool(viewer) ? rootResources.filter(resource => resourceAllowedForScope(viewer, resource.uri)) : []),
    ] });
  }
  if (method === 'resources/read') {
    const uri = String(params.uri ?? '');
    if (viewer.scope === 'workspace' && !resourceAllowedForScope(viewer, uri)) return error(-32602, 'Resource unavailable.');
    const installationTool = rootResourceTool(uri);
    if (installationTool) {
      try {
        const contents = await runRootTool(viewer, installationTool, {});
        return reply({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }] });
      } catch (failure) {
        const safe = operationFailure(failure, 'The resource could not be read.');
        return error(-32603, safe.error, safe.code);
      }
    }
    if (viewer.scope === 'installation') return error(-32602, 'Workspace access is required for this resource.');
    const declared = host().resources.find(({ resource }) => resource.uri === uri)?.resource;
    // A direct URI read must satisfy the same declaration checks as resources/list,
    // even when the backing tool requires a different feature.
    if (declared && (!toolAllowedForScope(viewer, declared.readTool) || (declared.managerOnly && !canManageData(viewer)) || (declared.feature !== null && (!canUseFeature(viewer.entitlements, declared.feature) || !viewer.permissions || !canAccessFeature(viewer.permissions, declared.feature, 'read'))))) return error(-32602, 'Resource unavailable.');
    try {
      let contents: unknown;
      if (uri === 'msp://workspace') contents = viewer.workspace;
      else if (declared) contents = await runTool(viewer, declared.readTool, { ...(declared.readArgs ?? {}) });
      else return error(-32602, `Unknown resource: ${uri}`);
      return reply({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }] });
    } catch (failure) {
      const safe = operationFailure(failure, 'The resource could not be read.');
      return error(-32603, safe.error, safe.code);
    }
  }
  if (method === 'prompts/list') return reply({ prompts: viewer.scope === 'workspace' ? WORKSPACE_PROMPTS.map(({ name, description }) => ({ name, description })) : [] });
  if (method === 'prompts/get') {
    const prompt = viewer.scope === 'workspace' ? WORKSPACE_PROMPTS.find(item => item.name === params.name) : undefined;
    if (!prompt) return error(-32602, `Unknown prompt: ${String(params.name ?? '')}`);
    return reply({ description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text } }] });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } });
  return error(-32601, `Method not found: ${String(method)}`);
}
