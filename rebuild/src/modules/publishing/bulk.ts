import { z } from 'zod';

/**
 * Bulk post actions (legacy Posts list parity). Each item runs through the same
 * per-post service as the single action, so role, authorship, channel scope,
 * state and provider-neutral publication journal rules apply to every post.
 * Bulk deletion is local-only: remote deletion stays a per-post, explicit choice.
 * Retry re-dispatches only destinations recorded as failed with no remote ID;
 * submitted/uncertain/processing destinations are never re-sent.
 */
export const BULK_ACTIONS = ['delete', 'duplicate', 'reschedule', 'retry'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const BULK_BOUNDS = { maxPosts: 50 } as const;
export const bulkConfirmation = (action: BulkAction, count: number) => `${action.toUpperCase()} ${count} POSTS`;

export const BULK_SCHEMA = z.object({
  action: z.enum(BULK_ACTIONS),
  postIds: z.array(z.string().min(1).max(120)).min(1).max(BULK_BOUNDS.maxPosts),
  requestId: z.string().uuid(),
  confirmation: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
}).strict();
export type BulkInput = z.output<typeof BULK_SCHEMA>;

export type BulkItemOutcome = 'done' | 'needs_review' | 'skipped' | 'failed';
export type BulkItemResult = { postId: string; outcome: BulkItemOutcome; code?: string; message?: string; newPostId?: string };
export type BulkResult = { action: BulkAction; requested: number; done: number; needsReview: number; skipped: number; failed: number; items: BulkItemResult[] };

/** Destination statuses a retry may re-dispatch; everything else is held. */
export function retryableDestinationCount(post: { status: string; targets: Array<{ status: string; remotePostId?: string | null }> }) {
  if (post.status !== 'failed' && post.status !== 'partially_failed') return 0;
  return post.targets.filter(target => target.status === 'failed' && !target.remotePostId).length;
}

export function summarizeBulk(action: BulkAction, items: BulkItemResult[]): BulkResult {
  const count = (outcome: BulkItemOutcome) => items.filter(item => item.outcome === outcome).length;
  return { action, requested: items.length, done: count('done'), needsReview: count('needs_review'), skipped: count('skipped'), failed: count('failed'), items };
}

export type BulkLocale = 'en' | 'fr';
export const BULK_COPY = {
  en: {
    select: (label: string) => `Select post ${label}`, selectAll: 'Select all posts on this page', selected: (n: number) => `${n} selected`, clear: 'Clear selection',
    actions: { delete: 'Delete locally', duplicate: 'Duplicate', reschedule: 'Reschedule', retry: 'Retry failed destinations' },
    titles: { delete: 'Delete selected posts locally?', duplicate: 'Duplicate selected posts?', reschedule: 'Reschedule selected posts?', retry: 'Retry failed destinations?' },
    descriptions: {
      delete: 'Removes the selected posts from this workspace. Published copies stay on their platforms; delete a post individually to remove it from a platform too.',
      duplicate: 'Creates a new unscheduled draft for each selected post.',
      reschedule: 'Moves selected posts that are still waiting to publish to the chosen workspace date and time. Other posts are skipped.',
      retry: 'Sends again only to destinations that clearly failed. Destinations with an uncertain or pending result are not sent again; check them first.',
    },
    date: 'Date', time: 'Time', cancel: 'Cancel', confirm: 'Confirm', working: 'Working…',
    summary: (r: { done: number; needsReview: number; skipped: number; failed: number }) => `${r.done} done, ${r.needsReview} need review, ${r.skipped} skipped, ${r.failed} failed.`,
    unconfirmed: 'The result could not be confirmed. Refresh Posts and check each post before trying again.',
    retryOne: 'Retry failed destinations', retryOneHelp: (n: number) => `${n} destination${n === 1 ? '' : 's'} failed and can be sent again.`,
    whenRequired: 'Choose a future date and time.', tryAgain: 'Try again',
  },
  fr: {
    select: (label: string) => `Sélectionner la publication ${label}`, selectAll: 'Sélectionner toutes les publications de cette page', selected: (n: number) => `${n} sélectionnée${n > 1 ? 's' : ''}`, clear: 'Effacer la sélection',
    actions: { delete: 'Supprimer localement', duplicate: 'Dupliquer', reschedule: 'Reprogrammer', retry: 'Relancer les destinations en échec' },
    titles: { delete: 'Supprimer localement les publications sélectionnées ?', duplicate: 'Dupliquer les publications sélectionnées ?', reschedule: 'Reprogrammer les publications sélectionnées ?', retry: 'Relancer les destinations en échec ?' },
    descriptions: {
      delete: 'Retire les publications sélectionnées de cet espace de travail. Les copies publiées restent sur leurs plateformes ; supprimez une publication individuellement pour la retirer aussi de la plateforme.',
      duplicate: 'Crée un nouveau brouillon non programmé pour chaque publication sélectionnée.',
      reschedule: "Déplace à la date et à l'heure choisies (fuseau de l'espace de travail) les publications encore en attente. Les autres sont ignorées.",
      retry: "Renvoie uniquement vers les destinations clairement en échec. Les destinations au résultat incertain ou en attente ne sont pas renvoyées ; vérifiez-les d'abord.",
    },
    date: 'Date', time: 'Heure', cancel: 'Annuler', confirm: 'Confirmer', working: 'En cours…',
    summary: (r: { done: number; needsReview: number; skipped: number; failed: number }) => `${r.done} terminée(s), ${r.needsReview} à vérifier, ${r.skipped} ignorée(s), ${r.failed} en échec.`,
    unconfirmed: "Le résultat n'a pas pu être confirmé. Actualisez les publications et vérifiez chacune avant de réessayer.",
    retryOne: 'Relancer les destinations en échec', retryOneHelp: (n: number) => `${n} destination${n > 1 ? 's' : ''} en échec peu${n > 1 ? 'vent' : 't'} être renvoyée${n > 1 ? 's' : ''}.`,
    whenRequired: 'Choisissez une date et une heure futures.', tryAgain: 'Réessayer',
  },
} as const;
export const bulkCopy = (locale: string | null | undefined) => BULK_COPY[locale?.toLowerCase().startsWith('fr') ? 'fr' : 'en'];
