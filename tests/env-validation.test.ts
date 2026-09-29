import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MIN_SESSION_SECRET_LENGTH, env, validateEnv } from '../src/lib/env';

/**
 * The start-up check behind `src/instrumentation.ts`.
 *
 * What is asserted is mostly the message: somebody reads it in `docker logs`
 * with a container in a restart loop, and it has to name the variable and the
 * fix without ever printing the secret it is complaining about.
 */

const KEYS = ['NODE_ENV', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.DATABASE_URL = 'postgresql://localhost/test';
  process.env.ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else (process.env as Record<string, string>)[key] = saved[key]!;
  }
});

/** NODE_ENV is typed read-only; tests are the one place that must set it. */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string>).NODE_ENV = value;
}

describe('SESSION_SECRET', () => {
  it('refuses a short secret in production, naming the variable and the fix', () => {
    setNodeEnv('production');
    process.env.SESSION_SECRET = 'too-short-but-secret';

    expect(() => validateEnv()).toThrow(/SESSION_SECRET/);
    expect(() => validateEnv()).toThrow(/openssl rand -base64 32/);
    expect(() => validateEnv()).toThrow(new RegExp(`at least ${MIN_SESSION_SECRET_LENGTH}`));
    // The same rule at the point of use, for code that runs before or without
    // the start-up hook — the worker, a script.
    expect(() => env.sessionSecret).toThrow(/SESSION_SECRET/);
  });

  it('never repeats the secret in the error', () => {
    setNodeEnv('production');
    process.env.SESSION_SECRET = 'hunter2-hunter2';

    expect(() => validateEnv()).toThrow();
    try {
      validateEnv();
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });

  it('counts whitespace padding as nothing', () => {
    setNodeEnv('production');
    process.env.SESSION_SECRET = `  short  ${' '.repeat(40)}`;
    expect(() => validateEnv()).toThrow(/SESSION_SECRET/);
  });

  it('accepts a generated secret in production', () => {
    setNodeEnv('production');
    process.env.SESSION_SECRET = 'x'.repeat(MIN_SESSION_SECRET_LENGTH);
    expect(() => validateEnv()).not.toThrow();
    expect(env.sessionSecret).toBe('x'.repeat(MIN_SESSION_SECRET_LENGTH));
  });

  it('lets development and tests keep short throwaway values', () => {
    setNodeEnv('development');
    process.env.SESSION_SECRET = 'dev';
    expect(() => validateEnv()).not.toThrow();

    setNodeEnv('test');
    expect(env.sessionSecret).toBe('dev');
  });

  it('is required everywhere', () => {
    setNodeEnv('development');
    delete process.env.SESSION_SECRET;
    expect(() => validateEnv()).toThrow(/Missing required environment variable SESSION_SECRET/);
  });
});

describe('the other bootstrap variables', () => {
  it.each(['DATABASE_URL', 'ENCRYPTION_KEY'])('refuses to start without %s', (name) => {
    setNodeEnv('production');
    process.env.SESSION_SECRET = 'x'.repeat(48);
    process.env[name] = '';
    expect(() => validateEnv()).toThrow(new RegExp(name));
  });
});

describe('the start-up hook', () => {
  it('throws in production, so the server refuses to boot', async () => {
    setNodeEnv('production');
    process.env.SESSION_SECRET = 'short';
    const previous = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = 'nodejs';

    try {
      const { register } = await import('../src/instrumentation');
      await expect(register()).rejects.toThrow(/SESSION_SECRET/);
    } finally {
      if (previous === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = previous;
    }
  });

  it('stays out of `next build`, which runs without runtime secrets', async () => {
    setNodeEnv('production');
    delete process.env.SESSION_SECRET;
    const previous = { runtime: process.env.NEXT_RUNTIME, phase: process.env.NEXT_PHASE };
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NEXT_PHASE = 'phase-production-build';

    try {
      const { register } = await import('../src/instrumentation');
      await expect(register()).resolves.toBeUndefined();
    } finally {
      for (const [key, value] of [
        ['NEXT_RUNTIME', previous.runtime],
        ['NEXT_PHASE', previous.phase],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
