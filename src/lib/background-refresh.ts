/**
 * A refresh that runs after the request that asked for it has been answered.
 *
 * Reading a Page's insights, its posts and their figures from Facebook takes
 * longer than the proxy in front of the app waits for an answer — a minute or
 * two for a Page with history. Held open, the request was cut off and the
 * person was told it failed while it went on to finish. So the button starts
 * the work and is answered at once, and the screen asks how it is going.
 *
 * In memory, in the web process: the state is only ever a progress light for
 * whoever pressed the button, and a restart mid-refresh simply means pressing
 * it again. One refresh per key at a time, so a second press joins the first.
 */

export type RefreshState<T> =
  | { state: 'idle' }
  | { state: 'running'; startedAt: number }
  | { state: 'done'; finishedAt: number; result: T }
  | { state: 'failed'; finishedAt: number; message: string };

/** How long a finished refresh is remembered, for the screen to read once. */
const KEEP_MS = 10 * 60 * 1000;

const states = new Map<string, RefreshState<unknown>>();

export function refreshState<T>(key: string, now: number = Date.now()): RefreshState<T> {
  const current = states.get(key) as RefreshState<T> | undefined;
  if (!current) return { state: 'idle' };
  if ((current.state === 'done' || current.state === 'failed') && now - current.finishedAt > KEEP_MS) {
    states.delete(key);
    return { state: 'idle' };
  }
  return current;
}

/** Start `work` under `key` unless it is already running; never throws. */
export function startRefresh<T>(key: string, work: () => Promise<T>): RefreshState<T> {
  const current = states.get(key);
  if (current?.state === 'running') return current as RefreshState<T>;

  const running: RefreshState<T> = { state: 'running', startedAt: Date.now() };
  states.set(key, running);
  void work().then(
    (result) => states.set(key, { state: 'done', finishedAt: Date.now(), result }),
    (error: unknown) =>
      states.set(key, {
        state: 'failed',
        finishedAt: Date.now(),
        message: error instanceof Error ? error.message : String(error),
      }),
  );
  return running;
}
