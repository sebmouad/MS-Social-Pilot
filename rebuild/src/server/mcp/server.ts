import { prisma } from '../data';
import { canUseFeature, requireFeature, type Entitlements } from '../entitlements';

export type McpViewer = { userId: string; workspaceId: string; workspace: { id: string; name: string; timezone: string }; entitlements: Entitlements };
type JsonRpcId = string | number | null;

const versions = ['2025-06-18', '2025-03-26', '2024-11-05'];
const textResult = (value: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: Array.isArray(value) ? { items: value } : value,
});

const tools = [
  { name: 'list_pages', description: 'List enabled workspace destinations and their publishing availability.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_posts', description: 'List workspace posts, newest first. Filter by status and scheduled date.', inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Comma-separated post statuses.' }, from: { type: 'string', description: 'ISO date or date-time lower bound for scheduledAt.' }, to: { type: 'string', description: 'ISO date or date-time upper bound for scheduledAt.' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: 'list_inbox', description: 'List synced comments and conversations visible in the workspace inbox.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['comment', 'message'] }, state: { type: 'string', enum: ['open', 'resolved', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: 'get_page_analytics', description: 'Read stored daily insights for one workspace Page.', inputSchema: { type: 'object', required: ['pageId'], properties: { pageId: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 365 } }, additionalProperties: false } },
];

const toolFeatures: Record<string, string> = {
  list_pages: 'settings/connections',
  list_posts: 'publishing/posts',
  list_inbox: 'inbox/conversations',
  get_page_analytics: 'analytics/overview',
};

async function runTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  const feature = toolFeatures[name];
  if (feature) requireFeature(viewer.entitlements, feature);
  switch (name) {
    case 'list_pages':
      return prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }], select: { id: true, type: true, providerId: true, name: true, pictureUrl: true, canPublish: true } });
    case 'list_posts': {
      const status = typeof args.status === 'string' ? args.status.split(',').map(s => s.trim()).filter(Boolean) : [];
      const allowedStatuses = new Set(['draft', 'pending_approval', 'rejected', 'scheduled', 'publishing', 'published', 'partially_failed', 'failed', 'cancelled']);
      if (status.some(value => !allowedStatuses.has(value))) throw new Error('status contains an unsupported post status.');
      const from = typeof args.from === 'string' ? new Date(args.from) : undefined;
      const to = typeof args.to === 'string' ? new Date(args.to) : undefined;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new Error('from and to must be valid ISO dates.');
      const limit = Math.max(1, Math.min(200, Math.trunc(Number(args.limit) || 100)));
      return prisma.post.findMany({ where: { workspaceId: viewer.workspaceId, ...(status.length ? { status: { in: status as never[] } } : {}), ...(from || to ? { scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }], take: limit, select: { id: true, message: true, status: true, scheduledAt: true, publishedAt: true, createdAt: true, targets: { select: { status: true, remotePostId: true, remoteUrl: true, target: { select: { id: true, type: true, name: true } } } } } });
    }
    case 'list_inbox': {
      const kind = args.kind === 'comment' || args.kind === 'message' ? args.kind : undefined;
      const state = args.state === 'resolved' || args.state === 'all' ? args.state : 'open';
      const limit = Math.max(1, Math.min(100, Math.trunc(Number(args.limit) || 50)));
      const conversationWhere = { target: { workspaceId: viewer.workspaceId }, ...(state === 'all' ? {} : { resolvedAt: state === 'resolved' ? { not: null } : null }) };
      const commentWhere = { isHidden: false, postTarget: { post: { workspaceId: viewer.workspaceId }, target: { workspaceId: viewer.workspaceId } }, ...(state === 'all' ? {} : { resolvedAt: state === 'resolved' ? { not: null } : null }) };
      const [conversations, comments] = await Promise.all([
        kind === 'comment' ? Promise.resolve([]) : prisma.conversation.findMany({ where: conversationWhere, orderBy: { updatedTime: 'desc' }, take: limit, select: { id: true, snippet: true, unreadCount: true, updatedTime: true, resolvedAt: true, target: { select: { id: true, type: true, name: true } }, messages: { orderBy: { createdTime: 'desc' }, take: 5, select: { id: true, fromName: true, message: true, createdTime: true } } } }),
        kind === 'message' ? Promise.resolve([]) : prisma.postComment.findMany({ where: commentWhere, orderBy: { createdTime: 'desc' }, take: limit, select: { id: true, message: true, fromName: true, createdTime: true, resolvedAt: true, replyCount: true, postTarget: { select: { target: { select: { id: true, type: true, name: true } }, post: { select: { id: true, message: true } } } } } }),
      ]);
      return { conversations, comments };
    }
    case 'get_page_analytics': {
      const pageId = String(args.pageId ?? '');
      const page = await prisma.target.findFirst({ where: { id: pageId, workspaceId: viewer.workspaceId, type: 'page' }, select: { id: true, name: true } });
      if (!page) throw new Error('Page not found in this workspace.');
      const days = Math.max(1, Math.min(365, Math.trunc(Number(args.days) || 30)));
      const rows = await prisma.pageInsight.findMany({ where: { targetId: pageId, period: 'day', endTime: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { endTime: 'desc' }, select: { metric: true, period: true, endTime: true, numeric: true, value: true } });
      return { page, days, insights: rows };
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
    return reply({ protocolVersion: versions.includes(requested) ? requested : versions[0], capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: 'ms-social-pilot', version: '0.1.0' }, instructions: `Read-only workspace data for ${viewer.workspace.name}. Times use ${viewer.workspace.timezone}.` });
  }
  if (method === 'tools/list') return reply({ tools: tools.filter(tool => canUseFeature(viewer.entitlements, toolFeatures[tool.name]!)) });
  if (method === 'tools/call') {
    const name = String(params.name ?? '');
    if (!tools.some(tool => tool.name === name)) return error(-32602, `Unknown tool: ${name}`);
    try { return reply(textResult(await runTool(viewer, name, (params.arguments ?? {}) as Record<string, unknown>))); }
    catch (e) { return reply({ ...textResult({ error: e instanceof Error ? e.message : 'Tool failed.' }), isError: true }); }
  }
  if (method === 'resources/list') return reply({ resources: [
    { uri: 'msp://workspace', name: 'Workspace', description: 'Current workspace details.', mimeType: 'application/json' },
    { uri: 'msp://targets', name: 'Destinations', description: 'Enabled workspace destinations.', mimeType: 'application/json' },
    { uri: 'msp://posts', name: 'Posts', description: 'Recent workspace posts.', mimeType: 'application/json' },
    { uri: 'msp://inbox', name: 'Inbox', description: 'Recent synced inbox activity.', mimeType: 'application/json' },
  ].filter(resource => {
    const feature = resource.uri === 'msp://targets' ? 'settings/connections' : resource.uri === 'msp://posts' ? 'publishing/posts' : resource.uri === 'msp://inbox' ? 'inbox/conversations' : null;
    return feature === null || canUseFeature(viewer.entitlements, feature);
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
