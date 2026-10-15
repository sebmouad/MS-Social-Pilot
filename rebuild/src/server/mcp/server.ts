import { prisma } from '../data';
import { canUseFeature, requireFeature, type Entitlements } from '../entitlements';
import { createLocalDraft, deleteLocalDraft, updateLocalDraft } from '../post-mutations';
import { setConnectionSelections } from '../connection-mutations';
import { randomBytes } from 'node:crypto';
import { canAccessFeature, canAccessPage, type ScopedPermissions } from '../permissions';

export type McpViewer = { userId: string; workspaceId: string; role: string; workspace: { id: string; name: string; timezone: string }; entitlements: Entitlements; permissions?: ScopedPermissions; maxResultItems?: number };
type JsonRpcId = string | number | null;

const versions = ['2025-06-18', '2025-03-26', '2024-11-05'];
const pageIdsFor = (viewer: McpViewer): string[] | undefined => viewer.permissions?.pageScope.all === false ? [...viewer.permissions.pageScope.ids] : undefined;
const textResult = (value: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: Array.isArray(value) ? { items: value } : value,
});

const tools = [
  { name: 'list_pages', description: 'List enabled workspace destinations and their publishing availability.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_posts', description: 'List workspace posts, newest first. Filter by status and scheduled date.', inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Comma-separated post statuses.' }, from: { type: 'string', description: 'ISO date or date-time lower bound for scheduledAt.' }, to: { type: 'string', description: 'ISO date or date-time upper bound for scheduledAt.' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: 'list_inbox', description: 'List synced comments and conversations visible in the workspace inbox.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['comment', 'message'] }, state: { type: 'string', enum: ['open', 'resolved', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: 'get_page_analytics', description: 'Read stored daily insights for one workspace Page.', inputSchema: { type: 'object', required: ['pageId'], properties: { pageId: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false } },
  { name: 'list_ad_accounts', description: 'List advertising accounts in this workspace.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'create_draft', description: 'Create an unpublished local draft. Confirmation is required: confirmation must be exactly CREATE DRAFT.', inputSchema: { type: 'object', required: ['message', 'confirmation'], properties: { message: { type: 'string', minLength: 1, maxLength: 10000 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'update_draft', description: 'Edit an unconnected local draft. Confirmation must be exactly UPDATE DRAFT followed by its ID.', inputSchema: { type: 'object', required: ['postId', 'message', 'confirmation'], properties: { postId: { type: 'string' }, message: { type: 'string', minLength: 1, maxLength: 10000 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_draft', description: 'Permanently delete an unconnected local draft. Confirmation must be exactly DELETE DRAFT followed by its ID.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_connection_selection', description: 'Enable or disable one workspace channel or advertising account. Confirmation must exactly identify the selection and action.', inputSchema: { type: 'object', required: ['kind', 'id', 'enabled', 'confirmation'], properties: { kind: { type: 'string', enum: ['target', 'adAccount'] }, id: { type: 'string' }, enabled: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
];

const toolFeatures: Record<string, string> = {
  list_pages: 'settings/connections',
  list_posts: 'publishing/posts',
  list_inbox: 'inbox/conversations',
  get_page_analytics: 'analytics/overview',
  list_ad_accounts: 'ads/campaigns',
  create_draft: 'publishing/posts',
  update_draft: 'publishing/posts',
  delete_draft: 'publishing/posts',
  set_connection_selection: 'settings/connections',
};

async function auditWrite(viewer: McpViewer, tool: string, detail: Record<string, unknown>) {
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`mcp_${randomBytes(12).toString('hex')}`}, ${viewer.userId}, 'mcp.write', ${JSON.stringify({ workspaceId: viewer.workspaceId, tool, ...detail })}::jsonb, NOW())`;
}

function requireConfirmation(args: Record<string, unknown>, expected: string) {
  if (args.confirmation !== expected) throw new Error(`Confirmation required. Repeat the call with confirmation exactly: ${expected}`);
}

async function runTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  const feature = toolFeatures[name];
  if (feature) requireFeature(viewer.entitlements, feature);
  if (feature && (!viewer.permissions || !canAccessFeature(viewer.permissions, feature, name.startsWith('create_') || name.startsWith('update_') || name.startsWith('delete_') || name === 'set_connection_selection' ? 'write' : 'read'))) throw new Error('You do not have permission to use this feature.');
  const cap = viewer.maxResultItems ?? 100;
  switch (name) {
    case 'list_pages':
      const pageIds = pageIdsFor(viewer);
      return prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, ...(pageIds ? { id: { in: pageIds } } : {}) }, orderBy: [{ type: 'asc' }, { name: 'asc' }], take: cap, select: { id: true, type: true, providerId: true, name: true, pictureUrl: true, canPublish: true } });
    case 'list_posts': {
      const status = typeof args.status === 'string' ? args.status.split(',').map(s => s.trim()).filter(Boolean) : [];
      const allowedStatuses = new Set(['draft', 'pending_approval', 'rejected', 'scheduled', 'publishing', 'published', 'partially_failed', 'failed', 'cancelled']);
      if (status.some(value => !allowedStatuses.has(value))) throw new Error('status contains an unsupported post status.');
      const from = typeof args.from === 'string' ? new Date(args.from) : undefined;
      const to = typeof args.to === 'string' ? new Date(args.to) : undefined;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new Error('from and to must be valid ISO dates.');
      const limit = Math.max(1, Math.min(cap, Math.trunc(Number(args.limit) || cap)));
      const pageIds = pageIdsFor(viewer);
      return prisma.post.findMany({ where: { workspaceId: viewer.workspaceId, ...(pageIds ? { OR: [{ targets: { some: { targetId: { in: pageIds } } } }, { authorId: viewer.userId, targets: { none: {} } }] } : {}), ...(status.length ? { status: { in: status as never[] } } : {}), ...(from || to ? { scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }], take: limit, select: { id: true, message: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, targets: { where: pageIds ? { targetId: { in: pageIds } } : {}, select: { status: true, remotePostId: true, remoteUrl: true, target: { select: { id: true, type: true, name: true } } } } } });
    }
    case 'list_inbox': {
      const kind = args.kind === 'comment' || args.kind === 'message' ? args.kind : undefined;
      const state = args.state === 'resolved' || args.state === 'all' ? args.state : 'open';
      const limit = Math.max(1, Math.min(cap, Math.trunc(Number(args.limit) || Math.min(50, cap))));
      const pageIds = pageIdsFor(viewer);
      const conversationWhere = { target: { workspaceId: viewer.workspaceId, ...(pageIds ? { id: { in: pageIds } } : {}) }, ...(state === 'all' ? {} : { resolvedAt: state === 'resolved' ? { not: null } : null }) };
      const commentWhere = { isHidden: false, postTarget: { post: { workspaceId: viewer.workspaceId }, target: { workspaceId: viewer.workspaceId, ...(pageIds ? { id: { in: pageIds } } : {}) } }, ...(state === 'all' ? {} : { resolvedAt: state === 'resolved' ? { not: null } : null }) };
      const [conversations, comments] = await Promise.all([
        kind === 'comment' ? Promise.resolve([]) : prisma.conversation.findMany({ where: conversationWhere, orderBy: { updatedTime: 'desc' }, take: limit, select: { id: true, snippet: true, unreadCount: true, updatedTime: true, resolvedAt: true, target: { select: { id: true, type: true, name: true } }, messages: { orderBy: { createdTime: 'desc' }, take: 5, select: { id: true, fromName: true, message: true, createdTime: true } } } }),
        kind === 'message' ? Promise.resolve([]) : prisma.postComment.findMany({ where: commentWhere, orderBy: { createdTime: 'desc' }, take: limit, select: { id: true, message: true, fromName: true, createdTime: true, resolvedAt: true, replyCount: true, postTarget: { select: { target: { select: { id: true, type: true, name: true } }, post: { select: { id: true, message: true } } } } } }),
      ]);
      return { conversations, comments };
    }
    case 'get_page_analytics': {
      const pageId = String(args.pageId ?? '');
      const pageIds = pageIdsFor(viewer);
      const page = await prisma.target.findFirst({ where: { id: pageId, workspaceId: viewer.workspaceId, type: 'page', ...(pageIds ? { id: { in: pageIds } } : {}) }, select: { id: true, name: true } });
      if (!page) throw new Error('Page not found in this workspace.');
      const days = Math.max(1, Math.min(365, Math.trunc(Number(args.days) || 30)));
      const rows = await prisma.pageInsight.findMany({ where: { targetId: pageId, period: 'day', endTime: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { endTime: 'desc' }, take: cap, select: { metric: true, period: true, endTime: true, numeric: true, value: true } });
      return { page, days, insights: rows };
    }
    case 'list_ad_accounts':
      if (viewer.role !== 'owner' && viewer.role !== 'admin') throw new Error('Only workspace owners and admins can list advertising accounts.');
      return prisma.adAccount.findMany({ where: { workspaceId: viewer.workspaceId }, orderBy: { name: 'asc' }, take: cap, select: { id: true, actId: true, name: true, enabled: true, currency: true } });
    case 'create_draft': {
      requireFeature(viewer.entitlements, 'publishing/posts');
      requireConfirmation(args, 'CREATE DRAFT');
      const message = typeof args.message === 'string' ? args.message.trim() : '';
      if (!message || message.length > 10000) throw new Error('message must contain 1 to 10000 characters.');
      const result = await createLocalDraft(viewer, message);
      await auditWrite(viewer, name, { postId: result.id });
      return { id: result.id, status: 'draft' };
    }
    case 'update_draft': {
      requireFeature(viewer.entitlements, 'publishing/posts');
      const postId = String(args.postId ?? '');
      requireConfirmation(args, `UPDATE DRAFT ${postId}`);
      const message = typeof args.message === 'string' ? args.message.trim() : '';
      if (!postId || !message || message.length > 10000) throw new Error('postId and a message of 1 to 10000 characters are required.');
      await updateLocalDraft(viewer, postId, message);
      await auditWrite(viewer, name, { postId });
      return { id: postId, status: 'draft', updated: true };
    }
    case 'delete_draft': {
      requireFeature(viewer.entitlements, 'publishing/posts');
      const postId = String(args.postId ?? '');
      requireConfirmation(args, `DELETE DRAFT ${postId}`);
      if (!postId) throw new Error('postId is required.');
      await deleteLocalDraft(viewer, postId);
      await auditWrite(viewer, name, { postId });
      return { id: postId, deleted: true };
    }
    case 'set_connection_selection': {
      requireFeature(viewer.entitlements, 'settings/connections');
      const kind = args.kind === 'target' || args.kind === 'adAccount' ? args.kind : null;
      const id = typeof args.id === 'string' ? args.id : '';
      const enabled = args.enabled === true;
      if (!kind || !id || typeof args.enabled !== 'boolean') throw new Error('kind, id, and enabled are required.');
      const action = enabled ? 'ENABLED' : 'DISABLED';
      requireConfirmation(args, `SET CONNECTION ${kind} ${id} ${action}`);
      await setConnectionSelections(viewer, [{ kind, id, enabled }]);
      await auditWrite(viewer, name, { kind, id, enabled });
      return { kind, id, enabled };
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleMcpMessage(viewer: McpViewer, message: Record<string, unknown>) {
  const id = (message.id ?? null) as JsonRpcId;
  const method = message.method;
  const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>;
  const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result });
  const error = (code: number, text: string) => Response.json({ jsonrpc: '2.0', id, error: { code, message: text } });
  if (message.jsonrpc !== '2.0' || typeof method !== 'string') return error(-32600, 'Invalid request.');
  if (message.id === undefined && method !== 'initialize') return new Response(null, { status: 202 });
  if (method === 'ping') return reply({});
  if (method === 'initialize') {
    const requested = String(params.protocolVersion ?? '');
    return reply({ protocolVersion: versions.includes(requested) ? requested : versions[0], capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: 'ms-social-pilot', version: '0.1.0' }, instructions: `Workspace-scoped access for ${viewer.workspace.name}. Writes are limited to local drafts and channel/ad account selections. Every write requires an explicit confirmation string. Times use ${viewer.workspace.timezone}.` });
  }
  if (method === 'tools/list') return reply({ tools: tools.filter(tool => canUseFeature(viewer.entitlements, toolFeatures[tool.name]!) && Boolean(viewer.permissions && canAccessFeature(viewer.permissions, toolFeatures[tool.name]!, ['create_draft', 'update_draft', 'delete_draft', 'set_connection_selection'].includes(tool.name) ? 'write' : 'read')) && (tool.name !== 'set_connection_selection' || viewer.role === 'owner' || viewer.role === 'admin') && (tool.name !== 'list_ad_accounts' || viewer.role === 'owner' || viewer.role === 'admin')) });
  if (method === 'tools/call') {
    const name = String(params.name ?? '');
    if (!tools.some(tool => tool.name === name)) return error(-32602, `Unknown tool: ${name}`);
    try {
      if (name === 'set_connection_selection' && viewer.role !== 'owner' && viewer.role !== 'admin') throw new Error('Only workspace owners and admins can change connections.');
      return reply(textResult(await runTool(viewer, name, (params.arguments ?? {}) as Record<string, unknown>)));
    }
    catch (e) { return reply({ ...textResult({ error: e instanceof Error ? e.message : 'Tool failed.' }), isError: true }); }
  }
  if (method === 'resources/list') return reply({ resources: [
    { uri: 'msp://workspace', name: 'Workspace', description: 'Current workspace details.', mimeType: 'application/json' },
    { uri: 'msp://targets', name: 'Destinations', description: 'Enabled workspace destinations.', mimeType: 'application/json' },
    { uri: 'msp://posts', name: 'Posts', description: 'Recent workspace posts.', mimeType: 'application/json' },
    { uri: 'msp://inbox', name: 'Inbox', description: 'Recent synced inbox activity.', mimeType: 'application/json' },
  ].filter(resource => {
    const feature = resource.uri === 'msp://targets' ? 'settings/connections' : resource.uri === 'msp://posts' ? 'publishing/posts' : resource.uri === 'msp://inbox' ? 'inbox/conversations' : null;
    return feature === null || (canUseFeature(viewer.entitlements, feature) && Boolean(viewer.permissions && canAccessFeature(viewer.permissions, feature, 'read')));
  }) });
  if (method === 'resources/read') {
    const uri = String(params.uri ?? '');
    let contents: unknown;
    if (uri === 'msp://workspace') contents = viewer.workspace;
    else if (uri === 'msp://targets') contents = await runTool(viewer, 'list_pages', {});
    else if (uri === 'msp://posts') contents = await runTool(viewer, 'list_posts', { limit: 100 });
    else if (uri === 'msp://inbox') contents = await runTool(viewer, 'list_inbox', { limit: 50 });
    else return error(-32602, `Unknown resource: ${uri}`);
    return reply({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }] });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return new Response(null, { status: 202 });
  return error(-32601, `Method not found: ${String(method)}`);
}
