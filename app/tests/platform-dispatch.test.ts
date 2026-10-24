import { describe, expect, it, vi } from 'vitest';

const factory = vi.hoisted(() => vi.fn());
const setting = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/platforms/facebook/runtime', () => ({ configuredFacebookAdapter: factory }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: setting }));

describe('platform capability dispatch', () => {
  it('returns only installed adapters with the requested capability', async () => {
    factory.mockResolvedValue({ id: 'facebook', capabilities: { publishing: 'supported', remoteDelete: 'unsupported' }, publish: vi.fn() });
    const { platformFor } = await import('@/server/platforms/registry');
    expect((await platformFor('facebook', 'publishing'))?.id).toBe('facebook');
    expect(await platformFor('facebook', 'remoteDelete')).toBeNull();
    expect(await platformFor('unknown-provider', 'publishing')).toBeNull();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not instantiate a disabled platform', async () => {
    setting.mockResolvedValueOnce(false);
    const { platformFor } = await import('@/server/platforms/registry');
    expect(await platformFor('facebook', 'publishing')).toBeNull();
  });
});
