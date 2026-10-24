import { describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('@/server/config/store', () => ({
  runtimeConfig: vi.fn(async (key: string) => config.values.get(key)),
}));
vi.mock('@/server/data', () => ({ prisma: {} }));

import { authRateLimit } from '@/server/auth-flow';

describe('Root-managed sign-in limits', () => {
  it('uses validated registry values for attempt count and window', async () => {
    config.values.set('auth.loginAttempts', 7);
    config.values.set('auth.loginWindowMinutes', 12);
    expect(await authRateLimit()).toEqual({ limit: 7, windowMs: 720_000 });
  });
});
