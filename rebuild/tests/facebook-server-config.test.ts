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
      ['meta.inboxWriteScopes', ['pages_manage_engagement']], ['meta.adsManageScopes', ['ads_management']],
      ['meta.firstCommentScopes', ['pages_manage_engagement']],
    ]);
    await expect(configuredFacebookOAuth()).resolves.toMatchObject({
      scopes: ['pages_show_list', 'pages_messaging', 'pages_manage_engagement'],
    });
  });
});
