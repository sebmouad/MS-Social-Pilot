import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdapter } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const runtime = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => runtime.values.get(key),
  runtimeSecret: async () => 'synthetic-app-secret',
}));

import { configuredFacebookAdapter, configuredFacebookOAuth } from '../src/platforms/facebook/runtime';
import { FACEBOOK_CONFIG } from '../src/platforms/facebook/module';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg', 'image/png'], appSecretProofEnabled: false,
};
const granted = (grantedScopes?: readonly string[]) => ({ accessToken: 'page-token', ...(grantedScopes ? { grantedScopes } : {}) });

describe('Facebook publishing credential readiness', () => {
  it('blocks publish, status, delete, and first-comment readiness when required proof secret is missing', () => {
    const adapter = createFacebookAdapter({ ...config, appSecretProofEnabled: true }, fetch, {
      postReadScopes: ['read'], postPublishScopes: ['publish'], postDeleteScopes: ['delete'], firstCommentScopes: ['comment'],
    });
    const credential = granted(['read', 'publish', 'delete', 'comment']);
    expect(adapter.capabilities).toMatchObject({ publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported' });
    for (const operation of ['publishing', 'remoteStatus', 'remoteDelete', 'firstComment'] as const) {
      expect(adapter.canUseCredential!(credential, operation)).toBe(false);
    }
  });

  it('declares only the media forms implemented by the Facebook publisher', () => {
    const adapter = createFacebookAdapter(config);
    expect(adapter.publishingMedia).toEqual({
      kinds: ['image', 'video'], maxImages: null, maxVideos: 1,
      mixedKinds: false, linkWithMedia: false, imageAltText: true,
    });
  });

  it('allows status reads only when every configured permission was granted', () => {
    const adapter = createFacebookAdapter(config, fetch, { postReadScopes: ['pages_read_engagement', 'pages_manage_posts'] });

    expect(adapter.canUseCredential!(granted(['pages_read_engagement', 'pages_manage_posts']), 'remoteStatus')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'remoteStatus')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement', 'pages_manage_posts', 'other_scope']), 'remoteStatus')).toBe(true);
  });

  it('fails closed for status reads when the provider has no configured permission policy', () => {
    const adapter = createFacebookAdapter(config);

    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'remoteStatus')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'publishing')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_manage_posts']), 'remoteDelete')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_manage_engagement']), 'firstComment')).toBe(false);
  });

  it('requires configured publish and delete scopes and denies calls before network dispatch', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const adapter = createFacebookAdapter(config, fetcher, { postReadScopes: ['pages_read_engagement'], postPublishScopes: ['pages_manage_posts'], postDeleteScopes: ['pages_manage_posts'] });
    expect(adapter.canUseCredential!(granted(['pages_manage_posts']), 'publishing')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_manage_posts']), 'remoteDelete')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'publishing')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'remoteDelete')).toBe(false);
    await expect(adapter.publish!(({ target: { id: 'p1', kind: 'page' }, credential: granted(['pages_read_engagement']), text: 'hello' } as never))).rejects.toThrow(/publishing permission/i);
    await expect(adapter.deleteRemote!(({ targetId: 'p1', credential: granted(['pages_read_engagement']), remoteId: 'p1_2' } as never))).rejects.toThrow(/deletion permission/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires every dedicated first-comment scope and fails closed without recorded grants', () => {
    const adapter = createFacebookAdapter(config, fetch, { postReadScopes: ['pages_read_engagement'], firstCommentScopes: ['pages_manage_engagement'] });

    expect(adapter.canUseCredential!(granted(['pages_manage_engagement']), 'firstComment')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'firstComment')).toBe(false);
    expect(adapter.canUseCredential!({ accessToken: 'page-token' }, 'firstComment')).toBe(false);
  });

  it('registers a validated, active Root setting for first-comment scopes', () => {
    const setting = FACEBOOK_CONFIG.find(item => item.key === 'meta.firstCommentScopes');
    expect(setting).toMatchObject({ defaultValue: ['pages_manage_engagement'], consumption: 'active', group: 'Facebook · API scopes · publishing' });
    expect(setting?.schema.safeParse(['pages_manage_engagement']).success).toBe(true);
    expect(setting?.schema.safeParse([]).success).toBe(false);
  });

  it('injects Root configured status-read permissions into the runtime adapter', async () => {
    runtime.values = new Map<string, unknown>([
      ['meta.graphBaseUrl', config.graphBaseUrl], ['meta.oauthBaseUrl', config.oauthBaseUrl], ['meta.graphVersion', config.graphVersion],
      ['meta.requestTimeoutMs', config.requestTimeoutMs], ['meta.maxPages', config.maxPages], ['meta.pageSize', config.pageSize],
      ['meta.pageInsightMetrics', config.pageInsightMetrics], ['meta.adInsightFields', config.adInsightFields],
      ['meta.maxImageUploadBytes', config.maxImageUploadBytes], ['meta.allowedImageMimeTypes', config.allowedImageMimeTypes],
      ['meta.appSecretProofEnabled', true],
      ['meta.postReadScopes', ['pages_read_engagement', 'pages_manage_posts']],
      ['meta.postPublishScopes', ['pages_manage_posts']], ['meta.postDeleteScopes', ['pages_manage_posts']],
      ['meta.firstCommentScopes', ['pages_manage_engagement']],
    ]);

    const adapter = await configuredFacebookAdapter();

    expect(adapter.canUseCredential!(granted(['pages_read_engagement', 'pages_manage_posts']), 'remoteStatus')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'remoteStatus')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_manage_engagement']), 'firstComment')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'firstComment')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_manage_posts']), 'publishing')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_manage_posts']), 'remoteDelete')).toBe(true);
  });

  it('includes the configured first-comment permission in OAuth scopes', async () => {
    runtime.values = new Map<string, unknown>([
      ['meta.appId', 'synthetic-app-id'], ['meta.oauthRedirectUri', 'https://app.test/callback'], ['meta.oauthScopes', ['pages_show_list']],
      ['meta.inboxReadScopes', []], ['meta.inboxWriteScopes', []], ['meta.firstCommentScopes', ['pages_manage_engagement']],
      ['meta.postReadScopes', ['pages_read_engagement']], ['meta.postPublishScopes', ['pages_manage_posts']], ['meta.postDeleteScopes', ['pages_manage_posts']],
    ]);
    const oauth = await configuredFacebookOAuth();
    expect(oauth.scopes).toEqual(['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement']);
  });

  it('registers active, validated publish and delete scope settings', () => {
    for (const key of ['meta.postPublishScopes', 'meta.postDeleteScopes']) {
      const setting = FACEBOOK_CONFIG.find(item => item.key === key);
      expect(setting).toMatchObject({ defaultValue: ['pages_manage_posts'], consumption: 'active', group: 'Facebook · API scopes · publishing' });
      expect(setting?.schema.safeParse(['pages_manage_posts']).success).toBe(true);
      expect(setting?.schema.safeParse([]).success).toBe(false);
    }
  });
  it('denies status and first-comment adapter entry points before network without grants', async () => {
    const fetcher = vi.fn();
    const adapter = createFacebookAdapter(config, fetcher as unknown as typeof fetch, { postReadScopes: ['read-post'], firstCommentScopes: ['comment-write'] });
    await expect(adapter.getRemoteStatus!({ credential: granted([]), remoteId: 'p1_2' })).rejects.toThrow(/permission/i);
    await expect(adapter.publishFirstComment!({ credential: granted([]), remotePostId: 'p1_2', text: 'Comment' })).rejects.toThrow(/permission/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps adapter operations callable without a receiver object', async () => {
    const adapter = createFacebookAdapter(config, async () => new Response(JSON.stringify({ id: 'p1_2' })), { postPublishScopes: ['publish-write'] });
    const publish = adapter.publish!;
    await expect(publish({ target: { id: 'p1', name: 'Page', kind: 'page' }, credential: granted(['publish-write']), text: 'Example' })).resolves.toMatchObject({ remoteId: 'p1_2' });
  });

});
