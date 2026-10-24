/** The language the member picked in the account menu. Middleware turns it into the request's Accept-Language, so every server reader keeps its single source. */
export const LANGUAGE_COOKIE = 'sp_locale';
export const LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];
export function chosenLanguage(value: string | undefined | null): Language | null {
  return value === 'en' || value === 'fr' ? value : null;
}
