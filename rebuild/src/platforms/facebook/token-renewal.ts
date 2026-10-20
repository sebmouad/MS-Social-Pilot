import type { PlatformHost } from '@/server/platforms/host';
import { configuredFacebookEngine, configuredFacebookOAuth } from './runtime';

/** Only the stored user token is exchanged. Page credentials and grants require discovery/reconnection. */
export const renewFacebookConnectionToken: NonNullable<PlatformHost['connection']['renewToken']> = async input => {
  if (!input.accessToken) return null;
  const [engine, oauth] = await Promise.all([configuredFacebookEngine({ signal: input.signal }), configuredFacebookOAuth()]);
  return engine.exchangeForLongLivedToken({ accessToken: input.accessToken, appId: oauth.appId, appSecret: oauth.appSecret });
};
