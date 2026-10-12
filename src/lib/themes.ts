/**
 * The looks a person can pick in Settings → Account. Plain data, so client
 * components and the server read the same list. The colours themselves are CSS
 * variables in `src/app/globals.css`, switched by `<html data-theme>`.
 */
export const THEMES = ['facebook', 'warm', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'facebook';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}
