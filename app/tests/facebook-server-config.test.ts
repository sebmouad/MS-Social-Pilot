import { describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => config.values.get(key),
  runtimeSecret: async (key: string) => key === 'meta.appSecret' ? 'secret' : '',
}));

import { configuredFacebookOAuth } from '../src/platforms/facebook/runtime';

describe('Facebook OAuth scope configuration', () => {
  it('does not unconditionally add ads-management permission to connection scopes', async () => {
    config.values = new Map<string, unknown>([
      ['meta.appId', 'app-id'], ['meta.oauthRedirectUri', 'https://social.test/callback'],
      ['meta.oauthScopes', ['pages_show_list']], ['meta.inboxReadScopes', ['pages_messaging']],
      ['meta.pageInsightReadScopes', ['read_insights', 'pages_read_engagement']],
      ['meta.inboxWriteScopes', ['pages_manage_engagement']], ['meta.adsManageScopes', ['ads_management']],
      ['meta.firstCommentScopes', ['pages_manage_engagement']],
      ['meta.postReadScopes', ['pages_read_engagement']], ['meta.postPublishScopes', ['pages_manage_posts']], ['meta.postDeleteScopes', ['pages_manage_posts']],
    ]);
    await expect(configuredFacebookOAuth()).resolves.toMatchObject({
      scopes: ['pages_show_list', 'read_insights', 'pages_read_engagement', 'pages_messaging', 'pages_manage_engagement', 'pages_manage_posts'],
    });
    config.values.set('meta.mediaReadScopes', ['photo_read_override']);
    config.values.set('meta.mediaDeleteScopes', ['photo_delete_override']);
    config.values.set('meta.manualMediaCleanupEnabled', false);
    expect((await configuredFacebookOAuth()).scopes).not.toContain('photo_delete_override');
    config.values.set('meta.manualMediaCleanupEnabled', true);
    expect((await configuredFacebookOAuth()).scopes).toEqual(expect.arrayContaining(['photo_read_override', 'photo_delete_override']));
  });
});
