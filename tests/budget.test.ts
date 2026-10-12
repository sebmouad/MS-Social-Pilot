import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  BACKGROUND_USAGE_CEILING,
  THROTTLE_COOLDOWN_MS,
  backgroundBudget,
  budgetSnapshot,
  callsBySource,
  callsLastHour,
  noteAppUsage,
  noteCall,
  noteObjectThrottled,
  noteObjectUsage,
  noteThrottled,
  pathObjectId,
  readBudget,
  resetBudget,
  restoreBudget,
  setReadCeiling,
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

describe('each Page’s own allowance', () => {
  it('knows which object a path is about', () => {
    expect(pathObjectId('123/feed')).toBe('123');
    expect(pathObjectId('/123_456')).toBe('123');
    expect(pathObjectId('act_789/insights')).toBe('789');
    expect(pathObjectId('me/accounts')).toBeNull();
  });

  it('refuses reads of a Page Facebook said is near its limit, and only that Page', () => {
    noteObjectUsage(JSON.stringify({ '123': [{ type: 'pages', call_count: 95, total_time: 3, total_cputime: 2 }] }), 0);
    expect(readBudget('123/feed', 1000).ok).toBe(false);
    expect(readBudget('456/feed', 1000).ok).toBe(true);
    expect(readBudget('123/feed', HOUR + 1).ok).toBe(true);
  });

  it('waits as long as Facebook says before reading a refused Page again', () => {
    noteObjectUsage(JSON.stringify({ '123': [{ call_count: 10, estimated_time_to_regain_access: 40 }] }), 0);
    const verdict = readBudget('123/feed', 60_000);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.retryInMs).toBe(39 * 60_000);
    expect(readBudget('123/feed', 41 * 60_000).ok).toBe(true);
  });

  it('holds a Page back after its own refusal', () => {
    noteObjectThrottled('123', 0);
    expect(readBudget('123_9/comments', 1000).ok).toBe(false);
    expect(readBudget('123/feed', THROTTLE_COOLDOWN_MS + 1).ok).toBe(false);
  });

  it('lets the web app read a little further than the worker', () => {
    noteAppUsage(80, 0);
    expect(readBudget('me', 1).ok).toBe(true);
    setReadCeiling(BACKGROUND_USAGE_CEILING);
    expect(readBudget('me', 1).ok).toBe(false);
  });

  it('counts the calls of the last hour', () => {
    noteCall(0);
    noteCall(30_000);
    noteCall(30 * 60_000);
    expect(callsLastHour(30 * 60_000)).toBe(3);
    expect(callsLastHour(HOUR + 60_000)).toBe(1);
  });

  it('carries what it knew across a restart, and drops what is past the hour', () => {
    noteAppUsage(80, 0);
    noteThrottled(1000);
    noteObjectThrottled('123', 1000);
    const saved = budgetSnapshot(2000);
    resetBudget();
    restoreBudget(saved, 3000);
    expect(backgroundBudget(3000).ok).toBe(false);
    expect(readBudget('123/feed', 3000).ok).toBe(false);
    resetBudget();
    restoreBudget(saved, 2 * HOUR);
    expect(readBudget('123/feed', 2 * HOUR).ok).toBe(true);
    expect(backgroundBudget(2 * HOUR).ok).toBe(true);
  });
});

describe('what Graph tells the budget', () => {
  let server: Server;
  let answer: { status: number; usage: string | null; business?: string; body: unknown };
  let calls = 0;

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
        if (answer.business) headers['x-business-use-case-usage'] = answer.business;
        calls += 1;
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

  it('holds back the Page a limit was about, without calling Facebook again', async () => {
    const { graphRequest } = await import('../src/lib/facebook/graph');
    answer = { status: 400, usage: null, body: { error: { message: 'Pages API throttled', code: 80001 } } };
    await expect(graphRequest('555/feed', { accessToken: 'token' })).rejects.toMatchObject({ kind: 'rate_limit' });
    const before = calls;
    answer = { status: 200, usage: null, body: { data: [] } };
    await expect(graphRequest('555/feed', { accessToken: 'token' })).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(calls).toBe(before);
    await graphRequest('556/feed', { accessToken: 'token' });
    expect(calls).toBe(before + 1);
  });

  it('reads the per-Page header, and still sends writes and essential reads', async () => {
    const { graphRequest } = await import('../src/lib/facebook/graph');
    answer = {
      status: 200,
      usage: null,
      business: JSON.stringify({ '777': [{ type: 'pages', call_count: 99, total_time: 1, total_cputime: 1 }] }),
      body: { id: 'x' },
    };
    await graphRequest('777/feed', { accessToken: 'token' });
    await expect(graphRequest('777/feed', { accessToken: 'token' })).rejects.toMatchObject({ kind: 'rate_limit' });
    await graphRequest('777/feed', { accessToken: 'token', method: 'POST', body: { message: 'x' } });
    await graphRequest('777_1', { accessToken: 'token', essential: true });
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

describe('calls by source (H16)', () => {
  beforeEach(() => resetBudget());

  it('counts the last hour per object and per job, busiest first', async () => {
    const { runAsJob, currentJob } = await import('../src/lib/facebook/call-source');
    const now = Date.UTC(2026, 9, 12, 12, 0);
    noteCall(now - 2 * 60 * 60 * 1000, { object: '111', job: 'analytics' });
    noteCall(now - 60_000, { object: '111', job: 'analytics' });
    noteCall(now - 30_000, { object: '111', job: 'edges' });
    noteCall(now, { object: '222', job: 'analytics' });
    noteCall(now, {});
    await runAsJob('publish', async () => {
      await Promise.resolve();
      expect(currentJob()).toBe('publish');
    });
    expect(currentJob()).toBeNull();

    const calls = callsBySource(now);
    expect(calls.objects).toEqual([{ id: '111', calls: 2 }, { id: '222', calls: 1 }]);
    expect(calls.jobs).toEqual([{ name: 'analytics', calls: 2 }, { name: 'edges', calls: 1 }, { name: '', calls: 1 }]);
    expect(budgetSnapshot(now).calls).toEqual(calls);
  });
});
