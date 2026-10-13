import type { PostMedia } from './json';

/** Overrides follow the publishing contract: blank override uses shared text. */
export function destinationContent(id: string, message: string, media: PostMedia[], variants: Record<string, string>, textOnly: string[]) {
  return { message: variants[id]?.trim() ? variants[id]!.trim() : message, media: textOnly.includes(id) ? [] : media };
}
export function initialComposeTiming(intent: string | undefined, hasQueueSlots: boolean): 'schedule' | 'queue' {
  return intent === 'queue' && hasQueueSlots ? 'queue' : 'schedule';
}
/** Sort object keys so edit detection does not depend on insertion order. */
export function stableFields(value: Record<string, string>) {
  return JSON.stringify(Object.entries(value).filter(([, text]) => text !== '').sort(([a], [b]) => a.localeCompare(b)));
}
/** API field names and form control IDs share one validation map. */
export function composerFieldErrors(fields: Record<string, string> = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, message]) => [({ scheduledAtLocal: 'scheduledAt', firstComment: 'first-comment', place: 'post-place' } as Record<string, string>)[key] ?? key, message]));
}
