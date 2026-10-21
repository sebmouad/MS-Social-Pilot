/** OAuth connector consent copy in both shipped languages; chosen from `accept-language` like the media library. */
export const oauthCopy = {
  en: {
    title: 'Connect {client}',
    eyebrow: 'Workspace settings',
    description: '{client} wants to use {workspace} through MCP. Choose exactly what it may do.',
    unavailable: 'Connecting apps is not available right now.',
    invalid: 'This connection link is not valid. Go back to the app and start again.',
    signInNeeded: 'Sign in to continue',
    signInBody: 'Sign in to MS Social Pilot, then open the connection link from {client} again.',
    signIn: 'Sign in',
    restricted: 'Only workspace owners and admins can connect apps to this workspace.',
    sends: 'After you decide, you are sent back to {host}. Only continue if you started this from {client}.',
    featuresTitle: 'What it can use',
    featuresDetail: 'Reading is on for what you can use. Allow changes only for what it must change.',
    colFeature: 'Feature',
    colRead: 'Read',
    colWrite: 'Change',
    writeRequested: '{client} asked to make changes. Nothing is allowed to change unless you tick it.',
    channelsTitle: 'Which channels and ad accounts',
    modeSelected: 'Only the channels and ad accounts I choose',
    modeAll: 'All current and future channels and ad accounts',
    channels: 'Channels',
    adAccounts: 'Ad accounts',
    noResources: 'No channels or ad accounts are selected in this workspace.',
    chooseOne: 'Choose at least one channel or ad account.',
    chooseRead: 'Allow at least one feature to read.',
    tooMany: 'This workspace has too many channels to list here. Create a key in Settings instead.',
    revokeHint: 'The connection becomes a key named "OAuth: {client}" under Settings, MCP API keys. It never exceeds your own access, ends on its own, and you can revoke it there at any time.',
    allow: 'Allow',
    deny: 'Deny',
    confirmTitle: 'Confirm access',
    confirmCancel: 'Review again',
    confirmAllow: 'Allow access',
    confirmWrite: 'Allow {client} to change data in {workspace}? It can act with your permissions on the features you ticked under Change.',
    confirmAll: 'Allow {client} to use every current and future channel and ad account in {workspace}?',
    confirmBoth: 'Allow {client} to change data on every current and future channel and ad account in {workspace}?',
  },
  fr: {
    title: 'Connecter {client}',
    eyebrow: "Paramètres de l'espace de travail",
    description: '{client} souhaite utiliser {workspace} via MCP. Choisissez précisément ce qu\'il peut faire.',
    unavailable: "La connexion d'applications n'est pas disponible pour le moment.",
    invalid: "Ce lien de connexion n'est pas valide. Retournez dans l'application et recommencez.",
    signInNeeded: 'Connectez-vous pour continuer',
    signInBody: "Connectez-vous à MS Social Pilot, puis rouvrez le lien de connexion depuis {client}.",
    signIn: 'Se connecter',
    restricted: "Seuls les propriétaires et administrateurs de l'espace de travail peuvent connecter des applications.",
    sends: "Après votre choix, vous serez renvoyé vers {host}. Ne continuez que si vous avez lancé cette demande depuis {client}.",
    featuresTitle: 'Ce qu\'il peut utiliser',
    featuresDetail: "La lecture est activée pour ce que vous pouvez utiliser. N'autorisez les modifications que là où c'est nécessaire.",
    colFeature: 'Fonctionnalité',
    colRead: 'Lecture',
    colWrite: 'Modification',
    writeRequested: "{client} demande à pouvoir modifier. Rien ne peut être modifié sans que vous le cochiez.",
    channelsTitle: 'Quels canaux et comptes publicitaires',
    modeSelected: 'Uniquement les canaux et comptes publicitaires que je choisis',
    modeAll: 'Tous les canaux et comptes publicitaires, actuels et futurs',
    channels: 'Canaux',
    adAccounts: 'Comptes publicitaires',
    noResources: "Aucun canal ni compte publicitaire n'est sélectionné dans cet espace de travail.",
    chooseOne: 'Choisissez au moins un canal ou un compte publicitaire.',
    chooseRead: 'Autorisez la lecture d\'au moins une fonctionnalité.',
    tooMany: "Cet espace de travail a trop de canaux pour les lister ici. Créez plutôt une clé dans les paramètres.",
    revokeHint: "La connexion devient une clé nommée « OAuth : {client} » dans Paramètres, Clés API MCP. Elle ne dépasse jamais vos propres accès, expire d'elle-même et vous pouvez la révoquer à tout moment.",
    allow: 'Autoriser',
    deny: 'Refuser',
    confirmTitle: "Confirmer l'accès",
    confirmCancel: 'Revoir',
    confirmAllow: "Autoriser l'accès",
    confirmWrite: "Autoriser {client} à modifier des données dans {workspace} ? Il agit avec vos permissions sur les fonctionnalités cochées sous Modification.",
    confirmAll: 'Autoriser {client} à utiliser tous les canaux et comptes publicitaires, actuels et futurs, de {workspace} ?',
    confirmBoth: 'Autoriser {client} à modifier des données sur tous les canaux et comptes publicitaires, actuels et futurs, de {workspace} ?',
  },
} as const;

export type OAuthLocale = keyof typeof oauthCopy;
export type OAuthCopyKey = keyof (typeof oauthCopy)['en'];

/** `fr` for French-speaking browsers, otherwise English. */
export function oauthLocale(acceptLanguage: string | null | undefined): OAuthLocale {
  return /^\s*fr\b/i.test(acceptLanguage ?? '') ? 'fr' : 'en';
}
export function oauthText(locale: OAuthLocale, key: OAuthCopyKey, vars: Record<string, string | number> = {}): string {
  return Object.entries(vars).reduce((text: string, [name, value]) => text.split(`{${name}}`).join(String(value)), oauthCopy[locale][key]);
}
/** The strings the client component needs, resolved on the server so no copy catalog ships to the browser. */
export function oauthCopyFor(locale: OAuthLocale): Record<OAuthCopyKey, string> {
  return { ...oauthCopy[locale] } as Record<OAuthCopyKey, string>;
}
