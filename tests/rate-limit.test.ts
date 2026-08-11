import { beforeEach, describe, expect, it } from 'vitest';

import { clear, hit, reset } from '../src/lib/rate-limit';

/**
 * The brake on the sign-in form. Checking a password is deliberately slow, so
 * an unlimited form is both a way to guess passwords and a cheap way to keep
 * every core on the box busy.
 */
describe('hit', () => {
  const limit = { limit: 3, windowMs: 60_000 };

  beforeEach(() => {
    reset();
  });

  it('allows up to the limit and then stops', () => {
    const now = 1_000_000;
    const results = [1, 2, 3, 4].map(() => hit('k', { ...limit, now }));

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[2]!.remaining).toBe(0);
  });

  it('keeps counting while it refuses, so hammering does not outlast the window', () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 10; attempt += 1) hit('k', { ...limit, now });

    // Still inside the window: the tenth refusal has not reset anything.
    expect(hit('k', { ...limit, now: now + 59_000 }).allowed).toBe(false);
  });

  it('lets the window expire', () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 3; attempt += 1) hit('k', { ...limit, now });
    expect(hit('k', { ...limit, now }).allowed).toBe(false);

    expect(hit('k', { ...limit, now: now + 60_001 }).allowed).toBe(true);
  });

  it('counts each key separately', () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 3; attempt += 1) hit('one', { ...limit, now });

    expect(hit('one', { ...limit, now }).allowed).toBe(false);
    expect(hit('two', { ...limit, now }).allowed).toBe(true);
  });

  it('forgets a key on request, so a success wipes earlier failures', () => {
    const now = 1_000_000;
    hit('k', { ...limit, now });
    hit('k', { ...limit, now });
    clear('k');

    expect(hit('k', { ...limit, now }).remaining).toBe(2);
  });

  it('reports when the window resets', () => {
    const now = 1_000_000;
    expect(hit('k', { ...limit, now }).resetAt).toBe(now + 60_000);
  });

  it('does not grow without bound when the keys are all different', () => {
    // The memory-exhaustion version of the attack: guessing at random
    // addresses would otherwise add a key per attempt, for ever.
    const now = 1_000_000;
    for (let index = 0; index < 12_000; index += 1) {
      hit(`key-${index}`, { limit: 3, windowMs: 60_000, now });
    }

    // Nothing to assert directly on a module-private map, so assert the
    // consequence: an old key was evicted and starts over.
    expect(hit('key-0', { limit: 3, windowMs: 60_000, now }).remaining).toBe(2);
  });
});
