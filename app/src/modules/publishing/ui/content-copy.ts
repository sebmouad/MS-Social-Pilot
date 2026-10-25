import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { bilingualCatalogSchema } from './kit/copy-schema';

type Message = { en: string; fr: string };
const m = (en: string, fr: string): Message => ({ en, fr });

/**
 * Customer copy of the Create composer and the Content area (design v2 B2/B3). One flat catalog, English and French,
 * edited in Root under `publishing.contentCopy`. Named placeholders such as {count} must stay in every edit.
 */
export const contentCopyDefaults = {
  // ---- Create: sheet, channels, text, media ----
  createTitle: m('New post', 'Nouvelle publication'),
  createClose: m('Close', 'Fermer'),
  createCloseTitle: m('Leave without saving?', 'Quitter sans enregistrer ?'),
  createCloseBody: m('Your changes are not saved yet. Save them as a draft, or leave and lose them.', 'Vos modifications ne sont pas encore enregistrées. Enregistrez-les en brouillon, ou quittez et perdez-les.'),
  createCloseSave: m('Save draft and leave', 'Enregistrer le brouillon et quitter'),
  createCloseDiscard: m('Leave without saving', 'Quitter sans enregistrer'),
  createCloseStay: m('Keep editing', 'Continuer à modifier'),
  createTabEdit: m('Edit', 'Modifier'),
  createTabPreview: m('Preview', 'Aperçu'),
  createChannels: m('Channels', 'Canaux'),
  createChannelsInfo: m('Choose where this post goes. You can save a draft without a channel, but scheduling needs at least one.', 'Choisissez où va cette publication. Vous pouvez enregistrer un brouillon sans canal, mais la programmation en demande au moins un.'),
  createChannelsNone: m('No channel can publish yet. Connect or reconnect one in Settings.', 'Aucun canal ne peut publier pour le moment. Connectez-en ou reconnectez-en un dans les réglages.'),
  createChannelBlocked: m('{name} needs to be reconnected before it can publish.', '{name} doit être reconnecté avant de pouvoir publier.'),
  createReconnect: m('Reconnect', 'Reconnecter'),
  createChannelsSelected: m('{count} selected', '{count} sélectionné(s)'),
  createText: m('Post text', 'Texte de la publication'),
  createTextPlaceholder: m('What do you want to share?', 'Que voulez-vous partager ?'),
  createCounter: m('{used} / {max}', '{used} / {max}'),
  createMedia: m('Media', 'Médias'),
  createDrop: m('Drop photos here, or add a video link', 'Déposez des photos ici, ou ajoutez un lien vidéo'),
  createDropActive: m('Release to add', 'Relâchez pour ajouter'),
  createUpload: m('Upload', 'Téléverser'),
  createFromLibrary: m('From library', 'Depuis la bibliothèque'),
  createLibraryTitle: m('Choose from your library', 'Choisir dans votre bibliothèque'),
  createLibraryHint: m('Select the images to add to this post.', 'Sélectionnez les images à ajouter à cette publication.'),
  createLibraryLoading: m('Loading images…', 'Chargement des images…'),
  createLibraryEmpty: m('Your library has no images yet. Upload one with the Upload button.', 'Votre bibliothèque ne contient pas encore d’images. Téléversez-en une avec le bouton Téléverser.'),
  createLibraryError: m('The library could not be loaded. Try again.', 'La bibliothèque n’a pas pu être chargée. Réessayez.'),
  createLibraryMore: m('Load more', 'Charger plus'),
  createLibraryAdd: m('Add selected ({count})', 'Ajouter la sélection ({count})'),
  createLibraryImage: m('Image {name}', 'Image {name}'),
  createFirstCommentAdd: m('Add a first comment', 'Ajouter un premier commentaire'),
  createFirstCommentHide: m('Remove the first comment', 'Retirer le premier commentaire'),
  createAdvanced: m('More options', 'Plus d’options'),
  createAdvancedFormats: m('Format for each channel', 'Format pour chaque canal'),
  createAdvancedLabel: m('Label', 'Étiquette'),
  createAdvancedNoLabel: m('No label', 'Aucune étiquette'),
  createTemplates: m('Templates', 'Modèles'),
  // ---- Create: action bar ----
  createStatusNeedContent: m('Add text, media or a link to continue', 'Ajoutez du texte, un média ou un lien pour continuer'),
  createStatusReady: m('Ready when you are', 'Prêt quand vous l’êtes'),
  createStatusSaving: m('Saving draft…', 'Enregistrement du brouillon…'),
  createStatusSaved: m('Draft saved {time}', 'Brouillon enregistré à {time}'),
  createStatusAutosaveFailed: m('Could not save automatically. Your text is still here.', 'Enregistrement automatique impossible. Votre texte est toujours là.'),
  createActionBar: m('Post actions', 'Actions de la publication'),
  createSaveDraft: m('Save draft', 'Enregistrer le brouillon'),
  createSchedule: m('Schedule', 'Programmer'),
  createHookScore: m('Score the opening line', 'Évaluer l’accroche'),
  createGridPreview: m('Grid preview', 'Aperçu en grille'),
  calendarBestTimes: m('Best times', 'Meilleurs créneaux'),
  calendarBestTimesNote: m('Shades hours where your past posts did better than usual, from stored post results.', 'Colore les heures où vos publications passées ont mieux marché que d’habitude, d’après les résultats enregistrés.'),
  calendarBestTimesPeak: m('Strong', 'Fort'),
  createHookLength: m('Opening line: {n} characters (visible before "See more" up to about {max})', 'Première ligne : {n} caractères (visible avant « Voir plus » jusqu’à environ {max})'),
  createHookQuestion: m('Asks a question that invites comments', 'Pose une question qui invite aux commentaires'),
  createHookHashtags: m('{n} hashtags (up to {max} reads well)', '{n} hashtags (jusqu’à {max} reste lisible)'),
  createHookDismiss: m('Close', 'Fermer'),
  createHookPass: m('Passes', 'Validé'),
  createHookFail: m('To improve', 'À améliorer'),
  createHookRewrite: m('Suggest a stronger opening line', 'Proposer une meilleure accroche'),
  createHookApply: m('Use it', 'Utiliser'),
  createHookRewriteFailed: m('No suggestion this time. Try again.', 'Pas de suggestion cette fois. Réessayez.'),
  createGridNote: m('This post next to your latest published posts on the selected channels.', 'Cette publication à côté de vos dernières publications sur les canaux choisis.'),
  createGridThisPost: m('This post', 'Cette publication'),
  createGridNoMedia: m('No image', 'Sans image'),
  createGridEmpty: m('No published posts yet on the selected channels.', 'Aucune publication pour l’instant sur les canaux choisis.'),
  createScheduleFor: m('Schedule for {when}', 'Programmer pour le {when}'),
  createScheduleEllipsis: m('Schedule…', 'Programmer…'),
  createPublishNow: m('Publish now', 'Publier maintenant'),
  createQueue: m('Add to queue', 'Ajouter à la file'),
  createQueueAt: m('Add to queue · {when}', 'Ajouter à la file · {when}'),
  createQueueFull: m('Add to queue (no free time)', 'Ajouter à la file (aucun créneau libre)'),
  createQueueLoading: m('Add to queue (checking times…)', 'Ajouter à la file (recherche de créneaux…)'),
  createQueueRetry: m('Add to queue: times could not be checked, try again', 'Ajouter à la file : créneaux non vérifiables, réessayer'),
  createQueueNeedChannel: m('Add to queue (choose a channel first)', 'Ajouter à la file (choisissez d’abord un canal)'),
  createMoreWays: m('More ways to publish', 'Autres façons de publier'),
  createWorking: m('Saving…', 'Enregistrement…'),
  createUploading: m('Uploading…', 'Téléversement…'),
  // ---- Create: schedule popover and publish-now confirmation ----
  createPickTime: m('Pick a time', 'Choisir une heure'),
  createDate: m('Date', 'Date'),
  createTime: m('Time', 'Heure'),
  createZone: m('Times use {zone}.', 'Les heures utilisent le fuseau {zone}.'),
  createSetTime: m('Use this time', 'Utiliser cette heure'),
  createClearTime: m('Clear time', 'Effacer l’heure'),
  createNeedTime: m('Choose a date and a time to schedule.', 'Choisissez une date et une heure pour programmer.'),
  createPublishTitle: m('Publish now?', 'Publier maintenant ?'),
  createPublishBody: m('This post goes to {count} channel(s) within about a minute. You can still cancel it from Content while it waits.', 'Cette publication part vers {count} canal(aux) dans environ une minute. Vous pouvez encore l’annuler depuis Contenu tant qu’elle attend.'),
  createPublishGo: m('Publish now', 'Publier maintenant'),
  createPublishCancel: m('Cancel', 'Annuler'),
  createPublishNeedChannel: m('Choose at least one channel to publish.', 'Choisissez au moins un canal pour publier.'),
  createPreviewTitle: m('Preview', 'Aperçu'),
  createPreviewChannel: m('Previewing {name}', 'Aperçu pour {name}'),
  createPreviewInfo: m('A neutral preview. Each channel may show your post a little differently.', 'Un aperçu neutre. Chaque canal peut afficher votre publication un peu différemment.'),
  createPreviewAll: m('All channels', 'Tous les canaux'),
  createPreviewSeeMore: m('See more', 'Voir plus'),
  createPreviewSeeLess: m('See less', 'Voir moins'),
  createPreviewNoCaption: m('This format shows no caption — only the media will appear.', 'Ce format n’affiche pas de légende — seul le média paraîtra.'),
  createPreviewNoFirstComment: m('This format cannot carry a first comment.', 'Ce format ne peut pas porter de premier commentaire.'),
  createPreviewEmptyComment: m('The first comment will appear here.', 'Le premier commentaire apparaîtra ici.'),
  createPreviewApprox: m('Channel previews are approximate; each channel may show this differently.', 'Les aperçus par canal sont approximatifs ; chaque canal peut afficher ceci différemment.'),
  createPreviewNeutral: m('No channel preview is available; showing the neutral preview.', 'Aucun aperçu de canal disponible ; aperçu neutre affiché.'),
  createOpenContent: m('Check Content', 'Vérifier dans Contenu'),
  // ---- Content: shared ----
  contentArea: m('Content', 'Contenu'),
  contentFilterStatus: m('Status', 'Statut'),
  contentFilterAnyStatus: m('Any status', 'Tous les statuts'),
  contentFilterOrigin: m('Created by', 'Créée par'),
  contentFilterAnyOrigin: m('Anyone', 'Tout le monde'),
  contentFilterViews: m('Saved views', 'Vues enregistrées'),
  contentFilterClear: m('Clear filters', 'Effacer les filtres'),
  contentSearch: m('Search posts', 'Rechercher des publications'),
  contentSearchPlaceholder: m('Search text or first comment', 'Rechercher dans le texte ou le premier commentaire'),
  contentSearchGo: m('Search', 'Rechercher'),
  contentCountOne: m('{count} post', '{count} publication'),
  contentCount: m('{count} posts', '{count} publications'),
  contentChannelUnavailable: m('The selected channel is not available any more, so nothing is shown for it.', 'Le canal sélectionné n’est plus disponible, donc rien n’est affiché pour lui.'),
  // ---- Content › Posts ----
  postsInfo: m('Find any post and act on it. Select a row to see how it will look and what happened on each channel.', 'Retrouvez n’importe quelle publication et agissez dessus. Sélectionnez une ligne pour voir son aspect et ce qui s’est passé sur chaque canal.'),
  postsExport: m('Export', 'Exporter'),
  postsExportTitle: m('Export posts', 'Exporter les publications'),
  postsPanelOpen: m('Open {name}', 'Ouvrir {name}'),
  postsPanelTitle: m('Post', 'Publication'),
  postsPanelClose: m('Close post', 'Fermer la publication'),
  postsPanelDestinations: m('Where it goes', 'Où elle est publiée'),
  postsPanelNoDestinations: m('No channel chosen yet.', 'Aucun canal choisi pour le moment.'),
  postsPanelDetails: m('Open full details', 'Ouvrir tous les détails'),
  postsPanelActions: m('Actions', 'Actions'),
  postsPanelEdit: m('Edit, duplicate, reschedule or delete', 'Modifier, dupliquer, reprogrammer ou supprimer'),
  postsPanelFirstComment: m('First comment', 'Premier commentaire'),
  postsPanelUncertain: m('We could not confirm this post was published. Check the channel, then record what you see.', 'Nous n’avons pas pu confirmer que cette publication est en ligne. Vérifiez le canal, puis indiquez ce que vous voyez.'),
  postsRowAttention: m('Needs attention', 'À vérifier'),
  postsMissing: m('That post is not available. It may have been deleted, or you may not have access to it.', 'Cette publication n’est pas disponible. Elle a peut-être été supprimée, ou vous n’y avez pas accès.'),
  postsRows: m('Posts', 'Publications'),
  postsOpenRow: m('Open post: {text}', 'Ouvrir la publication : {text}'),
  // ---- Content › Calendar ----
  calendarInfo: m('See what is planned and published. Drag a post to move it, or use Move in its menu.', 'Voyez ce qui est prévu et publié. Faites glisser une publication pour la déplacer, ou utilisez Déplacer dans son menu.'),
  calendarToolbar: m('Calendar navigation', 'Navigation du calendrier'),
  calendarFreeSlot: m('Free slot {time}', 'Créneau libre {time}'),
  calendarFreeSlotLabel: m('Create a post for {day} at {time}', 'Créer une publication pour le {day} à {time}'),
  calendarMore: m('+{count} more', '+{count} de plus'),
  calendarDayPosts: m('Posts on {day}', 'Publications du {day}'),
  calendarMoreCalendars: m('More calendars', 'Autres calendriers'),
  calendarViewList: m('List', 'Liste'),
  calendarWeekTimeline: m('Timeline', 'Chronologie'),
  calendarWeekLanes: m('By channel', 'Par canal'),
  calendarLanesLabel: m('Week layout', 'Disposition de la semaine'),
  calendarNoChannel: m('No channel', 'Aucun canal'),
  calendarLanePostsOne: m('{count} post', '{count} publication'),
  calendarLanePosts: m('{count} posts', '{count} publications'),
  calendarQuietHours: m('Quiet hours {start}–{end}: automatic sends pause then. Scheduled posts still go out.', 'Heures silencieuses {start}–{end} : les envois automatiques sont en pause. Les publications programmées partent quand même.'),
  calendarQuietLegend: m('Shaded hours are autopilot quiet hours', 'Les heures ombrées sont les heures silencieuses du pilote automatique'),
  calendarCapReached: m('Daily automatic-send cap reached ({count}/{cap}). Further automatic sends wait for tomorrow; scheduled posts still go out.', 'Plafond quotidien d’envois automatiques atteint ({count}/{cap}). Les prochains envois automatiques attendront demain ; les publications programmées partent quand même.'),
  // ---- Content › Queue ----
  queueInfo: m('Posts wait here in order and go out in the next free time. Change the weekly times on the right.', 'Les publications attendent ici dans l’ordre et partent au prochain créneau libre. Modifiez les créneaux hebdomadaires à droite.'),
  queueNext: m('Next in queue', 'Prochaines de la file'),
  queueNextEmpty: m('Nothing is waiting. Add a post to the queue from Create.', 'Rien n’attend. Ajoutez une publication à la file depuis Créer.'),
  queueAdd: m('Add to queue', 'Ajouter à la file'),
  queueTimesTitle: m('Queue times', 'Créneaux de la file'),
  queueTimesInfo: m('The weekly times when queued posts go out, in the workspace time zone.', 'Les créneaux hebdomadaires où partent les publications de la file, dans le fuseau de l’espace de travail.'),
  queueTimesUnavailable: m('Queue times are not available for your role.', 'Les créneaux de la file ne sont pas disponibles pour votre rôle.'),
  queueAutomation: m('Automation', 'Automatisation'),
  // ---- Content › Approvals ----
  approvalsInfo: m('Review posts before they go live. Approve to schedule them, or request changes with a note.', 'Relisez les publications avant leur mise en ligne. Approuvez pour les programmer, ou demandez des modifications avec une note.'),
  approvalsKeys: m('Select a card, then press A to jump to Approve or R to request changes.', 'Sélectionnez une carte, puis appuyez sur A pour aller à Approuver ou sur R pour demander des modifications.'),
  approvalsApprove: m('Approve', 'Approuver'),
  approvalsRequest: m('Request changes', 'Demander des modifications'),
  approvalsOpen: m('Review', 'Relire'),
  approvalsSubmittedBy: m('Submitted by {name}', 'Soumise par {name}'),
  approvalsNoteLabel: m('Note for the author (optional)', 'Note pour l’auteur (facultatif)'),
  approvalsBoardLabel: m('Approval pipeline', 'Circuit d’approbation'),
  approvalsStageDraft: m('Draft', 'Brouillon'),
  approvalsStageReview: m('In review', 'En relecture'),
  approvalsStageApproved: m('Approved', 'Approuvé'),
  approvalsStageScheduled: m('Scheduled', 'Programmé'),
  approvalsDraftEmpty: m('No drafts waiting.', 'Aucun brouillon en attente.'),
  approvalsReviewEmpty: m('Nothing waiting for review.', 'Rien en attente de relecture.'),
  approvalsApprovedEmpty: m('No approved posts waiting for a time.', 'Aucune publication approuvée en attente d’horaire.'),
  approvalsScheduledEmpty: m('Nothing scheduled.', 'Rien de programmé.'),
  approvalsViewAllCount: m('View all {count} in Posts', 'Tout voir ({count}) dans les publications'),
  approvalsOpenPost: m('Open post', 'Ouvrir la publication'),
  approvalsNotesUnavailable: m('Comments could not be loaded.', 'Les commentaires n’ont pas pu être chargés.'),
  approvalsApprovedBy: m('Approved by {name}', 'Approuvé par {name}'),
  // ---- Content › Library ----
  libraryTitle: m('Library', 'Bibliothèque'),
  libraryNav: m('Library sections', 'Sections de la bibliothèque'),
  libraryMedia: m('Media', 'Médias'),
  libraryTemplates: m('Templates', 'Modèles'),
  libraryLabels: m('Labels', 'Étiquettes'),
  libraryFields: m('Fields', 'Champs'),
  libraryFeeds: m('Feeds', 'Flux'),
  libraryInfoMedia: m('Browse, search, import and clean up the images and videos your posts use.', 'Parcourez, recherchez, importez et nettoyez les images et vidéos utilisées par vos publications.'),
  libraryInfoTemplates: m('Create and reuse workspace post templates.', 'Créez et réutilisez des modèles de publication de l’espace de travail.'),
  libraryInfoLabels: m('Organize workspace content with shared labels.', 'Organisez le contenu de l’espace de travail avec des étiquettes partagées.'),
  libraryInfoFields: m('Custom fields, queue times and content mix for your posts and team.', 'Champs personnalisés, créneaux de la file et mix de contenu pour vos publications et votre équipe.'),
  libraryInfoFeeds: m('Turn new articles from a website feed into posts for your channels.', 'Transformez les nouveaux articles d’un flux de site web en publications pour vos canaux.'),
  // ---- Content › Post details ----
  postDetailInfo: m('Labels, notes, custom fields and version history for this post.', 'Étiquettes, notes, champs personnalisés et historique des versions de cette publication.'),
  postDetailBack: m('Back to posts', 'Retour aux publications'),
  postDetailEdit: m('Open in Create', 'Ouvrir dans Créer'),
} as const satisfies Record<string, Message>;

