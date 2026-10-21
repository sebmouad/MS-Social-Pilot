import { describe, expect, it } from 'vitest';
import { assetReferences, safeAssetName, sniffMedia } from '../src/modules/media/library';

describe('media content helpers', () => {
  it('sniffs by bytes, not by declaration', () => {
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
    expect(sniffMedia(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42')]))).toEqual({ kind: 'video', mimeType: 'video/mp4' });
    expect(sniffMedia(Buffer.from('<html><script>'))).toBeNull();
    expect(sniffMedia(Buffer.alloc(0))).toBeNull();
    expect(sniffMedia(Buffer.from('RIFF0000WEBP'))).toEqual({ kind: 'image', mimeType: 'image/webp' });
    expect(sniffMedia(Buffer.from('RIFF0000WAVE'))).toBeNull();
  });
  it('cleans names and builds reference sets', () => {
    expect(safeAssetName('../../etc/passwd', 'https://x.test/a.png', 'image')).toBe('etcpasswd');
    expect(safeAssetName(undefined, 'https://x.test/dir/pic%20one.png', 'image')).toBe('pic one.png');
    expect(safeAssetName('..', 'not a url', 'video')).toBe('video');
    expect(assetReferences({ id: 'abc', source: 'stored-image' })).toEqual(['media:abc']);
    expect(assetReferences({ id: 'short', source: 'library', url: 'media:med_longer_id', storageKey: null })).toEqual(['media:med_longer_id']);
  });
});
