import { beforeEach, describe, expect, it, vi } from 'vitest';

const modules = vi.hoisted(() => ({
  defaults: { alpha: 'alpha-default', beta: 'beta-default' } as Record<string, string>,
}));

vi.mock('../src/server/platforms/registry', () => ({
  platformFor: async (provider: string) => ({
    publish: async () => ({ success: true }),
    defaultPublishingFormatId: modules.defaults[provider],
    publishingFormats: [{
      id: modules.defaults[provider], label: `${provider} format`,
      media: { kinds: ['image'], maxImages: 4, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: true },
      firstComment: true, remoteStatus: true, remoteDelete: true,
      scheduling: { application: true, native: false },
    }],
  }),
}));

import { resolveAuthorizedDestinationFormats } from '../src/modules/publishing/server/formats';

const targets = [
  { id: 'target-a', socialAccount: { provider: 'alpha' } },
  { id: 'target-b', socialAccount: { provider: 'beta' } },
];
const content = { media: [] as never[] };

beforeEach(() => {
  modules.defaults.alpha = 'alpha-default';
  modules.defaults.beta = 'beta-default';
});

describe('authorized destination format resolution', () => {
  it('uses each selected module default independently', async () => {
    await expect(resolveAuthorizedDestinationFormats(targets, undefined, 10, content)).resolves.toEqual({
      'target-a': 'alpha-default', 'target-b': 'beta-default',
    });
  });

  it('uses explicit formats before stored formats and the legacy global format only for existing targets', async () => {
    const existing = { formats: new Map([['target-a', null], ['target-b', 'beta-default']]), legacyFormat: 'alpha-default' };
    await expect(resolveAuthorizedDestinationFormats(targets, { 'target-a': 'alpha-default' }, 10, content, existing)).resolves.toEqual({
      'target-a': 'alpha-default', 'target-b': 'beta-default',
    });

    const newTarget = { id: 'target-new', socialAccount: { provider: 'beta' } };
    await expect(resolveAuthorizedDestinationFormats([newTarget], undefined, 10, content, {
      formats: new Map(), legacyFormat: 'alpha-default',
    })).resolves.toEqual({ 'target-new': 'beta-default' });
  });

  it('rejects stale destination keys and unsafe map prototypes', async () => {
    await expect(resolveAuthorizedDestinationFormats(targets, { 'removed-target': 'alpha-default' }, 10, content)).rejects.toMatchObject({ code: 'invalid_request' });
    const inherited = Object.assign(Object.create({ 'target-a': 'alpha-default' }), { 'target-b': 'beta-default' });
    await expect(resolveAuthorizedDestinationFormats(targets, inherited, 10, content)).rejects.toMatchObject({ code: 'invalid_request' });
    const symbolKey = { 'target-a': 'alpha-default', [Symbol('target-b')]: 'beta-default' };
    await expect(resolveAuthorizedDestinationFormats(targets, symbolKey, 10, content)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('keeps result maps safe for target keys such as __proto__', async () => {
    const target = { id: '__proto__', socialAccount: { provider: 'beta' } };
    const result = await resolveAuthorizedDestinationFormats([target], undefined, 10, content);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(result['__proto__']).toBe('beta-default');
  });
});
