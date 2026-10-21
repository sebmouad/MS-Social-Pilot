import { SHORTCUT_COPY } from './shortcut-copy';
import { inboxSyncCopy, inboxSyncSummary } from './sync-copy';
import { inboxServiceCopy } from './service-copy';
import { z } from 'zod';
import { inboxCopy } from './ui/copy';
import { actionCopy } from './ui/action-copy';
import { REPLY_COPY } from './ui/reply-copy';
import { round3Copy } from './ui/round3-copy';
import { reviewCopy } from './reviews-copy';
import { moderationCopy } from './moderation';
import { productivityCopy } from './productivityCopy';
import { threadToolsCopy } from './threadToolsCopy';

export const inboxSourceCatalogs = { SHORTCUT_COPY, inboxCopy, actionCopy, REPLY_COPY, round3Copy, reviewCopy, moderationCopy, productivityCopy, threadToolsCopy };
type Catalogs = typeof inboxSourceCatalogs;
export type InboxCustomerCopy = Record<string, { en: string; fr: string }>;

/** Catalog paths are stable field identifiers. Functions retain their typed argument contracts. */
function collect(en: unknown, fr: unknown, path: string, result: InboxCustomerCopy) {
  if (typeof en === 'function' && typeof fr === 'function' && templates[path]) {
    const spec = templates[path];
    for (const variant of variants(spec)) {
      const args = spec.parameters.map((name, index) => spec.boolean ? variant === 'reply' : numeric.has(name) ? 876541 + index : `{${name}}`);
      if (spec.plural !== undefined) args[spec.plural] = variant === 'one' ? 1 : variant === 'zero' ? 0 : 876541 + spec.plural;
      if (spec.zeroAt !== undefined && variant === 'zero') args[spec.zeroAt] = 0;
      const render = (fn: Function) => {
        let text = String(fn(...args));
        args.forEach((arg, index) => { if (!(spec.zeroAt !== undefined && variant === 'zero') && typeof arg === 'number') text = text.replace(new RegExp(`\\b${arg}\\b`, 'g'), `{${spec.parameters[index]}}`); });
        return text;
      };
      result[`${path}.${variant}`] = { en: render(en), fr: render(fr) };
    }
  } else if (typeof en === 'string' && typeof fr === 'string') result[path] = { en, fr };
  else if (en && fr && typeof en === 'object' && typeof fr === 'object') {
    for (const key of Object.keys(en)) collect((en as Record<string, unknown>)[key], (fr as Record<string, unknown>)[key], `${path}.${key}`, result);
  }
}
type TemplateSpec = { parameters: string[]; plural?: number; boolean?: boolean; zeroAt?: number };
const templates: Record<string, TemplateSpec> = {
  'inboxCopy.items': { parameters: ['shown', 'total'], plural: 0, zeroAt: 1 },
  'inboxCopy.nUnread': { parameters: ['n'], plural: 0 },
  'inboxCopy.conversationWith': { parameters: ['name'] }, 'inboxCopy.commentBy': { parameters: ['name'] },
  'inboxCopy.historyShown': { parameters: ['shown', 'total', 'noun'] }, 'inboxCopy.sentBy': { parameters: ['name'] }, 'inboxCopy.repliesTo': { parameters: ['name'] },
  'actionCopy.noun': { parameters: ['reply'], boolean: true }, 'actionCopy.cap': { parameters: ['reply'], boolean: true },
  ...Object.fromEntries(['hide', 'unhide', 'delete', 'keep', 'deleteTitle', 'hideInstead'].map(key => [`actionCopy.${key}`, { parameters: ['noun'] }])),
  ...Object.fromEntries(['hiddenDone', 'visibleDone'].map(key => [`actionCopy.${key}`, { parameters: ['cap'] }])),
  'actionCopy.deleteBody': { parameters: ['noun', 'platform'] }, 'REPLY_COPY.to': { parameters: ['author'] },
  'round3Copy.bulk.selectItem': { parameters: ['name'] }, 'round3Copy.bulk.count': { parameters: ['n'], plural: 0 }, 'round3Copy.bulk.limit': { parameters: ['max'] },
  ...Object.fromEntries(['resolve', 'reopen', 'hide', 'unhide', 'delete'].map(key => [`round3Copy.bulk.done.${key}`, { parameters: ['n'], plural: 0 }])),
  'round3Copy.bulk.partial': { parameters: ['ok', 'failed'] },
  ...Object.fromEntries(['hideSentence', 'unhideSentence', 'deleteSentence'].map(key => [`round3Copy.bulk.confirm.${key}`, { parameters: ['n', 'platform'], plural: 0 }])),
  'round3Copy.bulk.confirm.object': { parameters: ['n'], plural: 0 },
  'round3Copy.details.commentsOn': { parameters: ['n'], plural: 0 }, 'round3Copy.details.counts': { parameters: ['positive', 'neutral', 'negative', 'unclassified'] },
  'round3Copy.details.assignedTo': { parameters: ['name'] }, 'round3Copy.details.unreadLabel': { parameters: ['n'] },
  'round3Copy.replies.usage': { parameters: ['used', 'max'] }, 'round3Copy.replies.full': { parameters: ['max'] }, 'round3Copy.replies.counter': { parameters: ['n', 'max'] },
  'round3Copy.replies.editing': { parameters: ['name'] }, 'round3Copy.replies.actions': { parameters: ['name'] },
  'productivityCopy.assignedTo': { parameters: ['name'] }, 'productivityCopy.replyActions': { parameters: ['name'] },
};
const numeric = new Set(['shown', 'total', 'n', 'max', 'ok', 'failed', 'positive', 'neutral', 'negative', 'unclassified', 'used']);
const variants = (spec: TemplateSpec) => spec.boolean ? ['comment', 'reply'] : spec.plural !== undefined ? ['zero', 'one', 'many'] : ['text'];
export const inboxCustomerCopy: InboxCustomerCopy = { ...inboxSyncCopy,
  'navigation.listPages': { en: 'Inbox list pages', fr: 'Pages de la liste' },
  'navigation.historyPages': { en: 'Conversation history pages', fr: 'Pages de l’historique' },
};
for (const [key, value] of Object.entries(inboxServiceCopy)) inboxCustomerCopy[`errors.${key}`] = value;
for (const [name, catalog] of Object.entries(inboxSourceCatalogs)) collect(catalog.en, catalog.fr, name, inboxCustomerCopy);
const text = z.string().min(1).max(4000);
export const inboxCustomerCopySchema = z.object(Object.fromEntries(Object.keys(inboxCustomerCopy).map(key => [key, z.object({ en: text, fr: text }).strict()]))).strict();

