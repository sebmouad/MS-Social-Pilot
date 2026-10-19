import { z } from 'zod';

/**
 * Personal saved views for Posts and Calendar (legacy `saved_views` parity).
 * A view stores only whitelisted filter parameters; the page re-applies its own
 * channel scope and validation every time the view is opened, so a stored query
 * never grants access. Provider-neutral: channels are opaque selected-resource IDs.
 */
export const SAVED_VIEW_SCREENS = ['posts', 'calendar'] as const;
export type SavedViewScreen = (typeof SAVED_VIEW_SCREENS)[number];

/** Module-owned bounds; the stored column is limited by the legacy schema. */
export const SAVED_VIEW_BOUNDS = { maxName: 60, maxQuery: 1500, maxPerScreen: 50 } as const;

const POST_STATUSES = ['draft', 'pending_approval', 'rejected', 'scheduled', 'publishing', 'published', 'partially_failed', 'failed', 'cancelled'] as const;
const KEYS: Record<SavedViewScreen, Record<string, (value: string) => boolean>> = {
  posts: {
    view: value => value === 'table' || value === 'feed' || value === 'cards',
    status: value => (POST_STATUSES as readonly string[]).includes(value),
    channel: value => /^[A-Za-z0-9_-]{1,80}$/.test(value),
    q: value => value.trim().length > 0 && value.length <= 500,
  },
  calendar: {
    view: value => value === 'month' || value === 'week',
    status: value => (POST_STATUSES as readonly string[]).includes(value),
    channel: value => /^[A-Za-z0-9_-]{1,80}$/.test(value),
  },
};
export const SAVED_VIEW_PATHS: Record<SavedViewScreen, string> = { posts: '/publishing/posts', calendar: '/publishing/calendar' };

/** Keeps only known, valid, single-valued filter parameters in a stable order. Returns null when anything is invalid. */
export function normalizeSavedViewQuery(screen: SavedViewScreen, query: string): string | null {
  if (query.length > SAVED_VIEW_BOUNDS.maxQuery) return null;
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  const allowed = KEYS[screen];
  const out = new URLSearchParams();
  for (const key of Object.keys(allowed).sort()) {
    const values = params.getAll(key).filter(value => value !== '');
    if (values.length > 1) return null;
    if (values.length === 1) { if (!allowed[key](values[0])) return null; out.set(key, values[0]); }
  }
  return out.toString();
}

export const SAVED_VIEW_LIST_SCHEMA = z.object({ screen: z.enum(SAVED_VIEW_SCREENS) }).strict();
export const SAVED_VIEW_CREATE_SCHEMA = z.object({
  screen: z.enum(SAVED_VIEW_SCREENS),
  name: z.string().trim().min(1).max(SAVED_VIEW_BOUNDS.maxName),
  query: z.string().max(SAVED_VIEW_BOUNDS.maxQuery),
}).strict();
export const SAVED_VIEW_DELETE_SCHEMA = z.object({ id: z.string().min(1).max(80), confirmation: z.string() }).strict();
export const deleteSavedViewConfirmation = (id: string) => `DELETE SAVED VIEW ${id}`;

export type SavedViewRecord = { id: string; name: string; screen: SavedViewScreen; query: string; href: string; createdAt: string };

export type SavedViewLocale = 'en' | 'fr';
export const SAVED_VIEW_COPY = {
  en: {
    heading: 'Saved views', empty: 'No saved views yet. Apply filters, then save them here.', nameLabel: 'View name', save: 'Save current view',
    saving: 'Saving…', saved: 'View saved.', remove: 'Remove', removeLabel: (name: string) => `Remove saved view ${name}`, removed: 'View removed.',
    loadFailed: 'Saved views could not be loaded. Refresh the page and try again.', saveFailed: 'The view could not be saved. Check its name and try again.',
    removeFailed: 'The view could not be removed. Refresh and try again.', nameRequired: 'Enter a name for this view.', limit: 'You have reached the saved view limit for this screen. Remove one first.',
    invalid: 'These filters cannot be saved. Reset the filters and try again.',
  },
  fr: {
    heading: 'Vues enregistrées', empty: 'Aucune vue enregistrée. Appliquez des filtres, puis enregistrez-les ici.', nameLabel: 'Nom de la vue', save: 'Enregistrer la vue actuelle',
    saving: 'Enregistrement…', saved: 'Vue enregistrée.', remove: 'Supprimer', removeLabel: (name: string) => `Supprimer la vue enregistrée ${name}`, removed: 'Vue supprimée.',
    loadFailed: 'Impossible de charger les vues enregistrées. Actualisez la page et réessayez.', saveFailed: "La vue n'a pas pu être enregistrée. Vérifiez son nom et réessayez.",
    removeFailed: "La vue n'a pas pu être supprimée. Actualisez et réessayez.", nameRequired: 'Saisissez un nom pour cette vue.', limit: 'Vous avez atteint la limite de vues enregistrées pour cet écran. Supprimez-en une d’abord.',
    invalid: 'Ces filtres ne peuvent pas être enregistrés. Réinitialisez les filtres et réessayez.',
  },
} as const;
export const savedViewCopy = (locale: string | null | undefined) => SAVED_VIEW_COPY[locale?.toLowerCase().startsWith('fr') ? 'fr' : 'en'];
