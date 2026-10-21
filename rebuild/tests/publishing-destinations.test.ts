import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ targets: vi.fn(), enabled: vi.fn(), product: vi.fn(), adapter: vi.fn(), selected: vi.fn(), credentials: vi.fn() }));
vi.mock('../src/server/data', () => ({ getTargets: deps.targets, prisma: { target: { findMany: deps.credentials } } }));
vi.mock('../src/modules/publishing/server/read-scope', () => ({ selectedPublishingTargetIds: deps.selected }));
vi.mock('../src/server/entitlements', () => ({ hasPlatformCapability: deps.enabled, canUseFeature: deps.product }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: deps.adapter }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
import { publishingDestinationChoices } from '@/modules/publishing/server/destinations';
import type { requireViewer } from '../src/server/context';

const now = new Date('2026-10-16T09:00:00Z');
const target = (id: string, overrides = {}) => ({ id, name: id, type: 'channel', canPublish: true, socialAccount: { provider: 'example-network', invalidatedAt: null, tokenExpiresAt: null }, ...overrides });
const viewer = { workspaceId: 'workspace-a', entitlements: {}, permissions: { pageScope: { all: false, ids: ['current', 'expired', 'revoked'] } } } as unknown as Awaited<ReturnType<typeof requireViewer>>;
beforeEach(() => { vi.clearAllMocks(); deps.selected.mockResolvedValue(['current', 'expired', 'revoked']); deps.credentials.mockResolvedValue(['current', 'expired', 'revoked'].map(id => ({ id, accessToken: 'encrypted-test-token', socialAccount: { scopes: 'configured_publish_grant', invalidatedAt: null, tokenExpiresAt: null } })));  deps.enabled.mockReturnValue(true); deps.product.mockReturnValue(true); deps.adapter.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => true }); });

describe('shared publishing destination choices', () => {
  it('includes the selected channel picture without exposing its credentials', async () => {
    deps.targets.mockResolvedValue([target('current', { pictureUrl: 'https://images.example.test/page.jpg' })]);
    const [choice] = await publishingDestinationChoices(viewer, now);
    expect(choice?.pictureUrl).toBe('https://images.example.test/page.jpg');
    expect(choice).not.toHaveProperty('accessToken');
    expect(choice).not.toHaveProperty('socialAccount');
  });
  it('does not advertise publishing when the product feature is unavailable', async () => {
    deps.targets.mockResolvedValue([target('current')]);
    deps.product.mockReturnValue(false);
    expect((await publishingDestinationChoices(viewer, now))[0]?.canPublish).toBe(false);
    expect(deps.adapter).not.toHaveBeenCalled();
  });

  it('requests scoped selected targets and marks expired and revoked sources unavailable', async () => {
    deps.targets.mockResolvedValue([
      target('current'),
      target('expired', { socialAccount: { provider: 'example-network', invalidatedAt: null, tokenExpiresAt: now } }),
      target('revoked', { socialAccount: { provider: 'example-network', invalidatedAt: new Date(), tokenExpiresAt: null } }),
    ]);
    const choices = await publishingDestinationChoices(viewer, now);
    expect(deps.selected).toHaveBeenCalledWith('workspace-a', viewer.entitlements, ['current', 'expired', 'revoked']);
    expect(deps.targets).toHaveBeenCalledWith('workspace-a', ['current', 'expired', 'revoked']);
    expect(choices.map(item => [item.id, item.canPublish])).toEqual([['current', true], ['expired', false], ['revoked', false]]);
    expect(choices[0]).not.toHaveProperty('socialAccount');
  });

  it('does not offer unsupported or disabled module destinations as publish-ready', async () => {
    deps.targets.mockResolvedValue([target('current')]);
    deps.adapter.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => false });
    expect((await publishingDestinationChoices(viewer, now))[0]?.canPublish).toBe(false);
    deps.enabled.mockReturnValue(false);
    deps.adapter.mockClear();
    expect((await publishingDestinationChoices(viewer, now))[0]?.canPublish).toBe(false);
    expect(deps.adapter).not.toHaveBeenCalled();
  });
  it('keeps selected history choices visible but never marks a missing operation grant as ready', async () => {
    deps.targets.mockResolvedValue([target('current')]);
    deps.adapter.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => true, canUseCredential: () => false });
    expect((await publishingDestinationChoices(viewer, now)).map(row => [row.id, row.canPublish])).toEqual([['current', false]]);
  });

  it('returns safe media metadata only for currently ready publishing destinations', async () => {
    deps.targets.mockResolvedValue([target('current'), target('expired', { socialAccount: { provider: 'example-network', invalidatedAt: null, tokenExpiresAt: now } })]);
    deps.adapter.mockResolvedValue({
      publish: vi.fn(), supportsTargetKind: () => true, canUseCredential: () => true,
      publishingMedia: { kinds: ['image'], maxImages: null, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: true },
      localImageUpload: { maxBytes: 4096, mimeTypes: ['image/png'] },
      credential: { accessToken: 'must-not-leak' },
    });

    const choices = await publishingDestinationChoices(viewer, now);

    expect(choices[0]).toMatchObject({
      canPublish: true,
      publishingMedia: { kinds: ['image'], maxImages: null, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: true },
      localImageUpload: { maxBytes: 4096, mimeTypes: ['image/png'] },
    });
    expect(choices[0]).not.toHaveProperty('credential');
    expect(choices[1]).not.toHaveProperty('publishingMedia');
    expect(choices[1]).not.toHaveProperty('localImageUpload');
  });

});

describe('granular format projection', () => {
  const format = { id: 'note', label: 'Note', media: { kinds: [], maxImages: 0, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: false }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } };
  it('isolates a broken module catalog without taking away another destination', async () => {
    deps.targets.mockResolvedValue([target('current'), target('expired')]);
    deps.adapter.mockResolvedValueOnce({ publish: vi.fn(), supportsTargetKind: () => true, publishingFormats: [{ ...format, label: '' }], defaultPublishingFormatId: 'note' })
      .mockResolvedValueOnce({ publish: vi.fn(), supportsTargetKind: () => true, publishingFormats: [format], defaultPublishingFormatId: 'note' });
    const choices = await publishingDestinationChoices(viewer, now);
    expect(choices.map(c => c.canPublish)).toEqual([false, true]);
    expect(choices[0]).not.toHaveProperty('publishingFormats');
    expect(choices[1]?.publishingFormats?.[0]?.id).toBe('note');
  });
  it('rejects a default outside its catalog and narrows operation grants before projection', async () => {
    deps.targets.mockResolvedValue([target('current')]);
    deps.adapter.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => true, publishingFormats: [format], defaultPublishingFormatId: 'wrong' });
    expect((await publishingDestinationChoices(viewer, now))[0]?.canPublish).toBe(false);
    deps.adapter.mockResolvedValue({ publish: vi.fn(), supportsTargetKind: () => true, publishingFormats: [{ ...format, secret: 'private-adapter-value' }], defaultPublishingFormatId: 'note', canUseCredential: (_credential: unknown, op: string) => op === 'publishing' });
    const choices = await publishingDestinationChoices(viewer, now);
    expect(choices[0]?.publishingFormats?.[0]).toMatchObject({ firstComment: false, remoteStatus: false, remoteDelete: false });
    expect(JSON.stringify(choices)).not.toContain('private-adapter-value');
  });
});
