import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ hook: vi.fn(), enabled: true }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => state.enabled }));
vi.mock('../src/server/platforms/index', () => ({
  PLATFORM_HOSTS: {
    facebook: {
      adapter: vi.fn(), connection: { isReady: vi.fn(), start: vi.fn(), callback: vi.fn() },
      jobs: { analytics: state.hook },
    },
  },
}));

import { runEnabledPlatformJob } from '../src/server/platforms/registry';

beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.hook.mockResolvedValue({ examined: 2, updated: 1, skipped: 1, failed: 0 });
});

describe('platform job dispatch', () => {
  it('runs enabled module hooks and returns their job summary', async () => {
    const now = new Date('2026-10-15T12:00:00Z');
    await expect(runEnabledPlatformJob('analytics', now, 2, { baseDelayMs: 10, maxDelayMs: 100 })).resolves.toEqual({ examined: 2, updated: 1, skipped: 1, failed: 0 });
    expect(state.hook).toHaveBeenCalledWith(now, 2, { baseDelayMs: 10, maxDelayMs: 100 });
  });

  it('does not run hooks when the module switch is off', async () => {
    state.enabled = false;
    await expect(runEnabledPlatformJob('analytics', new Date(), 0, { baseDelayMs: 10, maxDelayMs: 100 })).resolves.toEqual({ examined: 0, updated: 0, skipped: 0, failed: 0 });
    expect(state.hook).not.toHaveBeenCalled();
  });
});
