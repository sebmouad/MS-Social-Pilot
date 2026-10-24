import { describe, expect, it, vi } from 'vitest';
import { inboxCustomerCopy, inboxCustomerCopySchema, inboxSourceCatalogs, resolveInboxCatalog } from '../src/modules/inbox/customer-copy';

vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => ({ ...(await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy, 'errors.bulkLimit': { en: 'Select {limit} or fewer', fr: 'Choisissez au maximum {limit}' } }) }));

import { inboxServiceText } from '../src/modules/inbox/server/service-copy';

describe('Inbox Root customer catalog', () => {
  it('shares Root-edited service templates with both wire languages', async () => {
    expect(await inboxServiceText('bulkLimit', { limit: 7 })).toBe('Select 7 or fewer');
    expect(await inboxServiceText('bulkLimit', { limit: 7 }, 'fr')).toBe('Choisissez au maximum 7');
  });
  it('preserves spacing in schema-parsed sync fragments', () => {
    const parsed = inboxCustomerCopySchema.parse(inboxCustomerCopy);
    const copy = resolveInboxCatalog('actionCopy', parsed);
    const counts = { targets: 2, conversations: 1, messages: 3, comments: 2, reviews: 1, failed: 1 };
    expect(copy.en.synced(counts)).toBe(inboxSourceCatalogs.actionCopy.en.synced(counts));
    expect(copy.fr.synced(counts)).toBe(inboxSourceCatalogs.actionCopy.fr.synced(counts));
  });
  it('validates complete English and French and refuses missing/unknown fields', () => {
    expect(inboxCustomerCopySchema.safeParse(inboxCustomerCopy).success).toBe(true);
    const key = Object.keys(inboxCustomerCopy)[0];
    expect(inboxCustomerCopySchema.safeParse({ ...inboxCustomerCopy, [key]: { en: 'Only English' } }).success).toBe(false);
    expect(inboxCustomerCopySchema.safeParse({ ...inboxCustomerCopy, unknown: { en: 'x', fr: 'x' } }).success).toBe(false);
  });
  it('applies Root edits to labels and templates without treating customer names as templates', () => {
    const catalog = { ...inboxCustomerCopy, 'inboxCopy.title': { en: 'Team inbox', fr: 'Réception équipe' }, 'REPLY_COPY.to.text': { en: 'Answer {author}', fr: 'Répondre : {author}' } };
    expect(resolveInboxCatalog('inboxCopy', catalog).fr.title).toBe('Réception équipe');
    expect(resolveInboxCatalog('REPLY_COPY', catalog).en.to('{author}')).toBe('Answer {author}');
  });
  it('preserves default function output, including zero, singular and plural grammar', () => {
    function check(source: unknown, resolved: unknown, path: string) {
      if (typeof source === 'function' && typeof resolved === 'function') {
        const name = path.split('.').pop();
        if (name === 'synced') {
          for (const targets of [0, 1, 2]) for (const conversations of [0, 1, 2]) for (const messages of [0, 1, 2]) for (const comments of [0, 1, 2]) for (const reviews of [null, 0, 1, 2]) for (const failed of [0, 1, 2]) {
            const counts = { targets, conversations, messages, comments, reviews, failed };
            expect(resolved(counts), path).toBe(source(counts));
          }
          return;
        }
        for (const n of [0, 1, 2, 17]) {
          const args = name === 'noun' || name === 'cap' ? [Boolean(n)] : [n, n, 'messages', 'unclassified'];
          expect(resolved(...args), path).toBe(source(...args));
        }
      } else if (source && typeof source === 'object') {
        for (const [key, value] of Object.entries(source)) check(value, (resolved as Record<string, unknown>)[key], `${path}.${key}`);
      } else expect(resolved, path).toBe(source);
    }
    for (const name of Object.keys(inboxSourceCatalogs) as Array<keyof typeof inboxSourceCatalogs>) check(inboxSourceCatalogs[name], resolveInboxCatalog(name), name);
  });
});
