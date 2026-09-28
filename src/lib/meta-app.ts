import { env } from './env';
import { OAUTH_REDIRECT_PATH } from './facebook/oauth';

/**
 * The values to paste into the Meta app's settings, built from this
 * installation's own address.
 *
 * Connecting fails in ways Facebook explains badly when any of these is off by
 * a character — "URL blocked: this redirect failed because the redirect URI is
 * not whitelisted" names neither the URI it received nor the one it expected.
 * So rather than describe them in a document somebody translates by hand, the
 * installation says exactly what it will send, and what Meta will call back.
 */

export interface MetaAppField {
  /** Key under `metaApp.fields`, for the label and where it goes in Meta's UI. */
  key: 'appDomain' | 'siteUrl' | 'redirectUri' | 'deauthorize' | 'dataDeletion' | 'graphVersion' | 'permissions';
  value: string;
}

export type MetaAppWarning = 'notHttps' | 'loopback' | 'notAUrl';

export interface MetaAppSettings {
  fields: MetaAppField[];
  warnings: MetaAppWarning[];
}

export function metaAppSettings(): MetaAppSettings {
  const base = env.appUrl.replace(/\/+$/, '');
  const warnings: MetaAppWarning[] = [];

  let host = '';
  try {
    const url = new URL(base);
    host = url.hostname;
    // Meta accepts plain http only for localhost, and only in development mode.
    if (url.protocol !== 'https:') warnings.push('notHttps');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') warnings.push('loopback');
  } catch {
    warnings.push('notAUrl');
  }

  return {
    fields: [
      { key: 'appDomain', value: host },
      { key: 'siteUrl', value: `${base}/` },
      { key: 'redirectUri', value: `${base}${OAUTH_REDIRECT_PATH}` },
      { key: 'deauthorize', value: `${base}/api/facebook/deauthorize` },
      { key: 'dataDeletion', value: `${base}/api/facebook/data-deletion` },
      { key: 'graphVersion', value: env.graphVersion },
      { key: 'permissions', value: env.facebookScopes.join(', ') },
    ],
    warnings,
  };
}
