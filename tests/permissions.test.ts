import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Turning Facebook's permission vocabulary into something a person can act on.
 *
 * The value of this module is entirely in the wording, so that is what is
 * tested: that every permission the app can ask for has words attached, and
 * that a list is ordered so the problems are at the top where somebody looking
 * for what is wrong will find them.
 */

let server: Server;
let reply: { data?: Array<{ permission: string; status: string }> } = {};

let permissions: typeof import('../src/lib/facebook/permissions');
let requestableScopes: string[];

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test-secret';
  process.env.FACEBOOK_APP_ID = '123';
  process.env.FACEBOOK_APP_SECRET = 'app-secret';

  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  process.env.FACEBOOK_GRAPH_BASE_URL = `http://127.0.0.1:${address.port}`;

  permissions = await import('../src/lib/facebook/permissions');

  // Every scope this app can ask for: the configured list, plus the ones each
  // feature switch adds on top. The switches are off by default, so those are
  // named here rather than read from this installation's configuration.
  const { env } = await import('../src/lib/env');
  const collected = new Set<string>(env.facebookScopes);
  for (const scope of [
    'publish_to_groups',
    'groups_access_member_info',
    'pages_messaging',
    'pages_manage_metadata',
    'instagram_basic',
    'instagram_manage_insights',
    'ads_read',
  ]) {
    collected.add(scope);
  }
  requestableScopes = [...collected];
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('the words attached to a permission', () => {
  it('has an entry for every permission this app can ask for', () => {
    // A scope added to the request list without an entry here shows up on the
    // connection screen as a raw name like `pages_manage_metadata`, which is
    // exactly what this module exists to prevent.
    const unlabelled = requestableScopes.filter(
      (scope) => permissions.describePermission(scope).label === scope,
    );

    expect(unlabelled).toEqual([]);
  });

  it('says what each one lets the app do, not what it is called', () => {
    const publish = permissions.describePermission('pages_manage_posts');

    expect(publish.label).toMatch(/publish/i);
    expect(publish.label).not.toContain('pages_manage_posts');
  });

  it('says what stops working without it', () => {
    // The half that turns a refusal into a decision rather than a mystery.
    expect(permissions.describePermission('pages_manage_posts').consequence).toMatch(
      /nothing can be published/i,
    );
    expect(permissions.describePermission('ads_read').consequence).toMatch(/ad spend/i);
  });

  it('falls back without pretending to know a permission it does not', () => {
    const unknown = permissions.describePermission('some_future_scope');

    expect(unknown.label).toBe('some_future_scope');
    expect(unknown.consequence).toMatch(/does not use/i);
  });
});

describe('reading what Facebook granted', () => {
  it('separates granted, refused, and never asked for', async () => {
    reply = {
      data: [
        { permission: 'pages_show_list', status: 'granted' },
        { permission: 'pages_manage_posts', status: 'declined' },
      ],
    };

    const states = await permissions.readPermissions('token', [
      'pages_show_list',
      'pages_manage_posts',
      'pages_read_engagement',
    ]);

    const byName = new Map(states.map((state) => [state.permission, state]));
    expect(byName.get('pages_show_list')?.status).toBe('granted');
    expect(byName.get('pages_manage_posts')?.status).toBe('declined');
    // Required, and Facebook has never heard of it: its absence is the reason
    // something is not working, so it has to appear rather than be dropped.
    expect(byName.get('pages_read_engagement')?.status).toBe('not_requested');
  });

  it('puts the problems first', async () => {
    reply = {
      data: [
        { permission: 'pages_show_list', status: 'granted' },
        { permission: 'pages_manage_posts', status: 'declined' },
        { permission: 'email', status: 'granted' },
      ],
    };

    const states = await permissions.readPermissions('token', [
      'pages_show_list',
      'pages_manage_posts',
    ]);

    expect(states[0]?.permission).toBe('pages_manage_posts');
  });

  it('keeps a permission the app does not need, but marks it so', async () => {
    // Facebook grants things nobody asked for. Hiding them would make the list
    // disagree with what Facebook shows the same person.
    reply = { data: [{ permission: 'email', status: 'granted' }] };

    const states = await permissions.readPermissions('token', ['pages_show_list']);
    const email = states.find((state) => state.permission === 'email');

    expect(email?.required).toBe(false);
    expect(email?.status).toBe('granted');
  });

  it('treats an answer with nothing in it as nothing granted', async () => {
    reply = {};

    const states = await permissions.readPermissions('token', ['pages_manage_posts']);

    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe('not_requested');
  });
});
