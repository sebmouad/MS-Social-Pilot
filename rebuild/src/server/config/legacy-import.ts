import type { ConfigKey } from '@/lib/config/registry';
import { FACEBOOK_CONNECTION_CALLBACK_PATH } from '@/platforms/facebook/protocol';

export type LegacySettingRow = { key: string; value: unknown; encrypted: boolean };
export type LegacyConfigCandidate = { key: ConfigKey; source: string; value: unknown; secret: boolean };

const mappings = [
  ['facebook.appId', 'meta.appId'],
  ['facebook.appSecret', 'meta.appSecret'],
  ['facebook.graphVersion', 'meta.graphVersion'],
  ['facebook.graphBaseUrl', 'meta.graphBaseUrl'],
  ['facebook.scopes', 'meta.oauthScopes'],
] as const satisfies ReadonlyArray<readonly [string, ConfigKey]>;

export const legacyFacebookSettingKeys = [
  ...mappings.map(([source]) => source),
  'facebook.requestTimeoutSeconds',
] as const;

export function legacyConfigCandidates(
  rows: readonly LegacySettingRow[],
  options: {
    appUrl?: string;
    authPolicy?: string;
    loginAttempts?: string;
    loginWindowMinutes?: string;
    decrypt: (encrypted: string) => string;
  },
): LegacyConfigCandidate[] {
  const byKey = new Map(rows.map(row => [row.key, row]));
  const candidates: LegacyConfigCandidate[] = [];
  for (const [source, key] of mappings) {
    const row = byKey.get(source);
    if (!row || row.value === null || row.value === '') continue;
    let value = row.value;
    if (source === 'facebook.appSecret') {
      if (typeof value !== 'string' || !row.encrypted) throw new Error('Legacy Facebook app secret is not stored in the expected encrypted format.');
      value = options.decrypt(value);
    }
    if (source === 'facebook.scopes' && typeof value === 'string') value = value.split(',').map(part => part.trim()).filter(Boolean);
    candidates.push({ key, source, value, secret: source === 'facebook.appSecret' });
  }
  const timeout = byKey.get('facebook.requestTimeoutSeconds');
  if (timeout?.value !== null && timeout?.value !== undefined && timeout.value !== '') {
    const seconds = Number(timeout.value);
    candidates.push({ key: 'meta.requestTimeoutMs', source: timeout.key, value: seconds * 1000, secret: false });
  }
  if (options.appUrl) {
    const base = new URL(options.appUrl);
    if (base.protocol !== 'https:') throw new Error('Legacy APP_URL must use HTTPS before importing an OAuth redirect.');
    candidates.push({ key: 'meta.oauthRedirectUri', source: 'APP_URL', value: new URL(FACEBOOK_CONNECTION_CALLBACK_PATH, base).toString(), secret: false });
  }
  if (options.authPolicy !== undefined) {
    // Legacy sign-in treated any defined, unrecognized value as "everyone".
    const policy = ['off', 'admins', 'everyone'].includes(options.authPolicy) ? options.authPolicy : 'everyone';
    candidates.push({ key: 'security.twoStep', source: 'SECURITY_TWO_STEP', value: policy, secret: false });
  }
  if (options.loginAttempts) candidates.push({ key: 'auth.loginAttempts', source: 'LOGIN_ATTEMPTS', value: Number(options.loginAttempts), secret: false });
  if (options.loginWindowMinutes) candidates.push({ key: 'auth.loginWindowMinutes', source: 'LOGIN_WINDOW_MINUTES', value: Number(options.loginWindowMinutes), secret: false });
  return candidates;
}
