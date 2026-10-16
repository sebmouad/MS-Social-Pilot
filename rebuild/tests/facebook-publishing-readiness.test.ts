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
  allowedImageMimeTypes: ['image/jpeg', 'image/png'],
};
const granted = (grantedScopes?: readonly string[]) => ({ accessToken: 'page-token', ...(grantedScopes ? { grantedScopes } : {}) });

describe('Facebook publishing credential readiness', () => {
  it('allows status reads only when every configured permission was granted', () => {
    const adapter = createFacebookAdapter(config, fetch, { postReadScopes: ['pages_read_engagement', 'pages_manage_posts'] });

    expect(adapter.canUseCredential!(granted(['pages_read_engagement', 'pages_manage_posts']), 'remoteStatus')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'remoteStatus')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement', 'pages_manage_posts', 'other_scope']), 'remoteStatus')).toBe(true);
  });

  it('fails closed for status reads when the provider has no configured permission policy', () => {
    const adapter = createFacebookAdapter(config);

    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'remoteStatus')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'publishing')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'remoteDelete')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_manage_engagement']), 'firstComment')).toBe(false);
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
      ['meta.postReadScopes', ['pages_read_engagement', 'pages_manage_posts']],
      ['meta.firstCommentScopes', ['pages_manage_engagement']],
    ]);

    const adapter = await configuredFacebookAdapter();

    expect(adapter.canUseCredential!(granted(['pages_read_engagement', 'pages_manage_posts']), 'remoteStatus')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'remoteStatus')).toBe(false);
    expect(adapter.canUseCredential!(granted(['pages_manage_engagement']), 'firstComment')).toBe(true);
    expect(adapter.canUseCredential!(granted(['pages_read_engagement']), 'firstComment')).toBe(false);
  });

  it('includes the configured first-comment permission in OAuth scopes', async () => {
    runtime.values = new Map<string, unknown>([
      ['meta.appId', 'synthetic-app-id'], ['meta.oauthRedirectUri', 'https://app.test/callback'], ['meta.oauthScopes', ['pages_show_list']],
      ['meta.inboxReadScopes', []], ['meta.inboxWriteScopes', []], ['meta.firstCommentScopes', ['pages_manage_engagement']],
    ]);
    const oauth = await configuredFacebookOAuth();
    expect(oauth.scopes).toEqual(['pages_show_list', 'pages_manage_engagement']);
  });
});
