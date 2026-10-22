import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn(), auth: vi.fn(), config: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: mocks.auth }));
vi.mock('@/modules/publishing/server/error-copy', async () => {
  const catalog = await import('@/modules/publishing/error-catalog');
  return { loadPublishingErrorText: async () => catalog.defaultPublishingErrorText };
});

import { normalizeLocale, postVariants, resolveVariantMessage, variantSelectionForPublish } from '@/modules/publishing/server/post-variants';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ actor, role: 'owner', permissions: {}, entitlements: {} });
  mocks.config.mockImplementation(async (key: string) => key === 'publishing.postVariantsMaxPerPost' ? 10 : 10000);
  mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM posts WHERE')) return [{ id: 'post-a', authorId: 'user-a', message: 'Hello' }];
    if (sql.includes('FROM post_language_variants')) return [];
    if (sql.includes('FROM post_targets pt JOIN targets')) return [];
    if (sql.includes('FROM workspaces WHERE')) return [{ defaultLocale: 'en' }];
    return [];
  });
  mocks.executeRaw.mockResolvedValue(1);
});

describe('variant selection rule', () => {
  const variants = [{ locale: 'fr', message: 'Bonjour' }, { locale: 'fr-CA', message: 'Allo' }, { locale: 'es', message: 'Hola' }];
  it('prefers the exact locale, then the language, then the default text', () => {
    expect(resolveVariantMessage('Hello', variants, 'fr-CA')).toEqual({ message: 'Allo', variantLocale: 'fr-CA' });
    expect(resolveVariantMessage('Hello', variants, 'fr-BE')).toEqual({ message: 'Bonjour', variantLocale: 'fr' });
    expect(resolveVariantMessage('Hello', variants, 'de')).toEqual({ message: 'Hello', variantLocale: null });
    expect(resolveVariantMessage('Hello', variants, null)).toEqual({ message: 'Hello', variantLocale: null });
    expect(resolveVariantMessage('Hello', [], 'fr')).toEqual({ message: 'Hello', variantLocale: null });
  });
  it('matches locales case-insensitively and breaks language ties deterministically', () => {
    expect(resolveVariantMessage('Hello', variants, 'FR-ca')).toEqual({ message: 'Allo', variantLocale: 'fr-CA' });
    const tied = [{ locale: 'pt-PT', message: 'PT' }, { locale: 'pt-BR', message: 'BR' }, { locale: 'pt', message: 'base' }];
    expect(resolveVariantMessage('Hello', tied, 'pt-AO')).toEqual({ message: 'base', variantLocale: 'pt' });
    expect(resolveVariantMessage('Hello', tied.slice(0, 2), 'pt-AO')).toEqual({ message: 'BR', variantLocale: 'pt-BR' });
  });
  it('normalizes BCP 47 short tags and refuses the rest', () => {
    expect(normalizeLocale('fr')).toBe('fr');
    expect(normalizeLocale('FR-ca')).toBe('fr-CA');
    expect(normalizeLocale(' en ')).toBe('en');
    for (const bad of ['e', 'english', 'fr-', 'fr-CAN', 'fr-CA-x', '', null, 42]) expect(normalizeLocale(bad)).toBeNull();
  });
});

