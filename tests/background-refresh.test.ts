import { describe, expect, it } from 'vitest';

import { refreshState, startRefresh } from '../src/lib/background-refresh';

/**
 * "Analyse now" reads Facebook for longer than the proxy waits for an answer,
 * so the request is answered at once and the work carries on behind it.
 */
describe('a refresh that outlives its request', () => {
  it('is running straight away and done once the work finishes', async () => {
    let finish!: (value: number) => void;
    const work = new Promise<number>((resolve) => (finish = resolve));

    expect(startRefresh('a', () => work).state).toBe('running');
    expect(refreshState('a').state).toBe('running');

    finish(7);
    await work;
    await Promise.resolve();
    expect(refreshState<number>('a')).toMatchObject({ state: 'done', result: 7 });
  });

  it('joins a refresh already running rather than starting another', async () => {
    let calls = 0;
    let finish!: () => void;
    const work = () => {
      calls += 1;
      return new Promise<void>((resolve) => (finish = resolve));
    };
    startRefresh('b', work);
    startRefresh('b', work);
    expect(calls).toBe(1);
    finish();
  });

  it('reports a failure in words', async () => {
    startRefresh('c', async () => {
      throw new Error('token expired');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshState('c')).toMatchObject({ state: 'failed', message: 'token expired' });
  });

  it('forgets a finished refresh after a while', async () => {
    startRefresh('d', async () => 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshState('d', Date.now() + 11 * 60 * 1000).state).toBe('idle');
  });
});
