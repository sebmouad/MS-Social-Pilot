import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Every API endpoint, asked the one question no unit test can ask it: what do
 * you do for somebody who is not signed in?
 *
 * The libraries underneath are covered in detail elsewhere. The handler layer
 * is not, and it is where a single missing line has the largest consequence —
 * a route that forgets `requireAuth` hands one agency's client list to whoever
 * finds the URL, and every test in the repository still passes.
 *
 * So this walks the filesystem rather than a list. A new route is included the
 * moment it exists, and if it answers an anonymous request it fails here until
 * somebody adds it to PUBLIC below and says why.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/**
 * The endpoints that answer without a session, each for a stated reason.
 *
 * This list is the security boundary of the API written out. Adding to it is
 * a deliberate act; forgetting to is caught below.
 */
const PUBLIC: Record<string, string> = {
  'auth/login': 'Signing in cannot require being signed in.',
  'auth/register': 'Creating the first account cannot require an account.',
  'auth/logout': 'Signing out twice is not an error worth a 401.',
  health: 'A load balancer has no cookies.',
  'cron/tick': 'Called by a scheduler, and guarded by its own secret rather than a session.',
  'facebook/data-deletion': "Meta calls this, with a signed_request it verifies rather than a cookie.",
  'facebook/deauthorize': 'Meta calls this too, same verification.',
  setup: 'Open only while the database holds no accounts; owner-only from the first registration onwards.',
};

/**
 * Bodies that get past validation, for the routes where an empty one would be
 * rejected before the role is ever consulted — which would make the check
 * below pass without testing anything.
 */
const VALID_BODY: Record<string, unknown> = {
  'queue-slots': { slots: [{ dayOfWeek: 1, hour: 9, minute: 0 }] },
  'connections/instagram/[id]': { enabled: false },
  'connections/ads/[id]': { enabled: false },
};

/** Route path → the params a dynamic segment needs, so the handler can run. */
function paramsFor(routePath: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of routePath.matchAll(/\[(\.\.\.)?([A-Za-z0-9_]+)\]/g)) {
    params[match[2]!] = 'does-not-exist';
  }
  return params;
}

function routeFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      return routeFiles(full, prefix ? `${prefix}/${entry}` : entry);
    }
    return entry === 'route.ts' ? [prefix] : [];
  });
}

const ROUTES = routeFiles('src/app/api').sort();

/**
 * A cookie jar the handlers read through, since `next/headers` only works
 * inside a real request. `signedInAs` swaps the session cookie, which is the
 * only difference between the two sweeps below.
 */
const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

let database: TestDatabase;

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('apiroutes');
}, 120_000);

afterAll(async () => {
  const { prisma } = await import('../src/lib/prisma');
  await prisma.$disconnect();
  database?.drop();
});

describe('every API endpoint', () => {
  it('was found on disk, so this is a sweep and not a list', () => {
    // A guard against the walk silently finding nothing — which would make
    // every assertion below vacuous.
    expect(ROUTES.length).toBeGreaterThan(40);
    expect(ROUTES).toContain('posts');
    expect(ROUTES).toContain('team/route.ts'.replace('/route.ts', ''));
  });

  it('turns away an anonymous caller, or is on the public list', async () => {
    jar.clear();
    const leaks: string[] = [];

    for (const routePath of ROUTES) {
      const module = (await import(`../src/app/api/${routePath}/route`)) as Record<
        string,
        ((request: Request, context: { params: Promise<unknown> }) => Promise<Response>) | undefined
      >;

      for (const method of METHODS) {
        const handler = module[method];
        if (typeof handler !== 'function') continue;

        const request = new Request(`http://localhost/api/${routePath}`, {
          method,
          ...(method === 'GET' || method === 'DELETE'
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: '{}' }),
        });

        const response = await handler(request, {
          params: Promise.resolve(paramsFor(routePath)),
        });

        const isPublic = routePath in PUBLIC;
        // 401 is the honest answer; a 3xx to the sign-in screen is the same
        // refusal in a different dialect and a couple of routes use it.
        const refused = response.status === 401 || response.status === 403 ||
          (response.status >= 300 && response.status < 400);

        if (!isPublic && !refused) {
          leaks.push(`${method} /api/${routePath} answered ${response.status}`);
        }
      }
    }

    expect(leaks).toEqual([]);
  }, 120_000);

  it('has a reason written down for every endpoint that is open', () => {
    // Not a matter of taste: an entry that no longer matches a real route is a
    // stale exemption, and the next route to take that path inherits it.
    const stale = Object.keys(PUBLIC).filter((entry) => !ROUTES.includes(entry));
    expect(stale, 'PUBLIC names routes that no longer exist').toEqual([]);

    for (const [entry, reason] of Object.entries(PUBLIC)) {
      expect(reason.length, `${entry} has no reason`).toBeGreaterThan(20);
    }
  });
});

