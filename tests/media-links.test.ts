import { beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv } from './helpers/database';

/**
 * The one public door onto uploaded files.
 *
 * Everything else about media access is decided by a session and a workspace.
 * This is not, because Instagram's publishing API takes a URL rather than
 * bytes and Facebook's fetcher has no cookie to present. So the link itself
 * has to carry the whole of the permission, and be wrong in none of the usual
 * ways: not transferable to another file, not extendable, not forgeable, and
 * not alive for long.
 */

let links: typeof import('../src/lib/media-links');

beforeAll(async () => {
  setTestEnv({ SESSION_SECRET: 'a-secret-for-signing-media-links' });
  process.env.APP_URL = 'https://social.example';
  links = await import('../src/lib/media-links');
});

const NOW = new Date('2026-09-01T12:00:00Z');
const MEDIA = 'media_abc123';

function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('a signed media link', () => {
  it('is absolute, so Facebook can fetch it from outside', () => {
    const link = links.signMediaUrl(MEDIA, NOW);

    expect(link.url.startsWith('https://social.example/api/media/media_abc123/raw?')).toBe(true);
  });

  it('opens the file it names', () => {
    const link = links.signMediaUrl(MEDIA, NOW);

    expect(links.verifyMediaUrl(MEDIA, paramsOf(link.url), NOW)).toBe(true);
  });

  it('dies on its own', () => {
    const link = links.signMediaUrl(MEDIA, NOW);
    const later = new Date(NOW.getTime() + links.MEDIA_LINK_TTL_MS + 1000);

    expect(links.verifyMediaUrl(MEDIA, paramsOf(link.url), later)).toBe(false);
  });

  it('cannot be kept alive by editing the expiry', () => {
    const link = links.signMediaUrl(MEDIA, NOW);
    const params = paramsOf(link.url);

    // The expiry is inside the signature, so moving it invalidates the link
    // rather than extending it.
    params.set('expires', String(NOW.getTime() + 365 * 24 * 60 * 60 * 1000));

    expect(links.verifyMediaUrl(MEDIA, params, NOW)).toBe(false);
  });

  it('does not open a different file', () => {
    const link = links.signMediaUrl(MEDIA, NOW);

    // Otherwise one published Instagram post would hand over the whole media
    // library to anyone who noticed the pattern.
    expect(links.verifyMediaUrl('media_someone_elses', paramsOf(link.url), NOW)).toBe(false);
  });

  it('refuses anything that is not a signature', () => {
    for (const query of [
      '',
      'expires=99999999999999',
      'signature=deadbeef',
      'expires=tomorrow&signature=deadbeef',
      `expires=${NOW.getTime() + 1000}&signature=`,
      `expires=1e30&signature=deadbeef`,
    ]) {
      expect(links.verifyMediaUrl(MEDIA, new URLSearchParams(query), NOW), query).toBe(false);
    }
  });

  it('is not signed with the session secret itself', async () => {
    // Key separation: if the two shared a key, a change to either format could
    // let one kind of token be presented as the other.
    const { hmacHex } = await import('../src/lib/crypto');
    const params = paramsOf(links.signMediaUrl(MEDIA, NOW).url);
    const expires = params.get('expires')!;

    expect(params.get('signature')).not.toBe(
      hmacHex('a-secret-for-signing-media-links', `${MEDIA}.${expires}`),
    );
  });
});
