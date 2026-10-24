import { describe, expect, it } from 'vitest';
import { CONFIG_BY_KEY, safeConfigShape } from '@/lib/config/registry';
import { clientInvitationCopy, clientInvitationCopySchema, clientInvitationDefaults, clientInvitationPolicySchema } from './invitation-policy';

describe('Root invitation configuration', () => {
  it('registers both keys under the installed Agency module and defaults issuance off', () => {
    for (const key of ['agency.clientInvitationPolicy', 'agency.clientInvitationCopy']) {
      const definition = CONFIG_BY_KEY.get(key)!;
      expect(definition).toBeDefined();
      expect(definition.schema.safeParse(definition.defaultValue).success).toBe(true);
      expect(safeConfigShape().find(item => item.key === key)?.owner).toEqual({ kind: 'product', id: 'agency' });
    }
    expect(CONFIG_BY_KEY.get('agency.clientInvitationPolicy')!.defaultValue).toMatchObject({ enabled: false });
  });
  it('rejects unsafe redirect paths and invalid policy bounds', () => {
    for (const registrationPath of ['https://other.example.test/register', '//other.example.test', '/register?token=abc', '/register#token=abc']) {
      expect(clientInvitationPolicySchema.safeParse({ ...clientInvitationDefaults, registrationPath }).success).toBe(false);
    }
    expect(clientInvitationPolicySchema.safeParse({ ...clientInvitationDefaults, listLimit: 0 }).success).toBe(false);
  });
  it('requires equivalent EN/FR catalog keys and exactly one mail link and expiry placeholder', () => {
    expect(Object.keys(clientInvitationCopy.en)).toEqual(Object.keys(clientInvitationCopy.fr));
    expect(clientInvitationCopySchema.safeParse({ ...clientInvitationCopy, en: { ...clientInvitationCopy.en, mailBody: '{expiresAt}' } }).success).toBe(false);
    expect(clientInvitationCopySchema.safeParse({ ...clientInvitationCopy, fr: { ...clientInvitationCopy.fr, mailBody: '{expiresAt} {url} {url}' } }).success).toBe(false);
  });
});
