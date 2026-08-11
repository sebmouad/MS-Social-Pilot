import { errors } from './errors';

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
