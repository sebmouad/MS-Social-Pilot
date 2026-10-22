/** Read-only historical mapping for migration verification; no import/write entry point. */
import type { ConfigKey } from '@/lib/config/registry';
import { FACEBOOK_CONNECTION_CALLBACK_PATH } from '@/platforms/facebook/protocol';

export type SourceSettingRow = { key: string; value: unknown; encrypted: boolean };
export type ExpectedSetting = { key: ConfigKey; source: string; value: unknown; secret: boolean };

const mappings = [
  ['facebook.appId', 'meta.appId'],
  ['facebook.appSecret', 'meta.appSecret'],
  ['facebook.graphVersion', 'meta.graphVersion'],
  ['facebook.graphBaseUrl', 'meta.graphBaseUrl'],
  ['facebook.scopes', 'meta.oauthScopes'],
] as const satisfies ReadonlyArray<readonly [string, ConfigKey]>;

/** The source application stored one model for the selected provider; the rebuild keeps one model per provider. */
const AI_MODEL_KEY: Record<string, ConfigKey> = { anthropic: 'ai.model', openai: 'ai.openaiModel', gemini: 'ai.geminiModel' };

export function expectedMigratedSettings(
  rows: readonly SourceSettingRow[],
  options: {
    appUrl?: string;
    authPolicy?: string;
    loginAttempts?: string;
    loginWindowMinutes?: string;
    decrypt: (encrypted: string) => string;
  },
): ExpectedSetting[] {
  const byKey = new Map(rows.map(row => [row.key, row]));
  const candidates: ExpectedSetting[] = [];
  for (const [source, key] of mappings) {
    const row = byKey.get(source);
    if (!row || row.value === null || row.value === '') continue;
    let value = row.value;
    if (source === 'facebook.appSecret') {
      if (typeof value !== 'string' || !row.encrypted) throw new Error('Source Facebook app secret is not stored in the expected encrypted format.');
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
    if (base.protocol !== 'https:') throw new Error('Source APP_URL must use HTTPS before importing an OAuth redirect.');
    candidates.push({ key: 'meta.oauthRedirectUri', source: 'APP_URL', value: new URL(FACEBOOK_CONNECTION_CALLBACK_PATH, base).toString(), secret: false });
  }
  if (options.authPolicy !== undefined) {
    // Source sign-in treated any defined, unrecognized value as "everyone".
    const policy = ['off', 'admins', 'everyone'].includes(options.authPolicy) ? options.authPolicy : 'everyone';
    candidates.push({ key: 'security.twoStep', source: 'SECURITY_TWO_STEP', value: policy, secret: false });
  }
  for (const [source, key] of [['ai.openaiKey', 'ai.openaiApiKey'], ['ai.geminiKey', 'ai.geminiApiKey']] as const) {
    const row = byKey.get(source);
    if (!row || row.value === null || row.value === '') continue;
    if (typeof row.value !== 'string' || !row.encrypted) throw new Error(`Source ${source} is not stored in the expected encrypted format.`);
    candidates.push({ key, source, value: options.decrypt(row.value), secret: true });
  }
  const provider = byKey.get('ai.provider')?.value;
  if (typeof provider === 'string' && AI_MODEL_KEY[provider]) {
    candidates.push({ key: 'ai.provider', source: 'ai.provider', value: provider, secret: false });
    const model = byKey.get('ai.model')?.value;
    if (typeof model === 'string' && model) candidates.push({ key: AI_MODEL_KEY[provider], source: 'ai.model', value: model, secret: false });
  }
  const hourly = byKey.get('ai.rateLimitPerHour')?.value;
  if (hourly !== undefined && hourly !== null && hourly !== '') candidates.push({ key: 'ai.hourlyRequestsPerWorkspace', source: 'ai.rateLimitPerHour', value: Number(hourly), secret: false });
  if (options.loginAttempts) candidates.push({ key: 'auth.loginAttempts', source: 'LOGIN_ATTEMPTS', value: Number(options.loginAttempts), secret: false });
  if (options.loginWindowMinutes) candidates.push({ key: 'auth.loginWindowMinutes', source: 'LOGIN_WINDOW_MINUTES', value: Number(options.loginWindowMinutes), secret: false });
  return candidates;
}
