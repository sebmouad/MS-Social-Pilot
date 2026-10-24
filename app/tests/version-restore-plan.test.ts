import { describe, expect, it } from 'vitest';
import { planVersionRestore, type RestoreDestination } from '../src/modules/publishing/server/version-restore-plan';
import type { VersionSnapshot } from '../src/modules/publishing/collaboration/ports';
const format = { id: 'current', label: 'Current format', firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false }, media: { kinds: ['image'] as ('image' | 'video')[], maxImages: 1, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true } };
const destination: RestoreDestination = { id: 'now', formatId: 'current', formats: [format], defaultId: 'current', comment: true, mediaValid: () => true };
const snapshot: VersionSnapshot = { versionId: 'v1', message: 'Earlier text', firstComment: 'Reply', firstCommentDelayMinutes: 90, link: null, media: [], format: 'current', targetIds: ['now'], labelIds: [], scheduledAt: null, timezone: 'UTC' };
describe('current-destination neutral restore plan', () => {
  it('keeps an exact compatible version and its delay', () => {
    expect(planVersionRestore(snapshot, [destination], [], 100)).toMatchObject({ exact: true, canRestore: true, content: { firstCommentDelayMinutes: 90, targetIds: ['now'], destinationFormats: { now: 'current' } } });
  });
  it('restores an available saved format even when the current per-destination format differs', () => {
    const savedFormat = { ...format, id: 'saved-opaque' };
    const plan = planVersionRestore({ ...snapshot, destinationFormats: { now: 'saved-opaque' } }, [{ ...destination, formats: [format, savedFormat] }], [], 100);
    expect(plan.exact).toBe(true);
    expect(plan.content.destinationFormats).toEqual({ now: 'saved-opaque' });
  });
  it('keeps current destinations and formats, never resurrecting old destinations', () => {
    const plan = planVersionRestore({ ...snapshot, targetIds: ['removed'], destinationFormats: { now: 'old' } }, [destination], [], 100);
    expect(plan.exact).toBe(false);
    expect(plan.issues.map(i => i.code)).toEqual(['destinations', 'format']);
    expect(plan.content.targetIds).toEqual(['now']);
    expect(plan.content.destinationFormats).toEqual({ now: 'current' });
    expect(plan.issues.every(i => i.en && i.fr)).toBe(true);
  });
  it('omits a comment not supported by any destination and clears its delay', () => {
    const plan = planVersionRestore(snapshot, [destination, { ...destination, id: 'second', comment: false }], [], 100);
    expect(plan.content.firstComment).toBe('');
    expect(plan.content.firstCommentDelayMinutes).toBe(0);
    expect(plan.issues.map(i => i.code)).toContain('comment');
  });
  it('clamps obsolete delay to the current Root ceiling', () => {
    const plan = planVersionRestore(snapshot, [destination], [], 30);
    expect(plan.content.firstCommentDelayMinutes).toBe(30);
    expect(plan.issues.map(i => i.code)).toEqual(['delay']);
  });
  it('keeps the compatible ordered subset and removes unsupported alt text', () => {
    const media = [{ kind: 'video' as const, url: 'https://cdn.test/a.mp4' }, { kind: 'image' as const, url: 'https://cdn.test/a.jpg', altText: 'Description' }, { kind: 'image' as const, url: 'https://cdn.test/b.jpg' }];
    const plan = planVersionRestore({ ...snapshot, media }, [{ ...destination, formats: [{ ...format, media: { ...format.media, imageAltText: false } }] }], media, 100);
    expect(plan.content.media).toEqual([{ kind: 'image', url: 'https://cdn.test/a.jpg' }]);
    expect(plan.issues.map(i => i.code)).toContain('media');
  });
  it('applies the Root media ceiling after rejecting incompatible early attachments', () => {
    const media = [{ kind: 'video' as const, url: 'https://cdn.test/a.mp4' }, { kind: 'image' as const, url: 'https://cdn.test/a.jpg', altText: 'Description' }];
    const plan = planVersionRestore({ ...snapshot, media }, [{ ...destination, mediaValid: items => items.every(item => !item.altText) }], media, 100, 1);
    expect(plan.content.media).toEqual([{ kind: 'image', url: 'https://cdn.test/a.jpg' }]);
  });
  it('reports missing media and blocks an empty result', () => {
    const plan = planVersionRestore({ ...snapshot, message: '', firstComment: null, media: [{ kind: 'image', url: 'media:missing' }] }, [destination], [], 100);
    expect(plan.canRestore).toBe(false);
    expect(plan.issues.map(i => i.code)).toContain('media');
  });
  it('fails closed without a catalog match/default and with invalid delay policy', () => {
    expect(() => planVersionRestore(snapshot, [{ ...destination, formats: [] }], [], 100)).toThrow(/No valid publishing format/);
    expect(() => planVersionRestore(snapshot, [destination], [], Number.NaN)).toThrow(/limit is unavailable/);
  });
  it('changes the consent token when the proposed content or policy changes', () => {
    const first = planVersionRestore(snapshot, [destination], [], 100);
    expect(planVersionRestore(snapshot, [destination], [], 100).token).toBe(first.token);
    expect(planVersionRestore(snapshot, [destination], [], 30).token).not.toBe(first.token);
    expect(planVersionRestore({ ...snapshot, message: 'Changed' }, [destination], [], 100).token).not.toBe(first.token);
  });
});
