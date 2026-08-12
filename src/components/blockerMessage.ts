/**
 * Turn a destination's block reason into something the reader can act on.
 *
 * The reason is decided by a background job, which has no idea who will read
 * it — and half this product's audience reads French. So the job stores a code
 * and the interface picks the words.
 *
 * The stored English sentence is the fallback, for rows written before the
 * code existed and for any writer that forgets one. Showing the wrong language
 * beats showing nothing: a destination that will not publish and gives no
 * reason is the version of this that wastes somebody's afternoon.
 */
export function blockerMessage(
  code: string | null,
  stored: string | null,
  translate: (key: string) => string,
  has: (key: string) => boolean,
): string | null {
  if (code) {
    const key = `blocked.${code}`;
    if (has(key)) return translate(key);
  }
  return stored;
}
