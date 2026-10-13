/**
 * Coloured backgrounds for text-only Page posts.
 *
 * Facebook's Page feed reference does not document this: the preset ids are the
 * ones Facebook's own site sends and other scheduling tools copy (checked
 * 2026-10-13, docs/ai/MAP.md). They can change without notice, so this is a
 * short list that is easy to correct, and a post that Facebook refuses says so
 * in its own words like any other refusal.
 *
 * In a plain module: the composer (client) and the publisher (server) share it.
 */
export interface TextBackground {
  id: string;
  /** What the swatch looks like, as CSS. */
  css: string;
  /** The key under `compose.background.*`. */
  name: 'black' | 'purple' | 'red' | 'redBlue';
}

export const TEXT_BACKGROUNDS: readonly TextBackground[] = [
  { id: '1881421442117417', css: 'rgb(0, 0, 0)', name: 'black' },
  { id: '106018623298955', css: 'rgb(198, 0, 255)', name: 'purple' },
  { id: '1903718606535395', css: 'rgb(226, 1, 59)', name: 'red' },
  { id: '249307305544279', css: 'linear-gradient(45deg, rgb(255, 0, 71), rgb(44, 52, 199))', name: 'redBlue' },
];

/** Facebook's limit for a post that has a background. */
export const BACKGROUND_MAX_CHARS = 130;

export function isTextBackground(id: string): boolean {
  return TEXT_BACKGROUNDS.some((background) => background.id === id);
}
