/**
 * AI translation helpers (NEXT_PHASES G11). A plain module, so the composer
 * can use it too.
 */

/** Languages written right to left (primary subtags, plus scripts). */
const RTL_LANGUAGES = new Set(['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'iw', 'ks', 'ku-arab', 'ps', 'sd', 'ug', 'ur', 'yi']);
const RTL_SCRIPTS = new Set(['arab', 'hebr', 'syrc', 'thaa', 'nkoo', 'adlm', 'rohg']);

/** Whether text in this BCP-47 language reads right to left. */
export function isRightToLeft(tag: string | null | undefined): boolean {
  if (!tag) return false;
  const parts = tag.toLowerCase().split('-');
  const script = parts.find((part) => part.length === 4);
  if (script) return RTL_SCRIPTS.has(script);
  return RTL_LANGUAGES.has(parts[0]!);
}

const TOKENS = /https?:\/\/\S+|#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]+/gu;

/**
 * The translation with every link, hashtag and @mention of the source kept:
 * any the model dropped or changed are added back at the end, as written.
 */
export function keepTokens(source: string, translated: string): string {
  const missing = [...new Set(source.match(TOKENS) ?? [])].filter((token) => !translated.includes(token));
  return missing.length > 0 ? `${translated.trimEnd()}\n\n${missing.join(' ')}` : translated;
}

/** One translation of a post: the Pages that get it and its text. */
export interface TranslationGroup {
  /** BCP-47 tag; null for Pages with no audience language, which keep the original. */
  language: string | null;
  targetIds: string[];
  text: string;
}

/** Pages grouped by the first language of their audience, in the order given. */
export function groupByLanguage(pages: Array<{ id: string; language: string | null }>): Array<{ language: string | null; targetIds: string[] }> {
  const groups = new Map<string | null, string[]>();
  for (const page of pages) groups.set(page.language, [...(groups.get(page.language) ?? []), page.id]);
  return [...groups].map(([language, targetIds]) => ({ language, targetIds }));
}
