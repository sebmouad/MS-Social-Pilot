/**
 * Counting the characters in a post.
 *
 * `String.length` counts UTF-16 code units, which is not what anybody means by
 * a character and not what Meta's limits are measured in. An emoji is two
 * units, a flag is four, and an accented letter typed as a combining mark is
 * two — so a caption of exactly two thousand two hundred characters with fifty
 * emoji in it counts as two thousand two hundred and fifty and is refused
 * before Facebook is ever asked.
 *
 * The direction of that error is the reason it is worth fixing rather than
 * documenting. Over-counting turns valid content away with a message the
 * person cannot act on — the caption really is 2,200 characters, and the app
 * says it is not.
 *
 * Code points rather than grapheme clusters. Neither is exactly what Meta
 * counts, and Meta does not say; code points is the closer of the two to what
 * an API means by "characters", and grapheme clusters would fold a flag into
 * one where Meta near-certainly sees two.
 */
export function countCharacters(text: string): number {
  // Iterating a string yields code points rather than UTF-16 units.
  return [...text].length;
}