export function resolveInboxCatalog<K extends keyof Catalogs>(name: K, values: InboxCustomerCopy = inboxCustomerCopy): Catalogs[K] {
  function resolve(source: unknown, locale: 'en' | 'fr', path: string): unknown {
    if (path === 'actionCopy.synced') return (counts: Parameters<typeof inboxSyncSummary>[0]) => inboxSyncSummary(counts, locale, values);
    if (typeof source === 'function' && templates[path]) {
      const spec = templates[path];
      return (...args: unknown[]) => {
        const count = spec.plural === undefined ? null : args[spec.plural];
        const variant = spec.boolean ? args[0] ? 'reply' : 'comment' : spec.plural === undefined ? 'text' : (spec.zeroAt !== undefined && args[spec.zeroAt] === 0) || count === 0 ? 'zero' : count === 1 ? 'one' : 'many';
        const template = values[`${path}.${variant}`]?.[locale];
        return template === undefined ? source(...args) : template.replace(/\{(\w+)\}/g, (whole, name: string) => { const index = spec.parameters.indexOf(name); return index < 0 ? whole : String(args[index]); });
      };
    }
    if (typeof source === 'string') return values[path]?.[locale] ?? source;
    if (!source || typeof source !== 'object') return source;
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, resolve(value, locale, `${path}.${key}`)]));
  }
  const source = inboxSourceCatalogs[name];
  return { en: resolve(source.en, 'en', name), fr: resolve(source.fr, 'fr', name) } as Catalogs[K];
}
