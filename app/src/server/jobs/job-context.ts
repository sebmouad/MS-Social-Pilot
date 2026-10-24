import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-run shutdown state the worker exposes to job code without threading arguments through platform hooks. */
export type JobRunContext = {
  /** Aborts once the shutdown grace period has elapsed. */
  signal: AbortSignal;
  /** True as soon as shutdown begins; jobs stop starting new items at their next safe point. */
  stopRequested: () => boolean;
};

const storage = new AsyncLocalStorage<JobRunContext>();

export function runWithJobContext<T>(context: JobRunContext, run: () => T): T { return storage.run(context, run); }
export function jobStopRequested(): boolean { return storage.getStore()?.stopRequested() === true; }
export function jobAbortSignal(): AbortSignal | undefined { return storage.getStore()?.signal; }
