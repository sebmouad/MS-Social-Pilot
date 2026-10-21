/**
 * Copy catalog for workspace operations settings, English and French.
 * Ported from legacy `messages/{en,fr}.json` (settings namespace). The rebuild UI
 * currently renders English; French is kept in step for the locale rollout.
 */
export const workspaceOperationsCopy = {
  en: {
    confirmationConsequence: 'Apply these settings to this workspace. This affects future workspace activity.',
    panelTitle: 'Workspace operations', panelDetail: 'Posting hours, link tagging, spacing, undo, AI voice and moderation defaults for this workspace.',
    hoursLegend: 'Posting hours and queue rules', weekStartsOn: 'First day of the week', weekStartsOnHint: 'The calendar’s first column, for everyone in this workspace.',
    businessHours: 'Business hours', businessFrom: 'From', businessTo: 'to', businessHoursHint: 'Days and hours on the workspace clock. Pick no day to count every hour.',
    bestTimeMode: 'Best times per channel', bestTimeSuggest: 'Suggest them in the composer', bestTimeApply: 'Prefer them when adding posts to the queue',
    linksLegend: 'Links', utmSource: 'UTM source', utmMedium: 'UTM medium', utmCampaign: 'UTM campaign', utmHint: 'Appended to links in your posts so you can attribute traffic. Campaign accepts {date}, {month}, {year} and {target}. Leave blank to post links untouched. Saved posts keep the original links.',
    shortenLinks: 'Shorten links', shortenHint: 'Replaces links with short ones you control, so clicks can be counted.',
    spacingLegend: 'Spacing and undo', spacingOnlyLegend: 'Spacing', panelLiveDetail: 'Link tagging applied when posts are published, and the composer spacing warning.', spamGap: 'Gap between channels for the same content (minutes)', spamGapHint: 'The composer warns when the same post would reach 3 or more channels of one network at once. 0 turns the warning off.',
    undoSend: 'Undo send (seconds)', undoSendHint: '“Publish now” waits this long, with an Undo button. 0 publishes straight away.',
    aiLegend: 'AI voice', aiEnabled: 'Enable AI writing help', aiTone: 'Default tone', aiBrandVoice: 'Brand voice', aiBrandVoiceHint: 'A sentence or two about how this client sounds.',
    aiAvoidWords: 'Words to avoid', aiAvoidWordsHint: 'Separated by commas.',
    moderationLegend: 'Moderation', watchNegativeComments: 'Alert me when negative comments spike',
    confirmation: 'Type this confirmation to save', save: 'Save workspace operations', saving: 'Saving…', saved: 'Workspace operations saved.',
    unconfirmed: 'The outcome is unconfirmed. Refresh before trying again.', unavailable: 'Workspace operations are unavailable. Refresh the page or try again later.',
    spacingWarning: 'The same content will reach 3 or more channels of one network at the same time. Consider scheduling some of them at least {minutes} minutes apart.',
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
  fr: {
    confirmationConsequence: 'Appliquer ces paramètres à cet espace. Cela affecte ses prochaines activités.',
    panelTitle: 'Fonctionnement de l’espace', panelDetail: 'Heures de publication, balisage des liens, espacement, annulation, voix de l’IA et modération pour cet espace.',
    hoursLegend: 'Heures de publication et règles de file', weekStartsOn: 'Premier jour de la semaine', weekStartsOnHint: 'La première colonne du calendrier, pour tous les membres de cet espace.',
    businessHours: 'Heures d’ouverture', businessFrom: 'De', businessTo: 'à', businessHoursHint: 'Jours et heures selon l’horloge de l’espace. Ne cochez aucun jour pour compter toutes les heures.',
    bestTimeMode: 'Meilleurs moments par canal', bestTimeSuggest: 'Les suggérer dans l’éditeur', bestTimeApply: 'Les privilégier lors de l’ajout à la file',
    linksLegend: 'Liens', utmSource: 'Source UTM', utmMedium: 'Support UTM', utmCampaign: 'Campagne UTM', utmHint: 'Ajouté aux liens de vos publications pour attribuer le trafic. La campagne accepte {date}, {month}, {year} et {target}. Laissez vide pour publier les liens tels quels. Les publications enregistrées gardent les liens d’origine.',
    shortenLinks: 'Raccourcir les liens', shortenHint: 'Remplace les liens par des liens courts que vous contrôlez, afin de compter les clics.',
    spacingLegend: 'Espacement et annulation', spacingOnlyLegend: 'Espacement', panelLiveDetail: 'Balisage des liens appliqué à la publication, et avertissement d’espacement dans l’éditeur.', spamGap: 'Écart entre canaux pour un même contenu (minutes)', spamGapHint: 'L’éditeur prévient quand une même publication toucherait 3 canaux ou plus d’un même réseau en même temps. 0 désactive l’avertissement.',
    undoSend: 'Annulation de l’envoi (secondes)', undoSendHint: '« Publier maintenant » attend ce délai, avec un bouton Annuler. 0 publie tout de suite.',
    aiLegend: 'Voix de l’IA', aiEnabled: 'Activer l’aide à la rédaction', aiTone: 'Ton par défaut', aiBrandVoice: 'Voix de la marque', aiBrandVoiceHint: 'Une ou deux phrases décrivant le ton de ce client.',
    aiAvoidWords: 'Mots à éviter', aiAvoidWordsHint: 'Séparés par des virgules.',
    moderationLegend: 'Modération', watchNegativeComments: 'M’alerter quand les commentaires négatifs augmentent',
    confirmation: 'Saisissez cette confirmation pour enregistrer', save: 'Enregistrer le fonctionnement de l’espace', saving: 'Enregistrement…', saved: 'Fonctionnement de l’espace enregistré.',
    unconfirmed: 'Le résultat n’est pas confirmé. Actualisez avant de réessayer.', unavailable: 'Le fonctionnement de l’espace est indisponible. Actualisez la page ou réessayez plus tard.',
    spacingWarning: 'Le même contenu touchera 3 canaux ou plus d’un même réseau au même moment. Pensez à en programmer certains à au moins {minutes} minutes d’écart.',
    days: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'], dayNames: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  },
} as const;
export type WorkspaceOperationsCopy = typeof workspaceOperationsCopy.en;
