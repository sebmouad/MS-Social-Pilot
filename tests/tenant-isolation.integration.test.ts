import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Each workspace is a client of its own: its own data, its own team, and no
 * way to see or touch another's. This signs in as the owner of workspace B —
 * the highest role there is inside a workspace — and points every API route
 * that takes an id at workspace A's real rows. Every one must refuse, and A's
 * rows must be exactly as they were afterwards.
 *
 * Walks the filesystem like api-routes.integration.test.ts, so a new `[id]`
 * route is covered the day it is added; one it cannot give an id to fails
 * here until it is mapped below.
 */

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceRole } from '@prisma/client';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
const A: Record<string, string> = {};

/** Routes that are not about workspace data at all, with the reason. */
const NOT_WORKSPACE_DATA: Record<string, string> = {
  'auth/passkeys/[id]': "A person's own passkey; checked against the signed-in user.",
  'networks/[network]/callback': 'An OAuth return address, keyed by the network name.',
  'networks/[network]/connect': 'Starts OAuth for the caller’s own workspace, keyed by the network name.',
  'share/[token]': 'Public review link: the token is the authority.',
  'root/invitations/[id]': 'Root section: 404 for everybody but root (root.integration.test.ts).',
  'root/users/[id]': 'Root section.',
  'root/users/[id]/reset-two-step': 'Root section.',
  'root/users/[id]/sign-out': 'Root section.',
  'root/workspaces/[id]': 'Root section.',
  'root/client-invitations/[id]': 'Root section.',
  'root/members/[id]': 'Root section (root-oversight.integration.test.ts).',
  'root/workspaces/[id]/members': 'Root section.',
  'root/workspaces/[id]/visit': 'Root section (root-oversight.integration.test.ts).',
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function routeFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return routeFiles(full, prefix ? `${prefix}/${entry}` : entry);
    return entry === 'route.ts' ? [prefix] : [];
  });
}

/** Bodies that pass validation, so the refusal tested is about ownership, not shape. */
const BODY: Record<string, unknown> = {
  'posts/[id]': { message: 'Changed by another client' },
  'targets/[id]': { enabled: false },
  'targets/[id]/profile': { brandVoice: 'Hijacked' },
  'labels/[id]': { name: 'Hijacked' },
  'page-groups/[id]': { name: 'Hijacked' },
  'snippets/[id]': { name: 'Hijacked', body: 'x' },
  'feeds/[id]': { enabled: false },
  'chat-channels/[id]': { enabled: false },
  'connections/instagram/[id]': { enabled: false },
  'connections/ads/[id]': { enabled: false },
  'team/[id]': { role: 'contributor' },
  'posts/[id]/approve': { action: 'approve' },
  'posts/[id]/recycle': { enabled: true, everyDays: 7 },
  'report-templates/[id]': { name: 'Hijacked', sections: ['analysis'] },
};

