import { z } from 'zod';
import type { AuthLocale } from '@/modules/home/auth/copy';

/** Copy for the signed-out share and bio pages. The visitor's browser language decides; owner-written text is never translated. Root can edit every line (`sharing.publicCopy`); `{0}` marks a value supplied by the page. */
const en = {
  rateLimited: 'Too many visits just now. Please wait a few minutes and try again.',
  loadFailed: 'This page could not be loaded. Please try again shortly.',
  share: {
    kinds: { portal: 'Client portal', review: 'Review', calendar: 'Calendar' } as Record<string, string>,
    statuses: { awaiting_review: 'Waiting for your decision', planned: 'Planned', published: 'Published' } as Record<string, string>,
    sections: 'Sections', tabReview: 'To review', tabCalendar: 'Calendar',
    emptyReviewTitle: 'Nothing to review', emptyReview: 'Nothing is waiting for review right now.',
    emptyCalendarTitle: 'Nothing planned', emptyCalendar: 'Nothing is planned in this period.',
    noDate: 'No date yet', channels: 'Selected channels', noText: 'No text', video: 'Video attachment',
    moreFilesOne: '1 more uploaded file attached (no preview)', moreFilesMany: '{0} more uploaded files attached (no preview)',
    lastAnswer: 'Last answer', approved: 'approved', changes: 'changes requested', commented: 'comment sent',
    truncated: 'Only the first {0} posts are shown.',
  },
  review: {
    name: 'Your name', comment: 'Comment', approve: 'Approve', requestChanges: 'Request changes', sendComment: 'Send comment',
    enterName: 'Enter your name first.', tellChange: 'Tell the team what to change.', writeComment: 'Write a comment first.',
    unconfirmed: 'Your answer could not be confirmed. Try again.', sent: 'Answer sent', dismiss: 'Dismiss',
  },
  bio: { title: 'Links', noLinks: 'No links yet.' },
};

type Catalog = typeof en;

const fr: Catalog = {
  rateLimited: 'Trop de visites en ce moment. Patientez quelques minutes puis réessayez.',
  loadFailed: 'Cette page n’a pas pu être chargée. Réessayez dans un instant.',
  share: {
    kinds: { portal: 'Portail client', review: 'Relecture', calendar: 'Calendrier' },
    statuses: { awaiting_review: 'En attente de votre décision', planned: 'Planifiée', published: 'Publiée' },
    sections: 'Sections', tabReview: 'À relire', tabCalendar: 'Calendrier',
    emptyReviewTitle: 'Rien à relire', emptyReview: 'Rien n’attend de relecture pour le moment.',
    emptyCalendarTitle: 'Rien de planifié', emptyCalendar: 'Rien n’est planifié sur cette période.',
    noDate: 'Pas encore de date', channels: 'Canaux sélectionnés', noText: 'Aucun texte', video: 'Vidéo jointe',
    moreFilesOne: '1 autre fichier envoyé joint (sans aperçu)', moreFilesMany: '{0} autres fichiers envoyés joints (sans aperçu)',
    lastAnswer: 'Dernière réponse', approved: 'approuvée', changes: 'modifications demandées', commented: 'commentaire envoyé',
    truncated: 'Seules les {0} premières publications sont affichées.',
  },
  review: {
    name: 'Votre nom', comment: 'Commentaire', approve: 'Approuver', requestChanges: 'Demander des modifications', sendComment: 'Envoyer le commentaire',
    enterName: 'Saisissez d’abord votre nom.', tellChange: 'Indiquez à l’équipe ce qu’il faut modifier.', writeComment: 'Écrivez d’abord un commentaire.',
    unconfirmed: 'Votre réponse n’a pas pu être confirmée. Réessayez.', sent: 'Réponse envoyée', dismiss: 'Fermer',
  },
  bio: { title: 'Liens', noLinks: 'Pas encore de liens.' },
};

export const publicCopyDefaults = { en, fr };

/** Exact catalog shape for both languages: unknown or missing keys are rejected, blank text too. */
const shape = (value: unknown): z.ZodTypeAny => typeof value === 'string'
  ? z.string().trim().min(1).max(4000)
  : z.object(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, shape(item)]))).strict();
export const publicCopySchema = z.object({ en: shape(en), fr: shape(fr) }).strict();

const fill = (template: string, count: number) => template.replace('{0}', String(count));

/** What the pages read: the catalog's templates with count-filling helpers. */
export type PublicCopy = Omit<Catalog, 'share'> & { share: Omit<Catalog['share'], 'moreFilesOne' | 'moreFilesMany' | 'truncated'> & { moreFiles: (count: number) => string; truncated: (count: number) => string } };

export const publicCopy = (locale: AuthLocale, catalog: typeof publicCopyDefaults = publicCopyDefaults): PublicCopy => {
  const text = locale === 'fr' ? catalog.fr : catalog.en;
  const { moreFilesOne, moreFilesMany, truncated, ...share } = text.share;
  return { ...text, share: { ...share, moreFiles: count => count === 1 ? moreFilesOne : fill(moreFilesMany, count), truncated: count => fill(truncated, count) } };
};
