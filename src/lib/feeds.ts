import { errors } from './errors';
import { isBlockedHost } from './safe-fetch';

/**
 * RSS auto-posting is Facebook-only, and has to be.
 *
 * A feed entry is a headline, a link and a summary. Instagram publishes none
 * of those on their own — it has no text post at all — so every item scheduled
 * to an Instagram destination would be created, sit in the calendar looking
 * fine, and fail at the moment it was due. Refused when the feed is saved
 * rather than discovered one item at a time.
 *
 * Here rather than in the route that first needed it, because two routes need
 * it and a third would otherwise be written without it.
 */
export function assertFeedDestinations(targets: Array<{ name: string; type: string }>): void {
  const instagram = targets.filter((target) => target.type === 'instagram');
  if (instagram.length > 0) {
    throw errors.feedInstagramUnsupported(instagram.map((target) => target.name).join(', '));
  }
}

/**
 * Refuse a feed address that names the server's own network.
 *
 * The poller checks every fetch anyway, including where the name resolves and
 * where it redirects; this is the part that can be said while the person is
 * still on the form, rather than as an error on the feed an hour later.
 */
export function assertFeedUrl(raw: string): void {
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    // Not a URL at all is the schema's message to give, not this one.
    return;
  }
  if (isBlockedHost(host)) throw errors.feedUrlBlocked();
}
