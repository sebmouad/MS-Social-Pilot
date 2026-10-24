import { kitCopy, fillCopy } from './ui/kit/copy';
export type ContentSummaryCopy = Pick<typeof kitCopy.en, 'summaryImageOne' | 'summaryImageMany' | 'summaryVideoOne' | 'summaryVideoMany' | 'summaryLink' | 'summaryAnd' | 'summaryWith' | 'summaryEmpty'>;
/** Short, provider-neutral identity for post list/calendar items without a caption. */
export function postContentSummary(message: string, media: unknown, link: string | null | undefined, copy: ContentSummaryCopy = kitCopy.en): string {
  const caption = message.trim();
  if (caption) return caption;

  const mediaKinds = Array.isArray(media)
    ? media.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        if (typeof record.url !== 'string' || !record.url.trim() || (record.kind !== 'image' && record.kind !== 'video')) return [];
        if (record.kind === 'image' && /^media:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.url)) return [record.kind];
        try {
          const parsed = new URL(record.url);
          return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password ? [record.kind] : [];
        } catch { return []; }
      })
    : [];
  const imageCount = mediaKinds.filter(kind => kind === 'image').length;
  const videoCount = mediaKinds.filter(kind => kind === 'video').length;
  const parts: string[] = [];
  if (imageCount) parts.push(`${imageCount} ${imageCount === 1 ? copy.summaryImageOne : copy.summaryImageMany}`);
  if (videoCount) parts.push(`${videoCount} ${videoCount === 1 ? copy.summaryVideoOne : copy.summaryVideoMany}`);

  let hasValidLink = false;
  if (link?.trim()) {
    try {
      const parsed = new URL(link);
      hasValidLink = (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password;
    } catch { /* a malformed saved link is not presented as valid content */ }
  }
  if (hasValidLink) parts.push(copy.summaryLink);
  return parts.length ? fillCopy(copy.summaryWith, { parts: parts.join(copy.summaryAnd) }) : copy.summaryEmpty;
}
