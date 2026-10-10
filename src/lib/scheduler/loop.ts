import type { JobDefinition } from './jobs';

/**
 * Which jobs are due, and the bookkeeping that keeps one from lapping itself.
 *
 * The worker used to stamp a job's next run *before* starting it. A job that
 * takes longer than its interval therefore came due again while the previous
 * run was still going, and the loop started another — for ever, overlapping.
 *
 * For `publish` that is harmless: claiming a destination is atomic, and running
 * several workers is a supported way to go faster. For the jobs that walk every
 * workspace calling Graph — analytics, page insights, edges, Instagram, ads —
 * it is not. Two passes over the same Pages spend the app's rate limit twice to
 * collect the same numbers, and on an installation big enough for the job to
 * run long, that is exactly the installation that can least afford it.
 *
 * So a job is skipped while its previous run is still in flight, and its next
 * run is measured from when that run *finished*. A job that takes 45 seconds on
 * a 30-second interval settles into every 75 seconds rather than running
 * continuously — slower than configured, which is the honest answer when the
 * work does not fit in the interval.
 *
 * Kept separate from the worker process so the decision can be tested without
 * starting one.
 */

export interface LoopState {
  /** Job name to the epoch millisecond it may next start. */
  nextRunAt: Map<string, number>;
  /** Jobs whose previous run has not finished. */
  running: Set<string>;
}

export function createLoopState(): LoopState {
  return { nextRunAt: new Map(), running: new Set() };
}

/** The jobs that should start now. */
export function dueJobs(jobs: JobDefinition[], state: LoopState, now: number): JobDefinition[] {
  return jobs.filter((job) => {
    if (state.running.has(job.name)) return false;
    return (state.nextRunAt.get(job.name) ?? 0) <= now;
  });
}

/** Mark a job as started. Its next run is decided when it finishes. */
export function markStarted(state: LoopState, job: JobDefinition): void {
  state.running.add(job.name);
}

/**
 * Mark a job as finished and schedule the next one.
 *
 * Measured from now rather than from when this run began, so a job that
 * overruns its interval does not come due the instant it stops.
 */
export function markFinished(state: LoopState, job: JobDefinition, now: number, nextInMs?: number): void {
  state.running.delete(job.name);
  state.nextRunAt.set(job.name, now + (nextInMs ?? job.intervalMs));
}

/**
 * Carry the schedule over from before a restart.
 *
 * A fresh worker used to find every job due and run them all at once: each
 * deploy spent a full analytics, insights and comments pass, and on a small
 * Meta app a few deploys in a day were enough to spend the hour's call
 * allowance and have Facebook refuse the next scheduled post. A job that
 * finished recently now waits out the rest of its interval; one that never
 * ran, or is overdue, still runs straight away.
 */
export function seedFromHistory(
  state: LoopState,
  jobs: JobDefinition[],
  finishedAt: Map<string, number>,
): void {
  for (const job of jobs) {
    const finished = finishedAt.get(job.name);
    if (finished !== undefined) state.nextRunAt.set(job.name, finished + job.intervalMs);
  }
}
