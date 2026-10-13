import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** API keys, the REST endpoints and the MCP server, called as a client would. */

let database: TestDatabase;
type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let tokens: typeof import('../src/lib/api-tokens');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('apikeys');
  ({ prisma } = await import('../src/lib/prisma'));
  tokens = await import('../src/lib/api-tokens');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.apiToken.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.memberPageAccess.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed(role: WorkspaceRole = WorkspaceRole.owner, allPages = true) {
  const user = await prisma.user.create({ data: { email: 'a@example.test', name: 'A', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({
    data: { name: 'Agency', slug: 'agency', timezone: 'UTC', developerFeatures: true, memberships: { create: [{ userId: user.id, role, allPages }] } },
  });
  const page = (name: string) =>
    prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: name, name, accessToken: null } });
  const [bakery, garage] = await Promise.all([page('Bakery'), page('Garage')]);
  return { user, workspace, bakery, garage };
}

const call = (handler: (request: Request, ...rest: never[]) => Promise<Response>, init: { key?: string; method?: string; body?: unknown; url?: string }) =>
  handler(
    new Request(init.url ?? 'http://localhost/api/x', {
      method: init.method ?? 'GET',
      headers: { ...(init.key ? { authorization: `Bearer ${init.key}` } : {}), 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );

describe('API keys', () => {
  it('list the Pages, and refuse a missing, wrong or revoked key', async () => {
    const { user, workspace } = await seed();
    const { GET } = await import('../src/app/api/v1/pages/route');
    const made = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'Claude', scope: 'read' });

    const response = await call(GET, { key: made.token });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { pages: Array<{ name: string }> }).pages.map((page) => page.name)).toEqual(['Bakery', 'Garage']);

    expect((await call(GET, {})).status).toBe(401);
    expect((await call(GET, { key: 'msp_' + 'x'.repeat(40) })).status).toBe(401);
    await prisma.apiToken.update({ where: { id: made.id }, data: { revokedAt: new Date() } });
    expect((await call(GET, { key: made.token })).status).toBe(401);
  });

  it('follow the owner’s Page access as it is now', async () => {
    const { user, workspace, bakery } = await seed(WorkspaceRole.editor, false);
    await prisma.memberPageAccess.create({
      data: { membershipId: (await prisma.membership.findFirstOrThrow()).id, targetId: bakery.id },
    });
    const { GET } = await import('../src/app/api/v1/pages/route');
    const made = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'Claude', scope: 'read' });
    const body = (await (await call(GET, { key: made.token })).json()) as { pages: Array<{ name: string }> };
    expect(body.pages.map((page) => page.name)).toEqual(['Bakery']);
  });

  it('only write with a write key, and through the usual rules', async () => {
    const { user, workspace, bakery } = await seed();
    const { POST } = await import('../src/app/api/v1/posts/route');
    const read = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'r', scope: 'read' });
    const write = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'w', scope: 'write' });
    const body = { targetIds: [bakery.id], message: 'From the API', saveAsDraft: true };

    expect((await call(POST, { key: read.token, method: 'POST', body })).status).toBe(403);
    const created = await call(POST, { key: write.token, method: 'POST', body });
    expect(created.status).toBe(201);
    const post = await prisma.post.findFirstOrThrow();
    expect([post.message, post.status, post.authorId]).toEqual(['From the API', 'draft', user.id]);
  });
});

