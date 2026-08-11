import { env } from './env';
import { hmacHex, safeEqual } from './crypto';

/**
 * Short-lived public links to an uploaded file.
 *
 * Uploads are served from an authenticated route, which is the right default:
 * unpublished campaign artwork should not be fetchable by whoever guesses a
 * filename. Instagram makes that impossible for one case. Its publishing API
 * takes no bytes — you hand it a URL and Facebook's own servers fetch the file,
 * with no cookie and nothing to authenticate as.
 *
 * So a link is minted for exactly that fetch: one file, signed, and valid for
 * minutes rather than for ever. It is created at the moment of publishing and
 * never stored, so there is no long-lived public URL anywhere in the system.
 */

/**
 * How long a minted link lives.
 *
 * Facebook fetches the file while the create-container call is still open, so
 * this only has to cover one request. Half an hour is generous enough to
 * survive a slow queue and short enough that a link found in a log is almost
 * certainly already dead.
 */
export const MEDIA_LINK_TTL_MS = 30 * 60 * 1000;

/**
 * A key of its own, derived from the session secret rather than being it.
 *
 * Two things signed with the same key can be swapped for one another when a
 * format changes; a label makes that impossible without adding another secret
 * to the deployment checklist.
 */
function signingKey(): string {
  return hmacHex(env.sessionSecret, 'media-link-v1');
}

function signature(mediaId: string, expiresAt: number): string {
  // The expiry is inside the signature, or moving it costs nothing.
  return hmacHex(signingKey(), `${mediaId}.${expiresAt}`);
}

export interface SignedMediaLink {
  url: string;
  expiresAt: Date;
}

/** An absolute, publicly fetchable URL for one file. */
export function signMediaUrl(mediaId: string, now: Date = new Date()): SignedMediaLink {
  const expiresAt = now.getTime() + MEDIA_LINK_TTL_MS;
  const params = new URLSearchParams({
    expires: String(expiresAt),
    signature: signature(mediaId, expiresAt),
  });

  return {
    url: `${env.appUrl}/api/media/${mediaId}/raw?${params.toString()}`,
    expiresAt: new Date(expiresAt),
  };
}

/**
 * Whether a request carries a valid, unexpired signature for this file.
 *
 * Returns false for anything malformed rather than throwing: this decides
 * whether to fall back to the session check, and a bad query string is not an
 * error, it is just not a signed link.
 */
export function verifyMediaUrl(
  mediaId: string,
  params: URLSearchParams,
  now: Date = new Date(),
): boolean {
  const expires = params.get('expires');
  const provided = params.get('signature');
  if (!expires || !provided) return false;

  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt <= now.getTime()) return false;

  return safeEqual(signature(mediaId, expiresAt), provided);
}
