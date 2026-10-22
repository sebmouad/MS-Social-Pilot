import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const { configuredFacebookConfig } = vi.hoisted(() => ({ configuredFacebookConfig: vi.fn() }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookConfig }));
import { configuredFacebookProbeConfig } from '../src/platforms/facebook/probe-credentials';

const defaults: FacebookConfig = {
  graphBaseUrl: 'https://bundled.example', oauthBaseUrl: 'https://oauth.example',
  graphVersion: 'v1.0', requestTimeoutMs: 1000, maxPages: 1, pageSize: 1,
  pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/png'], appSecretProofEnabled: false,
  appSecret: 'synthetic-bundled-secret',
};

beforeEach(() => { configuredFacebookConfig.mockReset(); });

describe('Facebook operator probe configuration', () => {
  it('uses current module policy and signing material rather than bundled values', async () => {
    const configured = { ...defaults, graphBaseUrl: 'https://configured.example',
      requestTimeoutMs: 5000, appSecretProofEnabled: true, appSecret: 'synthetic-root-secret' };
    configuredFacebookConfig.mockResolvedValue(configured);
    expect(await configuredFacebookProbeConfig(defaults)).toEqual(configured);
    expect(defaults.appSecret).toBe('synthetic-bundled-secret');
  });

  it('clears a bundled secret when current Root signing material is unavailable', async () => {
    const { appSecret: _secret, ...configured } = defaults;
    configuredFacebookConfig.mockResolvedValue({ ...configured, appSecretProofEnabled: true });
    const result = await configuredFacebookProbeConfig(defaults);
    expect(result.appSecret).toBeUndefined();
    expect(result.appSecretProofEnabled).toBe(true);
    expect(JSON.stringify(result)).not.toContain('synthetic-bundled-secret');
  });

  it('propagates policy read failures without falling back to bundled configuration', async () => {
    configuredFacebookConfig.mockRejectedValue(new Error('policy unavailable'));
    await expect(configuredFacebookProbeConfig(defaults)).rejects.toThrow('policy unavailable');
  });
});