describe('API keys under root’s switches', () => {
  it('stop working for a disabled person or a suspended workspace, and respect switched-off modules', async () => {
    const { user, workspace } = await seed();
    const posts = await import('../src/app/api/v1/posts/route');
    const pages = await import('../src/app/api/v1/pages/route');
    const made = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'k', scope: 'read' });

    await prisma.workspace.update({ where: { id: workspace.id }, data: { disabledModules: ['schedule'] } });
    expect((await call(posts.GET, { key: made.token })).status).toBe(403);
    expect((await call(pages.GET, { key: made.token })).status).toBe(200);
    await prisma.workspace.update({ where: { id: workspace.id }, data: { disabledModules: [] } });

    // Root switches developer features off: the key stops, and comes back with them.
    await prisma.workspace.update({ where: { id: workspace.id }, data: { developerFeatures: false } });
    expect((await call(pages.GET, { key: made.token })).status).toBe(403);
    await prisma.workspace.update({ where: { id: workspace.id }, data: { developerFeatures: true } });
    expect((await call(pages.GET, { key: made.token })).status).toBe(200);

    await prisma.workspace.update({ where: { id: workspace.id }, data: { suspendedAt: new Date() } });
    expect((await call(pages.GET, { key: made.token })).status).toBe(403);
    await prisma.workspace.update({ where: { id: workspace.id }, data: { suspendedAt: null } });

    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect((await call(pages.GET, { key: made.token })).status).toBe(401);
  });

  it('narrow the post list with ?pages=, never beyond the owner’s access', async () => {
    const { user, workspace, bakery, garage } = await seed();
    for (const target of [bakery, garage]) {
      await prisma.post.create({
        data: { workspaceId: workspace.id, authorId: user.id, message: target.name, status: 'draft', targets: { create: { targetId: target.id } } },
      });
    }
    const posts = await import('../src/app/api/v1/posts/route');
    const made = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'k', scope: 'read' });
    const list = async (query: string) =>
      ((await (await call(posts.GET, { key: made.token, url: `http://localhost/api/v1/posts?${query}` })).json()) as { posts: Array<{ message: string }> }).posts.map((post) => post.message);
    expect((await list('')).sort()).toEqual(['Bakery', 'Garage']);
    expect(await list(`pages=${bakery.id}`)).toEqual(['Bakery']);
    expect(await list('pages=someone-else')).toEqual([]);
  });
});

describe('the MCP server', () => {
  const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, params });

  it('initialises, lists tools by key scope, and drafts a post', async () => {
    const { user, workspace, bakery } = await seed();
    const { POST } = await import('../src/app/api/mcp/route');
    const read = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'r', scope: 'read' });
    const write = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'w', scope: 'write' });

    const init = (await (await call(POST, { key: read.token, method: 'POST', body: rpc('initialize', { protocolVersion: '2025-06-18' }) })).json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.serverInfo.name).toBe('ms-social-pilot');

    const readTools = (await (await call(POST, { key: read.token, method: 'POST', body: rpc('tools/list') })).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(readTools.result.tools.map((tool) => tool.name)).not.toContain('create_post');

    const writeTools = (await (await call(POST, { key: write.token, method: 'POST', body: rpc('tools/list') })).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(writeTools.result.tools.map((tool) => tool.name)).toContain('create_post');

    const made = (await (
      await call(POST, {
        key: write.token,
        method: 'POST',
        body: rpc('tools/call', { name: 'create_post', arguments: { targetIds: [bakery.id], message: 'Hello from Claude' } }),
      })
    ).json()) as { result: { isError?: boolean } };
    expect(made.result.isError).toBeUndefined();
    const post = await prisma.post.findFirstOrThrow();
    expect([post.message, post.status]).toEqual(['Hello from Claude', 'draft']);

    // A notification gets no answer, and no key gets a 401.
    expect((await call(POST, { key: read.token, method: 'POST', body: { jsonrpc: '2.0', method: 'notifications/initialized' } })).status).toBe(202);
    expect((await call(POST, { method: 'POST', body: rpc('tools/list') })).status).toBe(401);
  });
  it('edits and cancels a post, reads the inbox and summarises what needs attention', async () => {
    const { user, workspace, bakery } = await seed();
    const { POST } = await import('../src/app/api/mcp/route');
    const write = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'w', scope: 'write' });
    const read = await tokens.createApiToken({ workspaceId: workspace.id, userId: user.id, name: 'r', scope: 'read' });
    const tool = async (key: string, name: string, args: Record<string, unknown> = {}) =>
      (await (await call(POST, { key, method: 'POST', body: rpc('tools/call', { name, arguments: args }) })).json()) as {
        result: { isError?: boolean; structuredContent?: Record<string, unknown> };
      };

    await tool(write.token, 'create_post', { targetIds: [bakery.id], message: 'First draft' });
    const post = await prisma.post.findFirstOrThrow();

    expect((await tool(write.token, 'update_post', { postId: post.id, message: 'Second draft' })).result.isError).toBeUndefined();
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).message).toBe('Second draft');

    // A read key sees the read tools only.
    expect((await tool(read.token, 'update_post', { postId: post.id, message: 'x' })).result.isError).toBe(true);
    const attention = (await tool(read.token, 'get_attention')).result.structuredContent;
    expect(attention).toMatchObject({ failedPosts: 0, awaitingApproval: 0, openComments: 0, openMessages: 0 });
    expect((await tool(read.token, 'list_inbox')).result.isError).toBeUndefined();

    expect((await tool(write.token, 'cancel_post', { postId: post.id })).result.isError).toBeUndefined();
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('cancelled');
  });
});
