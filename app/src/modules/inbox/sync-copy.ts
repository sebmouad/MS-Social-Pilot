import type { InboxCustomerCopy } from './customer-copy';
export const inboxSyncCopy: InboxCustomerCopy = {
  'sync.summary': { en: 'Checked {targets}: {conversations} ({messages}) and {comments} up to date.', fr: '{targets} {verified} : {conversations} ({messages}) et {comments} à jour.' },
  'sync.reviews': { en: ' {reviews} up to date.', fr: ' {reviews} à jour.' },
  'sync.failure.one': { en: ' {failed} could not be read. Reconnect it in Connections, then sync again.', fr: ' {failed} n’a pas pu être lu. Reconnectez-le dans Connexions, puis synchronisez à nouveau.' },
  'sync.failure.many': { en: ' {failed} could not be read. Reconnect it in Connections, then sync again.', fr: ' {failed} n’ont pas pu être lus. Reconnectez-les dans Connexions, puis synchronisez à nouveau.' },
  'sync.verified.one': { en: 'checked', fr: 'vérifié' }, 'sync.verified.many': { en: 'checked', fr: 'vérifiés' },
  'sync.targets.one': { en: 'channel', fr: 'canal' }, 'sync.targets.many': { en: 'channels', fr: 'canaux' },
  'sync.conversations.one': { en: 'conversation', fr: 'conversation' }, 'sync.conversations.many': { en: 'conversations', fr: 'conversations' },
  'sync.messages.one': { en: 'message', fr: 'message' }, 'sync.messages.many': { en: 'messages', fr: 'messages' },
  'sync.comments.one': { en: 'comment', fr: 'commentaire' }, 'sync.comments.many': { en: 'comments', fr: 'commentaires' },
  'sync.reviews.one': { en: 'review', fr: 'avis' }, 'sync.reviews.many': { en: 'reviews', fr: 'avis' },
};
type Counts = { targets: number; conversations: number; messages: number; comments: number; reviews: number | null; failed: number };
export function inboxSyncSummary(c: Counts, locale: 'en' | 'fr', catalog: InboxCustomerCopy): string {
  const plural = (n: number) => (locale === 'fr' ? n > 1 : n !== 1) ? 'many' : 'one';
  const text = (key: string, values: Record<string, string> = {}) => catalog[key][locale].replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
  const count = (key: string, n: number) => `${n} ${text(`sync.${key}.${plural(n)}`)}`;
  return text('sync.summary', { targets: count('targets', c.targets), conversations: count('conversations', c.conversations), messages: count('messages', c.messages), comments: count('comments', c.comments), verified: text(`sync.verified.${plural(c.targets)}`) })
    + (c.reviews === null ? '' : text('sync.reviews', { reviews: count('reviews', c.reviews) }))
    + (c.failed ? text(`sync.failure.${plural(c.failed)}`, { failed: count('targets', c.failed) }) : '');
}