describe('variant service', () => {
  it('requires exact confirmations and refuses unknown locales', async () => {
    await expect(postVariants(actor, { action: 'add', postId: 'post-a', locale: 'fr', message: 'Bonjour', confirmation: 'ADD VARIANT post-a FR' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(postVariants(actor, { action: 'add', postId: 'post-a', locale: 'xx-YY-zz', message: 'x', confirmation: 'ADD VARIANT post-a xx-YY-zz' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(postVariants(actor, { action: 'remove', postId: 'post-a', locale: 'fr', confirmation: 'REMOVE post-a fr' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('saves a variant with upsert semantics and audits it', async () => {
    const result = await postVariants(actor, { action: 'add', postId: 'post-a', locale: 'FR-ca', message: ' Allo ', confirmation: 'ADD VARIANT post-a fr-CA' });
    expect(result).toMatchObject({ ok: true, postId: 'post-a', locale: 'fr-CA' });
    const upsert = mocks.executeRaw.mock.calls.map(sqlOf).find(sql => sql.includes('INSERT INTO post_language_variants'))!;
    expect(upsert).toContain('ON CONFLICT ("postId", locale)');
    expect(mocks.executeRaw.mock.calls.flatMap(call => call.slice(1))).toContain('publishing.variant_saved');
  });

  it('enforces the per-post ceiling only for new locales', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM posts WHERE')) return [{ id: 'post-a', authorId: 'user-a', message: 'Hello' }];
      if (sql.includes('FROM post_language_variants')) return ['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj'].map(locale => ({ locale, message: 'x' }));
      return [];
    });
    await expect(postVariants(actor, { action: 'add', postId: 'post-a', locale: 'fr', message: 'Bonjour', confirmation: 'ADD VARIANT post-a fr' })).rejects.toMatchObject({ code: 'conflict' });
    const replace = await postVariants(actor, { action: 'add', postId: 'post-a', locale: 'ac', message: 'New', confirmation: 'ADD VARIANT post-a ac' });
    expect(replace).toMatchObject({ ok: true });
  });

  it('refuses writers outside the post scope and contributors on other authors posts', async () => {
    mocks.auth.mockResolvedValueOnce({ actor: { ...actor, allowedTargetIds: ['target-a'] }, role: 'owner', permissions: {}, entitlements: {} });
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM posts WHERE')) return [{ id: 'post-a', authorId: 'user-a', message: 'Hello' }];
      if (sql.includes('FROM post_targets WHERE')) return [{ targetId: 'target-b' }];
      return [];
    });
    await expect(postVariants(actor, { action: 'add', postId: 'post-a', locale: 'fr', message: 'x', confirmation: 'ADD VARIANT post-a fr' })).rejects.toMatchObject({ code: 'forbidden' });
    mocks.auth.mockResolvedValueOnce({ actor, role: 'contributor', permissions: {}, entitlements: {} });
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM posts WHERE')) return [{ id: 'post-a', authorId: 'user-b', message: 'Hello' }];
      return [];
    });
    await expect(postVariants(actor, { action: 'remove', postId: 'post-a', locale: 'fr', confirmation: 'REMOVE VARIANT post-a fr' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('removes only its own workspace variant and refuses a missing one', async () => {
    mocks.executeRaw.mockResolvedValue(0);
    await expect(postVariants(actor, { action: 'remove', postId: 'post-a', locale: 'fr', confirmation: 'REMOVE VARIANT post-a fr' })).rejects.toMatchObject({ code: 'not_found' });
    const statement = mocks.executeRaw.mock.calls.map(sqlOf).find(sql => sql.includes('DELETE FROM post_language_variants'))!;
    expect(statement).toContain('"workspaceId"');
  });

  it('lists variants with the resolved text per destination', async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM posts WHERE')) return [{ id: 'post-a', authorId: 'user-a', message: 'Hello' }];
      if (sql.includes('FROM post_language_variants')) return [{ locale: 'fr', message: 'Bonjour' }];
      if (sql.includes('FROM post_targets pt JOIN targets')) return [
        { id: 'pt1', targetId: 'target-a', name: 'Page FR', targetLocale: 'fr-CA' },
        { id: 'pt2', targetId: 'target-b', name: 'Page EN', targetLocale: null },
      ];
      if (sql.includes('FROM workspaces WHERE')) return [{ defaultLocale: 'en' }];
      return [];
    });
    const listing = await postVariants(actor, { action: 'list', postId: 'post-a' }) as { destinations: Array<{ targetId: string; effectiveLocale: string | null; variantLocale: string | null; message: string }> };
    expect(listing.destinations).toEqual([
      { targetId: 'target-a', name: 'Page FR', effectiveLocale: 'fr-CA', variantLocale: 'fr', message: 'Bonjour' },
      { targetId: 'target-b', name: 'Page EN', effectiveLocale: 'en', variantLocale: null, message: 'Hello' },
    ]);
  });

  it('sets and clears destination locales with exact confirmations', async () => {
    expect(await postVariants(actor, { action: 'destination-locale', targetId: 'target-a', locale: 'fr-ca', confirmation: 'SET DESTINATION LOCALE target-a' })).toMatchObject({ ok: true, locale: 'fr-CA' });
    expect(await postVariants(actor, { action: 'destination-locale', targetId: 'target-a', locale: null, confirmation: 'SET DESTINATION LOCALE target-a' })).toMatchObject({ ok: true, locale: null });
    await expect(postVariants(actor, { action: 'destination-locale', targetId: 'target-a', locale: 'xx', confirmation: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    const update = mocks.executeRaw.mock.calls.map(sqlOf).find(sql => sql.includes('UPDATE targets SET locale'))!;
    expect(update).toContain('"workspaceId"');
  });

  it('resolves an empty selection when the variant table is missing mid-deploy', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('relation "post_language_variants" does not exist'));
    const selection = await variantSelectionForPublish('workspace-a', 'post-a', ['target-a']);
    expect(selection).toEqual({ variants: [], locales: new Map(), workspaceLocale: null });
    expect(resolveVariantMessage('Hello', selection.variants, 'fr').message).toBe('Hello');
  });
});
