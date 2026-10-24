import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICY_DEFAULTS as linkedin } from '../src/platforms/linkedin/config';
import { POLICY_DEFAULTS as pinterest } from '../src/platforms/pinterest/config';
const m = vi.hoisted(() => ({ config: vi.fn(), secret: vi.fn(), headers: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config, runtimeSecret: m.secret }));
vi.mock('next/headers', () => ({ headers: m.headers }));
import { configuredEngine as liEngine, configuredCredentials as liCredentials } from '../src/platforms/linkedin/runtime';
import { configuredEngine as pinEngine, configuredCredentials as pinCredentials } from '../src/platforms/pinterest/runtime';
beforeEach(() => {
  m.config.mockImplementation(async (key: string) => key === 'linkedin.policy' ? linkedin : key === 'pinterest.policy' ? pinterest : 'app-id');
  m.secret.mockResolvedValue('synthetic-secret');
  m.headers.mockResolvedValue(new Headers({ 'accept-language': 'fr-FR' }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const lanes = [
  { id: 'linkedin', engine: liEngine, credentials: liCredentials, policy: linkedin, target: { id: 'urn:li:person:member', kind: 'linkedin', name: 'Example Studio' }, scopes: ['w_member_social'] },
  { id: 'pinterest', engine: pinEngine, credentials: pinCredentials, policy: pinterest, target: { id: 'board-one', kind: 'pinterest', name: 'Example Studio' }, scopes: ['pins:write'] },
];
for (const lane of lanes) describe(`${lane.id} Root runtime`, () => {
  it('loads credentials from the owning Root keys', async () => {
    expect(await lane.credentials()).toEqual({ appId: 'app-id', appSecret: 'synthetic-secret' });
    expect(m.config).toHaveBeenCalledWith(`${lane.id}.clientId`);
    expect(m.secret).toHaveBeenCalledWith(`${lane.id}.clientSecret`);
  });
  it('fails closed when credentials are missing', async () => {
    m.secret.mockResolvedValue(null); await expect(lane.credentials()).rejects.toThrow();
  });
  it('uses configured French copy for validation refusal and retains failure classification', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { adapter } = await lane.engine();
    const error = await adapter.publish!({ credential: { accessToken: 'synthetic', grantedScopes: lane.scopes }, target: lane.target, text: 'Example', scheduledAt: new Date() }).catch(error => error);
    expect(error).toMatchObject({ code: 'invalid_request', message: lane.policy.copy.invalid.fr });
    expect(adapter.classifyPublishingFailure!(error)).toBe('rejected');
    expect(fetcher).not.toHaveBeenCalled();
    expect(adapter.publishingFormats![0]!.label).toBe(lane.policy.copy.format.fr);
  });
  it('localizes uncertain writes without exposing provider data or releasing the claim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private provider body', { status: 500 })));
    const { adapter } = await lane.engine();
    const error = await adapter.publish!({ credential: { accessToken: 'synthetic', grantedScopes: lane.scopes }, target: lane.target, text: 'Example', media: lane.id === 'pinterest' ? [{ kind: 'image', url: 'https://media.example.test/image.jpg' }] : [] }).catch(error => error);
    expect(error).toMatchObject({ code: 'upstream_failure', message: lane.policy.copy.uncertain.fr });
    expect(adapter.classifyPublishingFailure!(error)).toBe('uncertain');
    expect(String(error)).not.toContain('private provider body');
  });
});
