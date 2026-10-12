/**
 * Which worker job is making a Graph call (NEXT_PHASES H16), carried through
 * every await without passing it down, so root can see the heaviest jobs.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const job = new AsyncLocalStorage<string>();

export function runAsJob<T>(name: string, run: () => Promise<T>): Promise<T> {
  return job.run(name, run);
}

export function currentJob(): string | null {
  return job.getStore() ?? null;
}
