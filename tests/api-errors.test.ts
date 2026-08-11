import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

/**
 * How a thrown error becomes a response.
 *
 * Every route in the app funnels through this, so a mistake here is a mistake
 * everywhere at once: a 500 where the client expected a 403 stops the UI
 * showing the message that would have told somebody what to do, and an
 * unrecognised error that leaks its text can carry a token or a connection
 * string to the browser.
 */

vi.mock('next-intl/server', () => ({
  // No request context in a unit test, so the catalogue lookup fails and the
  // fallback wording on the error is what comes out — which is the path worth
  // testing anyway, since an error response must never itself throw.
  getTranslations: async () => {
    throw new Error('no request context');
  },
}));

let api: typeof import('../src/lib/api');
let errors: typeof import('../src/lib/errors')['errors'];
let AuthError: typeof import('../src/lib/auth')['AuthError'];
let ForbiddenError: typeof import('../src/lib/auth')['ForbiddenError'];
let GraphError: typeof import('../src/lib/facebook/graph')['GraphError'];
let MediaError: typeof import('../src/lib/media')['MediaError'];

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test-secret';
  process.env.FACEBOOK_APP_ID = '123';
  process.env.FACEBOOK_APP_SECRET = 'app-secret';

  api = await import('../src/lib/api');
  ({ errors } = await import('../src/lib/errors'));
  ({ AuthError, ForbiddenError } = await import('../src/lib/auth'));
  ({ GraphError } = await import('../src/lib/facebook/graph'));
  ({ MediaError } = await import('../src/lib/media'));
});

async function handle(error: unknown) {
  const response = await api.handleApiError(error);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('errors the app raises on purpose', () => {
  it('keeps the status the error chose', async () => {
    // These statuses are what the UI branches on: 403 shows "ask an admin",
    // 409 shows "this already happened", 429 shows "wait".
    expect((await handle(errors.noPermission())).status).toBe(403);
    expect((await handle(errors.postNotFound())).status).toBe(404);
    expect((await handle(errors.alreadyPublished())).status).toBe(409);
    expect((await handle(errors.aiRateLimited())).status).toBe(429);
    expect((await handle(errors.bulkTooManyRows(900, 500))).status).toBe(422);
  });

  it('says what happened, in words meant for the person reading', async () => {
    const { body } = await handle(errors.registrationClosed());
    expect(body.error).toMatch(/does not accept new accounts/i);
  });

  it('fills in the numbers an error carries', async () => {
    const { body } = await handle(errors.bulkTooManyRows(900, 500));
    expect(body.error).toContain('900');
    expect(body.error).toContain('500');
  });
});

describe('errors from elsewhere', () => {
  it('turns a validation failure into per-field messages', async () => {
    const zod = new ZodError([
      { code: 'custom', path: ['message'], message: 'That message is too long for Facebook.' },
    ]);

    const { status, body } = await handle(zod);
    expect(status).toBe(422);
    expect((body.fields as Record<string, string>).message).toMatch(/too long/i);
  });

  it('answers 401 when nobody is signed in, and 403 when somebody is but may not', async () => {
    // Different fixes: one is "sign in", the other is "ask someone with more
    // access". Collapsing them into one status loses that.
    expect((await handle(new AuthError('Sign in to continue.'))).status).toBe(401);
    expect((await handle(new ForbiddenError('Not your workspace.'))).status).toBe(403);
  });

  it('maps a Graph failure to the status that describes it', async () => {
    const kinds = [
      { kind: 'auth' as const, status: 401 },
      { kind: 'permission' as const, status: 403 },
      { kind: 'rate_limit' as const, status: 429 },
      { kind: 'transient' as const, status: 400 },
    ];

    for (const { kind, status } of kinds) {
      const result = await handle(new GraphError({ message: 'Facebook said no.', kind }));
      expect(result.status).toBe(status);
    }
  });

  it('passes Facebook\'s own wording through', async () => {
    // It arrives in one language and there is nothing to translate it against,
    // so rewriting it would only lose detail.
    const { body } = await handle(
      new GraphError({ message: 'The user has not authorized application 123.', kind: 'permission' }),
    );
    expect(body.error).toContain('has not authorized application');
  });

  it('carries the trace id when Facebook gives one', async () => {
    // The only thing that makes a Meta support conversation possible.
    const { body } = await handle(
      new GraphError({ message: 'Something failed.', kind: 'transient', traceId: 'ABC123' }),
    );
    expect(body.traceId).toBe('ABC123');
  });

  it('answers 415 for a file it will not accept', async () => {
    expect((await handle(new MediaError('Upload a JPEG, PNG, GIF, WebP or MP4 file.'))).status).toBe(
      415,
    );
  });
});

describe('errors nobody planned for', () => {
  it('says nothing about what actually went wrong', async () => {
    // An exception from deep in the stack can hold a token or a connection
    // string. The full text still reaches the server log; what must not
    // happen is it reaching the browser.
    const leaky = new Error(
      'connect ECONNREFUSED postgresql://postgres:hunter2@10.0.0.4:5432/social_pilot',
    );

    const { status, body } = await handle(leaky);

    expect(status).toBe(500);
    expect(body.error).not.toContain('hunter2');
    expect(body.error).not.toContain('postgresql://');
    expect(body.error).toMatch(/something went wrong/i);
  });

  it('handles something thrown that is not an error at all', async () => {
    const { status, body } = await handle('just a string');

    expect(status).toBe(500);
    expect(body.error).toMatch(/something went wrong/i);
  });
});
