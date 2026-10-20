export type KitLocale = 'en' | 'fr';

export const kitCopy = {
  en: {
    newPost: 'New post', resetFilters: 'Reset filters', activeFilters: 'Active filters', removeFilter: 'Remove filter', search: 'Search', channel: 'Channel', status: 'Status',
    scheduledApp: 'App', scheduledPlatform: 'Platform', scheduledAppHint: 'Sent by this app at the scheduled time', scheduledRemoteHint: 'Held by the platform and published there at the scheduled time',
    noDestinations: 'No destinations', moreDestinations: 'more', noText: 'No text', mediaCount: 'media', needsAttention: 'Needs attention',
    postsEmptyTitle: 'No posts yet', postsEmptyBody: 'Write your first post, pick where it goes and schedule it.', postsNoMatchTitle: 'No posts match these filters', postsNoMatchBody: 'Change or reset the filters to see other posts.',
    viewTable: 'Table', viewFeed: 'Feed', viewCards: 'Cards', viewLabel: 'Post view',
  },
  fr: {
    newPost: 'Nouvelle publication', resetFilters: 'Réinitialiser les filtres', activeFilters: 'Filtres actifs', removeFilter: 'Retirer le filtre', search: 'Recherche', channel: 'Canal', status: 'Statut',
    scheduledApp: 'App', scheduledPlatform: 'Plateforme', scheduledAppHint: 'Envoyée par cette application à l’heure prévue', scheduledRemoteHint: 'Conservée par la plateforme et publiée là-bas à l’heure prévue',
    noDestinations: 'Aucune destination', moreDestinations: 'de plus', noText: 'Sans texte', mediaCount: 'média', needsAttention: 'À vérifier',
    postsEmptyTitle: 'Aucune publication', postsEmptyBody: 'Rédigez votre première publication, choisissez où elle va et planifiez-la.', postsNoMatchTitle: 'Aucune publication ne correspond', postsNoMatchBody: 'Modifiez ou réinitialisez les filtres pour voir d’autres publications.',
    viewTable: 'Tableau', viewFeed: 'Fil', viewCards: 'Cartes', viewLabel: 'Affichage',
  },
} as const;
