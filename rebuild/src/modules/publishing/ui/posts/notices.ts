import type { KitLocale } from '../kit/copy';

const NOTICES = {
  en: {
    created: 'Post saved.',
    'publication-finished': 'Local publication record updated. No new publication or first comment was sent.',
    'publication-absent': 'Human-verified absence recorded. No publication was sent. Check the destination again before a separate retry.',
    updated: 'Post saved.',
    deleted: 'Post deleted locally.',
    failed: 'The publishing action could not be completed. Check permissions, connection status, and post state, then try again.',
    'failed-import': 'The CSV could not be imported. Check its header, row format, and file size, then try again.',
    'failed-image': 'The image could not be used for every selected destination. Check its type and size, or choose another image.',
    'failed-remote-delete': 'Remote deletion could not be confirmed. The local post and delivery history were preserved. Reconnect the source or try again.',
    'failed-access': 'Your role or channel access does not permit this action.',
    'failed-state': 'This post is no longer eligible for that action. Refresh the page and review its current status.',
    published: 'Publishing completed.',
    submitted: 'Post submitted for approval.',
    scheduled: 'Post added to the queue.',
    cancelled: 'Scheduled post returned to drafts.',
    'publish-review': 'Some destinations or first comments need attention. Review their individual delivery states before another action.',
    synced: 'Remote status sync completed.',
    'failed-sync': 'No new delivery status was confirmed. Check the post on its platform, then try syncing again.',
    duplicated: 'A new unscheduled draft was created.',
  },
  fr: {
    created: 'Publication enregistrée.',
    'publication-finished': 'Le suivi local de la publication est à jour. Aucune nouvelle publication ni aucun premier commentaire n’a été envoyé.',
    'publication-absent': 'L’absence vérifiée par une personne est enregistrée. Rien n’a été publié. Vérifiez à nouveau la destination avant toute nouvelle tentative.',
    updated: 'Publication enregistrée.',
    deleted: 'Publication supprimée localement.',
    failed: 'L’action n’a pas pu être terminée. Vérifiez les droits, l’état de la connexion et l’état de la publication, puis réessayez.',
    'failed-import': 'Le CSV n’a pas pu être importé. Vérifiez son en-tête, le format des lignes et sa taille, puis réessayez.',
    'failed-image': 'L’image ne convient pas à toutes les destinations choisies. Vérifiez son type et sa taille, ou choisissez une autre image.',
    'failed-remote-delete': 'La suppression sur la plateforme n’a pas pu être confirmée. La publication locale et son historique sont conservés. Reconnectez la source ou réessayez.',
    'failed-access': 'Votre rôle ou votre accès aux canaux ne permet pas cette action.',
    'failed-state': 'Cette publication n’est plus éligible à cette action. Actualisez la page et vérifiez son état.',
    published: 'Publication terminée.',
    submitted: 'Publication soumise pour approbation.',
    scheduled: 'Publication ajoutée à la file d’attente.',
    cancelled: 'La publication programmée est revenue en brouillon.',
    'publish-review': 'Certaines destinations ou certains premiers commentaires demandent votre attention. Vérifiez l’état de chaque destination avant d’agir à nouveau.',
    synced: 'Synchronisation de l’état terminée.',
    'failed-sync': 'Aucun nouvel état de diffusion n’a été confirmé. Vérifiez la publication sur sa plateforme, puis réessayez.',
    duplicated: 'Un nouveau brouillon non programmé a été créé.',
  },
} as const satisfies Record<KitLocale, Record<string, string>>;

/** Customer notice for a `?notice=` code, in the page language; null for unknown codes. */
export function postsNotice(code: string, locale: KitLocale): string | null {
  const text = (NOTICES[locale] as Record<string, string>)[code];
  if (text) return text;
  if (code.startsWith('imported-')) {
    const count = code.slice('imported-'.length);
    return locale === 'fr' ? `${count} publications importées en brouillons.` : `${count} posts imported as drafts.`;
  }
  return null;
}