/**
 * The endpoints a contributor must not reach.
 *
 * A contributor is the role an agency gives a freelancer: they write posts and
 * somebody else approves them. Everything here would let them act on the
 * business rather than on their own drafts — invite themselves an admin, point
 * the installation at a different Facebook app, disconnect a client's Page.
 *
 * Unlike the anonymous sweep this is a list rather than a walk, because "which
 * role should this need" is a judgement per endpoint rather than a rule. It is
 * the judgement that is worth writing down.
 */
const CONTRIBUTOR_MUST_NOT: Array<[Method, string]> = [
  ['POST', 'team'],
  ['PATCH', 'team/[id]'],
  ['DELETE', 'team/[id]'],
  ['PATCH', 'workspace'],
  ['GET', 'settings/config'],
  ['POST', 'settings/config'],
  ['PUT', 'queue-slots'],
  ['DELETE', 'accounts/[id]'],
  ['POST', 'accounts/[id]/sync'],
  ['PATCH', 'targets/[id]'],
  ['POST', 'feeds'],
  ['PATCH', 'feeds/[id]'],
  ['DELETE', 'feeds/[id]'],
  ['POST', 'connections/health'],
  ['PATCH', 'connections/instagram/[id]'],
  ['DELETE', 'connections/instagram/[id]'],
  ['PATCH', 'connections/ads/[id]'],
  ['DELETE', 'connections/ads/[id]'],
];

describe('a signed-in contributor', () => {
  let workspaceId = '';

  beforeAll(async () => {
    const { prisma } = await import('../src/lib/prisma');
    const { createSession } = await import('../src/lib/auth');
    const { WorkspaceRole } = await import('@prisma/client');

    const user = await prisma.user.create({
      data: { email: 'freelancer@example.test', name: 'Robin Vale', passwordHash: 'x' },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Client',
        slug: 'client',
        timezone: 'UTC',
        memberships: { create: { userId: user.id, role: WorkspaceRole.contributor } },
      },
    });
    workspaceId = workspace.id;

    jar.set('msp_session', await createSession(user.id));
  }, 60_000);

  it('is signed in, so a refusal below is about the role and not the session', async () => {
    const module = await import('../src/app/api/posts/route');
    const response = await module.GET(new Request('http://localhost/api/posts'));

    expect(response.status, 'the contributor could not read their own posts').toBe(200);
    expect(workspaceId).not.toBe('');
  });

  it('cannot act on the business', async () => {
    const allowed: string[] = [];

    for (const [method, routePath] of CONTRIBUTOR_MUST_NOT) {
      const module = (await import(`../src/app/api/${routePath}/route`)) as Record<
        string,
        ((request: Request, context: { params: Promise<unknown> }) => Promise<Response>) | undefined
      >;
      const handler = module[method];
      expect(handler, `${method} /api/${routePath} does not exist`).toBeTypeOf('function');

      const request = new Request(`http://localhost/api/${routePath}`, {
        method,
        ...(method === 'GET' || method === 'DELETE'
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(VALID_BODY[routePath] ?? {}),
            }),
      });

      const response = await handler!(request, {
        params: Promise.resolve(paramsFor(routePath)),
      });

      // 403 is the answer being tested for. 404 also means refused — several of
      // these look the row up inside the workspace first, and the ids are
      // deliberately fictional. 422 means the body was rejected before the role
      // was consulted, which would make the check vacuous, so it counts as a
      // failure here.
      if (response.status !== 403 && response.status !== 404) {
        allowed.push(`${method} /api/${routePath} answered ${response.status}`);
      }
    }

    expect(allowed).toEqual([]);
  }, 120_000);
});
