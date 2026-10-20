import type { AuthLocale } from '@/modules/home/auth/copy';

/** Copy for the signed-out share and bio pages. The visitor's browser language decides; owner-written text is never translated. */
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
    moreFiles: (n: number) => `${n} more uploaded ${n === 1 ? 'file' : 'files'} attached (no preview)`,
    lastAnswer: 'Last answer', approved: 'approved', changes: 'changes requested', commented: 'comment sent',
    truncated: (n: number) => `Only the first ${n} posts are shown.`,
  },
  review: {
    name: 'Your name', comment: 'Comment', approve: 'Approve', requestChanges: 'Request changes', sendComment: 'Send comment',
    enterName: 'Enter your name first.', tellChange: 'Tell the team what to change.', writeComment: 'Write a comment first.',
    unconfirmed: 'Your answer could not be confirmed. Try again.', sent: 'Answer sent', dismiss: 'Dismiss',
  },
  bio: { title: 'Links', noLinks: 'No links yet.' },
};

const fr: typeof en = {
  rateLimited: 'Trop de visites en ce moment. Patientez quelques minutes puis réessayez.',
  loadFailed: 'Cette page n’a pas pu être chargée. Réessayez dans un instant.',
  share: {
    kinds: { portal: 'Portail client', review: 'Relecture', calendar: 'Calendrier' },
    statuses: { awaiting_review: 'En attente de votre décision', planned: 'Planifiée', published: 'Publiée' },
    sections: 'Sections', tabReview: 'À relire', tabCalendar: 'Calendrier',
    emptyReviewTitle: 'Rien à relire', emptyReview: 'Rien n’attend de relecture pour le moment.',
    emptyCalendarTitle: 'Rien de planifié', emptyCalendar: 'Rien n’est planifié sur cette période.',
    noDate: 'Pas encore de date', channels: 'Canaux sélectionnés', noText: 'Aucun texte', video: 'Vidéo jointe',
    moreFiles: (n: number) => `${n} ${n === 1 ? 'autre fichier envoyé joint' : 'autres fichiers envoyés joints'} (sans aperçu)`,
    lastAnswer: 'Dernière réponse', approved: 'approuvée', changes: 'modifications demandées', commented: 'commentaire envoyé',
    truncated: (n: number) => `Seules les ${n} premières publications sont affichées.`,
  },
  review: {
    name: 'Votre nom', comment: 'Commentaire', approve: 'Approuver', requestChanges: 'Demander des modifications', sendComment: 'Envoyer le commentaire',
    enterName: 'Saisissez d’abord votre nom.', tellChange: 'Indiquez à l’équipe ce qu’il faut modifier.', writeComment: 'Écrivez d’abord un commentaire.',
    unconfirmed: 'Votre réponse n’a pas pu être confirmée. Réessayez.', sent: 'Réponse envoyée', dismiss: 'Fermer',
  },
  bio: { title: 'Liens', noLinks: 'Pas encore de liens.' },
};

export type PublicCopy = typeof en;
export const publicCopy = (locale: AuthLocale): PublicCopy => locale === 'fr' ? fr : en;
