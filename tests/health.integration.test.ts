import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * "Is it working, and if not, what do I do about it?"
 *
 * The checks behind that question. Every case here is a real way a Facebook
 * connection goes wrong, and the thing being asserted is usually the *wording*
 * as much as the verdict: a diagnosis nobody can act on produces a support
 * conversation instead of a fix.
 */

let server: Server;
let database: TestDatabase;

/** Handlers by path suffix, longest first so `/me/permissions` wins over `/me`. */
let routes: Record<string, (query: URLSearchParams) => { status?: number; body: unknown }> = {};

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let health: typeof import('../src/lib/health');
let encryptSecret: (value: string) => string;
let requiredScopes: () => string[];

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const key = [...Object.keys(routes)]
      .sort((a, b) => b.length - a.length)
      .find((suffix) => url.pathname.endsWith(suffix));

    const result = key ? routes[key]!(url.searchParams) : { status: 200, body: { id: 'ok' } };
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');

  setTestEnv({ FACEBOOK_GRAPH_BASE_URL: `http://127.0.0.1:${address.port}` });
  database = setupTestDatabase('health');

  ({ prisma } = await import('../src/lib/prisma'));
  health = await import('../src/lib/health');
  ({ encryptSecret } = await import('../src/lib/crypto'));

  const { env } = await import('../src/lib/env');
  requiredScopes = () => env.facebookScopes;
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database?.drop();
});

beforeEach(async () => {
  routes = {};
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

/** A healthy Graph: valid token, everything granted, every Page answering. */
function stubHealthy(options: { scopes?: string[]; granular?: Array<{ scope: string; target_ids: string[] }> } = {}) {
  // Whatever this installation asks for, so the test does not quietly depend on
  // the default scope list staying the same length.
  const scopes = options.scopes ?? requiredScopes();

  routes['/debug_token'] = () => ({
    body: {
      data: {
        is_valid: true,
        scopes,
        granular_scopes: options.granular,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
      },
    },
  });
  routes['/me/permissions'] = () => ({
    body: { data: scopes.map((permission) => ({ permission, status: 'granted' })) },
  });
  routes['/app'] = () => ({ body: { id: '123' } });
}

async function seed() {
  const workspace = await prisma.workspace.create({
    data: { name: 'Client', slug: `client-${randomBytes(3).toString('hex')}`, timezone: 'UTC' },
  });
  const account = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      providerUserId: '55555',
      name: 'Sam Jones',
      accessToken: encryptSecret('user-token'),
    },
  });
  const target = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      type: 'page',
      providerId: '1000',
      name: 'Client Page',
      accessToken: encryptSecret('page-token'),
      canPublish: true,
    },
  });

  return { workspace, account, target };
}

describe('the Facebook app itself', () => {
  it('says so plainly when nothing is configured', async () => {
    // Everything below depends on this, so it is worth its own sentence rather
    // than eight connections all reporting failure for one reason.
    const previous = process.env.FACEBOOK_APP_ID;
    process.env.FACEBOOK_APP_ID = '';

    try {
      const app = await health.checkApp();
      expect(app.configured).toBe(false);
      expect(app.verdict).toBe('broken');
      expect(app.headline).toMatch(/Configuration screen/i);
    } finally {
      process.env.FACEBOOK_APP_ID = previous;
    }
  });

  it('reports credentials Facebook refuses', async () => {
    routes['/app'] = () => ({ status: 400, body: { error: { message: 'Invalid OAuth access token.', code: 190 } } });

    const app = await health.checkApp();
    expect(app.verdict).toBe('broken');
    expect(app.headline).toMatch(/Invalid OAuth access token/);
  });

  it('is happy when Facebook answers', async () => {
    stubHealthy();
    expect((await health.checkApp()).verdict).toBe('ok');
  });
});

