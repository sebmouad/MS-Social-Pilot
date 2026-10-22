import { NextResponse } from 'next/server';
import type { PlatformHost } from '@/server/platforms/host';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import { configuredClient, configuredPolicy } from './runtime';
import { encodeTelegramCredential } from './adapter';

const refuse = () => NextResponse.json({ error: 'Enter your bot token in the connection form.' }, { status: 400 });

/** Telegram connects by bot token: no redirect. The module verifies the bot is an administrator able to post. */
export const telegramConnection: PlatformHost['connection'] = {
  isReady: async () => configuredPolicy().then(() => true, () => false),
  start: async () => refuse(),
  callback: async () => refuse(),
  credentials: {
    async form(locale) {
      const { copy } = await configuredPolicy();
      return {
        title: copy.formTitle[locale], intro: copy.formIntro[locale], submit: copy.formSubmit[locale],
        fields: [
          { key: 'token', label: copy.tokenLabel[locale], help: copy.tokenHelp[locale], secret: true, maxLength: 80 },
          { key: 'channel', label: copy.channelLabel[locale], help: copy.channelHelp[locale], secret: false, maxLength: 40 },
        ],
      };
    },
    async connect(fields) {
      const policy = await configuredPolicy();
      const token = (fields.token ?? '').trim();
      const channel = (fields.channel ?? '').trim();
      let chat;
      try { chat = await (await configuredClient('en')).connect(token, channel); }
      catch { throw new ProviderHttpError(policy.unavailable.en, 'rejected'); }
      return {
        providerUserId: chat.id, name: chat.name, pictureUrl: null,
        accessToken: encodeTelegramCredential(token, channel), refreshToken: null, accessExpiresAt: null, grantExpiresAt: null,
        scopes: ['bot_token'], destinations: [{ providerId: chat.id, name: chat.name, pictureUrl: null }],
      };
    },
  },
  async grantHealth({ locale = 'en' }) {
    const policy = await configuredPolicy();
    return [{ id: 'publishing', label: policy.copy.post[locale], state: 'granted' as const }];
  },
};
