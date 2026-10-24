import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYNCHRONOUS_POLICY } from '@/lib/config/synchronous-policy';
import { applySynchronousPolicy, refreshSynchronousPolicy, synchronousPolicy } from '@/server/synchronous-policy';
import { hit, reset } from '@/server/rate-limit';
import { validateProfileName } from '@/server/account-settings';
import { hashStoredPassword, verifyPassword } from '@/server/auth';

vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn() }));
afterEach(() => {
  for (const [key, definition] of Object.entries(SYNCHRONOUS_POLICY)) applySynchronousPolicy(key, definition.defaultValue);
  reset();
});
describe('Root policies for synchronous guards', () => {
  it('keeps synchronous bootstrap defaults aligned with their owning Root declarations', async () => {
    const { CONFIG_BY_KEY } = await import('@/lib/config/registry');
    for (const [key, definition] of Object.entries(SYNCHRONOUS_POLICY)) {
      const registered = CONFIG_BY_KEY.get(key);
      expect(registered?.defaultValue, key).toEqual(definition.defaultValue);
      expect(registered?.schema.safeParse(definition.defaultValue).success, key).toBe(true);
    }
  });
  it('bounds counters by the current Root capacity while retaining fixed-window behavior', () => {
    applySynchronousPolicy('security.rateLimitMaxKeys', 2);
    expect(hit('first', { limit: 1, windowMs: 1000, now: 0 }).allowed).toBe(true);
    expect(hit('second', { limit: 1, windowMs: 1000, now: 0 }).allowed).toBe(true);
    expect(hit('second', { limit: 1, windowMs: 1000, now: 1 }).allowed).toBe(false);
    hit('third', { limit: 1, windowMs: 1000, now: 1 });
    expect(hit('second', { limit: 1, windowMs: 1000, now: 2 }).allowed).toBe(false);
    expect(hit('first', { limit: 1, windowMs: 1000, now: 2 }).allowed).toBe(true);
  });
  it('uses the same configured UTF-8 byte guard for hashing and verification', () => {
    applySynchronousPolicy('auth.passwordMaxBytes', 1000);
    const password = 'é'.repeat(450);
    const encoded = hashStoredPassword(password);
    expect(verifyPassword(password, encoded)).toBe(true);
    applySynchronousPolicy('auth.passwordMaxBytes', 800);
    expect(verifyPassword(password, encoded)).toBe(false);
    expect(() => hashStoredPassword(password)).toThrow('Password is too long');
  });
  it('preserves legacy verification when only the new-password ceiling is lowered', () => {
    const password = 'a'.repeat(100);
    const hash = hashStoredPassword(password);
    applySynchronousPolicy('auth.passwordMaxBytes', 64);
    expect(() => hashStoredPassword(password)).toThrow('Password is too long');
    expect(verifyPassword(password, hash)).toBe(true);
  });
  it('updates profile validation without changing synchronous callers', () => {
    applySynchronousPolicy('settings.accountNameMaxLength', 3);
    expect(validateProfileName(' Ada ')).toBe('Ada');
    expect(validateProfileName('Adam')).toBeNull();
  });
  it('loads once per refresh and retains a validated prior value on failure or invalid data', async () => {
    applySynchronousPolicy('settings.accountNameMaxLength', 70);
    const read = vi.fn(async (key: string) => {
      if (key === 'settings.accountNameMaxLength') throw new Error('offline');
      return key === 'security.rateLimitMaxKeys' ? -1 : 1000;
    });
    await refreshSynchronousPolicy(read);
    expect(read).toHaveBeenCalledTimes(Object.keys(SYNCHRONOUS_POLICY).length + 1);
    expect(synchronousPolicy('settings.accountNameMaxLength')).toBe(70);
    expect(synchronousPolicy('security.rateLimitMaxKeys')).toBe(10000);
    expect(() => applySynchronousPolicy('security.rateLimitMaxKeys', 0)).toThrow();
  });
});

