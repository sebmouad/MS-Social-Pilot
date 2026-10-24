/** Private operator probes share module credential decoding and Root policy. */
import type { FacebookConfig } from './config';
import { configuredFacebookConfig } from './runtime';

export { decryptSecret } from '@/server/secret-crypto';

export async function configuredFacebookProbeConfig(defaults: FacebookConfig): Promise<FacebookConfig> {
  const configured = await configuredFacebookConfig();
  // Missing Root signing material must never fall back to a bundled secret.
  return { ...defaults, ...configured, appSecret: configured.appSecret };
}
