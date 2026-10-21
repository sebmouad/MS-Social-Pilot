import type { InboxLocale } from './copy';

/** Customer copy for the details panel, quick filters, bulk moderation, saved-reply management and the shortcut guide. */
export const round3Copy = {
  en: {
    quick: {
      title: 'Quick filters', chip: 'Quick filter', unread: 'Unread', unanswered: 'Unanswered', negative: 'Negative', mentions: 'Mentions',
      hint: { unread: 'Conversations with unread messages', unanswered: 'Open items nobody on your team has answered', negative: 'Comments classified as negative (unclassified comments are not included)', mentions: 'Items that mention the channel by name' },
      noMatchTitle: 'Nothing matches these quick filters', noMatchBody: 'Turn a quick filter off, or sync to fetch new activity.',
    },
    bulk: {
      region: 'Selected items', selectItem: (name: string) => `Select ${name}`, selectAll: 'Select all on this page', count: (n: number) => n === 1 ? '1 selected' : `${n} selected`, clear: 'Clear selection',
      resolve: 'Resolve', reopen: 'Reopen', hide: 'Hide', unhide: 'Show again', delete: 'Delete',
      limit: (max: number) => `You can act on up to ${max} items at a time.`,
      mixed: 'The selection mixes items this action does not apply to.', notAllowed: 'Not available for every selected item on this channel.',
      working: 'Working…', undo: 'Undo', retry: 'Retry',
      done: { resolve: (n: number) => n === 1 ? 'Resolved 1 item.' : `Resolved ${n} items.`, reopen: (n: number) => n === 1 ? 'Reopened 1 item.' : `Reopened ${n} items.`, hide: (n: number) => n === 1 ? 'Hid 1 comment.' : `Hid ${n} comments.`, unhide: (n: number) => n === 1 ? 'Showed 1 comment again.' : `Showed ${n} comments again.`, delete: (n: number) => n === 1 ? 'Deleted 1 comment.' : `Deleted ${n} comments.` },
      partial: (ok: number, failed: number) => `${ok} done, ${failed} could not be updated. They stay selected so you can check them.`,
      failedTitle: 'Could not update the selection', unconfirmed: 'The result could not be confirmed. Check the items before trying again.',
      undone: 'Undone.', undoPartial: 'Some items could not be restored. Check them in the list.',
      confirm: {
        hideTitle: 'Hide comments', hideSentence: (n: number, platform: string) => `${n} ${n === 1 ? 'comment' : 'comments'} will be hidden on ${platform}. You can show them again.`, hideConfirm: 'Hide comments',
        unhideTitle: 'Show comments again', unhideSentence: (n: number, platform: string) => `${n} ${n === 1 ? 'comment' : 'comments'} will be visible again on ${platform}.`, unhideConfirm: 'Show comments',
        deleteTitle: 'Delete comments', deleteSentence: (n: number, platform: string) => `${n} ${n === 1 ? 'comment' : 'comments'} will be deleted from ${platform} and from this app. This cannot be undone.`, deleteConfirm: 'Delete comments',
        object: (n: number) => n === 1 ? '1 selected comment' : `${n} selected comments`, cancel: 'Cancel', pending: 'Working…', failure: 'Could not complete this. Nothing was confirmed; check the items before trying again.',
      },
    },
    details: {
      region: 'Conversation details', title: 'Details', person: 'Person', channel: 'Channel', firstSeen: 'First seen', messagesWritten: 'Messages and comments', labels: 'Labels', relatedPosts: 'Related posts', sentimentTrend: 'Sentiment trend',
      unknown: 'Unknown', partial: 'This item has no platform identity, so only this conversation is described.',
      noPosts: 'They have not commented on any of your posts yet.', morePosts: 'More posts are not shown.', commentsOn: (n: number) => n === 1 ? '1 comment' : `${n} comments`,
      noSentiment: 'No classified comments yet', noSentimentBody: 'The trend appears once this person’s comments are classified.',
      directions: { improving: 'Getting more positive', worsening: 'Getting more negative', steady: 'Steady', unknown: 'Not enough classified comments to show a direction' },
      unclassified: 'Not classified', counts: (positive: number, neutral: number, negative: number, unclassified: number) => `${positive} positive · ${neutral} neutral · ${negative} negative · ${unclassified} not classified`,
      assignedTo: (name: string) => `Assigned to ${name}`, unassigned: 'Unassigned', teammate: 'Teammate', unreadLabel: (n: number) => `${n} unread`, loadError: 'The details could not be loaded.', show: 'Show details', hide: 'Hide details',
    },
    replies: {
      open: 'Saved replies', title: 'Saved replies', description: 'Answers your whole team can insert into a reply. Inserting never sends anything.', close: 'Close',
      usage: (used: number, max: number) => `${used} of ${max} saved replies used`, full: (max: number) => `You have reached the limit of ${max} saved replies. Delete one to add another.`,
      search: 'Search saved replies', searchPlaceholder: 'Name or text', empty: 'No saved replies yet', emptyBody: 'Save the answers you give often. Your team can insert them into a reply with one click.',
      noMatch: 'No saved reply matches your search', noMatchBody: 'Try a different word, or clear the search.', clearSearch: 'Clear search',
      name: 'Name', text: 'Reply text', namePlaceholder: 'For example: Opening hours', textPlaceholder: 'The answer you give most often', counter: (n: number, max: number) => `${n} / ${max}`,
      create: 'Create saved reply', save: 'Save changes', cancelEdit: 'Cancel', newReply: 'New saved reply', editing: (name: string) => `Editing “${name}”`,
      edit: 'Edit', delete: 'Delete', actions: (name: string) => `Actions for ${name}`, readOnly: 'You can read saved replies, but only teammates who can reply can change them.',
      created: 'Saved reply created.', updated: 'Saved reply updated.', deleted: 'Saved reply deleted.', loadError: 'Saved replies could not be loaded.', retry: 'Try again', loading: 'Loading saved replies…', unconfirmed: 'The result could not be confirmed. Reload the list before trying again.',
      deleteTitle: 'Delete saved reply', deleteConsequence: 'This removes it for your whole team. This cannot be undone.', deleteConfirm: 'Delete saved reply', cancel: 'Cancel', pending: 'Deleting…', deleteFailure: 'Could not delete this saved reply. Nothing was changed.',
      required: 'Enter a name and the reply text.',
    },
    shortcuts: {
      title: 'Keyboard shortcuts', open: 'Keyboard shortcuts', close: 'Close', description: 'These keys work when you are not typing in a field. Each one is also available as a button on the page.',
      groups: { move: 'Move', act: 'Act', select: 'Select' },
      keys: { next: 'Next conversation', previous: 'Previous conversation', reply: 'Write a reply', resolve: 'Resolve or reopen the open conversation', select: 'Select or unselect the focused conversation', clear: 'Clear the selection', search: 'Search the Inbox', help: 'Show this guide' },
    },
  },
  fr: {
    quick: {
      title: 'Filtres rapides', chip: 'Filtre rapide', unread: 'Non lus', unanswered: 'Sans réponse', negative: 'Négatifs', mentions: 'Mentions',
      hint: { unread: 'Conversations avec des messages non lus', unanswered: 'Éléments ouverts auxquels personne de votre équipe n’a répondu', negative: 'Commentaires classés comme négatifs (les commentaires non classés ne sont pas inclus)', mentions: 'Éléments qui citent le nom du canal' },
      noMatchTitle: 'Aucun élément ne correspond à ces filtres rapides', noMatchBody: 'Désactivez un filtre rapide, ou synchronisez pour récupérer les nouvelles activités.',
    },
    bulk: {
      region: 'Éléments sélectionnés', selectItem: (name: string) => `Sélectionner ${name}`, selectAll: 'Tout sélectionner sur cette page', count: (n: number) => n === 1 ? '1 sélectionné' : `${n} sélectionnés`, clear: 'Effacer la sélection',
      resolve: 'Résoudre', reopen: 'Rouvrir', hide: 'Masquer', unhide: 'Réafficher', delete: 'Supprimer',
      limit: (max: number) => `Vous pouvez agir sur ${max} éléments à la fois au maximum.`,
      mixed: 'La sélection mélange des éléments auxquels cette action ne s’applique pas.', notAllowed: 'Indisponible pour tous les éléments sélectionnés sur ce canal.',
      working: 'En cours…', undo: 'Annuler', retry: 'Réessayer',
      done: { resolve: (n: number) => n === 1 ? '1 élément résolu.' : `${n} éléments résolus.`, reopen: (n: number) => n === 1 ? '1 élément rouvert.' : `${n} éléments rouverts.`, hide: (n: number) => n === 1 ? '1 commentaire masqué.' : `${n} commentaires masqués.`, unhide: (n: number) => n === 1 ? '1 commentaire réaffiché.' : `${n} commentaires réaffichés.`, delete: (n: number) => n === 1 ? '1 commentaire supprimé.' : `${n} commentaires supprimés.` },
      partial: (ok: number, failed: number) => `${ok} terminé(s), ${failed} n’ont pas pu être mis à jour. Ils restent sélectionnés pour que vous puissiez les vérifier.`,
      failedTitle: 'La sélection n’a pas pu être mise à jour', unconfirmed: 'Le résultat n’a pas pu être confirmé. Vérifiez les éléments avant de réessayer.',
      undone: 'Action annulée.', undoPartial: 'Certains éléments n’ont pas pu être rétablis. Vérifiez-les dans la liste.',
      confirm: {
        hideTitle: 'Masquer les commentaires', hideSentence: (n: number, platform: string) => `${n} ${n === 1 ? 'commentaire sera masqué' : 'commentaires seront masqués'} sur ${platform}. Vous pourrez les réafficher.`, hideConfirm: 'Masquer les commentaires',
        unhideTitle: 'Réafficher les commentaires', unhideSentence: (n: number, platform: string) => `${n} ${n === 1 ? 'commentaire sera de nouveau visible' : 'commentaires seront de nouveau visibles'} sur ${platform}.`, unhideConfirm: 'Réafficher les commentaires',
        deleteTitle: 'Supprimer les commentaires', deleteSentence: (n: number, platform: string) => `${n} ${n === 1 ? 'commentaire sera supprimé' : 'commentaires seront supprimés'} de ${platform} et de cette application. Cette action est irréversible.`, deleteConfirm: 'Supprimer les commentaires',
        object: (n: number) => n === 1 ? '1 commentaire sélectionné' : `${n} commentaires sélectionnés`, cancel: 'Annuler', pending: 'En cours…', failure: 'Impossible de terminer. Rien n’a été confirmé ; vérifiez les éléments avant de réessayer.',
      },
    },
    details: {
      region: 'Détails de la conversation', title: 'Détails', person: 'Personne', channel: 'Canal', firstSeen: 'Première apparition', messagesWritten: 'Messages et commentaires', labels: 'Étiquettes', relatedPosts: 'Publications liées', sentimentTrend: 'Tendance du sentiment',
      unknown: 'Inconnue', partial: 'Cet élément n’a pas d’identité sur la plateforme : seule cette conversation est décrite.',
      noPosts: 'Cette personne n’a encore commenté aucune de vos publications.', morePosts: 'D’autres publications ne sont pas affichées.', commentsOn: (n: number) => n === 1 ? '1 commentaire' : `${n} commentaires`,
      noSentiment: 'Aucun commentaire classé pour l’instant', noSentimentBody: 'La tendance apparaît dès que les commentaires de cette personne sont classés.',
      directions: { improving: 'De plus en plus positif', worsening: 'De plus en plus négatif', steady: 'Stable', unknown: 'Pas assez de commentaires classés pour indiquer une direction' },
      unclassified: 'Non classé', counts: (positive: number, neutral: number, negative: number, unclassified: number) => `${positive} positif(s) · ${neutral} neutre(s) · ${negative} négatif(s) · ${unclassified} non classé(s)`,
      assignedTo: (name: string) => `Attribuée à ${name}`, unassigned: 'Non attribuée', teammate: 'Collègue', unreadLabel: (n: number) => `${n} non lu(s)`, loadError: 'Les détails n’ont pas pu être chargés.', show: 'Afficher les détails', hide: 'Masquer les détails',
    },
    replies: {
      open: 'Réponses enregistrées', title: 'Réponses enregistrées', description: 'Des réponses que toute votre équipe peut insérer dans une réponse. L’insertion n’envoie jamais rien.', close: 'Fermer',
      usage: (used: number, max: number) => `${used} réponses enregistrées sur ${max}`, full: (max: number) => `Vous avez atteint la limite de ${max} réponses enregistrées. Supprimez-en une pour en ajouter une autre.`,
      search: 'Rechercher une réponse enregistrée', searchPlaceholder: 'Nom ou texte', empty: 'Aucune réponse enregistrée', emptyBody: 'Enregistrez les réponses que vous donnez souvent. Votre équipe pourra les insérer en un clic.',
      noMatch: 'Aucune réponse enregistrée ne correspond', noMatchBody: 'Essayez un autre mot, ou effacez la recherche.', clearSearch: 'Effacer la recherche',
      name: 'Nom', text: 'Texte de la réponse', namePlaceholder: 'Par exemple : Horaires d’ouverture', textPlaceholder: 'La réponse que vous donnez le plus souvent', counter: (n: number, max: number) => `${n} / ${max}`,
      create: 'Créer la réponse enregistrée', save: 'Enregistrer les modifications', cancelEdit: 'Annuler', newReply: 'Nouvelle réponse enregistrée', editing: (name: string) => `Modification de « ${name} »`,
      edit: 'Modifier', delete: 'Supprimer', actions: (name: string) => `Actions pour ${name}`, readOnly: 'Vous pouvez lire les réponses enregistrées, mais seuls les collègues pouvant répondre peuvent les modifier.',
      created: 'Réponse enregistrée créée.', updated: 'Réponse enregistrée mise à jour.', deleted: 'Réponse enregistrée supprimée.', loadError: 'Les réponses enregistrées n’ont pas pu être chargées.', retry: 'Réessayer', loading: 'Chargement des réponses enregistrées…', unconfirmed: 'Le résultat n’a pas pu être confirmé. Rechargez la liste avant de réessayer.',
      deleteTitle: 'Supprimer la réponse enregistrée', deleteConsequence: 'Elle sera retirée pour toute votre équipe. Cette action est irréversible.', deleteConfirm: 'Supprimer la réponse', cancel: 'Annuler', pending: 'Suppression…', deleteFailure: 'Impossible de supprimer cette réponse enregistrée. Rien n’a été modifié.',
      required: 'Saisissez un nom et le texte de la réponse.',
    },
    shortcuts: {
      title: 'Raccourcis clavier', open: 'Raccourcis clavier', close: 'Fermer', description: 'Ces touches fonctionnent quand vous ne saisissez pas de texte. Chacune existe aussi sous forme de bouton sur la page.',
      groups: { move: 'Se déplacer', act: 'Agir', select: 'Sélectionner' },
      keys: { next: 'Conversation suivante', previous: 'Conversation précédente', reply: 'Écrire une réponse', resolve: 'Résoudre ou rouvrir la conversation ouverte', select: 'Sélectionner ou désélectionner la conversation ciblée', clear: 'Effacer la sélection', search: 'Rechercher dans la boîte de réception', help: 'Afficher ce guide' },
    },
  },
} as const satisfies Record<InboxLocale, unknown>;

export type Round3Copy = typeof round3Copy.en;