describe('Root input policies', () => {
  it('applies Root identifier and confirmation policy to already-created schemas', async () => {
    const { rootUserIdSchema, rootUserConfirmationSchema } = await import('@/lib/root-user-controls');
    applySynchronousPolicy('root.identifierMaxCharacters', 4);
    applySynchronousPolicy('root.confirmationMaxCharacters', 6);
    expect(rootUserIdSchema.safeParse('user').success).toBe(true);
    expect(rootUserIdSchema.safeParse('users').success).toBe(false);
    expect(rootUserConfirmationSchema.safeParse('enable!').success).toBe(false);
    applySynchronousPolicy('root.identifierMaxCharacters', 300);
    expect(rootUserIdSchema.safeParse('x'.repeat(201)).success).toBe(true);
  });
  it('uses Root plan policy for names, feature counts and financial ceilings', async () => {
    const { planPatchSchema } = await import('@/modules/root/server/admin/shared');
    applySynchronousPolicy('root.planNameMaxCharacters', 4);
    applySynchronousPolicy('root.planFeatureMaxItems', 1);
    applySynchronousPolicy('root.planMonthlyPriceMaxValue', 100);
    expect(planPatchSchema.safeParse({ name: 'Team', priceMonthly: 100, features: ['api'] }).success).toBe(true);
    expect(planPatchSchema.safeParse({ name: 'Enterprise' }).success).toBe(false);
    expect(planPatchSchema.safeParse({ priceMonthly: 101 }).success).toBe(false);
    expect(planPatchSchema.safeParse({ features: ['api', 'clients'] }).success).toBe(false);
  });
});

describe('connection health snapshot', () => {
  it('refreshes the shared server helper warning window and bilingual catalog', async () => {
    const { connectionHealthCopy, connectionHealthText, connectionTokenStatus, applyConnectionHealthCopy } = await import('@/lib/connection-health');
    const now = new Date('2026-10-20T00:00:00Z');
    const account = { invalidatedAt: null, tokenExpiresAt: new Date('2026-10-22T00:00:00Z') };
    applySynchronousPolicy('connections.expiryWarningDays', 1);
    expect(connectionTokenStatus(account, now)).toBe('valid');
    const custom = { en: { ...connectionHealthCopy.en, reconnect: 'Connect again' }, fr: { ...connectionHealthCopy.fr, reconnect: 'Connecter à nouveau' } };
    await refreshSynchronousPolicy(async key => key === 'connections.healthCopy' ? custom : SYNCHRONOUS_POLICY[key as keyof typeof SYNCHRONOUS_POLICY].defaultValue);
    expect(connectionTokenStatus(account, now)).toBe('expiring_soon');
    expect(connectionHealthText('en', 'reconnect')).toBe('Connect again');
    expect(connectionHealthText('fr', 'reconnect')).toBe('Connecter à nouveau');
    expect(() => applyConnectionHealthCopy({ en: {}, fr: {} })).toThrow();
    applyConnectionHealthCopy(connectionHealthCopy);
  });
});

describe('diagnostic receipt bounds', () => {
  it('uses Root result limits in shared receipt validation', async () => {
    const { diagnosticCheckSchema, diagnosticInput } = await import('@/lib/diagnostics');
    applySynchronousPolicy('diagnostics.messageMaxCharacters', 3);
    const check = { id: 'test', label: 'Test', status: 'pass', code: 'ok', message: 'yes', durationMs: 0 };
    expect(diagnosticCheckSchema.safeParse(check).success).toBe(true);
    expect(diagnosticCheckSchema.safeParse({ ...check, message: 'long' }).success).toBe(false);
    applySynchronousPolicy('diagnostics.confirmationMaxCharacters', 3);
    expect(diagnosticInput.safeParse({ scope: 'shared', confirmation: 'RUN DIAGNOSTICS shared' }).success).toBe(false);
  });
});
