import { isRightToLeft } from './translation';

/**
 * Interface languages (NEXT_PHASES G12). A plain module, so client components
 * can use it. The list itself is the Prisma `Locale` enum plus one
 * `messages/<code>.json` per value; tests/locale.test.ts keeps them in step.
 */

/** A language's own name for itself ("English", "français", "العربية"). */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

/** The `dir` attribute for a page in this language. */
export function textDirection(code: string): 'ltr' | 'rtl' {
  return isRightToLeft(code) ? 'rtl' : 'ltr';
}
