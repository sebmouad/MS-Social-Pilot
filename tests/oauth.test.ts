import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The Facebook connect flow.
 *
 * `verifyOAuthState` is the whole CSRF defence on it, and it had no tests. The
 * attack it prevents is worth stating plainly: without it, someone can send a
 * signed-in person a link that completes a Facebook connection into *their*
 * workspace using the attacker's authorization code, and every post that
 * workspace schedules afterwards goes to the attacker's Page.
 */

let server: Server;
let baseUrl: string;
let routes: Record<string, () => { status?: number; body: unknown }> = {};

let oauth: typeof import('../src/lib/facebook/oauth');

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'the-session-secret';
  process.env.FACEBOOK_APP_ID = '123';
  process.env.FACEBOOK_APP_SECRET = 'app-secret';
  process.env.APP_URL = 'https://social.example.com';

  server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    const handler = Object.entries(routes).find(([suffix]) => path.endsWith(suffix))?.[1];
    const result = handler ? handler() : { status: 200, body: {} };
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.FACEBOOK_GRAPH_BASE_URL = baseUrl;

  oauth = await import('../src/lib/facebook/oauth');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('the state that ties a callback to the browser that started it', () => {
  it('accepts what it issued', () => {
    const { state, nonce } = oauth.createOAuthState();
    expect(oauth.verifyOAuthState(state, nonce)).toBe(true);
  });

  it('refuses a state that belongs to a different browser', () => {
    // The attack: a signed-in victim follows a link carrying the attacker's
    // state. Their cookie holds a different nonce, so the connection stops
    // here rather than landing the attacker's Page in the victim's workspace.
    const attacker = oauth.createOAuthState();
    const victim = oauth.createOAuthState();

    expect(oauth.verifyOAuthState(attacker.state, victim.nonce)).toBe(false);
  });

  it('refuses a nonce with no signature at all', () => {
    const { nonce } = oauth.createOAuthState();
    expect(oauth.verifyOAuthState(nonce, nonce)).toBe(false);
  });

  it('refuses a tampered signature', () => {
    const { state, nonce } = oauth.createOAuthState();
    const forged = `${state.slice(0, state.lastIndexOf('.'))}.${'0'.repeat(64)}`;

    expect(oauth.verifyOAuthState(forged, nonce)).toBe(false);
  });

  it('refuses a state signed with a different secret', () => {
    // What binds the state to this installation: an attacker who knows the
    // format still cannot produce one without the session secret.
    const { state, nonce } = oauth.createOAuthState();
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'a-different-secret';

    try {
      expect(oauth.verifyOAuthState(state, nonce)).toBe(false);
    } finally {
      process.env.SESSION_SECRET = previous;
    }
  });

  it('refuses empty and malformed values', () => {
    const { nonce } = oauth.createOAuthState();
    for (const state of ['', '.', '.signature', 'no-separator']) {
      expect(oauth.verifyOAuthState(state, nonce)).toBe(false);
    }
  });

  it('issues a different nonce every time', () => {
    const nonces = new Set(Array.from({ length: 20 }, () => oauth.createOAuthState().nonce));
    expect(nonces.size).toBe(20);
  });
});

describe('the dialog people are sent to', () => {
  it('carries everything Facebook needs, and the state', () => {
    const { state } = oauth.createOAuthState();
    const url = new URL(oauth.authorizationUrl(state));

    expect(url.searchParams.get('client_id')).toBe('123');
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://social.example.com/api/facebook/callback',
    );
    expect(url.searchParams.get('scope')).toContain('pages_manage_posts');
  });

  it('re-prompts rather than silently reusing an old answer', () => {
    // Without this, someone reconnecting to fix a missing permission is sent
    // straight back with the same permissions they already refused.
    const url = new URL(oauth.authorizationUrl(oauth.createOAuthState().state));
    expect(url.searchParams.get('auth_type')).toBe('rerequest');
  });

  it('refuses to start over plain http outside localhost', async () => {
    const { assertOAuthReady } = await import('../src/lib/env');
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'http://social.example.com';

    try {
      // Facebook rejects an insecure redirect URI, and finding that out here
      // beats finding it out in the dialog.
      expect(() => assertOAuthReady()).toThrow(/https/i);
    } finally {
      process.env.APP_URL = previous;
    }
  });

  it('allows plain http on localhost, where development happens', async () => {
    const { assertOAuthReady } = await import('../src/lib/env');
    const previous = process.env.APP_URL;
    process.env.APP_URL = 'http://localhost:3000';

    try {
      expect(() => assertOAuthReady()).not.toThrow();
    } finally {
      process.env.APP_URL = previous;
    }
  });
});

describe('turning a code into a token', () => {
  it('upgrades to a long-lived token', () => {
    routes['/oauth/access_token'] = () => ({
      body: { access_token: 'long-lived-token', token_type: 'bearer', expires_in: 5_184_000 },
    });

    return oauth.exchangeForLongLivedToken('short-lived').then((token) => {
      expect(token.token).toBe('long-lived-token');
      // About sixty days out, which is what makes the scheduler's expiry
      // warnings meaningful.
      expect(token.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('reports what Facebook said when it refuses', async () => {
    routes['/oauth/access_token'] = () => ({
      status: 400,
      body: { error: { message: 'This authorization code has been used.', code: 100 } },
    });

    await expect(oauth.exchangeCodeForToken('used-code')).rejects.toThrow(/has been used/);
  });

  it('refuses a response with no token rather than storing nothing', async () => {
    // A 200 with an empty body would otherwise be stored as a connection that
    // fails at the first publish.
    routes['/oauth/access_token'] = () => ({ body: {} });

    await expect(oauth.exchangeCodeForToken('odd-code')).rejects.toThrow();
  });
});