describe('one connected account', () => {
  it('reports everything working', async () => {
    stubHealthy();
    const { workspace, account } = await seed();

    const report = await health.checkAccount(account.id, workspace.id);

    expect(report?.verdict).toBe('ok');
    expect(report?.headline).toBe('Everything is working.');
    expect(report?.destinations[0]?.headline).toBe('Ready to publish.');
  });

  it('names the permission that is missing, and what it costs', async () => {
    // Not "missing scopes: pages_manage_posts" — the person reading this has
    // never seen a scope name and needs to know what stopped working.
    stubHealthy({ scopes: requiredScopes().filter((scope) => scope !== 'pages_manage_posts') });
    const { workspace, account } = await seed();

    const report = await health.checkAccount(account.id, workspace.id);

    expect(report?.verdict).toBe('broken');
    expect(report?.headline).toMatch(/publish and schedule posts/i);
    expect(report?.headline).toMatch(/reconnect/i);

    const publish = report?.permissions.find((state) => state.permission === 'pages_manage_posts');
    expect(publish?.status).toBe('not_requested');
    expect(publish?.required).toBe(true);
  });

  it('distinguishes a permission that was refused from one never asked for', async () => {
    // Different fixes: one is a reconnect, the other is a configuration change.
    stubHealthy();
    routes['/me/permissions'] = () => ({
      body: {
        data: [
          { permission: 'pages_show_list', status: 'granted' },
          { permission: 'pages_manage_posts', status: 'declined' },
        ],
      },
    });
    const { workspace, account } = await seed();

    const report = await health.checkAccount(account.id, workspace.id);
    const publish = report?.permissions.find((state) => state.permission === 'pages_manage_posts');

    expect(publish?.status).toBe('declined');
  });

  it('sorts the problems to the top', async () => {
    stubHealthy({ scopes: requiredScopes().filter((scope) => scope !== 'pages_manage_posts') });
    const { workspace, account } = await seed();

    const report = await health.checkAccount(account.id, workspace.id);

    expect(report?.permissions[0]?.status).not.toBe('granted');
    expect(report?.permissions[0]?.required).toBe(true);
  });

  it('records an expired connection rather than rediscovering it at publish time', async () => {
    stubHealthy();
    routes['/debug_token'] = () => ({ body: { data: { is_valid: false } } });
    const { workspace, account } = await seed();

    const report = await health.checkAccount(account.id, workspace.id);
    expect(report?.verdict).toBe('broken');
    expect(report?.headline).toMatch(/expired/i);

    const stored = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.invalidatedAt).not.toBeNull();
  });
});

describe('one destination', () => {
  it('reports a Page Facebook will not answer for', async () => {
    stubHealthy();
    routes['/1000'] = () => ({
      status: 400,
      body: { error: { message: 'Unsupported get request.', code: 100 } },
    });
    const { workspace, account } = await seed();

    const report = await health.checkAccount(account.id, workspace.id);

    expect(report?.destinations[0]?.reachable).toBe(false);
    expect(report?.destinations[0]?.verdict).toBe('broken');
    expect(report?.verdict).toBe('broken');
  });

  it('catches a permission granted for other Pages but not this one', async () => {
    // The failure nobody diagnoses unaided: the token carries the permission,
    // so everything looks right, and publishing fails on exactly the Pages that
    // were left unticked in Facebook's second dialog.
    stubHealthy({ granular: [{ scope: 'pages_manage_posts', target_ids: ['2222', '3333'] }] });
    const { workspace, account } = await seed();

    const report = await health.checkAccount(account.id, workspace.id);

    expect(report?.destinations[0]?.verdict).toBe('broken');
    expect(report?.destinations[0]?.headline).toMatch(/tick it/i);
    // The permission itself is granted, so the account-level list stays clean.
    expect(report?.permissions.find((state) => state.permission === 'pages_manage_posts')?.status).toBe(
      'granted',
    );
  });

  it('accepts a permission granted for every Page', async () => {
    stubHealthy({ granular: [{ scope: 'pages_manage_posts', target_ids: ['1000'] }] });
    const { workspace, account } = await seed();

    expect((await health.checkAccount(account.id, workspace.id))?.destinations[0]?.verdict).toBe('ok');
  });

  it('flags a destination that is only turned off here', async () => {
    stubHealthy();
    const { workspace, account, target } = await seed();
    await prisma.target.update({ where: { id: target.id }, data: { enabled: false } });

    const report = await health.checkAccount(account.id, workspace.id);

    // Not broken: nothing is wrong with Facebook, somebody turned it off.
    expect(report?.destinations[0]?.verdict).toBe('attention');
    expect(report?.destinations[0]?.headline).toMatch(/turned off here/i);
  });

  it('repeats the reason a Page cannot be published to', async () => {
    stubHealthy();
    const { workspace, account, target } = await seed();
    await prisma.target.update({
      where: { id: target.id },
      data: { canPublish: false, publishBlocker: 'Your Facebook role on this Page does not allow creating posts.' },
    });

    const report = await health.checkAccount(account.id, workspace.id);
    expect(report?.destinations[0]?.headline).toMatch(/role on this Page/i);
  });
});

describe('the whole workspace', () => {
  it('stops at the app when the app is the problem', async () => {
    routes['/app'] = () => ({ status: 400, body: { error: { message: 'Bad app secret.', code: 190 } } });
    const { workspace } = await seed();

    const result = await health.checkWorkspace(workspace.id);

    // One clear problem beats eight consequences of it.
    expect(result.app.verdict).toBe('broken');
    expect(result.accounts).toEqual([]);
  });

  it('reports every account when the app is fine', async () => {
    stubHealthy();
    const { workspace } = await seed();

    const result = await health.checkWorkspace(workspace.id);
    expect(result.accounts).toHaveLength(1);
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  it('keeps one workspace out of another', async () => {
    stubHealthy();
    const mine = await seed();
    await seed();

    const result = await health.checkWorkspace(mine.workspace.id);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]?.accountId).toBe(mine.account.id);
  });
});
