import { describe, expect, it } from 'vitest';
import { createFacebookAdapter, FacebookApiError } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'],
};

describe('Facebook publishing failure classification', () => {
  const classify = createFacebookAdapter(config).classifyPublishingFailure!;

  it('rejects only provider-owned explicit Graph rejection codes on non-transient 4xx responses', () => {
    for (const code of [100, 190, 10, 200, 299]) {
      expect(classify(new FacebookApiError('rejected', 400, code))).toBe('rejected');
    }
    expect(classify(new FacebookApiError('uncoded bad request', 400))).toBe('uncertain');
    expect(classify(new FacebookApiError('recognized code on success status', 200, 100))).toBe('uncertain');
  });

  it('keeps generic errors, unknown codes, transient responses, throttling and ambiguous statuses uncertain', () => {
    expect(classify(Object.assign(new Error('generic'), { status: 400 }))).toBe('uncertain');
    expect(classify(new FacebookApiError('unknown code', 400, 999))).toBe('uncertain');
    expect(classify(new FacebookApiError('temporary', 400, 100, undefined, true))).toBe('uncertain');
    expect(classify(new FacebookApiError('throttled', 429, 100))).toBe('uncertain');
    expect(classify(new FacebookApiError('transport', 0))).toBe('uncertain');
    expect(classify(new FacebookApiError('malformed success', 200))).toBe('uncertain');
    expect(classify(new FacebookApiError('server error', 500))).toBe('uncertain');
  });

  it('preserves the Graph transient hint on parsed provider errors', async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: { message: 'try later', code: 100, is_transient: true } }), { status: 400 });
    const adapter = createFacebookAdapter(config, fetcher as unknown as typeof fetch, { postPublishScopes: ['pages_manage_posts'] });
    let failure: unknown;
    try {
      await adapter.publish!({ credential: { accessToken: 'token', grantedScopes: ['pages_manage_posts'] }, target: { id: 'page', name: 'Page', kind: 'page' }, text: 'hello' });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookApiError);
    expect(adapter.classifyPublishingFailure!(failure)).toBe('uncertain');
  });

  it('applies recognized Graph rejection signals to post creation failures', async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: { message: 'invalid request', code: 100 } }), { status: 400 });
    const adapter = createFacebookAdapter(config, fetcher as unknown as typeof fetch, { postPublishScopes: ['pages_manage_posts'] });
    let failure: unknown;
    try {
      await adapter.publish!({ credential: { accessToken: 'token', grantedScopes: ['pages_manage_posts'] }, target: { id: 'page', name: 'Page', kind: 'page' }, text: 'hello' });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(FacebookApiError);
    expect(adapter.classifyPublishingFailure!(failure)).toBe('rejected');
  });
});
