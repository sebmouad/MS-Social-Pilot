import { NextResponse } from 'next/server';
import type { PlatformHost } from '@/server/platforms/host';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import { configuredClient, configuredPolicy } from './runtime';
import { encodeBlueskyCredential } from './adapter';

const refuse = () => NextResponse.json({ error: 'Enter your app password in the connection form.' }, { status: 400 });

/** Bluesky connects by app password: no redirect. The module verifies it with a real session, then returns the account. */
export const blueskyConnection: PlatformHost['connection'] = {
  isReady: async () => configuredPolicy().then(() => true, () => false),
  start: async () => refuse(),
  callback: async () => refuse(),
  credentials: {
    async form(locale) {
      const { copy } = await configuredPolicy();
      return {
        title: copy.formTitle[locale], intro: copy.formIntro[locale], submit: copy.formSubmit[locale],
        fields: [
          { key: 'identifier', label: copy.identifierLabel[locale], help: copy.identifierHelp[locale], secret: false, maxLength: 320 },
          { key: 'appPassword', label: copy.passwordLabel[locale], help: copy.passwordHelp[locale], secret: true, maxLength: 64 },
        ],
      };
    },
    async connect(fields) {
      const policy = await configuredPolicy();
      const identifier = (fields.identifier ?? '').trim().replace(/^@/, '');
      const appPassword = (fields.appPassword ?? '').trim();
      let session;
      try { session = await (await configuredClient('en')).connect(identifier, appPassword); }
      catch { throw new ProviderHttpError(policy.unavailable.en, 'rejected'); }
      return {
        providerUserId: session.did, name: session.handle, pictureUrl: null,
        accessToken: encodeBlueskyCredential(identifier, appPassword), refreshToken: null, accessExpiresAt: null, grantExpiresAt: null,
        scopes: ['app_password'], destinations: [{ providerId: session.did, name: session.handle, pictureUrl: null }],
      };
    },
  },
  async grantHealth({ locale = 'en' }) {
    const policy = await configuredPolicy();
    return [{ id: 'publishing', label: policy.copy.post[locale], state: 'granted' as const }];
  },
};