export type ContentCopyKey = keyof typeof contentCopyDefaults;
export type ContentCopy = Record<ContentCopyKey, string>;
export const contentCopySchema = bilingualCatalogSchema(contentCopyDefaults as unknown as Record<string, Message>);

/** The catalog resolved to one language. */
export function resolveContentCopy(catalog: Record<string, Message>, locale: 'en' | 'fr'): ContentCopy {
  return Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, value[locale]])) as ContentCopy;
}

const placeholdersOf = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join('|');
const savedMessage = (value: unknown, shipped: Message): Message | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { en, fr } = value as Record<string, unknown>;
  if (typeof en !== 'string' || !en || typeof fr !== 'string' || !fr) return undefined;
  if (placeholdersOf(en) !== placeholdersOf(shipped.en) || placeholdersOf(fr) !== placeholdersOf(shipped.fr)) return undefined;
  return { en, fr };
};

/**
 * Stored `publishing.contentCopy` catalogs outlive copy additions: merge the saved entries over the
 * shipped catalog instead of rejecting the whole catalog. Unknown keys and invalid values are dropped,
 * saved customizations are kept, and shipped text fills every gap (including keys added after the
 * catalog was saved). Root saves stay strict; this is the read path only.
 */
export function resolveContentCatalog(saved: unknown): Record<string, Message> {
  const stored = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(contentCopyDefaults).map(([key, shipped]) => [key, savedMessage(stored[key], shipped) ?? shipped]));
}

