import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: new Map<string, unknown>(),
  appSecret: 'root-managed-app-secret' as string | null,
  appSecretError: null as Error | null,
  engineConfig: null as unknown,
  adapterConfig: null as unknown,
}));

vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => state.config.get(key),
  runtimeSecret: async (key: string) => {
    if (key === 'meta.appSecret' && state.appSecretError) throw state.appSecretError;
    return key === 'meta.appSecret' ? state.appSecret : null;
  },
}));
vi.mock('../src/platforms/facebook/publishing', () => ({
  createFacebookEngine: (config: unknown) => { state.engineConfig = config; return { config }; },
  createFacebookAdapter: (config: unknown) => { state.adapterConfig = config; return { config }; },
}));

import { configuredFacebookAdapter, configuredFacebookEngine } from '../src/platforms/facebook/runtime';

const configuredValues = () => new Map<string, unknown>([
  ['meta.graphBaseUrl', 'https://graph.facebook.com'],
  ['meta.oauthBaseUrl', 'https://www.facebook.com'],
  ['meta.graphVersion', 'v25.0'],
  ['meta.requestTimeoutMs', 15000],
  ['meta.maxPages', 20],
  ['meta.pageSize', 100],
  ['meta.pageInsightMetrics', ['page_views_total']],
  ['meta.adInsightFields', ['impressions']],
  ['meta.maxImageUploadBytes', 8388608],
  ['meta.allowedImageMimeTypes', ['image/jpeg', 'image/png']],
  ['meta.appSecretProofEnabled', true],
  ['meta.postReadScopes', ['pages_read_engagement']],
  ['meta.postPublishScopes', ['pages_manage_posts']],
  ['meta.postDeleteScopes', ['pages_manage_posts']],
  ['meta.firstCommentScopes', ['pages_manage_engagement']],
]);

afterEach(() => {
  state.config.clear(); state.appSecret = 'root-managed-app-secret'; state.appSecretError = null; state.engineConfig = null; state.adapterConfig = null; vi.unstubAllGlobals();
});

describe('Facebook runtime request signing configuration', () => {
  it('injects the Root policy and server-only app secret into the configured engine', async () => {
    state.config = configuredValues();
    await configuredFacebookEngine();
    expect(state.engineConfig).toMatchObject({ appSecretProofEnabled: true, appSecret: 'root-managed-app-secret' });
  });

  it('injects signing configuration into the production adapter constructor', async () => {
    state.config = configuredValues();
    await configuredFacebookAdapter();
    expect(state.adapterConfig).toMatchObject({ appSecretProofEnabled: true, appSecret: 'root-managed-app-secret' });
  });

  it('constructs safe engine metadata when signing material is absent', async () => {
    state.config = configuredValues();
    state.appSecret = null;
    await configuredFacebookEngine();
    expect(state.engineConfig).toMatchObject({ appSecretProofEnabled: true });
    expect(state.engineConfig).not.toHaveProperty('appSecret');
  });

  it('constructs safe engine metadata when the encrypted app secret cannot be read', async () => {
    state.config = configuredValues();
    state.appSecretError = new Error('private encryption detail');
    await expect(configuredFacebookEngine()).resolves.toBeDefined();
    expect(state.engineConfig).toMatchObject({ appSecretProofEnabled: true });
    expect(state.engineConfig).not.toHaveProperty('appSecret');
    await expect(configuredFacebookAdapter()).resolves.toBeDefined();
    expect(state.adapterConfig).toMatchObject({ appSecretProofEnabled: true });
    expect(state.adapterConfig).not.toHaveProperty('appSecret');
  });

  it('omits whitespace-only secrets from engine and adapter metadata', async () => {
    state.config = configuredValues();
    state.appSecret = '  \t  ';
    await configuredFacebookEngine();
    await configuredFacebookAdapter();
    expect(state.engineConfig).toMatchObject({ appSecretProofEnabled: true });
    expect(state.engineConfig).not.toHaveProperty('appSecret');
    expect(state.adapterConfig).toMatchObject({ appSecretProofEnabled: true });
    expect(state.adapterConfig).not.toHaveProperty('appSecret');
  });
});
