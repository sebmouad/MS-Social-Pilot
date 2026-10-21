import { bilingualCatalogSchema } from './ui/kit/copy-schema';
import { entry } from '@/lib/config/entry';

/** Plain text templates: placeholders are filled only at display time. */
export const composerCatalogDefaults = {
  "composer_stepLabel": {
    "en": "Step {n}",
    "fr": "Étape {n}"
  },
  "composer_destinations": {
    "en": "Destinations",
    "fr": "Destinations"
  },
  "composer_destinationsHelp": {
    "en": "Choose channels in the sidebar. Drafts can be saved without one; scheduling needs at least one.",
    "fr": "Choisissez les canaux dans la barre latérale. Un brouillon peut être enregistré sans canal ; la programmation en demande au moins un."
  },
  "composer_noDestination": {
    "en": "No destination chosen yet.",
    "fr": "Aucune destination choisie pour le moment."
  },
  "composer_formatLabel": {
    "en": "Format: {name}",
    "fr": "Format : {name}"
  },
  "composer_content": {
    "en": "Content",
    "fr": "Contenu"
  },
  "composer_media": {
    "en": "Media",
    "fr": "Médias"
  },
  "composer_firstComment": {
    "en": "First comment",
    "fr": "Premier commentaire"
  },
  "composer_scheduling": {
    "en": "Scheduling",
    "fr": "Programmation"
  },
  "composer_schedulingHelp": {
    "en": "Times use {zone}. Leave the date empty to save a draft.",
    "fr": "Les heures utilisent le fuseau {zone}. Laissez la date vide pour enregistrer un brouillon."
  },
  "composer_date": {
    "en": "Date",
    "fr": "Date"
  },
  "composer_time": {
    "en": "Time",
    "fr": "Heure"
  },
  "composer_whoSends": {
    "en": "Who sends the post at that time",
    "fr": "Qui envoie la publication à ce moment"
  },
  "composer_holdApp": {
    "en": "We publish at the time",
    "fr": "Nous publions à l’heure choisie"
  },
  "composer_holdAppHint": {
    "en": "The post stays in this app until then and can still be edited.",
    "fr": "La publication reste dans cette application jusque-là et peut encore être modifiée."
  },
  "composer_holdPlatform": {
    "en": "Sent now to {name}",
    "fr": "Envoyée maintenant à {name}"
  },
  "composer_holdPlatformHint": {
    "en": "{name} publishes it at the chosen time, even if we are offline. To change it, cancel the schedule and schedule again.",
    "fr": "{name} la publie à l’heure choisie, même si nous sommes hors ligne. Pour la modifier, annulez la programmation puis reprogrammez."
  },
  "composer_perDestination": {
    "en": "Choose for each destination",
    "fr": "Choisir pour chaque destination"
  },
  "composer_sameAsAbove": {
    "en": "Same as above",
    "fr": "Comme ci-dessus"
  },
  "composer_destinationApp": {
    "en": "We publish at the time.",
    "fr": "Nous publions à l’heure choisie."
  },
  "composer_destinationPlatform": {
    "en": "Sent now to {name}; it publishes at the time even if we are offline.",
    "fr": "Envoyée maintenant à {name} ; elle est publiée à l’heure choisie même si nous sommes hors ligne."
  },
  "composer_destinationAppOnly": {
    "en": "We publish at the time (this destination cannot hold a schedule itself).",
    "fr": "Nous publions à l’heure choisie (cette destination ne peut pas conserver elle-même la programmation)."
  },
  "composer_autosaveSaved": {
    "en": "Draft saved {time}",
    "fr": "Brouillon enregistré à {time}"
  },
  "composer_autosaveSaving": {
    "en": "Saving draft…",
    "fr": "Enregistrement du brouillon…"
  },
  "composer_autosaveFailed": {
    "en": "Autosave paused. Your text is still here; use Save draft to keep it.",
    "fr": "Enregistrement automatique en pause. Votre texte est toujours là ; utilisez Enregistrer le brouillon pour le conserver."
  },
  "composer_autosaveOn": {
    "en": "Drafts save automatically while you write.",
    "fr": "Les brouillons s’enregistrent automatiquement pendant que vous écrivez."
  },
  "composer_platformFallback": {
    "en": "the platform",
    "fr": "la plateforme"
  },
  "queue_retryPreview": {
    "en": "Refresh queue times",
    "fr": "Actualiser les créneaux"
  },
  "queue_opening": {
    "en": "Opening Posts…",
    "fr": "Ouverture des publications…"
  },
  "queue_viewSaved": {
    "en": "View saved posts",
    "fr": "Voir les publications enregistrées"
  },
  "queue_retained": {
    "en": "Your post details are still here.",
    "fr": "Vos données sont conservées."
  },
  "queue_retry": {
    "en": "You can retry.",
    "fr": "Vous pouvez réessayer."
  },
  "queue_checkPosts": {
    "en": "Check Posts in a new tab",
    "fr": "Vérifier les publications dans un nouvel onglet"
  },
  "queue_savedDraft": {
    "en": "Saved as a draft, but the queue placement could not be confirmed. Check Posts before retrying. Your input is retained.",
    "fr": "Brouillon enregistré, mais l’ajout à la file n’a pas pu être confirmé. Vérifiez les publications avant de réessayer. Vos données sont conservées."
  },
  "queue_saveFailed": {
    "en": "The post could not be saved. Check your destinations, attachments and permissions, then retry.",
    "fr": "La publication n’a pas pu être enregistrée. Vérifiez les destinations, pièces jointes et autorisations, puis réessayez."
  },
  "queue_button": {
    "en": "Add to queue",
    "fr": "Ajouter à la file"
  },
  "queue_legend": {
    "en": "Queue",
    "fr": "File d’attente"
  },
  "queue_hint": {
    "en": "Takes the next free saved queue time for the selected destinations.",
    "fr": "Utilise le prochain créneau libre de la file pour les destinations choisies."
  },
  "queue_chooseDestination": {
    "en": "Choose a destination to see its next queue time.",
    "fr": "Choisissez une destination pour voir son prochain créneau."
  },
  "queue_loading": {
    "en": "Finding the next queue time…",
    "fr": "Recherche du prochain créneau…"
  },
  "queue_next": {
    "en": "Next queue time: {time}",
    "fr": "Prochain créneau : {time}"
  },
  "queue_full": {
    "en": "No queue time is free. Change the queue timetable or schedule a specific time.",
    "fr": "Aucun créneau libre. Modifiez les horaires de la file ou programmez une heure précise."
  },
  "queue_unavailable": {
    "en": "The next queue time is not available.",
    "fr": "Le prochain créneau n’est pas disponible."
  },
  "queue_channelLine": {
    "en": "{name}: {time}",
    "fr": "{name} : {time}"
  },
  "queue_channelFull": {
    "en": "{name}: Not available",
    "fr": "{name} : non disponible"
  },
  "queue_estimate": {
    "en": "The exact time is confirmed when you add the post.",
    "fr": "L’heure exacte est confirmée à l’ajout de la publication."
  },
  "queue_added": {
    "en": "Added to the queue for {time}.",
    "fr": "Ajoutée à la file pour le {time}."
  },
  "queue_addedApproval": {
    "en": "Added to the queue for {time}. It still needs approval before it can publish.",
    "fr": "Ajoutée à la file pour le {time}. Elle doit encore être approuvée avant d’être publiée."
  },
  "queue_needDestination": {
    "en": "Choose at least one destination before adding to the queue.",
    "fr": "Choisissez au moins une destination avant d’ajouter à la file."
  },
  "remote_legend": {
    "en": "Where to hold the schedule",
    "fr": "Où conserver la programmation"
  },
  "remote_application": {
    "en": "In the app",
    "fr": "Dans l’application"
  },
  "remote_applicationHint": {
    "en": "We publish at the chosen time. You can still edit the post until then.",
    "fr": "Nous publions à l’heure choisie. Vous pouvez encore modifier la publication jusque-là."
  },
  "remote_remote": {
    "en": "On the platform",
    "fr": "Sur la plateforme"
  },
  "remote_remoteHint": {
    "en": "The post is sent now and the platform publishes it at the chosen time, even if this app is offline. To change its content you cancel the schedule and schedule again.",
    "fr": "La publication est envoyée maintenant et la plateforme la publie à l’heure choisie, même si cette application est hors ligne. Pour modifier son contenu, annulez la programmation puis reprogrammez."
  },
  "remote_window": {
    "en": "Allowed between {min} and {max} ahead.",
    "fr": "Possible entre {min} et {max} à l’avance."
  },
  "remote_appOnly": {
    "en": "Published by the app instead: {names}.",
    "fr": "Publié par l’application à la place : {names}."
  },
  "remote_perDestination": {
    "en": "Choose for each destination",
    "fr": "Choisir pour chaque destination"
  },
  "remote_perDestinationHint": {
    "en": "Each destination can hold its schedule in the app or on its platform.",
    "fr": "Chaque destination peut conserver sa programmation dans l’application ou sur sa plateforme."
  },
  "remote_sameAsAbove": {
    "en": "Same as above",
    "fr": "Comme ci-dessus"
  },
  "remote_minutes": {
    "en": "{n} minutes",
    "fr": "{n} minutes"
  },
  "remote_hours": {
    "en": "{n} hours",
    "fr": "{n} heures"
  },
  "remote_days": {
    "en": "{n} days",
    "fr": "{n} jours"
  },
  "version_title": {
    "en": "Version history",
    "fr": "Historique des versions"
  },
  "version_saved": {
    "en": "Saved",
    "fr": "Enregistrée"
  },
  "version_by": {
    "en": "By",
    "fr": "Par"
  },
  "version_text": {
    "en": "Text",
    "fr": "Texte"
  },
  "version_actions": {
    "en": "Actions",
    "fr": "Actions"
  },
  "version_restore": {
    "en": "Restore",
    "fr": "Restaurer"
  },
  "version_refresh": {
    "en": "Review again",
    "fr": "Vérifier à nouveau"
  },
  "version_review": {
    "en": "Review restore",
    "fr": "Vérifier la restauration"
  },
  "version_apply": {
    "en": "Restore version",
    "fr": "Restaurer la version"
  },
  "version_closest": {
    "en": "Restore closest valid version",
    "fr": "Restaurer la version valide la plus proche"
  },
  "version_cancel": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "version_confirm": {
    "en": "Confirm restore",
    "fr": "Confirmer la restauration"
  },
  "version_checking": {
    "en": "Checking…",
    "fr": "Vérification…"
  },
  "version_empty": {
    "en": "No earlier versions are stored for this post yet.",
    "fr": "Aucune version antérieure n’est enregistrée pour cette publication."
  },
  "version_unavailable": {
    "en": "Not available",
    "fr": "Non disponible"
  },
  "version_noText": {
    "en": "No text",
    "fr": "Aucun texte"
  },
  "version_description": {
    "en": "Restore saved content to the current destinations using available saved formats. The schedule and time zone stay unchanged. Nothing is published; current content stays in history. Usual checks and approvals apply.",
    "fr": "Restaurer le contenu enregistré vers les destinations actuelles avec les formats enregistrés disponibles. La programmation et le fuseau horaire restent inchangés. Rien n’est publié ; le contenu actuel reste dans l’historique. Les validations et approbations habituelles s’appliquent."
  },
  "version_changes": {
    "en": "What cannot be restored",
    "fr": "Éléments non restaurables"
  },
  "version_blocked": {
    "en": "No valid content remains. Edit the post to add text, a link or compatible media.",
    "fr": "Aucun contenu valide ne reste. Ajoutez du texte, un lien ou un média compatible à la publication."
  },
  "version_success": {
    "en": "Version restored.",
    "fr": "Version restaurée."
  },
  "version_approval": {
    "en": "Version restored. The post needs approval again.",
    "fr": "Version restaurée. La publication doit être approuvée à nouveau."
  },
  "version_failed": {
    "en": "The restore could not be verified. Check the current post and review again.",
    "fr": "La restauration n’a pas pu être vérifiée. Vérifiez la publication actuelle puis recommencez la vérification."
  },
  "version_destinations": {
    "en": "Destinations and formats",
    "fr": "Destinations et formats"
  },
  "version_media": {
    "en": "Media attachments",
    "fr": "Pièces jointes"
  },
  "version_comment": {
    "en": "First comment",
    "fr": "Premier commentaire"
  },
  "version_delay": {
    "en": "Delay (minutes)",
    "fr": "Délai (minutes)"
  },
  "screenTitle": {
    "en": "Create a post",
    "fr": "Créer une publication"
  },
  "screenDescription": {
    "en": "Choose destinations, write your post, then save a draft or schedule it.",
    "fr": "Choisissez les destinations, rédigez votre publication, puis enregistrez un brouillon ou programmez-la."
  },
  "noPermission": {
    "en": "You do not have permission to create posts in this workspace.",
    "fr": "Vous n’avez pas l’autorisation de créer des publications dans cet espace."
  },
  "authorFallback": {
    "en": "You",
    "fr": "Vous"
  },
  "transportFailure": {
    "en": "We could not confirm whether this post was saved. Check Posts before retrying.",
    "fr": "Nous n’avons pas pu confirmer l’enregistrement de cette publication. Vérifiez les publications avant de réessayer."
  },
  "ui_contentRequired": {
    "en": "Add post text, a link, or media before saving. A first comment alone is not a post.",
    "fr": "Ajoutez du texte, un lien ou un média avant d’enregistrer. Un premier commentaire seul ne constitue pas une publication."
  },
  "ui_invalidLink": {
    "en": "Enter a complete HTTPS URL without a username or password.",
    "fr": "Saisissez une URL HTTPS complète sans identifiant ni mot de passe."
  },
  "ui_needDestination": {
    "en": "Choose at least one destination before scheduling.",
    "fr": "Choisissez au moins une destination avant de programmer."
  },
  "ui_needTime": {
    "en": "Choose a date and time before scheduling.",
    "fr": "Choisissez une date et une heure avant de programmer."
  },
  "ui_fixAttachments": {
    "en": "Fix the attachment issues before saving.",
    "fr": "Corrigez les pièces jointes avant d’enregistrer."
  },
  "ui_reviewAttachments": {
    "en": "Review the destination attachment requirements before saving.",
    "fr": "Vérifiez les exigences des destinations pour les pièces jointes avant d’enregistrer."
  },
  "ui_uploadingImages": {
    "en": "Uploading images…",
    "fr": "Envoi des images…"
  },
  "ui_uploadPartial": {
    "en": "Some images could not be uploaded. Your order and descriptions are still here; fix the marked items and retry.",
    "fr": "Certaines images n’ont pas pu être envoyées. L’ordre et les descriptions sont conservés ; corrigez les éléments signalés puis réessayez."
  },
  "ui_uploadFailure": {
    "en": "We could not upload every image. Your post details are still here; try again.",
    "fr": "Certaines images n’ont pas pu être envoyées. Vos données sont conservées ; réessayez."
  },
  "ui_saved": {
    "en": "Post saved.",
    "fr": "Publication enregistrée."
  },
  "ui_savedPreview": {
    "en": "Saved post preview",
    "fr": "Aperçu de la publication enregistrée"
  },
  "ui_unsavedPreview": {
    "en": "Unsaved preview",
    "fr": "Aperçu non enregistré"
  },
  "ui_yourTeam": {
    "en": "Your team",
    "fr": "Votre équipe"
  },
  "ui_uploading": {
    "en": "Uploading…",
    "fr": "Envoi…"
  },
  "ui_opening": {
    "en": "Opening…",
    "fr": "Ouverture…"
  },
  "ui_saving": {
    "en": "Saving…",
    "fr": "Enregistrement…"
  },
  "ui_saveDraft": {
    "en": "Save draft",
    "fr": "Enregistrer le brouillon"
  },
  "ui_schedulePost": {
    "en": "Schedule post",
    "fr": "Programmer la publication"
  },
  "ui_uncategorized": {
    "en": "Uncategorized",
    "fr": "Sans catégorie"
  },
  "ui_postText": {
    "en": "Post text ",
    "fr": "Texte de la publication "
  },
  "ui_optionalContent": {
    "en": "(optional with a link or media)",
    "fr": "(facultatif avec un lien ou un média)"
  },
  "ui_attachments": {
    "en": "Attachments ",
    "fr": "Pièces jointes "
  },
  "ui_optional": {
    "en": "(optional)",
    "fr": "(facultatif)"
  },
  "ui_link": {
    "en": "Link ",
    "fr": "Lien "
  },
  "ui_attachmentSupport": {
    "en": "Attachment support depends on the selected destinations.",
    "fr": "La prise en charge des pièces jointes dépend des destinations choisies."
  },
  "ui_firstComment": {
    "en": "First comment ",
    "fr": "Premier commentaire "
  },
  "ui_commentDelay": {
    "en": "Wait before the first comment ",
    "fr": "Attente avant le premier commentaire "
  },
  "ui_delayHint": {
    "en": "(minutes; 0 sends it right after publication)",
    "fr": "(minutes ; 0 l’envoie juste après la publication)"
  },
  "ui_preview": {
    "en": "Preview",
    "fr": "Aperçu"
  },
  "ui_neutralPreview": {
    "en": "Neutral preview",
    "fr": "Aperçu neutre"
  },
  "ui_chooseTemplate": {
    "en": "Choose template",
    "fr": "Choisir un modèle"
  },
  "ui_destinations": {
    "en": "Destinations",
    "fr": "Destinations"
  },
  "ui_noDestinations": {
    "en": "No destinations are ready to publish right now.",
    "fr": "Aucune destination ne peut publier pour le moment."
  },
  "ui_draftHint": {
    "en": "Drafts can be saved without a destination. Scheduling needs at least one.",
    "fr": "Un brouillon peut être enregistré sans destination. La programmation en demande au moins une."
  },
  "ui_formats": {
    "en": "Formats",
    "fr": "Formats"
  },
  "ui_close": {
    "en": "Close",
    "fr": "Fermer"
  },
  "ui_templateLabel": {
    "en": "Using this template will apply its workspace label to the new post.",
    "fr": "Ce modèle appliquera son étiquette à la nouvelle publication."
  },
  "ui_useTemplate": {
    "en": "Use template",
    "fr": "Utiliser le modèle"
  },
  "ui_noTemplates": {
    "en": "No templates match this search.",
    "fr": "Aucun modèle ne correspond à cette recherche."
  },
  "ui_keepDraft": {
    "en": "Keep current draft",
    "fr": "Conserver le brouillon actuel"
  },
  "ui_replaceText": {
    "en": "Replace message and first comment",
    "fr": "Remplacer le texte et le premier commentaire"
  },
  "ui_templateTitle": {
    "en": "Choose a post template",
    "fr": "Choisir un modèle de publication"
  },
  "ui_templateDescription": {
    "en": "This copies saved message text, first comment and its delay into the current composer. It does not create or publish a post.",
    "fr": "Copie le texte, le premier commentaire et son délai dans le formulaire actuel. Aucune publication n’est créée ni publiée."
  },
  "ui_replaceTitle": {
    "en": "Replace the current draft text?",
    "fr": "Remplacer le texte du brouillon actuel ?"
  },
  "ui_replaceDescription": {
    "en": "The template will replace the current message, first comment and its delay. Your selected destinations, attachments, link and schedule stay as they are.",
    "fr": "Le modèle remplacera le texte, le premier commentaire et son délai. Les destinations, pièces jointes, lien et programmation restent inchangés."
  },
  "ui_delayRange": {
    "en": "Choose a whole number from 0 to {max} minutes.",
    "fr": "Choisissez un nombre entier entre 0 et {max} minutes."
  },
  "ui_delayApplies": {
    "en": "This applies only when a first comment is saved.",
    "fr": "Cela s’applique uniquement si un premier commentaire est enregistré."
  },
  "ui_noResponse": {
    "en": "no destination response is available yet",
    "fr": "aucune réponse des destinations n’est encore disponible"
  },
  "ui_schedulePreview": {
    "en": "Will schedule for {date} at {time} ({zone}).",
    "fr": "Programmation prévue le {date} à {time} ({zone})."
  },
  "ui_searchTemplates": {
    "en": "Search templates",
    "fr": "Rechercher un modèle"
  },
  "bestTime_title": {
    "en": "Suggested times",
    "fr": "Horaires suggérés"
  },
  "bestTime_choose": {
    "en": "Choose destinations to see suggested times.",
    "fr": "Choisissez des destinations pour voir les suggestions."
  },
  "bestTime_loading": {
    "en": "Loading suggested times…",
    "fr": "Chargement des suggestions…"
  },
  "bestTime_unknown": {
    "en": "Not available. More measured post history is needed for these destinations.",
    "fr": "Non disponible. Il faut davantage de publications mesurées pour ces destinations."
  },
  "bestTime_error": {
    "en": "Suggested times are unavailable. Try again.",
    "fr": "Les suggestions horaires sont indisponibles. Réessayez."
  },
  "bestTime_retry": {
    "en": "Retry",
    "fr": "Réessayer"
  },
  "bestTime_hint": {
    "en": "Based on stored performance, not a prediction. Times use",
    "fr": "Selon les performances enregistrées, sans prédiction. Fuseau horaire :"
  },
  "bestTime_apply": {
    "en": "Queue mode prefers these times when free; otherwise it uses your timetable.",
    "fr": "La file privilégie ces horaires libres, puis utilise votre calendrier habituel."
  },
  "bestTime_suggest": {
    "en": "Queue mode uses your timetable. Choose a suggestion to fill the schedule.",
    "fr": "La file utilise votre calendrier habituel. Choisissez une suggestion pour remplir la programmation."
  },
  "ui_formatFor": {
    "en": "Format for {name}",
    "fr": "Format pour {name}"
  },
  "ui_unavailableFormat": {
    "en": "Unavailable format (saved)",
    "fr": "Format enregistré indisponible"
  },
  "ui_unavailableFormatHelp": {
    "en": "The saved format is no longer available for this destination. Choose another format before scheduling.",
    "fr": "Le format enregistré n’est plus disponible pour cette destination. Choisissez un autre format avant de programmer."
  },
  "collab_assign": {
    "en": "Labels on posts",
    "fr": "Étiquettes des publications"
  },
  "collab_fields": {
    "en": "Custom fields",
    "fr": "Champs personnalisés"
  },
  "collab_queue": {
    "en": "Queue times",
    "fr": "Horaires de la file"
  },
  "collab_mix": {
    "en": "Content mix",
    "fr": "Répartition du contenu"
  },
  "collab_intro": {
    "en": "Organize posts for your team.",
    "fr": "Organisez les publications de votre équipe."
  },
  "collab_assignHelp": {
    "en": "Tag many posts at once, or open a post to organize it in detail.",
    "fr": "Étiquetez plusieurs publications à la fois ou ouvrez une publication pour l’organiser en détail."
  },
  "collab_fieldsHelp": {
    "en": "Track campaign codes, products or requesters on every post.",
    "fr": "Suivez les codes de campagne, produits ou demandeurs de chaque publication."
  },
  "collab_queueHelp": {
    "en": "Choose the weekly times queued posts publish at.",
    "fr": "Choisissez les horaires hebdomadaires de publication de la file."
  },
  "collab_mixHelp": {
    "en": "Balance what each channel posts by label.",
    "fr": "Équilibrez les publications de chaque canal par étiquette."
  },
  "collab_loadFailure": {
    "en": "This page could not be loaded. Refresh and try again.",
    "fr": "Cette page n’a pas pu être chargée. Actualisez puis réessayez."
  },
  "collab_postTitle": {
    "en": "Organize post",
    "fr": "Organiser la publication"
  },
  "collab_postHelp": {
    "en": "Manage labels, custom fields and internal team notes.",
    "fr": "Gérez les étiquettes, champs personnalisés et notes internes de l’équipe."
  },
  "collab_postNav": {
    "en": "Post organization pages",
    "fr": "Pages d’organisation de la publication"
  },
  "collab_back": {
    "en": "Back to all posts",
    "fr": "Retour à toutes les publications"
  },
  "collab_notesPage": {
    "en": "Notes · page {page}",
    "fr": "Notes · page {page}"
  },
  "collab_historyPage": {
    "en": "History · page {page}",
    "fr": "Historique · page {page}"
  },
  "collab_newerNotes": {
    "en": "Newer notes",
    "fr": "Notes plus récentes"
  },
  "collab_olderNotes": {
    "en": "Older notes",
    "fr": "Notes plus anciennes"
  },
  "collab_newerVersions": {
    "en": "Newer versions",
    "fr": "Versions plus récentes"
  },
  "collab_olderVersions": {
    "en": "Older versions",
    "fr": "Versions plus anciennes"
  },
  "collab_postFailure": {
    "en": "This post could not be loaded. Refresh and try again.",
    "fr": "Cette publication n’a pas pu être chargée. Actualisez puis réessayez."
  },
  "collab_the_result_could_not_be_verified_refresh_to_see_the_current_labels": {
    "en": "The result could not be verified. Refresh to see the current labels.",
    "fr": "Le résultat n’a pas pu être vérifié. Actualisez pour voir les étiquettes actuelles."
  },
  "collab_labels_saved": {
    "en": "Labels saved.",
    "fr": "Étiquettes enregistrées."
  },
  "collab_labels": {
    "en": "Labels",
    "fr": "Étiquettes"
  },
  "collab_no_labels_exist_yet_create_some_in_labels": {
    "en": "No labels exist yet. Create some in Labels.",
    "fr": "Aucune étiquette. Créez-en dans Étiquettes."
  },
  "collab_review_label_change": {
    "en": "Review label change",
    "fr": "Vérifier la modification des étiquettes"
  },
  "collab_only_this_post_s_labels_change_nothing_is_published_or_rescheduled": {
    "en": "Only this post's labels change. Nothing is published or rescheduled.",
    "fr": "Seules les étiquettes de cette publication changent. Rien n’est publié ni reprogrammé."
  },
  "collab_save_labels": {
    "en": "Save labels",
    "fr": "Enregistrer les étiquettes"
  },
  "collab_the_result_could_not_be_verified_refresh_to_see_the_current_values": {
    "en": "The result could not be verified. Refresh to see the current values.",
    "fr": "Le résultat n’a pas pu être vérifié. Actualisez pour voir les valeurs actuelles."
  },
  "collab_field_values_saved": {
    "en": "Field values saved.",
    "fr": "Valeurs enregistrées."
  },
  "collab_custom_fields": {
    "en": "Custom fields",
    "fr": "Champs personnalisés"
  },
  "collab_not_set": {
    "en": "Not set",
    "fr": "Non renseigné"
  },
  "collab_saving": {
    "en": "Saving…",
    "fr": "Enregistrement…"
  },
  "collab_save_values": {
    "en": "Save values",
    "fr": "Enregistrer les valeurs"
  },
  "collab_no_custom_fields_are_set_up_for_this_workspace": {
    "en": "No custom fields are set up for this workspace.",
    "fr": "Aucun champ personnalisé n’est configuré pour cet espace."
  },
  "collab_the_note_could_not_be_verified_refresh_to_check_it": {
    "en": "The note could not be verified. Refresh to check it.",
    "fr": "La note n’a pas pu être vérifiée. Actualisez pour la vérifier."
  },
  "collab_you": {
    "en": "You",
    "fr": "Vous"
  },
  "collab_note_saved_mention_notifications_queued": {
    "en": "Note saved. Mention notifications queued.",
    "fr": "Note enregistrée. Notifications de mention en attente d’envoi."
  },
  "collab_note_saved": {
    "en": "Note saved.",
    "fr": "Note enregistrée."
  },
  "collab_the_deletion_could_not_be_verified_refresh_to_check_the_note": {
    "en": "The deletion could not be verified. Refresh to check the note.",
    "fr": "La suppression n’a pas pu être vérifiée. Actualisez pour vérifier la note."
  },
  "collab_note_deleted": {
    "en": "Note deleted.",
    "fr": "Note supprimée."
  },
  "collab_team_notes": {
    "en": "Team notes",
    "fr": "Notes d’équipe"
  },
  "collab_notes_are_for_your_team_only_and_are_never_published": {
    "en": "Notes are for your team only and are never published.",
    "fr": "Les notes sont réservées à votre équipe et ne sont jamais publiées."
  },
  "collab_new_note": {
    "en": "New note",
    "fr": "Nouvelle note"
  },
  "collab_mention_also_type_name_in_the_note": {
    "en": "Mention (also type @Name in the note)",
    "fr": "Mention (saisissez aussi @Nom dans la note)"
  },
  "collab_add_note": {
    "en": "Add note",
    "fr": "Ajouter une note"
  },
  "collab_former_member": {
    "en": "Former member",
    "fr": "Ancien membre"
  },
  "collab_delete": {
    "en": "Delete",
    "fr": "Supprimer"
  },
  "collab_no_notes_yet": {
    "en": "No notes yet.",
    "fr": "Aucune note pour le moment."
  },
  "collab_delete_note": {
    "en": "Delete note",
    "fr": "Supprimer la note"
  },
  "collab_this_permanently_removes_the_note_for_everyone": {
    "en": "This permanently removes the note for everyone.",
    "fr": "Cette note sera supprimée définitivement pour tout le monde."
  },
  "collab_the_saved_settings_could_not_be_verified_refresh_to_see_the_current": {
    "en": "The saved settings could not be verified. Refresh to see the current state.",
    "fr": "Les paramètres enregistrés n’ont pas pu être vérifiés. Actualisez pour voir l’état actuel."
  },
  "collab_repeating_is_on": {
    "en": "Repeating is on.",
    "fr": "Répétition activée."
  },
  "collab_repeating_is_off": {
    "en": "Repeating is off.",
    "fr": "Répétition désactivée."
  },
  "collab_repeat_this_post": {
    "en": "Repeat this post",
    "fr": "Répéter cette publication"
  },
  "collab_this_post_is_a_repeat_of_another_post_change_repeating_on_the": {
    "en": "This post is a repeat of another post. Change repeating on the original.",
    "fr": "Cette publication en répète une autre. Modifiez la répétition sur l’originale."
  },
  "collab_days_between_repeats": {
    "en": "Days between repeats",
    "fr": "Jours entre les répétitions"
  },
  "collab_stop_after_leave_empty_for_no_limit": {
    "en": "Stop after (leave empty for no limit)",
    "fr": "Arrêter après (laisser vide pour aucune limite)"
  },
  "collab_alternate_wordings_separate_with_a_line_containing_only": {
    "en": "Alternate wordings (separate with a line containing only ---)",
    "fr": "Textes alternatifs (séparer par une ligne contenant uniquement ---)"
  },
  "collab_review_repeat_settings": {
    "en": "Review repeat settings",
    "fr": "Vérifier les paramètres de répétition"
  },
  "collab_repeating_stops_repeats_already_created_are_not_removed": {
    "en": "Repeating stops. Repeats already created are not removed.",
    "fr": "La répétition s’arrête. Les répétitions déjà créées sont conservées."
  },
  "collab_save_repeat_settings": {
    "en": "Save repeat settings",
    "fr": "Enregistrer la répétition"
  },
  "collab_add_labels": {
    "en": "Add labels",
    "fr": "Ajouter des étiquettes"
  },
  "collab_keeps_existing_labels_and_adds_the_chosen_ones": {
    "en": "Keeps existing labels and adds the chosen ones.",
    "fr": "Conserve les étiquettes existantes et ajoute celles choisies."
  },
  "collab_remove_labels": {
    "en": "Remove labels",
    "fr": "Retirer des étiquettes"
  },
  "collab_removes_only_the_chosen_labels": {
    "en": "Removes only the chosen labels.",
    "fr": "Retire uniquement les étiquettes choisies."
  },
  "collab_replace_labels": {
    "en": "Replace labels",
    "fr": "Remplacer les étiquettes"
  },
  "collab_posts_end_up_with_exactly_the_chosen_labels_none_clears_them": {
    "en": "Posts end up with exactly the chosen labels (none clears them).",
    "fr": "Les publications auront uniquement les étiquettes choisies (aucune les efface)."
  },
  "collab_the_result_could_not_be_verified_refresh_the_list_to_see_the": {
    "en": "The result could not be verified. Refresh the list to see the current labels.",
    "fr": "Le résultat n’a pas pu être vérifié. Actualisez la liste pour voir les étiquettes actuelles."
  },
  "collab_search_posts": {
    "en": "Search posts",
    "fr": "Rechercher des publications"
  },
  "collab_words_in_the_post": {
    "en": "Words in the post",
    "fr": "Mots dans la publication"
  },
  "collab_search": {
    "en": "Search",
    "fr": "Rechercher"
  },
  "collab_clear": {
    "en": "Clear",
    "fr": "Effacer"
  },
  "collab_change_labels_on_selected_posts": {
    "en": "Change labels on selected posts",
    "fr": "Modifier les étiquettes des publications sélectionnées"
  },
  "collab_action": {
    "en": "Action",
    "fr": "Action"
  },
  "collab_create_labels_first_in_labels_then_assign_them_here": {
    "en": "Create labels first in Labels, then assign them here.",
    "fr": "Créez d’abord des étiquettes dans Étiquettes, puis attribuez-les ici."
  },
  "collab_posts_and_their_labels": {
    "en": "Posts and their labels",
    "fr": "Publications et étiquettes"
  },
  "collab_select": {
    "en": "Select",
    "fr": "Sélectionner"
  },
  "collab_post": {
    "en": "Post",
    "fr": "Publication"
  },
  "collab_status": {
    "en": "Status",
    "fr": "Statut"
  },
  "collab_untitled": {
    "en": "untitled",
    "fr": "sans titre"
  },
  "collab_untitled_post": {
    "en": "Untitled post",
    "fr": "Publication sans titre"
  },
  "collab_no_labels": {
    "en": "No labels",
    "fr": "Aucune étiquette"
  },
  "collab_no_posts_match_this_search": {
    "en": "No posts match this search.",
    "fr": "Aucune publication ne correspond à cette recherche."
  },
  "collab_no_posts_yet_create_a_post_in_the_composer_to_organize_it": {
    "en": "No posts yet. Create a post in the composer to organize it here.",
    "fr": "Aucune publication. Créez-en une dans l’éditeur pour l’organiser ici."
  },
  "collab_post_pages": {
    "en": "Post pages",
    "fr": "Pages de publications"
  },
  "collab_previous_page": {
    "en": "Previous page",
    "fr": "Page précédente"
  },
  "collab_next_page": {
    "en": "Next page",
    "fr": "Page suivante"
  },
  "collab_apply_change": {
    "en": "Apply change",
    "fr": "Appliquer la modification"
  },
  "collab_none_clears_all_labels": {
    "en": "none (clears all labels)",
    "fr": "aucune (efface toutes les étiquettes)"
  },
  "collab_add_at_least_two_different_non_empty_choices": {
    "en": "Add at least two different non-empty choices.",
    "fr": "Ajoutez au moins deux choix différents non vides."
  },
  "collab_the_saved_field_could_not_be_verified_refresh_to_see_its_current": {
    "en": "The saved field could not be verified. Refresh to see its current state.",
    "fr": "Le champ enregistré n’a pas pu être vérifié. Actualisez pour voir son état actuel."
  },
  "collab_field_updated": {
    "en": "Field updated.",
    "fr": "Champ mis à jour."
  },
  "collab_field_created_it_now_appears_on_every_post": {
    "en": "Field created. It now appears on every post.",
    "fr": "Champ créé. Il apparaît désormais sur chaque publication."
  },
  "collab_the_deletion_could_not_be_verified_refresh_to_check_the_field": {
    "en": "The deletion could not be verified. Refresh to check the field.",
    "fr": "La suppression n’a pas pu être vérifiée. Actualisez pour vérifier le champ."
  },
  "collab_workspace_fields": {
    "en": "Workspace fields",
    "fr": "Champs de l’espace"
  },
  "collab_new_field": {
    "en": "New field",
    "fr": "Nouveau champ"
  },
  "collab_custom_post_fields": {
    "en": "Custom post fields",
    "fr": "Champs personnalisés des publications"
  },
  "collab_name": {
    "en": "Name",
    "fr": "Nom"
  },
  "collab_type": {
    "en": "Type",
    "fr": "Type"
  },
  "collab_options": {
    "en": "Options",
    "fr": "Options"
  },
  "collab_actions": {
    "en": "Actions",
    "fr": "Actions"
  },
  "collab_choice": {
    "en": "Choice",
    "fr": "Choix"
  },
  "collab_text": {
    "en": "Text",
    "fr": "Texte"
  },
  "collab_edit": {
    "en": "Edit",
    "fr": "Modifier"
  },
  "collab_no_custom_fields_yet": {
    "en": "No custom fields yet.",
    "fr": "Aucun champ personnalisé."
  },
  "collab_create_one_to_track_campaign_codes_products_or_requesters_on_each_post": {
    "en": " Create one to track campaign codes, products or requesters on each post.",
    "fr": " Créez-en un pour suivre les codes de campagne, produits ou demandeurs sur chaque publication."
  },
  "collab_only_workspace_owners_and_admins_with_access_to_all_channels_can_change": {
    "en": "Only workspace owners and admins with access to all channels can change fields. You can fill in values on each post.",
    "fr": "Seuls les propriétaires et administrateurs ayant accès à tous les canaux peuvent modifier les champs. Vous pouvez renseigner les valeurs sur chaque publication."
  },
  "collab_edit_field": {
    "en": "Edit field",
    "fr": "Modifier le champ"
  },
  "collab_options_one_per_line": {
    "en": "Options (one per line)",
    "fr": "Options (une par ligne)"
  },
  "collab_review": {
    "en": "Review",
    "fr": "Vérifier"
  },
  "collab_cancel": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "collab_review_field": {
    "en": "Review field",
    "fr": "Vérifier le champ"
  },
  "collab_saving_applies_to_every_post_in_the_workspace": {
    "en": "Saving applies to every post in the workspace.",
    "fr": "L’enregistrement s’applique à toutes les publications de l’espace."
  },
  "collab_confirm_save": {
    "en": "Confirm save",
    "fr": "Confirmer l’enregistrement"
  },
  "collab_review_field_deletion": {
    "en": "Review field deletion",
    "fr": "Vérifier la suppression du champ"
  },
  "collab_delete_field": {
    "en": "Delete field",
    "fr": "Supprimer le champ"
  },
  "collab_enter_a_valid_time_before_adding_this_slot": {
    "en": "Enter a valid time before adding this slot.",
    "fr": "Saisissez une heure valide avant d’ajouter ce créneau."
  },
  "collab_that_time_is_already_in_this_timetable": {
    "en": "That time is already in this timetable.",
    "fr": "Cette heure existe déjà dans ce calendrier."
  },
  "collab_the_saved_times_could_not_be_verified_refresh_to_see_the_current": {
    "en": "The saved times could not be verified. Refresh to see the current timetable.",
    "fr": "Les horaires enregistrés n’ont pas pu être vérifiés. Actualisez pour voir le calendrier actuel."
  },
  "collab_queue_timetable_selection": {
    "en": "Queue timetable selection",
    "fr": "Sélection du calendrier de la file"
  },
  "collab_timetable": {
    "en": "Timetable",
    "fr": "Calendrier"
  },
  "collab_apply_times_for": {
    "en": "Apply times for",
    "fr": "Appliquer les horaires pour"
  },
  "collab_shared_by_all_channels": {
    "en": "Shared by all channels",
    "fr": "Partagé par tous les canaux"
  },
  "collab_unsaved_changes": {
    "en": " · Unsaved changes",
    "fr": " · Modifications non enregistrées"
  },
  "collab_shared_queue_times": {
    "en": "Shared queue times",
    "fr": "Horaires communs de la file"
  },
  "collab_channel": {
    "en": "Channel",
    "fr": "Canal"
  },
  "collab_queued_posts_take_the_next_available_saved_time_saving_changes_affects_future": {
    "en": "Queued posts take the next available saved time. Saving changes affects future queue placements; posts already scheduled keep their time.",
    "fr": "Les publications en file utilisent le prochain créneau libre. Les modifications affectent les futurs ajouts ; les publications déjà programmées conservent leur horaire."
  },
  "collab_channel_queue_times": {
    "en": "Channel queue times",
    "fr": "Horaires de la file du canal"
  },
  "collab_day": {
    "en": "Day",
    "fr": "Jour"
  },
  "collab_time": {
    "en": "Time",
    "fr": "Heure"
  },
  "collab_remove": {
    "en": "Remove",
    "fr": "Retirer"
  },
  "collab_no_shared_queue_times_yet": {
    "en": "No shared queue times yet.",
    "fr": "Aucun horaire commun pour le moment."
  },
  "collab_this_channel_has_no_own_times_and_currently_uses_the_shared_times": {
    "en": "This channel has no own times and currently uses the shared times.",
    "fr": "Ce canal n’a pas d’horaires propres et utilise les horaires communs."
  },
  "collab_add_time": {
    "en": "Add time",
    "fr": "Ajouter un horaire"
  },
  "collab_for_all_channels": {
    "en": " for all channels",
    "fr": " pour tous les canaux"
  },
  "collab_review_changes": {
    "en": "Review changes",
    "fr": "Vérifier les modifications"
  },
  "collab_discard_changes": {
    "en": "Discard changes",
    "fr": "Annuler les modifications"
  },
  "collab_review_queue_times": {
    "en": "Review queue times",
    "fr": "Vérifier les horaires de la file"
  },
  "collab_shared": {
    "en": "shared",
    "fr": "commun"
  },
  "collab_selected_channel": {
    "en": "selected channel",
    "fr": "canal sélectionné"
  },
  "collab_save_queue_times": {
    "en": "Save queue times",
    "fr": "Enregistrer les horaires de la file"
  },
  "collab_removed_label": {
    "en": "Removed label",
    "fr": "Étiquette supprimée"
  },
  "collab_the_saved_rules_could_not_be_verified_refresh_to_see_the_current": {
    "en": "The saved rules could not be verified. Refresh to see the current mix.",
    "fr": "Les règles enregistrées n’ont pas pu être vérifiées. Actualisez pour voir la répartition actuelle."
  },
  "collab_content_mix_saved": {
    "en": "Content mix saved.",
    "fr": "Répartition enregistrée."
  },
  "collab_the_setting_could_not_be_verified_refresh_to_check_its_current_state": {
    "en": "The setting could not be verified. Refresh to check its current state.",
    "fr": "Le paramètre n’a pas pu être vérifié. Actualisez pour voir son état actuel."
  },
  "collab_automatic_content_mix_scheduling_is_on": {
    "en": "Automatic content-mix scheduling is on.",
    "fr": "Programmation automatique de la répartition activée."
  },
  "collab_automatic_content_mix_scheduling_is_off": {
    "en": "Automatic content-mix scheduling is off.",
    "fr": "Programmation automatique de la répartition désactivée."
  },
  "collab_content_mix_controls": {
    "en": "Content-mix controls",
    "fr": "Réglages de la répartition"
  },
  "collab_content_mix": {
    "en": "Content mix",
    "fr": "Répartition du contenu"
  },
  "collab_edit_a_channel_or_group": {
    "en": "Edit a channel or group",
    "fr": "Modifier un canal ou groupe"
  },
  "collab_choose": {
    "en": "Choose…",
    "fr": "Choisir…"
  },
  "collab_channels": {
    "en": "Channels",
    "fr": "Canaux"
  },
  "collab_groups": {
    "en": "Groups",
    "fr": "Groupes"
  },
  "collab_automatic_content_mix_scheduling": {
    "en": "Automatic content-mix scheduling",
    "fr": "Programmation automatique de la répartition"
  },
  "collab_automatic_scheduling": {
    "en": "Automatic scheduling",
    "fr": "Programmation automatique"
  },
  "collab_when_enabled_the_scheduler_can_add_eligible_drafts_to_fill_unmet_content": {
    "en": "When enabled, the scheduler can add eligible drafts to fill unmet content-mix targets.",
    "fr": "Une fois activée, la programmation peut ajouter des brouillons admissibles pour atteindre les objectifs de répartition."
  },
  "collab_off_saving_mix_rules_alone_never_schedules_posts": {
    "en": "Off. Saving mix rules alone never schedules posts.",
    "fr": "Désactivée. Enregistrer les règles de répartition ne programme jamais de publications."
  },
  "collab_enable_automatic_scheduling": {
    "en": "Enable automatic scheduling",
    "fr": "Activer la programmation automatique"
  },
  "collab_review_setting": {
    "en": "Review setting",
    "fr": "Vérifier le paramètre"
  },
  "collab_discard": {
    "en": "Discard",
    "fr": "Annuler"
  },
  "collab_only_workspace_owners_and_admins_with_access_to_all_channels_can_change_2": {
    "en": "Only workspace owners and admins with access to all channels can change this setting.",
    "fr": "Seuls les propriétaires et administrateurs ayant accès à tous les canaux peuvent modifier ce paramètre."
  },
  "collab_planned_posts": {
    "en": "Planned posts",
    "fr": "Publications prévues"
  },
  "collab_counts_include_only_posts_whose_full_destination_set_is_visible_to_you": {
    "en": "Counts include only posts whose full destination set is visible to you. Ready drafts have passed the workspace approval requirement.",
    "fr": "Les totaux concernent uniquement les publications dont vous voyez toutes les destinations. Les brouillons prêts ont satisfait aux exigences d’approbation."
  },
  "collab_planned_posts_against_the_content_mix": {
    "en": "Planned posts against the content mix",
    "fr": "Publications prévues selon la répartition"
  },
  "collab_label": {
    "en": "Label",
    "fr": "Étiquette"
  },
  "collab_planned": {
    "en": "Planned",
    "fr": "Prévues"
  },
  "collab_target": {
    "en": "Target",
    "fr": "Objectif"
  },
  "collab_ready_drafts": {
    "en": "Ready drafts",
    "fr": "Brouillons prêts"
  },
  "collab_short": {
    "en": " (short)",
    "fr": " (insuffisant)"
  },
  "collab_no_content_mix_is_set_up_yet": {
    "en": "No content mix is set up yet.",
    "fr": "Aucune répartition n’est configurée."
  },
  "collab_group": {
    "en": "group",
    "fr": "groupe"
  },
  "collab_channel_2": {
    "en": "channel",
    "fr": "canal"
  },
  "collab_edit_mix_rules": {
    "en": "Edit mix rules",
    "fr": "Modifier les règles de répartition"
  },
  "collab_no_rules_here_yet": {
    "en": "No rules here yet.",
    "fr": "Aucune règle ici."
  },
  "collab_add_a_label": {
    "en": "Add a label",
    "fr": "Ajouter une étiquette"
  },
  "collab_add_a_label_2": {
    "en": "Add a label…",
    "fr": "Ajouter une étiquette…"
  },
  "collab_group_mixes_can_be_changed_by_owners_and_admins_with_access_to": {
    "en": "Group mixes can be changed by owners and admins with access to all channels.",
    "fr": "Les répartitions de groupe peuvent être modifiées par les propriétaires et administrateurs ayant accès à tous les canaux."
  },
  "collab_only_workspace_owners_and_admins_can_change_the_content_mix": {
    "en": "Only workspace owners and admins can change the content mix.",
    "fr": "Seuls les propriétaires et administrateurs peuvent modifier la répartition."
  },
  "collab_choose_a_channel_or_group_from_the_sidebar_to_review_its_rules": {
    "en": "Choose a channel or group from the sidebar to review its rules.",
    "fr": "Choisissez un canal ou groupe dans la barre latérale pour vérifier ses règles."
  },
  "collab_review_content_mix": {
    "en": "Review content mix",
    "fr": "Vérifier la répartition"
  },
  "collab_save_content_mix": {
    "en": "Save content mix",
    "fr": "Enregistrer la répartition"
  },
  "collab_invalid_target": {
    "en": "Invalid target",
    "fr": "Objectif invalide"
  },
  "collab_enable": {
    "en": "Enable",
    "fr": "Activer"
  },
  "collab_disable": {
    "en": "Disable",
    "fr": "Désactiver"
  },
  "collab_eligible_drafts_may_be_scheduled_by_the_content_mix_automation_saving_mix": {
    "en": "Eligible drafts may be scheduled by the content-mix automation. Saving mix rules by itself does not enable this setting.",
    "fr": "Les brouillons admissibles peuvent être programmés automatiquement. Enregistrer les règles de répartition n’active pas ce paramètre."
  },
  "collab_the_content_mix_automation_will_stop_scheduling_new_posts_existing_scheduled_posts": {
    "en": "The content-mix automation will stop scheduling new posts. Existing scheduled posts keep their current times.",
    "fr": "La répartition automatique cessera de programmer de nouvelles publications. Les publications déjà programmées conservent leurs horaires."
  },
  "collab_enable_scheduling": {
    "en": "Enable scheduling",
    "fr": "Activer la programmation"
  },
  "collab_disable_scheduling": {
    "en": "Disable scheduling",
    "fr": "Désactiver la programmation"
  },
  "collab_post_organization": {
    "en": "Post organization",
    "fr": "Organisation des publications"
  },
  "collab_labels_on_posts": {
    "en": "Labels on posts",
    "fr": "Étiquettes des publications"
  },
  "collab_queue_times": {
    "en": "Queue times",
    "fr": "Horaires de la file"
  },
  "collab_working": {
    "en": "Working…",
    "fr": "Traitement…"
  },
  "collab_the_request_could_not_be_confirmed_refresh_and_check_the_current_state": {
    "en": "The request could not be confirmed. Refresh and check the current state before trying again.",
    "fr": "La demande n’a pas pu être confirmée. Actualisez et vérifiez l’état actuel avant de réessayer."
  },
  "collab_the_response_could_not_be_read_refresh_and_check_the_current_state": {
    "en": "The response could not be read. Refresh and check the current state before trying again.",
    "fr": "La réponse n’a pas pu être lue. Actualisez et vérifiez l’état actuel avant de réessayer."
  },
  "collab_the_result_is_unknown_refresh_before_retrying": {
    "en": "The result is unknown. Refresh before retrying.",
    "fr": "Le résultat est inconnu. Actualisez avant de réessayer."
  },
  "collab_unknown": {
    "en": "Unknown",
    "fr": "Inconnu"
  },
  "attachments_oneType": {
    "en": "Choose one media type for this post.",
    "fr": "Choisissez un seul type de média pour cette publication."
  },
  "attachments_imagesUnavailable": {
    "en": "Images are not available for the selected destinations.",
    "fr": "Les images ne sont pas disponibles pour les destinations choisies."
  },
  "attachments_uploadsUnavailable": {
    "en": "Local image uploads are unavailable for the selected destinations.",
    "fr": "L’envoi d’images locales n’est pas disponible pour les destinations choisies."
  },
  "attachments_kindUnavailable": {
    "en": "This media type is not available for the selected destinations.",
    "fr": "Ce type de média n’est pas disponible pour les destinations choisies."
  },
  "attachments_uploadsUnsupported": {
    "en": "Local image uploads are unavailable for the selected destinations. Remove this file or choose another supported attachment.",
    "fr": "L’envoi d’images locales n’est pas disponible pour les destinations choisies. Retirez ce fichier ou choisissez une pièce jointe compatible."
  },
  "attachments_chooseAgain": {
    "en": "Choose the image file again before saving.",
    "fr": "Choisissez à nouveau le fichier image avant d’enregistrer."
  },
  "attachments_invalidUrl": {
    "en": "Enter a complete HTTPS URL without a username or password.",
    "fr": "Saisissez une URL HTTPS complète sans identifiant ni mot de passe."
  },
  "attachments_review": {
    "en": "Review the highlighted media attachments before saving.",
    "fr": "Vérifiez les pièces jointes signalées avant d’enregistrer."
  },
  "attachments_uploadFailed": {
    "en": "The image could not be uploaded. Try again.",
    "fr": "L’image n’a pas pu être envoyée. Réessayez."
  },
  "attachments_heading": {
    "en": "Media attachments ",
    "fr": "Pièces jointes multimédias "
  },
  "attachments_optional": {
    "en": "(optional)",
    "fr": "(facultatif)"
  },
  "attachments_chooseImage": {
    "en": "Choose a local image",
    "fr": "Choisir une image locale"
  },
  "attachments_addImage": {
    "en": "Add image URL",
    "fr": "Ajouter une URL d’image"
  },
  "attachments_addVideo": {
    "en": "Add video URL",
    "fr": "Ajouter une URL de vidéo"
  },
  "attachments_addLink": {
    "en": "Add media link",
    "fr": "Ajouter un lien média"
  },
  "attachments_linkLabel": {
    "en": "Media link {n} (image or video)",
    "fr": "Lien média {n} (image ou vidéo)"
  },
  "attachments_typeLabel": {
    "en": "Type",
    "fr": "Type"
  },
  "attachments_detecting": {
    "en": "Checking the link…",
    "fr": "Vérification du lien…"
  },
  "attachments_detectedImage": {
    "en": "Recognised as an image.",
    "fr": "Reconnu comme une image."
  },
  "attachments_detectedVideo": {
    "en": "Recognised as a video.",
    "fr": "Reconnu comme une vidéo."
  },
  "attachments_detectUnknown": {
    "en": "We could not tell what this link is. Choose its type below; it is checked again when the post is saved.",
    "fr": "Nous n’avons pas pu reconnaître ce lien. Choisissez son type ci-dessous ; il sera revérifié à l’enregistrement."
  },
  "attachments_addLocal": {
    "en": "Add local images",
    "fr": "Ajouter des images locales"
  },
  "attachments_unavailable": {
    "en": "Media attachments are unavailable for this workspace.",
    "fr": "Les pièces jointes multimédias ne sont pas disponibles pour cet espace."
  },
  "attachments_chooseDestinations": {
    "en": "Choose destinations that support images or videos to add media. Your draft can still be saved.",
    "fr": "Choisissez des destinations compatibles avec les images ou vidéos pour ajouter un média. Vous pouvez toujours enregistrer un brouillon."
  },
  "attachments_empty": {
    "en": "No media attachments added.",
    "fr": "Aucune pièce jointe multimédia ajoutée."
  },
  "attachments_image": {
    "en": "Image",
    "fr": "Image"
  },
  "attachments_video": {
    "en": "Video",
    "fr": "Vidéo"
  },
  "attachments_imageUrl": {
    "en": "Image URL",
    "fr": "URL de l’image"
  },
  "attachments_videoUrl": {
    "en": "Video URL",
    "fr": "URL de la vidéo"
  },
  "attachments_ready": {
    "en": "Local image ready to upload",
    "fr": "Image locale prête à l’envoi"
  },
  "attachments_saved": {
    "en": "Saved workspace image",
    "fr": "Image enregistrée dans l’espace"
  },
  "attachments_moveUp": {
    "en": "Move up",
    "fr": "Monter"
  },
  "attachments_moveDown": {
    "en": "Move down",
    "fr": "Descendre"
  },
  "attachments_remove": {
    "en": "Remove",
    "fr": "Retirer"
  },
  "attachments_uploading": {
    "en": "Uploading images…",
    "fr": "Envoi des images…"
  },
  "attachments_preview": {
    "en": "Attachment preview",
    "fr": "Aperçu des pièces jointes"
  },
  "attachments_selectedImage": {
    "en": "Selected post image",
    "fr": "Image sélectionnée pour la publication"
  },
  "attachments_limit": {
    "en": "Choose up to {max} media attachments.",
    "fr": "Choisissez jusqu’à {max} pièces jointes multimédias."
  },
  "attachments_limitMany": {
    "en": "Choose up to {max} media attachments. Remove an item or choose fewer images.",
    "fr": "Choisissez jusqu’à {max} pièces jointes multimédias. Retirez un élément ou choisissez moins d’images."
  },
  "attachments_kindDenied": {
    "en": "This post cannot include {kind} for the selected destinations.",
    "fr": "Cette publication ne peut pas inclure de {kind} pour les destinations choisies."
  },
  "attachments_descriptionMax": {
    "en": "Image descriptions must be {max} characters or fewer.",
    "fr": "Les descriptions d’image doivent contenir au plus {max} caractères."
  },
  "attachments_uploadSize": {
    "en": "Choose an allowed image up to {max} MB.",
    "fr": "Choisissez une image compatible de {max} Mo maximum."
  },
  "attachments_moveUpLabel": {
    "en": "Move attachment {n} up",
    "fr": "Monter la pièce jointe {n}"
  },
  "attachments_moveDownLabel": {
    "en": "Move attachment {n} down",
    "fr": "Descendre la pièce jointe {n}"
  },
  "attachments_removeLabel": {
    "en": "Remove attachment {n}",
    "fr": "Retirer la pièce jointe {n}"
  },
  "attachments_videoLabel": {
    "en": "Video attachment {n}",
    "fr": "Pièce jointe vidéo {n}"
  },
  "attachments_images": {
    "en": "images",
    "fr": "images"
  },
  "attachments_videos": {
    "en": "videos",
    "fr": "vidéos"
  },
  "attachments_used": {
    "en": "{used} of {max} media attachments are used. Remove an attachment before adding another.",
    "fr": "{used} pièces jointes sur {max} sont utilisées. Retirez-en une avant d’en ajouter une autre."
  },
  "attachments_urlLabel": {
    "en": "{kind} attachment {n}",
    "fr": "Pièce jointe {kind} {n}"
  },
  "attachments_descriptionLabel": {
    "en": "Image description attachment {n}",
    "fr": "Description de la pièce jointe image {n}"
  },
  "collab_labelsUpdated": {
    "en": "Labels updated on {count} post{plural}.",
    "fr": "Étiquettes mises à jour sur {count} publication{plural}."
  },
  "collab_reviewLabelsCount": {
    "en": "Review change for {count} post{plural}",
    "fr": "Vérifier la modification de {count} publication{plural}"
  },
  "collab_selectMax": {
    "en": "Select at most {max} posts.",
    "fr": "Sélectionnez au plus {max} publications."
  },
  "collab_selectPost": {
    "en": "Select post: {title}",
    "fr": "Sélectionner la publication : {title}"
  },
  "collab_pageNumber": {
    "en": "Page {page}",
    "fr": "Page {page}"
  },
  "collab_reviewLabelsDescription": {
    "en": "{action} on {count} selected post{plural}. Nothing is published or rescheduled; only labels change.",
    "fr": "{action} sur {count} publication{plural} sélectionnée{plural}. Rien n’est publié ni reprogrammé ; seules les étiquettes changent."
  },
  "collab_labelsPrefix": {
    "en": "Labels: ",
    "fr": "Étiquettes : "
  },
  "collab_choiceMax": {
    "en": "Use no more than {max} choices.",
    "fr": "Utilisez au plus {max} choix."
  },
  "collab_choiceLength": {
    "en": "Each choice must be {max} characters or fewer.",
    "fr": "Chaque choix doit contenir au plus {max} caractères."
  },
  "collab_fieldDeleteHelp": {
    "en": "Deleting “{name}” also removes the value every post holds for it. Posts themselves are kept.",
    "fr": "Supprimer « {name} » efface aussi sa valeur dans chaque publication. Les publications sont conservées."
  },
  "collab_fieldsIntro": {
    "en": "Add fields such as a campaign code or product to every post. Up to {max} per workspace.",
    "fr": "Ajoutez des champs comme un code de campagne ou un produit à chaque publication. Au plus {max} par espace."
  },
  "collab_noFieldsYet": {
    "en": "No custom fields yet.",
    "fr": "Aucun champ personnalisé."
  },
  "collab_choiceBounds": {
    "en": "Up to {max} choices, {length} characters each.",
    "fr": "Jusqu’à {max} choix de {length} caractères chacun."
  },
  "collab_repeatStatus": {
    "en": "Repeating every {days} days. {count} repeat{plural} so far{next}.",
    "fr": "Répétition tous les {days} jours. {count} répétition{plural} jusqu’à présent{next}."
  },
  "collab_nextRepeat": {
    "en": "; next on {time}",
    "fr": " ; prochaine le {time}"
  },
  "collab_repeatHint": {
    "en": "Channels may reject identical text, so alternate wordings can rotate. Changed wordings may need workspace approval; when approvals are required, only editors and above can add them.",
    "fr": "Les canaux peuvent refuser un texte identique ; les textes alternatifs peuvent donc varier. Les nouveaux textes peuvent nécessiter une approbation ; seuls les éditeurs et rôles supérieurs peuvent les ajouter lorsque l’approbation est requise."
  },
  "collab_variantsMax": {
    "en": "Use at most {max} wordings.",
    "fr": "Utilisez au plus {max} textes alternatifs."
  },
  "collab_repeatReview": {
    "en": "New posts will be prepared every {days} days{limit} on the same channels. Workspace approval rules may hold each repeat for review before publication.",
    "fr": "De nouvelles publications seront préparées tous les {days} jours{limit} sur les mêmes canaux. Les règles d’approbation peuvent retenir chaque répétition pour vérification avant publication."
  },
  "collab_repeatLimit": {
    "en": ", up to {count} times",
    "fr": ", jusqu’à {count} fois"
  },
  "collab_day0": {
    "en": "Sunday",
    "fr": "Dimanche"
  },
  "collab_day1": {
    "en": "Monday",
    "fr": "Lundi"
  },
  "collab_day2": {
    "en": "Tuesday",
    "fr": "Mardi"
  },
  "collab_day3": {
    "en": "Wednesday",
    "fr": "Mercredi"
  },
  "collab_day4": {
    "en": "Thursday",
    "fr": "Jeudi"
  },
  "collab_day5": {
    "en": "Friday",
    "fr": "Vendredi"
  },
  "collab_day6": {
    "en": "Saturday",
    "fr": "Samedi"
  },
  "collab_queueSaved": {
    "en": "Queue times saved ({count}).",
    "fr": "Horaires de la file enregistrés ({count})."
  },
  "collab_sharedChannels": {
    "en": "Shared by all channels",
    "fr": "Partagé par tous les canaux"
  },
  "collab_queueZoneHelp": {
    "en": "Times use {zone}. Shared times are available to every channel. A channel’s own times are additional; a post for multiple channels can use one only when every selected channel has that same time.",
    "fr": "Les heures utilisent {zone}. Les horaires communs sont disponibles pour tous les canaux. Les horaires propres à un canal s’y ajoutent ; une publication à plusieurs destinations ne peut en utiliser un que si chaque canal dispose du même horaire."
  },
  "collab_channelQueueTitle": {
    "en": "{name} queue times",
    "fr": "Horaires de la file de {name}"
  },
  "collab_workspaceZone": {
    "en": "The workspace timezone is {zone}.",
    "fr": "Le fuseau horaire de l’espace est {zone}."
  },
  "collab_timeZoneLabel": {
    "en": "Time ({zone})",
    "fr": "Heure ({zone})"
  },
  "collab_queueLimit": {
    "en": "This timetable has reached its limit of {max} times.",
    "fr": "Ce calendrier a atteint sa limite de {max} horaires."
  },
  "collab_queuePermissions": {
    "en": "Only workspace owners and admins can change queue times{scope}.",
    "fr": "Seuls les propriétaires et administrateurs peuvent modifier les horaires de la file{scope}."
  },
  "collab_queueReview": {
    "en": "This replaces the {scope} timetable with {count} time{plural}. Posts already scheduled keep their time.",
    "fr": "Remplace le calendrier {scope} par {count} horaire{plural}. Les publications déjà programmées conservent leur horaire."
  },
  "collab_mixWindow": {
    "en": "Rules set weekly label targets across a rolling {days}-day window.",
    "fr": "Les règles définissent des objectifs hebdomadaires par étiquette sur une période glissante de {days} jours."
  },
  "collab_rulesFor": {
    "en": "Rules for {name}",
    "fr": "Règles pour {name}"
  },
  "collab_postsPerWeek": {
    "en": "Posts per week for {label}",
    "fr": "Publications par semaine pour {label}"
  },
  "collab_perWeek": {
    "en": " per week",
    "fr": " par semaine"
  },
  "collab_wholeTarget": {
    "en": "Enter a whole number from 1 to {max}.",
    "fr": "Saisissez un nombre entier entre 1 et {max}."
  },
  "collab_mixReview": {
    "en": "This replaces the rules for this {scope} with {count} label rule{plural}. No post is created or rescheduled by saving.",
    "fr": "Remplace les règles de ce {scope} par {count} règle{plural} d’étiquette. L’enregistrement ne crée ni ne reprogramme de publication."
  },
  "collab_autoFillTitle": {
    "en": "{action} automatic scheduling?",
    "fr": "{action} la programmation automatique ?"
  },
  "collab_typeConfirmation": {
    "en": "Type",
    "fr": "Saisissez"
  },
  "collab_toConfirm": {
    "en": "to confirm",
    "fr": "pour confirmer"
  },
  "ui_messagePlaceholder": {
    "en": "Write a post for your team…",
    "fr": "Rédigez une publication pour votre équipe…"
  },
  "ui_linkPlaceholder": {
    "en": "https://example.com",
    "fr": "https://example.com"
  },
  "ui_commentPlaceholder": {
    "en": "Add a link or follow-up as the first comment…",
    "fr": "Ajoutez un lien ou une suite dans le premier commentaire…"
  },
  "ui_sidebarLabel": {
    "en": "Post destinations and timing",
    "fr": "Destinations et horaires de la publication"
  },
  "ui_spacingWarning": {
    "en": "The same content will reach 3 or more channels of one network at the same time. Consider scheduling some of them at least {minutes} minutes apart.",
    "fr": "Le même contenu touchera 3 canaux ou plus d’un même réseau au même moment. Pensez à en programmer certains à au moins {minutes} minutes d’écart."
  },
  "ui_uploadMissing": {
    "en": "{name} does not currently support local image uploads. Remove the uploaded image or choose another destination.",
    "fr": "{name} ne prend pas en charge l’envoi d’images locales. Retirez l’image ou choisissez une autre destination."
  },
  "ui_uploadMime": {
    "en": "{name} does not accept {type}. Choose another image or destination.",
    "fr": "{name} n’accepte pas {type}. Choisissez une autre image ou destination."
  },
  "ui_imageFormat": {
    "en": "this image format",
    "fr": "ce format d’image"
  },
  "ui_uploadMax": {
    "en": "{name} accepts images up to {max} MB. Choose another image or destination.",
    "fr": "{name} accepte les images de {max} Mo maximum. Choisissez une autre image ou destination."
  },
  "ui_textMax": {
    "en": "Post text must be {max} characters or fewer.",
    "fr": "Le texte doit contenir au plus {max} caractères."
  },
  "collab_fieldDeletedSingular": {
    "en": "Field deleted. {count} stored value was removed from posts.",
    "fr": "Champ supprimé. {count} valeur enregistrée supprimée des publications."
  },
  "collab_fieldDeletedPlural": {
    "en": "Field deleted. {count} stored values were removed from posts.",
    "fr": "Champ supprimé. {count} valeurs enregistrées supprimées des publications."
  },
  "collab_status_draft": {
    "en": "draft",
    "fr": "brouillon"
  },
  "collab_status_scheduled": {
    "en": "scheduled",
    "fr": "programmée"
  },
  "collab_status_pending_approval": {
    "en": "pending approval",
    "fr": "en attente d’approbation"
  },
  "collab_status_published": {
    "en": "published",
    "fr": "publiée"
  },
  "collab_status_failed": {
    "en": "failed",
    "fr": "échec"
  },
  "collab_status_publishing": {
    "en": "publishing",
    "fr": "publication en cours"
  },
  "collab_status_rejected": {
    "en": "rejected",
    "fr": "refusée"
  },
  "media_unavailable": {
    "en": "Media publishing is unavailable for this destination.",
    "fr": "La publication de médias n’est pas disponible pour cette destination."
  },
  "media_images": {
    "en": "This destination cannot publish images.",
    "fr": "Cette destination ne peut pas publier d’images."
  },
  "media_videos": {
    "en": "This destination cannot publish videos.",
    "fr": "Cette destination ne peut pas publier de vidéos."
  },
  "media_maxImages": {
    "en": "This destination supports up to {max} images per post.",
    "fr": "Cette destination accepte au plus {max} images par publication."
  },
  "media_maxVideos": {
    "en": "This destination supports up to {max} videos per post.",
    "fr": "Cette destination accepte au plus {max} vidéos par publication."
  },
  "media_mixed": {
    "en": "This destination cannot combine images and video in one post.",
    "fr": "Cette destination ne peut pas combiner images et vidéos dans une publication."
  },
  "media_link": {
    "en": "This destination cannot combine a link with media in one post.",
    "fr": "Cette destination ne peut pas combiner un lien et des médias dans une publication."
  },
  "media_alt": {
    "en": "This destination does not support image descriptions.",
    "fr": "Cette destination ne prend pas en charge les descriptions d’image."
  },
  "media_invalidList": {
    "en": "Choose a valid media list.",
    "fr": "Choisissez une liste de médias valide."
  },
  "media_invalidAttachments": {
    "en": "Choose valid media attachments.",
    "fr": "Choisissez des pièces jointes multimédias valides."
  }
};
export type ComposerCatalog = typeof composerCatalogDefaults;
export const composerCatalogSchema = bilingualCatalogSchema(composerCatalogDefaults);
export const COMPOSER_COPY_CONFIG = [entry({ key: 'publishing.composerCopy', group: 'Publishing · Copy', label: 'Composer, collaboration and attachment copy', kind: 'json', description: 'English and French composer, queue, remote scheduling and version history text. Keep named placeholders in templates.', defaultValue: composerCatalogDefaults, schema: composerCatalogSchema, consumption: 'active' })] as const;
export function catalogGroup<P extends 'composer' | 'queue' | 'remote' | 'version' | 'ui' | 'bestTime' | 'collab' | 'attachments' | 'media'>(catalog: ComposerCatalog, prefix: P, locale: 'en' | 'fr') {
  type Keys = keyof ComposerCatalog;
  type Group = { [K in Keys as K extends `${P}_${infer Name}` ? Name : never]: string };
  return Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith(prefix + '_')).map(([key, value]) => [key.slice(prefix.length + 1), value[locale]])) as Group;
}
export const fillComposerCopy = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));
export function composerText(catalog: ComposerCatalog, locale: 'en' | 'fr') {
 const copy = catalogGroup(catalog, 'composer', locale);
 return { ...copy, stepLabel: (n: number) => fillComposerCopy(copy.stepLabel, { n }), formatLabel: (name: string) => fillComposerCopy(copy.formatLabel, { name }), schedulingHelp: (zone: string) => fillComposerCopy(copy.schedulingHelp, { zone }), holdPlatform: (name: string) => fillComposerCopy(copy.holdPlatform, { name }), holdPlatformHint: (name: string) => fillComposerCopy(copy.holdPlatformHint, { name }), destinationPlatform: (name: string) => fillComposerCopy(copy.destinationPlatform, { name }), autosaveSaved: (time: string) => fillComposerCopy(copy.autosaveSaved, { time }) };
}
