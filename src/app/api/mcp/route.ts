import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { AuthError, ForbiddenError } from '@/lib/auth';
import { requireApiToken, type ApiContext } from '@/lib/api-tokens';
import { AppError } from '@/lib/errors';
import {
  apiApprovePost,
  apiAssignInbox,
  apiAttention,
  apiCancelPost,
  apiCreatePost,
  apiListPages,
  apiListQueue,
  apiListTemplates,
  apiListPosts,
  apiPageAnalytics,
  apiReadInbox,
  apiRejectPost,
  apiResolveInbox,
  apiUpdatePost,
} from '@/lib/public-api';

/**
 * A Model Context Protocol server, so Claude (or any MCP client) can read the
 * workspace and draft or schedule posts with an API key.
 *
 * Streamable HTTP with plain JSON replies: one POST, one JSON-RPC message, one
 * answer. No sessions and no server-sent events — every tool is a quick
 * request — which keeps it a stateless route like the rest of the API.
 *
 * Writing tools need a `write` key, and a post made here goes through the same
 * approval and queue rules as one made in the composer.
 */

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Tool {
  name: string;
  description: string;
  write?: boolean;
  inputSchema: Record<string, unknown>;
  run: (ctx: ApiContext, args: Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: Tool[] = [
  {
    name: 'list_pages',
    description: 'List the Facebook Pages this key can use, with their ids and follower counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => apiListPages(ctx),
  },
  {
    name: 'list_posts',
    description:
      'List posts, newest first. Filter by status (draft, scheduled, pending_approval, published, failed) and by scheduled date.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'One status, or several separated by commas.' },
        from: { type: 'string', description: 'ISO date or date-time: scheduled on or after.' },
        to: { type: 'string', description: 'ISO date or date-time: scheduled on or before.' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    run: (ctx, args) => apiListPosts(ctx, args),
  },
  {
    name: 'create_post',
    description:
      'Create a Facebook post on one or more Pages: as a draft, at a time, or in the next free queue slot. ' +
      'Nothing is published immediately. Approval rules of the workspace apply.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['targetIds'],
      properties: {
        targetIds: { type: 'array', items: { type: 'string' }, description: 'Page ids from list_pages.' },
        message: { type: 'string', description: 'The post text.' },
        link: { type: 'string', description: 'A link to attach (feed posts only).' },
        firstComment: { type: 'string', description: 'Posted as the Page under the post.' },
        scheduledAtLocal: {
          type: 'string',
          description: 'Wall-clock time "YYYY-MM-DDTHH:mm" in the workspace timezone.',
        },
        useQueue: { type: 'boolean', description: 'Take the next free queue slot instead of a time.' },
        saveAsDraft: { type: 'boolean', description: 'Keep it as a draft. Default true when no time is given.' },
      },
      additionalProperties: false,
    },
    run: (ctx, args) => {
      const timed = Boolean(args.scheduledAtLocal) || args.useQueue === true;
      return apiCreatePost(ctx, {
        ...args,
        saveAsDraft: args.saveAsDraft ?? !timed,
        publishMode: 'worker',
        timezone: ctx.workspace.timezone,
      });
    },
  },
  {
    name: 'update_post',
    description:
      'Change a post: its text, link, time (scheduledAtLocal, "YYYY-MM-DDTHH:mm" in the workspace timezone), destinations, or set status to draft, scheduled or cancelled.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['postId'],
      properties: {
        postId: { type: 'string' },
        message: { type: 'string' },
        link: { type: ['string', 'null'] },
        firstComment: { type: ['string', 'null'] },
        scheduledAtLocal: { type: ['string', 'null'] },
        targetIds: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['draft', 'scheduled', 'cancelled'] },
      },
      additionalProperties: false,
    },
    run: (ctx, args) => {
      const { postId, ...changes } = args;
      return apiUpdatePost(ctx, String(postId ?? ''), changes);
    },
  },
  {
    name: 'cancel_post',
    description: 'Cancel a post. Copies already handed to Facebook are removed there too; failures are reported.',
    write: true,
    inputSchema: { type: 'object', required: ['postId'], properties: { postId: { type: 'string' } }, additionalProperties: false },
    run: (ctx, args) => apiCancelPost(ctx, String(args.postId ?? '')),
  },
  {
    name: 'approve_post',
    description: 'Approve a post that is waiting for review. Needs a key whose owner may approve.',
    write: true,
    inputSchema: { type: 'object', required: ['postId'], properties: { postId: { type: 'string' } }, additionalProperties: false },
    run: (ctx, args) => apiApprovePost(ctx, String(args.postId ?? '')),
  },
  {
    name: 'request_changes',
    description: 'Send a post waiting for review back to its author with a note saying what to change.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['postId', 'note'],
      properties: { postId: { type: 'string' }, note: { type: 'string' } },
      additionalProperties: false,
    },
    run: (ctx, args) => apiRejectPost(ctx, String(args.postId ?? ''), String(args.note ?? '')),
  },
  {
    name: 'list_inbox',
    description: 'Comments and messages people wrote to the Pages, newest first. state: open (default), resolved or all.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['comment', 'message'] },
        state: { type: 'string', enum: ['open', 'resolved', 'all'] },
        assignee: { type: 'string', enum: ['mine', 'unassigned'], description: 'Only what is assigned to this key’s owner, or to nobody.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: (ctx, args) => apiReadInbox(ctx, args),
  },
  {
    name: 'resolve_inbox_item',
    description: 'Mark a comment or message done (or not done) for the whole team.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['kind', 'id'],
      properties: {
        kind: { type: 'string', enum: ['comment', 'message'] },
        id: { type: 'string' },
        resolved: { type: 'boolean', description: 'true (default) marks it done.' },
      },
      additionalProperties: false,
    },
    run: (ctx, args) => apiResolveInbox(ctx, args),
  },
  {
    name: 'assign_inbox_item',
    description: 'Give a comment or message to a teammate (assigneeId is a user id), or pass null to take it back.',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['kind', 'id', 'assigneeId'],
      properties: {
        kind: { type: 'string', enum: ['comment', 'message'] },
        id: { type: 'string' },
        assigneeId: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
    run: (ctx, args) => apiAssignInbox(ctx, args),
  },
  {
    name: 'list_queue',
    description: 'The posting times in the queue: shared by every channel, or one channel’s own. create_post with useQueue takes the next free one.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => apiListQueue(ctx),
  },
  {
    name: 'list_templates',
    description: 'Saved post templates (text, hashtags, first comment) to start a post from.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => apiListTemplates(ctx),
  },
  {
    name: 'get_attention',
    description: 'What is waiting on somebody right now: failed posts, posts awaiting review, open comments and messages, disconnected accounts, tokens expiring soon.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => apiAttention(ctx),
  },
  {
    name: 'get_page_analytics',
    description:
      'How a Page is doing: health score, posts, interactions, reach and net followers against the period before, best times and top posts.',
    inputSchema: {
      type: 'object',
      required: ['pageId'],
      properties: {
        pageId: { type: 'string' },
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'Window length, 30 by default.' },
      },
      additionalProperties: false,
    },
    run: (ctx, args) => apiPageAnalytics(ctx, String(args.pageId ?? ''), { days: args.days }),
  },
];