/** Same merge for the behaviour policy: saved fields that still validate are kept, gaps use shipped defaults. */
export function resolveContentPolicy(saved: unknown): ContentPolicy {
  const stored = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const shape = contentPolicySchema.shape;
  return Object.fromEntries(Object.entries(contentPolicyDefaults).map(([key, fallback]) => {
    const parsed = (shape as Record<string, z.ZodTypeAny>)[key]?.safeParse(stored[key]);
    return [key, parsed?.success ? parsed.data : fallback];
  })) as ContentPolicy;
}

/** Fills named placeholders such as {count}; an unknown name stays visible instead of vanishing. */
export const fillContent = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));

/** Behaviour of Create and Content that Root can tune. Nothing here is customer-visible text. */
export const contentPolicySchema = z.object({
  publishNowLeadMinutes: z.number().int().min(1).max(60),
  monthPostsShown: z.number().int().min(1).max(10),
  freeSlotsPerDay: z.number().int().min(0).max(10),
  libraryPickerMaxSelect: z.number().int().min(1).max(50),
  reconnectHref: z.string().regex(/^\/[A-Za-z0-9/_-]*$/),
  pipelinePerStage: z.number().int().min(1).max(20),
}).strict();
export type ContentPolicy = z.infer<typeof contentPolicySchema>;
export const contentPolicyDefaults: ContentPolicy = {
  publishNowLeadMinutes: 2,
  monthPostsShown: 3,
  freeSlotsPerDay: 3,
  libraryPickerMaxSelect: 10,
  reconnectHref: '/settings/channels',
  pipelinePerStage: 6,
};

export const CONTENT_CONFIG = [
  entry({ key: 'publishing.contentCopy', group: 'Publishing · Copy', label: 'Create and Content customer copy', kind: 'json', description: 'English and French text of the full-screen Create composer and the Content area (Posts, Calendar, Queue, Approvals, Library). Keep named placeholders such as {count}.', defaultValue: contentCopyDefaults, schema: contentCopySchema, consumption: 'active' }),
  entry({ key: 'publishing.contentPolicy', group: 'Publishing · Content', label: 'Create and Content behaviour', kind: 'json', description: 'Minutes before "Publish now" goes out, posts shown per month-calendar day, free queue slots shown per day, images selectable at once from the library, posts shown per approval-pipeline stage and the reconnect page.', defaultValue: contentPolicyDefaults, schema: contentPolicySchema, consumption: 'active' }),
] as const;
