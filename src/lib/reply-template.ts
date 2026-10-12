/**
 * `{first_name}` and `{page}` in a reply, filled for one person. Used by the
 * moderation rules (G7) and by saved replies (G8); a plain module, so the
 * reply boxes in the browser can use it too.
 */
export function fillReply(template: string, values: { name: string | null; page: string }): string {
  const first = values.name?.trim().split(/\s+/)[0] ?? '';
  return template
    .replace(/\{\{?\s*first_name\s*\}?\}/g, first)
    .replace(/\{\{?\s*page\s*\}?\}/g, values.page)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}
