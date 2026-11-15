/**
 * Shorten text to at most `max` visible characters, cutting between whole characters (2026-11-15). A plain
 * `slice()` can split an emoji's surrogate pair: the server then sends « � » while the browser keeps the half
 * character, and React reports a hydration mismatch (#418). Emoji sequences such as 👩‍🍳 stay whole.
 */
export function clipText(text: string, max: number, mark = '…'): string {
  const parts = graphemes(text);
  if (parts.length <= max) return text;
  return `${parts.slice(0, Math.max(0, max)).join('').trimEnd()}${mark}`;
}

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
  return Array.from(text);
}
