/**
 * Customer copy for caption tests, English and French; Root catalog `captionTests.copy`.
 * `{name}` marks a value filled in by `fill`. Errors are the only wording the service exposes.
 */
export const CAPTION_TESTS_COPY = {
  en: {
    title: 'Caption tests',
    channelLimitHint: 'Choose up to {max} channels.', noChannels: 'No channels are available. Add a channel in Settings before creating these drafts.',
    source: 'Start from', existingPosts: 'Existing posts', rawCaptions: 'New captions', addCaption: 'Add caption', channels: 'Channels', link: 'Shared link (optional)', rawHint: 'Write different captions for the same link. This creates drafts only; review and publish each one in Content. The comparison begins after publication.', rawConfirm: 'Create one draft per caption and start this test? Nothing is published yet. Review and publish each draft in Content.',
    intro: 'The same content with different captions. Once the posts have had time to reach people, the caption that got the most engagement per view wins, but only when every caption had enough views to say so.',
    emptyTitle: 'No caption tests yet',
    emptyHint: 'Start a test from two to four posts that carry the same content with different captions. The result shows up here.',
    untitled: 'Untitled test', started: 'Started {date}', running: 'Running', runningUntil: 'Running until {date}',
    winner: 'Caption {label} won', winnerLift: 'Caption {label} won (+{lift}% engagement per view)', winnerShort: 'Winner',
    notEnoughViews: 'No winner: a caption had fewer than {views} views', notPublished: 'No winner: a caption did not go out',
    noInsights: 'No winner: no figures arrived for these posts', tie: 'No winner: the captions did equally well',
    colCaption: 'Caption', colChannels: 'Channels', colViews: 'Views', colEngagements: 'Engagements', colRate: 'Per view', unknown: 'Not measured',
    learn: 'Add to workspace voice', learnHint: 'The AI then writes more like the winning caption.', learned: 'Added to the workspace voice.',
    learnConfirm: 'Add the winning caption to your workspace writing voice? You can change it later in workspace settings.',
    learnFailed: 'The result could not be added. Try again.', learnNoRoom: 'The workspace voice is too long to add this. Shorten it in workspace settings first.',
    confirmation: 'Type to confirm', cancel: 'Cancel', confirm: 'Confirm', busy: 'Working…',
    startHeading: 'Start a test', startHint: 'Choose the posts that carry each caption, in order. The first becomes caption A.',
    name: 'Test name (optional)', hours: 'Compare after (hours)', minViews: 'Views each caption needs', posts: 'Posts', startRun: 'Start test',
    startConfirm: 'Start this caption test with the selected posts? Their results are compared once they have had time to reach people.',
    startedDone: 'Test started.', noPosts: 'No posts are available to test.', pickTwo: 'Choose at least two posts.', pickMost: 'Choose at most {max} posts.',
    learnLine: 'A caption test preferred “{winner}” over “{loser}”.', learnLineLift: 'A caption test preferred “{winner}” over “{loser}” ({lift}% more engagement per view).',
    errInvalid: 'Check the details and try again.', errUnauthorized: 'Sign in again to continue.', errForbidden: 'You do not have access to this.',
    errNotFound: 'That could not be found.', errUnavailable: 'This is not available right now.', errReconnect: 'Reconnect the channel to continue.',
    errConflict: 'That cannot be done in the current state.', errUpstream: 'That could not be completed. Try again later.',
  },
  fr: {
    title: 'Tests de légendes',
    channelLimitHint: 'Choisissez jusqu’à {max} canaux.', noChannels: 'Aucun canal disponible. Ajoutez un canal dans les réglages avant de créer ces brouillons.',
    source: 'Créer à partir de', existingPosts: 'Publications existantes', rawCaptions: 'Nouvelles légendes', addCaption: 'Ajouter une légende', channels: 'Canaux', link: 'Lien commun (facultatif)', rawHint: 'Rédigez différentes légendes pour le même lien. Seuls des brouillons sont créés ; vérifiez et publiez chacun dans Contenu. La comparaison commence après publication.', rawConfirm: 'Créer un brouillon par légende et lancer ce test ? Rien n’est encore publié. Vérifiez et publiez chaque brouillon dans Contenu.',
    intro: 'Le même contenu avec des légendes différentes. Une fois que les publications ont eu le temps de toucher les gens, la légende qui obtient le plus d’interactions par vue l’emporte, seulement si chaque légende a eu assez de vues pour le dire.',
    emptyTitle: 'Aucun test de légendes pour l’instant',
    emptyHint: 'Lancez un test à partir de deux à quatre publications qui portent le même contenu avec des légendes différentes. Le résultat s’affiche ici.',
    untitled: 'Test sans titre', started: 'Lancé le {date}', running: 'En cours', runningUntil: 'En cours jusqu’au {date}',
    winner: 'La légende {label} l’emporte', winnerLift: 'La légende {label} l’emporte (+{lift} % d’interactions par vue)', winnerShort: 'Gagnante',
    notEnoughViews: 'Pas de gagnante : une légende a eu moins de {views} vues', notPublished: 'Pas de gagnante : une légende n’a pas été publiée',
    noInsights: 'Pas de gagnante : aucun chiffre n’est arrivé pour ces publications', tie: 'Pas de gagnante : les légendes ont fait jeu égal',
    colCaption: 'Légende', colChannels: 'Canaux', colViews: 'Vues', colEngagements: 'Interactions', colRate: 'Par vue', unknown: 'Non mesuré',
    learn: 'Ajouter à la voix de l’espace', learnHint: 'L’IA écrit ensuite davantage comme la légende gagnante.', learned: 'Ajouté à la voix de l’espace.',
    learnConfirm: 'Ajouter la légende gagnante à la voix d’écriture de votre espace ? Vous pourrez la modifier dans les réglages de l’espace.',
    learnFailed: 'Le résultat n’a pas pu être ajouté. Réessayez.', learnNoRoom: 'La voix de l’espace est trop longue pour ajouter ceci. Raccourcissez-la d’abord dans les réglages de l’espace.',
    confirmation: 'Saisissez pour confirmer', cancel: 'Annuler', confirm: 'Confirmer', busy: 'En cours…',
    startHeading: 'Lancer un test', startHint: 'Choisissez les publications qui portent chaque légende, dans l’ordre. La première devient la légende A.',
    name: 'Nom du test (facultatif)', hours: 'Comparer après (heures)', minViews: 'Vues nécessaires par légende', posts: 'Publications', startRun: 'Lancer le test',
    startConfirm: 'Lancer ce test de légendes avec les publications choisies ? Leurs résultats sont comparés quand elles ont eu le temps de toucher les gens.',
    startedDone: 'Test lancé.', noPosts: 'Aucune publication disponible pour un test.', pickTwo: 'Choisissez au moins deux publications.', pickMost: 'Choisissez {max} publications au plus.',
    learnLine: 'Un test de légendes a préféré « {winner} » à « {loser} ».', learnLineLift: 'Un test de légendes a préféré « {winner} » à « {loser} » ({lift} % d’interactions par vue en plus).',
    errInvalid: 'Vérifiez les informations et réessayez.', errUnauthorized: 'Reconnectez-vous pour continuer.', errForbidden: 'Vous n’avez pas accès à cette fonction.',
    errNotFound: 'Élément introuvable.', errUnavailable: 'Cette fonction n’est pas disponible pour le moment.', errReconnect: 'Reconnectez le canal pour continuer.',
    errConflict: 'Impossible dans l’état actuel.', errUpstream: 'L’opération n’a pas pu aboutir. Réessayez plus tard.',
  },
} as const;
export type CaptionTestsCopy = { [K in keyof (typeof CAPTION_TESTS_COPY)['en']]: string };

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : match));
}
