import type { InboxLocale } from './copy';

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const pluralFr = (count: number, one: string, many = `${one}s`) => `${count} ${count > 1 ? many : one}`;

type SyncCounts = { targets: number; conversations: number; messages: number; comments: number; reviews: number | null; failed: number };

/** Buttons, status lines and dialogs of the Inbox write controls (sync, resolve, hide, delete). */
export const actionCopy = {
  en: {
    syncNow: 'Sync now', syncing: 'Syncing…', lastSynced: 'Last synced', notSynced: 'Not synced yet',
    synced: (c: SyncCounts) => `Checked ${plural(c.targets, 'channel')}: ${plural(c.conversations, 'conversation')} (${plural(c.messages, 'message')}) and ${plural(c.comments, 'comment')} up to date.${c.reviews === null ? '' : ` ${plural(c.reviews, 'review')} up to date.`}${c.failed ? ` ${plural(c.failed, 'channel')} could not be read. Reconnect it in Connections, then sync again.` : ''}`,
    uncertain: 'The outcome is unconfirmed. Check the current Inbox and platform state before repeating this action.',
    readOnly: 'You can read this conversation but not change it.',
    reopen: 'Reopen', markResolved: 'Mark resolved', reopened: 'Reopened.', resolvedDone: 'Marked as resolved.',
    noun: (reply: boolean) => reply ? 'reply' : 'comment', cap: (reply: boolean) => reply ? 'Reply' : 'Comment',
    hide: (noun: string) => `Hide ${noun}`, unhide: (noun: string) => `Unhide ${noun}`, delete: (noun: string) => `Delete ${noun}`, keep: (noun: string) => `Keep ${noun}`,
    hiddenDone: (cap: string) => `${cap} hidden.`, visibleDone: (cap: string) => `${cap} is visible again.`, deletedDone: 'Comment deleted.',
    undo: 'Undo', retry: 'Try again', failedTitle: 'That did not go through',
    deleteTitle: (noun: string) => `Delete this ${noun}?`, statusTitle: 'Comment deletion status',
    deleteBody: (noun: string, platform: string) => `This removes the ${noun}, and any replies under it, from ${platform} and from your inbox. This cannot be undone.`,
    statusBody: 'Check the current deletion outcome. Closing this dialog does not undo an existing deletion request.',
    close: 'Close', checkStatus: 'Check deletion status', checking: 'Checking…', finish: 'Finish removal from Inbox', finishing: 'Finishing…', deleting: 'Deleting…',
    checkingInProgress: 'Checking whether a deletion is already in progress…', hideInstead: (noun: string) => `Hiding the ${noun} instead keeps it in your inbox and can be undone.`,
    unconfirmedPlatform: 'The platform outcome is unconfirmed. Check deletion status before taking another action.',
    remoteConfirmed: 'The platform confirmed deletion.', remoteUnconfirmed: 'The platform outcome is unconfirmed.', finishNote: 'Finish removal from Inbox only completes the local cleanup.',
    rejected: 'The platform rejected this deletion. Contact your administrator before trying again.', notFullyConfirmed: 'Deletion is not fully confirmed. Check status or contact your administrator.',
    statusError: 'Could not check deletion status. Keep this dialog open and check again.',
  },
  fr: {
    syncNow: 'Synchroniser', syncing: 'Synchronisation…', lastSynced: 'Dernière synchronisation', notSynced: 'Pas encore synchronisé',
    synced: (c: SyncCounts) => `${pluralFr(c.targets, 'canal', 'canaux')} vérifié${c.targets > 1 ? 's' : ''} : ${pluralFr(c.conversations, 'conversation')} (${pluralFr(c.messages, 'message')}) et ${pluralFr(c.comments, 'commentaire')} à jour.${c.reviews === null ? '' : ` ${pluralFr(c.reviews, 'avis', 'avis')} à jour.`}${c.failed ? ` ${pluralFr(c.failed, 'canal', 'canaux')} n’${c.failed > 1 ? 'ont' : 'a'} pas pu être lu${c.failed > 1 ? 's' : ''}. Reconnectez-le dans Connexions, puis synchronisez à nouveau.` : ''}`,
    uncertain: 'Le résultat n’est pas confirmé. Vérifiez l’état actuel de la boîte de réception et de la plateforme avant de répéter cette action.',
    readOnly: 'Vous pouvez lire cette conversation, mais pas la modifier.',
    reopen: 'Rouvrir', markResolved: 'Marquer comme résolue', reopened: 'Conversation rouverte.', resolvedDone: 'Marquée comme résolue.',
    noun: (reply: boolean) => reply ? 'la réponse' : 'le commentaire', cap: (reply: boolean) => reply ? 'La réponse' : 'Le commentaire',
    hide: (noun: string) => `Masquer ${noun}`, unhide: (noun: string) => `Afficher ${noun}`, delete: (noun: string) => `Supprimer ${noun}`, keep: (noun: string) => `Garder ${noun}`,
    hiddenDone: (cap: string) => `${cap} est masqué(e).`, visibleDone: (cap: string) => `${cap} est de nouveau visible.`, deletedDone: 'Commentaire supprimé.',
    undo: 'Annuler', retry: 'Réessayer', failedTitle: 'L’action n’a pas abouti',
    deleteTitle: (noun: string) => `Supprimer ${noun} ?`, statusTitle: 'État de la suppression du commentaire',
    deleteBody: (noun: string, platform: string) => `Cela retire ${noun}, ainsi que toutes les réponses associées, de ${platform} et de votre boîte de réception. Cette action est irréversible.`,
    statusBody: 'Vérifiez le résultat de la suppression en cours. Fermer cette fenêtre n’annule pas une demande de suppression existante.',
    close: 'Fermer', checkStatus: 'Vérifier l’état de la suppression', checking: 'Vérification…', finish: 'Terminer le retrait de la boîte de réception', finishing: 'Finalisation…', deleting: 'Suppression…',
    checkingInProgress: 'Vérification d’une éventuelle suppression en cours…', hideInstead: (noun: string) => `Masquer ${noun} à la place le garde dans votre boîte de réception et peut être annulé.`,
    unconfirmedPlatform: 'Le résultat côté plateforme n’est pas confirmé. Vérifiez l’état de la suppression avant d’agir à nouveau.',
    remoteConfirmed: 'La plateforme a confirmé la suppression.', remoteUnconfirmed: 'Le résultat côté plateforme n’est pas confirmé.', finishNote: 'Terminer le retrait ne fait que finaliser le nettoyage local.',
    rejected: 'La plateforme a refusé cette suppression. Contactez votre administrateur avant de réessayer.', notFullyConfirmed: 'La suppression n’est pas entièrement confirmée. Vérifiez l’état ou contactez votre administrateur.',
    statusError: 'L’état de la suppression n’a pas pu être vérifié. Gardez cette fenêtre ouverte et vérifiez à nouveau.',
  },
} satisfies Record<InboxLocale, unknown>;
