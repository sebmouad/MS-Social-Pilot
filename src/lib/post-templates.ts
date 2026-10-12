/**
 * Post templates (NEXT_PHASES H4), the parts the composer and the server
 * share. Plain module: no database.
 *
 * A template's text holds `{placeholders}` ("New in store: {product} from
 * {price}") that the author fills when picking it. A placeholder is a short
 * name in braces; anything else in braces stays as typed.
 */

export const TEMPLATE_LIMITS = { name: 60, category: 40, body: 5000, hashtags: 500, firstComment: 2000 } as const;

const PLACEHOLDER = /\{([\p{L}\p{N}][\p{L}\p{N} _-]{0,29})\}/gu;

/** The placeholders of a text, each once, in the order they first appear. */
export function placeholdersOf(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1]!.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The text with each placeholder replaced; one left empty stays as written, braces and all. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = values[name.trim()]?.trim();
    return value ? value : whole;
  });
}

/** Hashtags as typed ("sale, #summer deals") made into tags, each once: `#sale #summer #deals`. */
export function normaliseHashtags(input: string): string {
  const tags: string[] = [];
  for (const word of input.split(/[\s,;]+/)) {
    const tag = word.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (tag && !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  return tags.map((tag) => `#${tag}`).join(' ');
}

/** The post text a template gives: its filled text, then its hashtags on their own line. */
export function templateText(template: { body: string; hashtags: string }, values: Record<string, string>): string {
  const body = fillPlaceholders(template.body, values).trim();
  const hashtags = template.hashtags.trim();
  return hashtags ? `${body}\n\n${hashtags}` : body;
}
