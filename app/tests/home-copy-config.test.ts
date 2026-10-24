import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authCopy, authCopyDefaults, authCopyCatalogDefaults, authCopySchema, authLocaleCopy } from '@/modules/home/auth/copy';
import { homeCopyCatalogDefaults, homeCopySchema } from '@/modules/home/copy';
import { HOME_CONFIG } from '@/modules/home/config';
const mocks = vi.hoisted(() => ({ runtimeConfig: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig }));
import { loadAuthCopyCatalog, loadHomeCopy } from '@/modules/home/server/copy';

describe('Root Home copy', () => {
  it('prepares serializable auth copy while preserving invitation formatting', async () => {
    expect(JSON.parse(JSON.stringify(authCopyDefaults))).toEqual(authCopyDefaults);
    const catalog = { en: authLocaleCopy(authCopySchema.parse(authCopyCatalogDefaults), 'en'), fr: authLocaleCopy(authCopySchema.parse(authCopyCatalogDefaults), 'fr') };
    expect(authCopy('en', catalog).join.inviteAs('Studio', 'editor')).toEqual({ before: 'You’re invited to ', workspace: 'Studio', middle: ' as ', role: 'editor' });
    catalog.fr.join.passwordShort = 'Minimum : {n} caractères.';
    expect(authCopy('fr', catalog).join.passwordShort(12)).toBe('Minimum : 12 caractères.');
    mocks.runtimeConfig.mockResolvedValue({ ...authCopyCatalogDefaults, 'join.passwordShort': { ...authCopyCatalogDefaults['join.passwordShort'], fr: catalog.fr.join.passwordShort } });
    expect(await loadAuthCopyCatalog()).toEqual(catalog);
    expect(mocks.runtimeConfig).toHaveBeenCalledWith('home.authCopy');
    expect(HOME_CONFIG.find(entry => entry.key === 'home.authCopy')?.consumption).toBe('configured');
  });
  beforeEach(() => mocks.runtimeConfig.mockReset());
  it('registers a strict bilingual catalog and rejects missing or empty fields', () => {
    const setting = HOME_CONFIG.find(entry => entry.key === 'home.uiCopy')!;
    expect(setting.schema.parse(setting.defaultValue)).toEqual(homeCopyCatalogDefaults);
    expect(homeCopySchema.safeParse({ ...homeCopyCatalogDefaults, greeting: { en: 'Hi' } }).success).toBe(false);
    expect(homeCopySchema.safeParse({ ...homeCopyCatalogDefaults, greeting: { ...homeCopyCatalogDefaults.greeting, fr: '' } }).success).toBe(false);
    expect(homeCopySchema.safeParse({ ...homeCopyCatalogDefaults, extra: { en: 'unexpected', fr: 'inattendu' } }).success).toBe(false);
  });
  it('loads edited French copy and nested module labels from the runtime setting', async () => {
    mocks.runtimeConfig.mockResolvedValue({ ...homeCopyCatalogDefaults, greeting: { ...homeCopyCatalogDefaults.greeting, fr: 'Bonjour' }, 'moduleNames.ads': { ...homeCopyCatalogDefaults['moduleNames.ads'], fr: 'Campagnes' } });
    const copy = await loadHomeCopy('fr');
    expect(copy.greeting).toBe('Bonjour');
    expect(copy.moduleNames.ads).toBe('Campagnes');
    expect(mocks.runtimeConfig).toHaveBeenCalledWith('home.uiCopy');
  });
});