type RpcId = string | number | null;

function reply(id: RpcId, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function failure(id: RpcId, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status });
}

function explain(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export async function POST(request: Request) {
  // Key first: a stranger learns nothing, not even whether the body parsed.
  if (!request.headers.get('authorization')) return failure(null, -32001, 'Send an API key as "Authorization: Bearer msp_…".', 401);
  let message: { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> };
  try {
    message = await request.json();
  } catch {
    return failure(null, -32700, 'Parse error.', 400);
  }
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return failure(message?.id ?? null, -32600, 'Invalid request.', 400);
  }
  const id = message.id ?? null;

  let ctx: ApiContext;
  try {
    ctx = await requireApiToken(request);
  } catch (error) {
    return failure(id, -32001, explain(error), 401);
  }

  // Notifications get no answer.
  if (message.id === undefined) return new NextResponse(null, { status: 202 });

  switch (message.method) {
    case 'initialize': {
      const asked = String(message.params?.protocolVersion ?? '');
      return reply(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ms-social-pilot', version: '1.0.0' },
        instructions: `Facebook Page scheduling for the workspace "${ctx.workspace.name}" (times in ${ctx.workspace.timezone}). Call list_pages first to get Page ids.`,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, {
        tools: TOOLS.filter((tool) => !tool.write || ctx.scope === 'write').map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case 'tools/call': {
      const name = String(message.params?.name ?? '');
      const tool = TOOLS.find((entry) => entry.name === name);
      if (!tool) return failure(id, -32602, `Unknown tool: ${name}`);
      if (tool.write && ctx.scope !== 'write') {
        return reply(id, { isError: true, content: [{ type: 'text', text: 'This API key can only read.' }] });
      }
      try {
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        const result = await tool.run(ctx, args);
        return reply(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: Array.isArray(result) ? { items: result } : result,
        });
      } catch (error) {
        const denied = error instanceof ForbiddenError || error instanceof AuthError;
        return reply(id, { isError: true, content: [{ type: 'text', text: denied ? 'Not allowed.' : explain(error) }] });
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${message.method}`);
  }
}

export function GET(request: Request) {
  if (!request.headers.get('authorization')) return failure(null, -32001, 'Send an API key.', 401);
  return NextResponse.json({ error: 'Send JSON-RPC requests with POST.' }, { status: 405, headers: { allow: 'POST' } });
}
