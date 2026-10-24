import { z } from 'zod';

/**
 * Personal saved views for the Inbox (triage filters). A view stores only
 * whitelisted filter parameters in the shared `saved_views` table with
 * screen `inbox`; the page re-applies its own channel scope and validation
 * every time the view is opened, so a stored query never grants access.
 * Provider-neutral: channels are opaque selected-resource IDs.
 */
export const INBOX_SAVED_VIEW_SCREEN = 'inbox' as const;
export const INBOX_SAVED_VIEW_PATH = '/inbox' as const;

/** Module-owned bounds; the stored column is limited by the legacy schema. */
export const INBOX_SAVED_VIEW_BOUNDS = { maxName: 60, maxQuery: 1500, maxPerScreen: 50 } as const;

const KEYS: Record<string, (value: string) => boolean> = {
  type: value => value === 'message' || value === 'comment' || value === 'review',
  status: value => value === 'open' || value === 'resolved' || value === 'all',
  hidden: value => value === 'visible' || value === 'all',
  q: value => value.trim().length > 0 && value.length <= 500,
  quick: value => value.split(',').filter(Boolean).every(item => item === 'unread' || item === 'unanswered' || item === 'negative' || item === 'mentions'),
};

/** Keeps only known, valid, single-valued filter parameters in a stable order. Returns null when anything is invalid. */
export function normalizeInboxSavedViewQuery(query: string): string | null {
  if (query.length > INBOX_SAVED_VIEW_BOUNDS.maxQuery) return null;
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  const out = new URLSearchParams();
  for (const key of Object.keys(KEYS).sort()) {
    const values = params.getAll(key).filter(value => value !== '');
    if (values.length > 1) return null;
    if (values.length === 1) { if (!KEYS[key]!(values[0]!)) return null; out.set(key, values[0]!); }
  }
  return out.toString();
}

export const INBOX_SAVED_VIEW_CREATE_SCHEMA = z.object({
  name: z.string().trim().min(1).max(INBOX_SAVED_VIEW_BOUNDS.maxName),
  query: z.string().max(INBOX_SAVED_VIEW_BOUNDS.maxQuery),
}).strict();
export const INBOX_SAVED_VIEW_DELETE_SCHEMA = z.object({ id: z.string().min(1).max(80), confirmation: z.string() }).strict();
export const deleteInboxSavedViewConfirmation = (id: string) => `DELETE INBOX SAVED VIEW ${id}`;

export type InboxSavedViewRecord = { id: string; name: string; query: string; href: string; createdAt: string };

export type InboxSavedViewLocale = 'en' | 'fr';
export const INBOX_SAVED_VIEW_COPY = {
  en: {
    views: 'Saved views', saveView: 'Save current filters', viewName: 'View name', save: 'Save view', saving: 'Saving…',
    saved: 'View saved.', deleted: 'View deleted.', delete: 'Delete', cancel: 'Cancel', apply: 'Apply',
    deleteTitle: 'Delete this view?', deleteDetail: 'The saved filters are removed. The inbox itself is unchanged.',
    nameRequired: 'Enter a name for this view.', saveFailed: 'The view could not be saved. Refresh and try again.',
    deleteFailed: 'The view could not be deleted. Refresh and try again.', noViews: 'No saved views yet.', open: 'Open',
  },
  fr: {
    views: 'Vues enregistrées', saveView: 'Enregistrer les filtres actuels', viewName: 'Nom de la vue', save: 'Enregistrer la vue', saving: 'Enregistrement…',
    saved: 'Vue enregistrée.', deleted: 'Vue supprimée.', delete: 'Supprimer', cancel: 'Annuler', apply: 'Appliquer',
    deleteTitle: 'Supprimer cette vue ?', deleteDetail: 'Les filtres enregistrés sont retirés. La boîte de réception est inchangée.',
    nameRequired: 'Saisissez un nom pour cette vue.', saveFailed: 'Impossible d’enregistrer la vue. Actualisez et réessayez.',
    deleteFailed: 'Impossible de supprimer la vue. Actualisez et réessayez.', noViews: 'Aucune vue enregistrée.', open: 'Ouvrir',
  },
} as const;
export const inboxSavedViewCopy = (locale: string | null | undefined) => INBOX_SAVED_VIEW_COPY[locale?.toLowerCase().startsWith('fr') ? 'fr' : 'en'];
