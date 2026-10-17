import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createFacebookEngine, FacebookApiError } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const secret = 'synthetic-app-secret';
const proof = (token: string) => createHmac('sha256', secret).update(token).digest('hex');
const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: true, appSecret: secret,
};
const response = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Facebook appsecret_proof signing', () => {
  it('signs Graph GET and DELETE query credentials using each request token', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE'
      ? response({ success: true }) : response({ id: 'u1', name: 'User' })) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    await engine.getCurrentUser('user-token');
    await engine.deletePost('page-token', 'p1_2');
    for (const [index, token] of ['user-token', 'page-token'].entries()) {
      const url = new URL(String(vi.mocked(fetcher).mock.calls[index][0]));
      expect(url.searchParams.get('access_token')).toBe(token);
      expect(url.searchParams.get('appsecret_proof')).toBe(proof(token));
    }
  });

  it('signs URL encoded POST bodies with the same token as access_token', async () => {
    const fetcher = vi.fn(async () => response({ id: 'p1_2' })) as unknown as typeof fetch;
    await createFacebookEngine(config, fetcher).publish({ targetId: 'p1', accessToken: 'page-token', text: 'Hello' });
    const body = new URLSearchParams(String(vi.mocked(fetcher).mock.calls[0][1]?.body));
    expect(body.get('access_token')).toBe('page-token');
    expect(body.get('appsecret_proof')).toBe(proof('page-token'));
  });

  it('signs multipart uploads in the form fields', async () => {
    const fetcher = vi.fn(async () => response({ id: 'photo-1' })) as unknown as typeof fetch;
    await createFacebookEngine(config, fetcher).publish({ targetId: 'p1', accessToken: 'page-token', text: 'Image', media: [{
      kind: 'image', url: 'https://unused.test/image.jpg', localFile: { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg', fileName: 'image.jpg' },
    }] });
    const form = vi.mocked(fetcher).mock.calls[0][1]?.body as FormData;
    expect(form.get('access_token')).toBe('page-token');
    expect(form.get('appsecret_proof')).toBe(proof('page-token'));
  });

  it('replaces untrusted pagination token and proof with the caller token and its proof', async () => {
    const next = new URL('https://graph.facebook.test/v99.0/me/permissions?after=older&access_token=attacker-token&appsecret_proof=stale-proof');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('after=older')
      ? response({ data: [] }) : response({ data: [], paging: { next: next.toString() } })) as unknown as typeof fetch;
    await createFacebookEngine(config, fetcher).getGrantedPermissions('caller-token');
    const pageTwo = new URL(String(vi.mocked(fetcher).mock.calls[1][0]));
    expect(pageTwo.searchParams.get('access_token')).toBe('caller-token');
    expect(pageTwo.searchParams.get('appsecret_proof')).toBe(proof('caller-token'));
  });

  it('strips stale pagination proof when signing is explicitly disabled', async () => {
    const next = 'https://graph.facebook.test/v99.0/me/permissions?after=older&access_token=attacker-token&appsecret_proof=stale-proof';
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('after=older')
      ? response({ data: [] }) : response({ data: [], paging: { next } })) as unknown as typeof fetch;
    await createFacebookEngine({ ...config, appSecretProofEnabled: false, appSecret: undefined }, fetcher).getGrantedPermissions('caller-token');
    const pageTwo = new URL(String(vi.mocked(fetcher).mock.calls[1][0]));
    expect(pageTwo.searchParams.get('access_token')).toBe('caller-token');
    expect(pageTwo.searchParams.has('appsecret_proof')).toBe(false);
  });

  it('fails without transport when signing is enabled but the app secret is missing', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const engine = createFacebookEngine({ ...config, appSecret: undefined }, fetcher);
    expect(() => engine.getAuthorizationUrl({ appId: 'app', redirectUri: 'https://app.test/callback', state: 's', scopes: [] }))
      .not.toThrow();
    await expect(engine.getCurrentUser('sensitive-token')).rejects.toMatchObject({ name: 'FacebookApiError' });
    expect(fetcher).not.toHaveBeenCalled();
    try { await engine.getCurrentUser('sensitive-token'); } catch (error) {
      expect(error).toBeInstanceOf(FacebookApiError);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain('sensitive-token');
    }
  });

  it('keeps appsecret_proof out of OAuth authorization and exchange protocols', async () => {
    const fetcher = vi.fn(async () => response({ access_token: 'exchanged-token', expires_in: 3600 })) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    const authorization = new URL(engine.getAuthorizationUrl({ appId: 'app', redirectUri: 'https://app.test/callback', state: 's', scopes: [] }));
    expect(authorization.searchParams.has('appsecret_proof')).toBe(false);
    expect(authorization.searchParams.has('client_secret')).toBe(false);
    await engine.exchangeCode({ appId: 'app', appSecret: secret, redirectUri: 'https://app.test/callback', code: 'code' });
    const exchange = new URL(String(vi.mocked(fetcher).mock.calls[0][0]));
    expect(exchange.searchParams.get('client_secret')).toBe(secret);
    expect(exchange.searchParams.has('appsecret_proof')).toBe(false);
  });

  it('validates the signing policy and any configured app secret', () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(() => createFacebookEngine({ ...config, appSecretProofEnabled: 'yes' as unknown as boolean }, fetcher)).toThrow(/app secret proof/i);
    expect(() => createFacebookEngine({ ...config, appSecret: '' }, fetcher)).toThrow(/app secret/i);
  });
});