beforeAll(async () => {
  setTestEnv({ SECURITY_TWO_STEP: 'off' });
  database = setupTestDatabase('isolation');
  ({ prisma } = await import('../src/lib/prisma'));
  const { createSession } = await import('../src/lib/auth');

  const ownerA = await prisma.user.create({ data: { email: 'a@example.test', name: 'Owner A', passwordHash: 'x' } });
  const memberA = await prisma.user.create({ data: { email: 'a2@example.test', name: 'Member A', passwordHash: 'x' } });
  const ownerB = await prisma.user.create({ data: { email: 'b@example.test', name: 'Owner B', passwordHash: 'x' } });

  const workspaceA = await prisma.workspace.create({
    data: {
      name: 'Client A',
      slug: 'client-a',
      timezone: 'UTC',
      memberships: { create: [{ userId: ownerA.id, role: WorkspaceRole.owner }, { userId: memberA.id, role: WorkspaceRole.editor }] },
    },
  });
  await prisma.workspace.create({
    data: { name: 'Client B', slug: 'client-b', timezone: 'UTC', memberships: { create: { userId: ownerB.id, role: WorkspaceRole.owner } } },
  });
  const w = workspaceA.id;

  const account = await prisma.socialAccount.create({
    data: { workspaceId: w, provider: 'facebook', providerUserId: 'fb-a', name: 'A', accessToken: 'x' },
  });
  const target = await prisma.target.create({
    data: { workspaceId: w, socialAccountId: account.id, type: 'page', providerId: 'page-a', name: 'Page A', accessToken: 'x' },
  });
  const post = await prisma.post.create({
    data: { workspaceId: w, authorId: ownerA.id, message: 'Client A post', targets: { create: { targetId: target.id } } },
    include: { targets: true },
  });
  const media = await prisma.media.create({
    data: { workspaceId: w, filename: 'a.jpg', mimeType: 'image/jpeg', size: 10, kind: 'image', url: '/media/a.jpg' },
  });
  const label = await prisma.label.create({ data: { workspaceId: w, name: 'A label' } });
  const group = await prisma.pageGroup.create({ data: { workspaceId: w, name: 'A group' } });
  const snippet = await prisma.snippet.create({ data: { workspaceId: w, name: 'A snippet', body: 'x' } });
  const feed = await prisma.feedSource.create({ data: { workspaceId: w, name: 'A feed', url: 'https://example.test/feed' } });
  const share = await prisma.shareLink.create({
    data: { workspaceId: w, kind: 'review', tokenHash: 'share-a', title: 'A', createdById: ownerA.id },
  });
  const template = await prisma.reportTemplate.create({ data: { workspaceId: w, name: 'A template' } });
  const schedule = await prisma.reportSchedule.create({
    data: { workspaceId: w, targetId: target.id, frequency: 'weekly', recipients: ['a@example.test'], nextRunAt: new Date() },
  });
  const chat = await prisma.chatChannel.create({ data: { workspaceId: w, kind: 'slack', name: 'A chat', secret: 'x', events: [] } });
  const token = await prisma.apiToken.create({
    data: { workspaceId: w, userId: ownerA.id, name: 'A key', tokenHash: 'token-a', prefix: 'msp_a' },
  });
  const instagram = await prisma.instagramAccount.create({ data: { workspaceId: w, igUserId: 'ig-a', username: 'a' } });
  const ads = await prisma.adAccount.create({ data: { workspaceId: w, actId: 'act_a', name: 'A ads' } });

  Object.assign(A, {
    workspace: w,
    'accounts/[id]': account.id,
    'accounts/[id]/sync': account.id,
    'analytics/[targetId]': target.id,
    'analytics/post/[postTargetId]': post.targets[0]!.id,
    'api-tokens/[id]': token.id,
    'chat-channels/[id]': chat.id,
    'chat-channels/[id]/test': chat.id,
    'connections/ads/[id]': ads.id,
    'connections/instagram/[id]': instagram.id,
    'feeds/[id]': feed.id,
    'labels/[id]': label.id,
    'media/[id]': media.id,
    'media/[id]/raw': media.id,
    'page-groups/[id]': group.id,
    'report-schedules/[id]': schedule.id,
    'report-templates/[id]': template.id,
    'share-links/[id]': share.id,
    'snippets/[id]': snippet.id,
    'targets/[id]': target.id,
    'targets/[id]/profile': target.id,
    'team/[id]': memberA.id,
    'v1/pages/[id]/analytics': target.id,
    target: target.id,
    post: post.id,
  });
  for (const action of ['', '/approve', '/duplicate', '/first-comment', '/publish', '/recycle', '/remove', '/retry']) {
    A[`posts/[id]${action}`] = post.id;
  }

  jar.set('msp_session', await createSession(ownerB.id));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

/** Everything A owns, as a fingerprint: counts and the fields a hijack would change. */
async function snapshot() {
  const w = A.workspace;
  const [posts, targets, labels, groups, snippets, feeds, shares, tokens, chats, templates, schedules, members, media] = await Promise.all([
    prisma.post.findMany({ where: { workspaceId: w }, select: { id: true, message: true, status: true } }),
    prisma.target.findMany({ where: { workspaceId: w }, select: { id: true, enabled: true, name: true } }),
    prisma.label.findMany({ where: { workspaceId: w }, select: { id: true, name: true } }),
    prisma.pageGroup.findMany({ where: { workspaceId: w }, select: { id: true, name: true } }),
    prisma.snippet.findMany({ where: { workspaceId: w }, select: { id: true, name: true } }),
    prisma.feedSource.findMany({ where: { workspaceId: w }, select: { id: true, enabled: true } }),
    prisma.shareLink.findMany({ where: { workspaceId: w }, select: { id: true } }),
    prisma.apiToken.findMany({ where: { workspaceId: w }, select: { id: true } }),
    prisma.chatChannel.findMany({ where: { workspaceId: w }, select: { id: true, enabled: true } }),
    prisma.reportTemplate.findMany({ where: { workspaceId: w }, select: { id: true, name: true } }),
    prisma.reportSchedule.findMany({ where: { workspaceId: w }, select: { id: true } }),
    prisma.membership.findMany({ where: { workspaceId: w }, select: { id: true, role: true } }),
    prisma.media.findMany({ where: { workspaceId: w }, select: { id: true } }),
  ]);
  return { posts, targets, labels, groups, snippets, feeds, shares, tokens, chats, templates, schedules, members, media };
}

describe("another client's owner", () => {
  it('is refused on every route that takes one of our ids, and changes nothing', async () => {
    const before = await snapshot();
    const leaks: string[] = [];
    const unmapped: string[] = [];

    for (const routePath of routeFiles('src/app/api').filter((path) => path.includes('['))) {
      if (routePath in NOT_WORKSPACE_DATA) continue;
      const id = A[routePath];
      if (!id) {
        unmapped.push(routePath);
        continue;
      }
      const module = (await import(`../src/app/api/${routePath}/route`)) as Record<
        string,
        ((request: Request, context: { params: Promise<unknown> }) => Promise<Response>) | undefined
      >;
      const params: Record<string, string> = {};
      for (const match of routePath.matchAll(/\[([A-Za-z0-9_]+)\]/g)) params[match[1]!] = id;

      for (const method of METHODS) {
        const handler = module[method];
        if (typeof handler !== 'function') continue;
        const request = new Request(`http://localhost/api/${routePath}`, {
          method,
          ...(method === 'GET' || method === 'DELETE'
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(BODY[routePath] ?? {}) }),
        });
        const response = await handler(request, { params: Promise.resolve(params) });
        // 404 (not found in your workspace) or 403. A 422 would mean the body
        // was rejected before ownership was checked, so it counts as a leak too.
        // The public API authenticates with an API key, not a session: 401.
        const refused = response.status === 404 || response.status === 403 || (routePath.startsWith('v1/') && response.status === 401);
        if (!refused) {
          leaks.push(`${method} /api/${routePath} answered ${response.status}`);
        }
      }
    }

    expect(unmapped, 'routes with an id this test cannot fill: add them to A or NOT_WORKSPACE_DATA').toEqual([]);
    expect(leaks).toEqual([]);
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it('sees nothing of ours on any list or read route', async () => {
    const ours = Object.entries(A).filter(([key]) => key !== 'workspace').map(([, id]) => id);
    const leaks: string[] = [];
    const routes = routeFiles('src/app/api').filter(
      (path) => !path.includes('[') && !path.startsWith('root') && !path.startsWith('cron') && !path.startsWith('auth'),
    );
    for (const routePath of routes) {
      const module = (await import(`../src/app/api/${routePath}/route`)) as Record<string, ((request: Request) => Promise<Response>) | undefined>;
      if (typeof module.GET !== 'function') continue;
      for (const query of ['', `?target=${A.target}`, `?targetId=${A.target}`, `?pages=${A.target}`]) {
        const response = await module.GET(new Request(`http://localhost/api/${routePath}${query}`));
        const text = await response.text();
        const found = ours.filter((id) => text.includes(id));
        if (found.length > 0 || text.includes('Client A') || text.includes('Page A')) {
          leaks.push(`GET /api/${routePath}${query} shows another workspace's data`);
        }
      }
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('cannot post to, group, report on or read analytics of our Pages by passing their ids', async () => {
    const before = await snapshot();
    const call = async (path: string, method: string, body?: unknown) => {
      const module = (await import(`../src/app/api/${path.split('?')[0]}/route`)) as Record<string, (request: Request) => Promise<Response>>;
      const response = await module[method]!(
        new Request(`http://localhost/api/${path}`, {
          method,
          ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
        }),
      );
      return response.status;
    };

    await call('posts', 'POST', { message: 'Spam', targetIds: [A.target], mode: 'draft' });
    await call('page-groups', 'POST', { name: 'Steal', targetIds: [A.target] });
    await call('report-schedules', 'POST', { targetId: A.target, frequency: 'weekly', recipients: ['x@example.test'] });

    // Whatever was answered, nothing outside A may point at A's Page.
    const foreign = { workspaceId: { not: A.workspace } };
    expect(await prisma.postTarget.count({ where: { targetId: A.target, post: foreign } })).toBe(0);
    expect(await prisma.pageGroupTarget.count({ where: { targetId: A.target, group: foreign } })).toBe(0);
    expect(await prisma.reportSchedule.count({ where: { targetId: A.target, ...foreign } })).toBe(0);

    // Lists show only B's own data.
    const posts = await import('../src/app/api/posts/route');
    const listed = (await (await posts.GET(new Request('http://localhost/api/posts'))).json()) as { posts?: Array<{ id: string }> };
    expect(JSON.stringify(listed)).not.toContain(A.post);
    expect(await snapshot()).toEqual(before);
  }, 60_000);
});
