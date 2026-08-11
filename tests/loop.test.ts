import { beforeEach, describe, expect, it } from 'vitest';

import {
  createLoopState,
  dueJobs,
  markFinished,
  markStarted,
  type LoopState,
} from '../src/lib/scheduler/loop';
import type { JobDefinition } from '../src/lib/scheduler/jobs';

/**
 * The worker's scheduling decision.
 *
 * Written as a separate function because the bug it fixes is invisible until
 * an installation is big enough to hit it: a job that takes longer than its
 * interval used to be started again while the previous run was still going,
 * for ever. On the jobs that walk every workspace calling Graph, that spends
 * the app's rate limit twice to collect the same numbers — on exactly the
 * installation that can least afford it.
 */

const job = (name: string, seconds: number): JobDefinition =>
  ({ name, intervalMs: seconds * 1000, run: async () => null }) as unknown as JobDefinition;

const publish = job('publish', 30);
const analytics = job('analytics', 60);

let state: LoopState;

beforeEach(() => {
  state = createLoopState();
});

describe('choosing what runs', () => {
  it('runs everything on the first pass', () => {
    expect(dueJobs([publish, analytics], state, 1_000_000).map((entry) => entry.name)).toEqual([
      'publish',
      'analytics',
    ]);
  });

  it('waits out the interval after a run finishes', () => {
    const now = 1_000_000;
    markStarted(state, publish);
    markFinished(state, publish, now);

    expect(dueJobs([publish], state, now + 29_000)).toEqual([]);
    expect(dueJobs([publish], state, now + 30_000)).toHaveLength(1);
  });

  it('does not start a job that is still running', () => {
    // The whole point. Without this a slow job is started again every pass.
    const now = 1_000_000;
    markStarted(state, publish);

    expect(dueJobs([publish], state, now)).toEqual([]);
    expect(dueJobs([publish], state, now + 600_000)).toEqual([]);
  });

  it('measures the next run from the finish, not from the start', () => {
    // A job taking 45 seconds on a 30-second interval settles into every 75
    // seconds. Slower than configured, which is the honest answer when the
    // work does not fit in the interval.
    const started = 1_000_000;
    markStarted(state, publish);
    markFinished(state, publish, started + 45_000);

    expect(dueJobs([publish], state, started + 60_000)).toEqual([]);
    expect(dueJobs([publish], state, started + 75_000)).toHaveLength(1);
  });

  it('lets a fast job keep its cadence while a slow one is stuck', () => {
    // One long analytics pass must not hold up publishing, which is the whole
    // reason these share a loop rather than a queue.
    const now = 1_000_000;
    markStarted(state, analytics);
    markStarted(state, publish);
    markFinished(state, publish, now);

    const due = dueJobs([publish, analytics], state, now + 30_000);
    expect(due.map((entry) => entry.name)).toEqual(['publish']);
  });

  it('starts a job again once its long run finally ends', () => {
    const now = 1_000_000;
    markStarted(state, analytics);
    expect(dueJobs([analytics], state, now + 500_000)).toEqual([]);

    markFinished(state, analytics, now + 500_000);
    expect(dueJobs([analytics], state, now + 560_000)).toHaveLength(1);
  });

  it('forgets a job that is no longer configured', () => {
    // Jobs are re-read every pass, so a feature switched off simply stops
    // appearing rather than needing to be cleaned out of the state.
    const now = 1_000_000;
    markStarted(state, analytics);
    markFinished(state, analytics, now);

    expect(dueJobs([publish], state, now).map((entry) => entry.name)).toEqual(['publish']);
  });

  it('keeps each job on its own schedule', () => {
    const now = 1_000_000;
    markStarted(state, publish);
    markFinished(state, publish, now);
    markStarted(state, analytics);
    markFinished(state, analytics, now);

    expect(dueJobs([publish, analytics], state, now + 30_000).map((entry) => entry.name)).toEqual([
      'publish',
    ]);
    expect(dueJobs([publish, analytics], state, now + 60_000).map((entry) => entry.name)).toEqual([
      'publish',
      'analytics',
    ]);
  });
});
