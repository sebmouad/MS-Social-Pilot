import { bilingualCatalogSchema } from '../kit/copy-schema';
import { fillCopy, type KitLocale } from '../kit/copy';
export const publishingNoticeDefaults = {
  "created": {
    "en": "Post saved.",
    "fr": "Publication enregistrée."
  },
  "publication-finished": {
    "en": "Local publication record updated. No new publication or first comment was sent.",
    "fr": "Le suivi local de la publication est à jour. Aucune nouvelle publication ni aucun premier commentaire n’a été envoyé."
  },
  "publication-absent": {
    "en": "Human-verified absence recorded. No publication was sent. Check the destination again before a separate retry.",
    "fr": "L’absence vérifiée par une personne est enregistrée. Rien n’a été publié. Vérifiez à nouveau la destination avant toute nouvelle tentative."
  },
  "updated": {
    "en": "Post saved.",
    "fr": "Publication enregistrée."
  },
  "deleted": {
    "en": "Post deleted locally.",
    "fr": "Publication supprimée localement."
  },
  "failed": {
    "en": "The publishing action could not be completed. Check permissions, connection status, and post state, then try again.",
    "fr": "L’action n’a pas pu être terminée. Vérifiez les droits, l’état de la connexion et l’état de la publication, puis réessayez."
  },
  "failed-import": {
    "en": "The CSV could not be imported. Check its header, row format, and file size, then try again.",
    "fr": "Le CSV n’a pas pu être importé. Vérifiez son en-tête, le format des lignes et sa taille, puis réessayez."
  },
  "failed-image": {
    "en": "The image could not be used for every selected destination. Check its type and size, or choose another image.",
    "fr": "L’image ne convient pas à toutes les destinations choisies. Vérifiez son type et sa taille, ou choisissez une autre image."
  },
  "failed-remote-delete": {
    "en": "Remote deletion could not be confirmed. The local post and delivery history were preserved. Reconnect the source or try again.",
    "fr": "La suppression sur la plateforme n’a pas pu être confirmée. La publication locale et son historique sont conservés. Reconnectez la source ou réessayez."
  },
  "failed-access": {
    "en": "Your role or channel access does not permit this action.",
    "fr": "Votre rôle ou votre accès aux canaux ne permet pas cette action."
  },
  "failed-state": {
    "en": "This post is no longer eligible for that action. Refresh the page and review its current status.",
    "fr": "Cette publication n’est plus éligible à cette action. Actualisez la page et vérifiez son état."
  },
  "published": {
    "en": "Publishing completed.",
    "fr": "Publication terminée."
  },
  "submitted": {
    "en": "Post submitted for approval.",
    "fr": "Publication soumise pour approbation."
  },
  "scheduled": {
    "en": "Post added to the queue.",
    "fr": "Publication ajoutée à la file d’attente."
  },
  "cancelled": {
    "en": "Scheduled post returned to drafts.",
    "fr": "La publication programmée est revenue en brouillon."
  },
  "publish-review": {
    "en": "Some destinations or first comments need attention. Review their individual delivery states before another action.",
    "fr": "Certaines destinations ou certains premiers commentaires demandent votre attention. Vérifiez l’état de chaque destination avant d’agir à nouveau."
  },
  "synced": {
    "en": "Remote status sync completed.",
    "fr": "Synchronisation de l’état terminée."
  },
  "failed-sync": {
    "en": "No new delivery status was confirmed. Check the post on its platform, then try syncing again.",
    "fr": "Aucun nouvel état de diffusion n’a été confirmé. Vérifiez la publication sur sa plateforme, puis réessayez."
  },
  "duplicated": {
    "en": "A new unscheduled draft was created.",
    "fr": "Un nouveau brouillon non programmé a été créé."
  },
  "imported": {
    "en": "{count} posts imported as drafts.",
    "fr": "{count} publications importées en brouillons."
  },
  "approval.approved": {
    "en": "Post approved and returned to drafts.",
    "fr": "Publication approuvée et remise en brouillon."
  },
  "approval.rejected": {
    "en": "Post rejected.",
    "fr": "Publication refusée."
  },
  "approval.failed": {
    "en": "The review could not be completed. Check the post state and your permissions.",
    "fr": "La validation n’a pas pu être terminée. Vérifiez l’état de la publication et vos droits."
  },
  "approval.failed-access": {
    "en": "You do not have permission to review this post.",
    "fr": "Vous n’avez pas le droit de valider cette publication."
  },
  "approval.failed-note": {
    "en": "Keep the note to 500 characters or fewer.",
    "fr": "La note doit faire 500 caractères ou moins."
  }
};
export type PublishingNoticeCatalog = typeof publishingNoticeDefaults;
export const publishingNoticeSchema = bilingualCatalogSchema(publishingNoticeDefaults);
/** Unknown notice codes stay silent. */
export function postsNotice(code:string,locale:KitLocale,catalog:PublishingNoticeCatalog=publishingNoticeDefaults):string|null {
 if (Object.prototype.hasOwnProperty.call(catalog,code) && code !== 'imported' && !code.startsWith('approval.')) return catalog[code as keyof PublishingNoticeCatalog][locale];
 if(code.startsWith('imported-')) return fillCopy(catalog.imported[locale],{count:code.slice('imported-'.length)});
 return null;
}
export function approvalNotice(code:string|undefined,locale:KitLocale,catalog:PublishingNoticeCatalog) {
 const key=`approval.${code}` as keyof PublishingNoticeCatalog;
 return code && Object.prototype.hasOwnProperty.call(catalog,key) ? {text:catalog[key][locale],error:code.startsWith('failed')} : undefined;
}
