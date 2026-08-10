import { randomBytes } from 'node:crypto';

/**
 * URL-safe identifiers.
 *
 * Workspaces carry a slug so the switcher can put the current client in the
 * URL, and short links need a compact random one.
 */

/** Turn a display name into a slug candidate. Never returns an empty string. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    // Strip diacritics, so "Café Léon" becomes "cafe-leon" rather than "caf-lon".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || 'workspace';
}

/**
 * Make a slug unique by appending a counter, asking `exists` about each
 * candidate. Kept storage-agnostic so it can be tested without a database.
 */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base);
  if (!(await exists(root))) return root;

  for (let suffix = 2; suffix <= 500; suffix += 1) {
    const candidate = `${root}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  // Pathological case: fall back to randomness rather than looping forever.
  return `${root}-${randomBytes(4).toString('hex')}`;
}

const SHORT_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A short link slug. The alphabet omits characters that are easy to confuse
 * when a link is read aloud or retyped (0/O, 1/l/I).
 */
export function shortSlug(length = 7): string {
  const bytes = randomBytes(length);
  let slug = '';
  for (let index = 0; index < length; index += 1) {
    slug += SHORT_ALPHABET[bytes[index]! % SHORT_ALPHABET.length];
  }
  return slug;
}
