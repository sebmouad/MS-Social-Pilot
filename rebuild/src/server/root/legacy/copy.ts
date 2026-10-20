/**
 * English and French copy for the Root sessions and connections screens. Root
 * has no locale setting yet, so the browser's preferred language chooses.
 */
export type RootCopyLocale = 'en' | 'fr';

export const ROOT_OPERATIONS_COPY = {
  en: {
    eyebrow: 'Root · Shared controls',
    sessionsTitle: 'Sessions',
    sessionsIntro: 'Browsers that are signed in across the installation. Signing out a browser ends that session only; the account stays enabled.',
    sessionsUnavailable: 'Sessions unavailable', sessionsEmpty: 'No sessions', sessionsEmptyHint: 'No signed-in browsers match this search.',
    truncated: 'Only the first {count} are shown. Narrow the search to see the rest.',
    account: 'Account', status: 'Status', expires: 'Expires', action: 'Action', verified: 'Signed in', pending: 'Verification pending', disabledAccount: 'Account disabled', thisBrowser: 'This browser', owner: 'Installation owner',
    search: 'Search', filter: 'Filter', reset: 'Reset filters', filters: 'Filters',
    signOut: 'Sign out', signOutTitle: 'Sign out this browser?', signOutBody: 'The person will need to sign in again on that browser. Type {phrase} to confirm.', confirmLabel: 'Confirmation', cancel: 'Cancel', working: 'Signing out…',
    failed: 'The sign-out could not be confirmed. Reload before repeating it.',
    connectionsTitle: 'Connections', connectionsIntro: 'Every platform connection in every workspace. Disconnect here stops its use and keeps all its data; workspaces reconnect, or delete related data, in their own settings. Credentials are never shown.', connectionAction: 'Action', disconnect: 'Disconnect', disconnectTitle: 'Disconnect {name}?', disconnectBody: 'Its stored credentials stop working and its channels and ad accounts are switched off. Posts, messages and metrics are kept. Nothing is revoked at the platform; the workspace can reconnect.', disconnectDone: 'Connection disconnected.',
    connectionsUnavailable: 'Connections unavailable', connectionsEmpty: 'No connections', connectionsEmptyHint: 'No connections match these filters.',
    platform: 'Platform', allPlatforms: 'All platforms', state: 'State', allStates: 'All states', workspace: 'Workspace', connection: 'Connection', channels: 'Channels', permissions: 'Permissions', tokenExpiry: 'Token expiry', never: 'No expiry recorded', notInstalled: 'module not installed',
    connected: 'Connected', expired: 'Expired', revoked: 'Revoked', selectedOf: '{selected} selected of {discovered}', permissionCount: '{count} granted',
    page: 'Page {page} of {pages}', previous: 'Previous', next: 'Next', total: '{count} connections',
    loadFailed: 'This list could not be loaded. Try again.',
  },
  fr: {
    eyebrow: 'Root · Contrôles partagés',
    sessionsTitle: 'Sessions',
    sessionsIntro: 'Navigateurs connectés sur l’installation. Déconnecter un navigateur ne ferme que cette session ; le compte reste actif.',
    sessionsUnavailable: 'Sessions indisponibles', sessionsEmpty: 'Aucune session', sessionsEmptyHint: 'Aucun navigateur connecté ne correspond à cette recherche.',
    truncated: 'Seuls les {count} premiers sont affichés. Affinez la recherche pour voir les autres.',
    account: 'Compte', status: 'État', expires: 'Expire', action: 'Action', verified: 'Connecté', pending: 'Vérification en attente', disabledAccount: 'Compte désactivé', thisBrowser: 'Ce navigateur', owner: 'Propriétaire de l’installation',
    search: 'Rechercher', filter: 'Filtrer', reset: 'Réinitialiser les filtres', filters: 'Filtres',
    signOut: 'Déconnecter', signOutTitle: 'Déconnecter ce navigateur ?', signOutBody: 'La personne devra se reconnecter sur ce navigateur. Saisissez {phrase} pour confirmer.', confirmLabel: 'Confirmation', cancel: 'Annuler', working: 'Déconnexion…',
    failed: 'La déconnexion n’a pas pu être confirmée. Rechargez avant de réessayer.',
    connectionsTitle: 'Connexions', connectionsIntro: 'Toutes les connexions aux plateformes de tous les espaces de travail. Déconnecter ici arrête son utilisation et conserve toutes ses données ; chaque espace se reconnecte, ou supprime les données liées, dans ses propres paramètres. Les identifiants ne sont jamais affichés.', connectionAction: 'Action', disconnect: 'Déconnecter', disconnectTitle: 'Déconnecter {name} ?', disconnectBody: 'Ses identifiants enregistrés cessent de fonctionner et ses canaux et comptes publicitaires sont désactivés. Les publications, messages et statistiques sont conservés. Rien n’est révoqué sur la plateforme ; l’espace peut se reconnecter.', disconnectDone: 'Connexion déconnectée.',
    connectionsUnavailable: 'Connexions indisponibles', connectionsEmpty: 'Aucune connexion', connectionsEmptyHint: 'Aucune connexion ne correspond à ces filtres.',
    platform: 'Plateforme', allPlatforms: 'Toutes les plateformes', state: 'État', allStates: 'Tous les états', workspace: 'Espace de travail', connection: 'Connexion', channels: 'Canaux', permissions: 'Autorisations', tokenExpiry: 'Expiration du jeton', never: 'Aucune expiration enregistrée', notInstalled: 'module non installé',
    connected: 'Connectée', expired: 'Expirée', revoked: 'Révoquée', selectedOf: '{selected} sélectionnés sur {discovered}', permissionCount: '{count} accordées',
    page: 'Page {page} sur {pages}', previous: 'Précédente', next: 'Suivante', total: '{count} connexions',
    loadFailed: 'Cette liste n’a pas pu être chargée. Réessayez.',
  },
} as const satisfies Record<RootCopyLocale, Record<string, string>>;

export type RootCopy = (typeof ROOT_OPERATIONS_COPY)['en'];

/** First supported language in an Accept-Language header; English otherwise. */
export function rootCopyLocale(acceptLanguage: string | null | undefined): RootCopyLocale {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    if (tag.startsWith('fr')) return 'fr';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export function rootCopy(locale: RootCopyLocale): RootCopy { return ROOT_OPERATIONS_COPY[locale] as RootCopy; }

export const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
