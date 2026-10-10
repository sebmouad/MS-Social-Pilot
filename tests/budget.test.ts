import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  BACKGROUND_USAGE_CEILING,
  THROTTLE_COOLDOWN_MS,
  backgroundBudget,
  noteAppUsage,
  noteThrottled,
  resetBudget,
} from '../src/lib/facebook/budget';
import { createLoopState, dueJobs, seedFromHistory } from '../src/lib/scheduler/loop';
import type { JobDefinition } from '../src/lib/scheduler/jobs';

/**
 * The Meta app's call allowance, and the two things that spent it.
 *
 * On a small installation Meta allows about two hundred calls an hour for the
 * whole app. A fresh worker ran every sync at once, so each deploy spent a full
 * pass, and the syncs never looked at how much was left — until Facebook
 * refused everything, the next scheduled post included.
 */

const HOUR = 60 * 60 * 1000;

beforeEach(() => resetBudget());

describe('the background budget', () => {
  it('lets syncs run with nothing seen', () => {
    expect(backgroundBudget(0).ok).toBe(true);
  });

  it('lets syncs run below the ceiling', () => {
    noteAppUsage(BACKGROUND_USAGE_CEILING - 1, 0);
    expect(backgroundBudget(1000).ok).toBe(true);
  });

  it('holds syncs back at the ceiling, so publishing keeps the rest', () => {
    noteAppUsage(BACKGROUND_USAGE_CEILING, 0);
    const verdict = backgroundBudget(1000);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/75%/);
      expect(verdict.retryInMs).toBeGreaterThan(0);
    }
  });

  it('forgets a high reading once Meta’s hour has moved on', () => {
    noteAppUsage(95, 0);
    expect(backgroundBudget(HOUR + 1).ok).toBe(true);
  });

  it('stays off after a refusal, then tries again', () => {
    noteThrottled(0);
    const verdict = backgroundBudget(60_000);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.retryInMs).toBe(THROTTLE_COOLDOWN_MS - 60_000);
    // The reading a refusal leaves behind is 100%, and it holds for the hour.
    expect(backgroundBudget(THROTTLE_COOLDOWN_MS + 1).ok).toBe(false);
    expect(backgroundBudget(HOUR + 1).ok).toBe(true);
  });

  it('ignores a header it could not read', () => {
    noteAppUsage(null, 0);
    noteAppUsage(Number.NaN, 0);
    expect(backgroundBudget(1).ok).toBe(true);
  });
});

describe('what Graph tells the budget', () => {
  let server: Server;
  let answer: { status: number; usage: string | null; body: unknown };

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.SESSION_SECRET = 'test-session-secret';
    process.env.FACEBOOK_APP_ID = '123';
    process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
    server = createServer((request, response) => {
      request.on('data', () => undefined);
      request.on('end', () => {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (answer.usage) headers['x-app-usage'] = answer.usage;
        response.writeHead(answer.status, headers);
        response.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('no port');
    process.env.FACEBOOK_GRAPH_BASE_URL = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reads the usage header on every answer', async () => {
    const { graphRequest } = await import('../src/lib/facebook/graph');
    answer = { status: 200, usage: JSON.stringify({ call_count: 88, total_time: 5, total_cputime: 4 }), body: { id: 'x' } };
    await graphRequest('me', { accessToken: 'token' });
    expect(backgroundBudget().ok).toBe(false);
  });

  it('takes the app’s own limit as a refusal for everyone', async () => {
    const { graphRequest } = await import('../src/lib/facebook/graph');
    answer = { status: 403, usage: null, body: { error: { message: '(#4) Application request limit reached', code: 4 } } };
    await expect(graphRequest('me', { accessToken: 'token' })).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(backgroundBudget().ok).toBe(false);
  });

  it('does not stop every sync for one Page’s limit', async () => {
    const { graphRequest } = await import('../src/lib/facebook/graph');
    answer = { status: 403, usage: null, body: { error: { message: 'Page request limit reached', code: 32 } } };
    await expect(graphRequest('me', { accessToken: 'token' })).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(backgroundBudget().ok).toBe(true);
  });
});

describe('a restarted worker', () => {
  const job = (name: string, hours: number): JobDefinition =>
    ({ name, intervalMs: hours * HOUR, run: async () => null }) as unknown as JobDefinition;
  const publish = { ...job('publish', 0), intervalMs: 30_000 } as JobDefinition;
  const analytics = job('analytics', 6);
  const insights = job('pageInsights', 12);

  it('carries on the schedule instead of running every sync at once', () => {
    const state = createLoopState();
    const now = 10 * HOUR;
    // Analytics finished an hour ago; insights never ran here.
    seedFromHistory(state, [publish, analytics, insights], new Map([['analytics', now - HOUR]]));
    expect(dueJobs([publish, analytics, insights], state, now).map((entry) => entry.name)).toEqual([
      'publish',
      'pageInsights',
    ]);
    // And analytics comes due when its interval is up, counted from that finish.
    expect(dueJobs([analytics], state, now + 5 * HOUR).map((entry) => entry.name)).toEqual(['analytics']);
  });

  it('runs an overdue job straight away', () => {
    const state = createLoopState();
    seedFromHistory(state, [analytics], new Map([['analytics', 0]]));
    expect(dueJobs([analytics], state, 7 * HOUR)).toHaveLength(1);
  });
});

describe('the background jobs', () => {
  it('stand aside while the app is refused, and ask to be tried again soon', async () => {
    const { jobDefinitions } = await import('../src/lib/scheduler/jobs');
    noteThrottled();
    const jobs = jobDefinitions();
    for (const name of ['analytics', 'pageInsights', 'edges']) {
      const job = jobs.find((entry) => entry.name === name)!;
      let deferred: number | undefined;
      const summary = await job.run({ now: new Date(), logger: () => undefined, defer: (ms) => (deferred = ms) });
      expect(summary).toMatch(/^waiting: .*publishing keeps the rest$/);
      expect(deferred).toBeGreaterThan(0);
      expect(deferred).toBeLessThan(job.intervalMs);
    }
  });
});
