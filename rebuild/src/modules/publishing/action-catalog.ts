import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Root-editable plain-text copy. Named placeholders preserve dynamic customer context. */
export const publishingActionCopy = {
  "addPostTextALinkOrMedia": {
    "en": "Add post text, a link, or media before saving. A first comment alone is not a post.",
    "fr": "Ajoutez du texte, un lien ou un média avant d’enregistrer. Un premier commentaire seul ne constitue pas une publication."
  },
  "enterACompleteLinkSuchAsHttpsexamplecom": {
    "en": "Enter a complete link, such as https://example.com.",
    "fr": "Saisissez un lien complet, par exemple https://example.com."
  },
  "chooseANonemptyCSVFileToImport": {
    "en": "Choose a non-empty CSV file to import.",
    "fr": "Choisissez un fichier CSV non vide à importer."
  },
  "importPostsFromCSV": {
    "en": "Import posts from CSV",
    "fr": "Importer des publications depuis un CSV"
  },
  "requiredHeader": {
    "en": "Required header:",
    "fr": "En-tête obligatoire :"
  },
  "optional": {
    "en": ". Optional:",
    "fr": ". Facultatif :"
  },
  "wholeMinutesDefaultsTo0UseThe": {
    "en": "(whole minutes; defaults to 0). Use the channel labels below; separate multiple channels with semicolons. Leave channels empty to import a local draft. Imported posts remain drafts.",
    "fr": "(minutes entières ; 0 par défaut). Utilisez les noms de canaux ci-dessous, séparés par des points-virgules. Laissez les canaux vides pour importer un brouillon local. Les publications importées restent des brouillons."
  },
  "importCSV": {
    "en": "Import CSV",
    "fr": "Importer le CSV"
  },
  "organizePost": {
    "en": "Organize post",
    "fr": "Organiser la publication"
  },
  "destination": {
    "en": "Destination",
    "fr": "Destination"
  },
  "editPost": {
    "en": "Edit post",
    "fr": "Modifier la publication"
  },
  "submitForApproval": {
    "en": "Submit for approval",
    "fr": "Soumettre pour approbation"
  },
  "cancelSchedule": {
    "en": "Cancel schedule",
    "fr": "Annuler la programmation"
  },
  "syncStatus": {
    "en": "Sync status",
    "fr": "Actualiser le statut"
  },
  "firstCommentStatus": {
    "en": "First comment status",
    "fr": "Statut du premier commentaire"
  },
  "firstCommentDelivery": {
    "en": "First comment delivery",
    "fr": "Envoi du premier commentaire"
  },
  "deleteLocally": {
    "en": "Delete locally",
    "fr": "Supprimer localement"
  },
  "firstCommentIsScheduled": {
    "en": "First comment is scheduled",
    "fr": "Le premier commentaire est programmé"
  },
  "sendNow": {
    "en": "Send now",
    "fr": "Envoyer maintenant"
  },
  "sendFirstComment": {
    "en": "Send first comment",
    "fr": "Envoyer le premier commentaire"
  },
  "recordCommentOutcome": {
    "en": "Record comment outcome",
    "fr": "Enregistrer le résultat du commentaire"
  },
  "sendTheFirstCommentNow": {
    "en": "Send the first comment now?",
    "fr": "Envoyer le premier commentaire maintenant ?"
  },
  "thisSendsTheSavedCommentTo": {
    "en": "This sends the saved comment to",
    "fr": "Le commentaire enregistré sera envoyé à"
  },
  "once": {
    "en": "once",
    "fr": "une fois"
  },
  "ifThePlatformAcceptsItButThe": {
    "en": "If the platform accepts it but the response is delayed, the result will need review. Check its current status before any further action.",
    "fr": "Si la plateforme l’accepte mais tarde à répondre, le résultat devra être vérifié. Consultez son statut actuel avant toute autre action."
  },
  "iUnderstandTheResultMayBeDelayed": {
    "en": "I understand the result may be delayed and I will check status before repeating.",
    "fr": "Je comprends que le résultat peut être retardé et je vérifierai le statut avant de recommencer."
  },
  "theSendResultCouldNotBeConfirmed": {
    "en": "The send result could not be confirmed. Check its current state before another action.",
    "fr": "L’envoi n’a pas pu être confirmé. Vérifiez son état actuel avant toute autre action."
  },
  "cancel": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "recordThePlatformCheck": {
    "en": "Record the platform check",
    "fr": "Enregistrer la vérification sur la plateforme"
  },
  "thisRecordsYourManualCheckTheApp": {
    "en": "This records your manual check. The app will not contact or verify the platform.",
    "fr": "Ceci enregistre votre vérification manuelle. L’application ne contactera pas la plateforme pour vérifier le résultat."
  },
  "theOriginalRequestMayStillCompleteLater": {
    "en": "The original request may still complete later. Confirm the current platform outcome before choosing below.",
    "fr": "La demande initiale peut encore aboutir. Vérifiez le résultat actuel sur la plateforme avant de choisir ci-dessous."
  },
  "whatDidYouVerify": {
    "en": "What did you verify?",
    "fr": "Qu’avez-vous vérifié ?"
  },
  "theCommentIsNotPresent": {
    "en": "The comment is not present",
    "fr": "Le commentaire est absent"
  },
  "theCommentIsPresent": {
    "en": "The comment is present",
    "fr": "Le commentaire est présent"
  },
  "platformCommentID": {
    "en": "Platform comment ID",
    "fr": "Identifiant du commentaire sur la plateforme"
  },
  "iCheckedThePlatformOutsideThisApp": {
    "en": "I checked the platform outside this app and understand a late result may still appear.",
    "fr": "J’ai vérifié la plateforme en dehors de cette application et je comprends qu’un résultat tardif reste possible."
  },
  "theOutcomeCouldNotBeRecordedCheck": {
    "en": "The outcome could not be recorded. Check the current state before trying again.",
    "fr": "Le résultat n’a pas pu être enregistré. Vérifiez l’état actuel avant de réessayer."
  },
  "recordResult": {
    "en": "Record result",
    "fr": "Enregistrer le résultat"
  },
  "theSendResultIsUnconfirmedCheckThe": {
    "en": "The send result is unconfirmed. Check the platform and current post before sending or recording an outcome.",
    "fr": "L’envoi n’est pas confirmé. Vérifiez la plateforme et la publication avant d’envoyer ou d’enregistrer un résultat."
  },
  "theOutcomeIsUnconfirmedCheckTheCurrent": {
    "en": "The outcome is unconfirmed. Check the current post before repeating or taking another action.",
    "fr": "Le résultat n’est pas confirmé. Vérifiez la publication actuelle avant de recommencer ou d’effectuer une autre action."
  },
  "uploadingImages": {
    "en": "Uploading images…",
    "fr": "Envoi des images…"
  },
  "someImagesCouldNotBeUploadedYour": {
    "en": "Some images could not be uploaded. Your order and descriptions are still here; fix the marked items and retry.",
    "fr": "Certaines images n’ont pas pu être envoyées. Leur ordre et leurs descriptions sont conservés ; corrigez les éléments indiqués et réessayez."
  },
  "weCouldNotUploadEveryImageYour": {
    "en": "We could not upload every image. Your post details are still here; try again.",
    "fr": "Toutes les images n’ont pas pu être envoyées. Les détails de votre publication sont conservés ; réessayez."
  },
  "postFormats": {
    "en": "Post formats",
    "fr": "Formats de publication"
  },
  "postText": {
    "en": "Post text",
    "fr": "Texte de la publication"
  },
  "optionalWithALinkOrMedia": {
    "en": "(optional with a link or media)",
    "fr": "(facultatif avec un lien ou un média)"
  },
  "firstComment": {
    "en": "First comment",
    "fr": "Premier commentaire"
  },
  "optional2": {
    "en": "(optional)",
    "fr": "(facultatif)"
  },
  "waitBeforeTheFirstComment": {
    "en": "Wait before the first comment",
    "fr": "Délai avant le premier commentaire"
  },
  "minutes0SendsItRightAfterPublication": {
    "en": "(minutes; 0 sends it right after publication)",
    "fr": "(minutes ; 0 l’envoie juste après la publication)"
  },
  "chooseAWholeNumberFrom0To": {
    "en": "Choose a whole number from 0 to",
    "fr": "Choisissez un nombre entier de 0 à"
  },
  "minutes": {
    "en": "minutes.",
    "fr": "minutes."
  },
  "link": {
    "en": "Link",
    "fr": "Lien"
  },
  "thePostCouldNotBeSavedYour": {
    "en": "The post could not be saved. Your changes are still here; try again.",
    "fr": "La publication n’a pas pu être enregistrée. Vos modifications sont conservées ; réessayez."
  },
  "uploading": {
    "en": "Uploading…",
    "fr": "Envoi…"
  },
  "saving": {
    "en": "Saving…",
    "fr": "Enregistrement…"
  },
  "savePost": {
    "en": "Save post",
    "fr": "Enregistrer la publication"
  },
  "deleteThisPostLocally": {
    "en": "Delete this post locally?",
    "fr": "Supprimer cette publication localement ?"
  },
  "thisPermanentlyRemovesThePostAndIts": {
    "en": "This permanently removes the post and its local publishing history.",
    "fr": "La publication et son historique local seront définitivement supprimés."
  },
  "chooseWhetherToRequestDeletionOfRecorded": {
    "en": "Choose whether to request deletion of recorded remote posts. Unconfirmed outcomes stay available here for review.",
    "fr": "Choisissez si vous souhaitez demander la suppression des publications enregistrées sur les plateformes. Les résultats non confirmés restent disponibles ici pour vérification."
  },
  "noRemotePostIsRecordedForThis": {
    "en": "No remote post is recorded for this item; only the local post and its history will be removed.",
    "fr": "Aucune publication sur une plateforme n’est enregistrée pour cet élément ; seuls la publication locale et son historique seront supprimés."
  },
  "alsoRequestDeletionOfRecordedRemotePosts": {
    "en": "Also request deletion of recorded remote posts.",
    "fr": "Demander aussi la suppression des publications enregistrées sur les plateformes."
  },
  "deletionStatus": {
    "en": "Deletion status",
    "fr": "Statut de suppression"
  },
  "deletionStatus2": {
    "en": "Deletion status:",
    "fr": "Statut de suppression :"
  },
  "recordDeleted": {
    "en": "Record deleted",
    "fr": "Enregistrer comme supprimé"
  },
  "recordNotDeleted": {
    "en": "Record not deleted",
    "fr": "Enregistrer comme non supprimé"
  },
  "theOriginalRequestMayStillCompleteLater2": {
    "en": "The original request may still complete later. For each destination, check the platform yourself before recording an outcome.",
    "fr": "La demande initiale peut encore aboutir. Pour chaque destination, vérifiez vous-même la plateforme avant d’enregistrer un résultat."
  },
  "iCheckedThePlatformOutsideThisApp2": {
    "en": "I checked the platform outside this app and understand a late deletion result may still appear.",
    "fr": "J’ai vérifié la plateforme en dehors de cette application et je comprends qu’un résultat de suppression tardif reste possible."
  },
  "weCouldNotConfirmWhetherThisPost": {
    "en": "We could not confirm whether this post was deleted. Check its current status before trying again.",
    "fr": "La suppression n’a pas pu être confirmée. Vérifiez le statut actuel avant de réessayer."
  },
  "close": {
    "en": "Close",
    "fr": "Fermer"
  },
  "checkDeletionStatus": {
    "en": "Check deletion status",
    "fr": "Vérifier le statut de suppression"
  },
  "finishLocalRemoval": {
    "en": "Finish local removal",
    "fr": "Terminer la suppression locale"
  },
  "newDeletionRequest": {
    "en": "New deletion request",
    "fr": "Nouvelle demande de suppression"
  },
  "deletePost": {
    "en": "Delete post",
    "fr": "Supprimer la publication"
  },
  "remoteDeletionConfirmed": {
    "en": "Remote deletion confirmed",
    "fr": "Suppression sur la plateforme confirmée"
  },
  "requestStarted": {
    "en": "Request started",
    "fr": "Demande démarrée"
  },
  "outcomeUnconfirmed": {
    "en": "Outcome unconfirmed",
    "fr": "Résultat non confirmé"
  },
  "localCleanupCompleted": {
    "en": "Local cleanup completed",
    "fr": "Nettoyage local terminé"
  },
  "notDeleted": {
    "en": "Not deleted",
    "fr": "Non supprimé"
  },
  "needsReview": {
    "en": "Needs review",
    "fr": "À vérifier"
  },
  "weCouldNotConfirmWhetherThisPost2": {
    "en": "We could not confirm whether this post was saved. Your changes are still here; check the post before trying again.",
    "fr": "L’enregistrement de cette publication n’a pas pu être confirmé. Vos modifications sont conservées ; vérifiez la publication avant de réessayer."
  },
  "theDeletionResultIsUnconfirmedCheckDeletion": {
    "en": "The deletion result is unconfirmed. Check deletion status before trying again.",
    "fr": "La suppression n’est pas confirmée. Vérifiez le statut de suppression avant de réessayer."
  },
  "scheduleYourLocalTime": {
    "en": "Schedule (your local time)",
    "fr": "Programmer (votre heure locale)"
  },
  "addToQueue": {
    "en": "Add to queue",
    "fr": "Ajouter à la file"
  },
  "destinations": {
    "en": "Destinations",
    "fr": "Destinations"
  },
  "noEnabledDestinationsCanPublishRightNow": {
    "en": "No enabled destinations can publish right now.",
    "fr": "Aucune destination activée ne peut publier pour le moment."
  },
  "onlyEnabledDestinationsThatSupportPublishingAre": {
    "en": "Only enabled destinations that support publishing are shown.",
    "fr": "Seules les destinations activées permettant la publication sont affichées."
  },
  "publishNow": {
    "en": "Publish now",
    "fr": "Publier maintenant"
  },
  "undo": {
    "en": "Undo",
    "fr": "Annuler"
  },
  "theCopyResultCouldNotBeConfirmed": {
    "en": "The copy result could not be confirmed.",
    "fr": "Le résultat de la copie n’a pas pu être confirmé."
  },
  "copying": {
    "en": "Copying…",
    "fr": "Copie…"
  },
  "duplicateAsDraft": {
    "en": "Duplicate as draft",
    "fr": "Dupliquer en brouillon"
  },
  "createsANewUnscheduledDraftWithThe": {
    "en": "Creates a new unscheduled draft with the content, first comment, media, and currently selected destinations copied. No changes are made on destinations.",
    "fr": "Crée un brouillon non programmé avec une copie du contenu, du premier commentaire, des médias et des destinations actuellement sélectionnées. Aucune modification n’est apportée aux destinations."
  },
  "checkDrafts": {
    "en": "Check Drafts",
    "fr": "Vérifier les brouillons"
  },
  "beforeTryingAgain": {
    "en": "before trying again.",
    "fr": "avant de réessayer."
  },
  "publicationRecoveryCouldNotBeLoaded": {
    "en": "Publication recovery could not be loaded.",
    "fr": "Impossible de charger la récupération de publication."
  },
  "publicationRecoveryReturnedAnUnreadableStatusReload": {
    "en": "Publication recovery returned an unreadable status. Reload and check again.",
    "fr": "Le statut de récupération est illisible. Rechargez la page et vérifiez à nouveau."
  },
  "chooseTheOutcomeYouCheckedOnThe": {
    "en": "Choose the outcome you checked on the destination.",
    "fr": "Choisissez le résultat vérifié sur la destination."
  },
  "enterTheRemotePostIDFoundOn": {
    "en": "Enter the remote post ID found on the destination.",
    "fr": "Saisissez l’identifiant de publication trouvé sur la destination."
  },
  "enterTheExactConfirmationShown": {
    "en": "Enter the exact confirmation shown.",
    "fr": "Saisissez la confirmation exacte affichée."
  },
  "theRecoveryOutcomeCouldNotBeSaved": {
    "en": "The recovery outcome could not be saved. Check current status before repeating it.",
    "fr": "Le résultat de récupération n’a pas pu être enregistré. Vérifiez le statut actuel avant de recommencer."
  },
  "theOutcomeMayHaveBeenSavedBut": {
    "en": "The outcome may have been saved, but the returned status was unreadable. Refresh publication status before repeating any action.",
    "fr": "Le résultat a peut-être été enregistré, mais le statut renvoyé est illisible. Actualisez le statut de publication avant de recommencer."
  },
  "theResponseDidNotConfirmThisOperation": {
    "en": "The response did not confirm this operation. Refresh publication status before repeating it.",
    "fr": "La réponse n’a pas confirmé cette opération. Actualisez le statut de publication avant de recommencer."
  },
  "localPublicationRecordUpdatedNoNewPublication": {
    "en": "Local publication record updated. No new publication was sent.",
    "fr": "L’enregistrement local de publication a été mis à jour. Aucune nouvelle publication n’a été envoyée."
  },
  "olderDestinationAdoptedForOutcomeReview": {
    "en": "Older destination adopted for outcome review.",
    "fr": "Ancienne destination reprise pour vérification du résultat."
  },
  "humanverifiedReceiptSavedFinishTheLocalRecord": {
    "en": "Human-verified receipt saved. Finish the local record separately. No new publication was sent.",
    "fr": "Confirmation vérifiée manuellement enregistrée. Terminez l’enregistrement local séparément. Aucune nouvelle publication n’a été envoyée."
  },
  "humanverifiedReceiptSavedFinishTheLocalRecord2": {
    "en": "Human-verified receipt saved. Finish the local record separately.",
    "fr": "Confirmation vérifiée manuellement enregistrée. Terminez l’enregistrement local séparément."
  },
  "humanverifiedAbsenceRecordedNoPublicationWasSent": {
    "en": "Human-verified absence recorded. No publication was sent.",
    "fr": "Absence vérifiée manuellement enregistrée. Aucune publication n’a été envoyée."
  },
  "publicationStatusCouldNotBeRefreshed": {
    "en": "Publication status could not be refreshed.",
    "fr": "Impossible d’actualiser le statut de publication."
  },
  "publicationRecovery": {
    "en": "Publication recovery",
    "fr": "Récupération de publication"
  },
  "publicationResultNeedsReview": {
    "en": "Publication result needs review",
    "fr": "Le résultat de publication doit être vérifié"
  },
  "aDestinationMayHaveAcceptedThisPost": {
    "en": "A destination may have accepted this post even if its response was lost. Check the destination directly before recording an outcome.",
    "fr": "Une destination a pu accepter cette publication même si sa réponse a été perdue. Vérifiez directement la destination avant d’enregistrer un résultat."
  },
  "hideRecovery": {
    "en": "Hide recovery",
    "fr": "Masquer la récupération"
  },
  "reviewPublicationResult": {
    "en": "Review publication result",
    "fr": "Vérifier le résultat de publication"
  },
  "loadingPublicationHistory": {
    "en": "Loading publication history…",
    "fr": "Chargement de l’historique de publication…"
  },
  "refreshPublicationStatus": {
    "en": "Refresh publication status",
    "fr": "Actualiser le statut de publication"
  },
  "postContext": {
    "en": "Post context:",
    "fr": "Contexte de la publication :"
  },
  "noPostTextIsAvailable": {
    "en": "No post text is available.",
    "fr": "Aucun texte de publication n’est disponible."
  },
  "thisHistoryIsLimitedToRecentOperations": {
    "en": "This history is limited to recent operations. Older records are not shown here. Ask your workspace administrator if you need more history.",
    "fr": "Cet historique se limite aux opérations récentes. Les anciens enregistrements ne sont pas affichés ici. Contactez l’administrateur de votre espace pour consulter davantage d’historique."
  },
  "operation": {
    "en": "Operation",
    "fr": "Opération"
  },
  "remotePostID": {
    "en": "Remote post ID:",
    "fr": "Identifiant de publication sur la plateforme :"
  },
  "openRecordedPublication": {
    "en": "Open recorded publication",
    "fr": "Ouvrir la publication enregistrée"
  },
  "recordExternalCheck": {
    "en": "Record external check",
    "fr": "Enregistrer la vérification externe"
  },
  "verifySubmittedPublication": {
    "en": "Verify submitted publication",
    "fr": "Vérifier la publication envoyée"
  },
  "finishLocalRecord": {
    "en": "Finish local record",
    "fr": "Terminer l’enregistrement local"
  },
  "olderProcessingDestinationsHaveNoRecoveryOperation": {
    "en": "older processing destination(s) have no recovery operation yet. Adopt only after checking the destination directly.",
    "fr": "anciennes destinations en cours n’ont pas encore d’opération de récupération. Reprenez-les uniquement après avoir vérifié directement la destination."
  },
  "adopt": {
    "en": "Adopt",
    "fr": "Reprendre"
  },
  "forRecovery": {
    "en": "for recovery",
    "fr": "pour récupération"
  },
  "recordTheDestinationCheck": {
    "en": "Record the destination check",
    "fr": "Enregistrer la vérification de la destination"
  },
  "finishTheLocalPublicationRecord": {
    "en": "Finish the local publication record?",
    "fr": "Terminer l’enregistrement local de publication ?"
  },
  "adoptThisOlderDestination": {
    "en": "Adopt this older destination?",
    "fr": "Reprendre cette ancienne destination ?"
  },
  "thisUpdatesLocalRecordsOnly": {
    "en": "This updates local records only.",
    "fr": "Ceci met uniquement à jour les enregistrements locaux."
  },
  "checkThatThisExactSubmittedPostIs": {
    "en": "Check that this exact submitted post is published. Its saved ID cannot be replaced. This records your external check; finish the local record separately.",
    "fr": "Vérifiez que cette publication envoyée précise est publiée. Son identifiant enregistré ne peut pas être remplacé. Ceci enregistre votre vérification externe ; terminez l’enregistrement local séparément."
  },
  "whatDidYouVerifyOnTheDestination": {
    "en": "What did you verify on the destination?",
    "fr": "Qu’avez-vous vérifié sur la destination ?"
  },
  "thePostIsAbsent": {
    "en": "The post is absent",
    "fr": "La publication est absente"
  },
  "thePostIsPublished": {
    "en": "The post is published",
    "fr": "La publication est publiée"
  },
  "remotePostID2": {
    "en": "Remote post ID",
    "fr": "Identifiant de publication sur la plateforme"
  },
  "publicPostLinkIfAvailable": {
    "en": "Public post link, if available",
    "fr": "Lien public de la publication, si disponible"
  },
  "iCheckedThisExactDestinationMyselfThis": {
    "en": "I checked this exact destination myself. This is not automated verification, and a delayed request may still complete later.",
    "fr": "J’ai vérifié cette destination précise moi-même. Il ne s’agit pas d’une vérification automatique et une demande retardée peut encore aboutir."
  },
  "thisOnlyProjectsASavedReceiptInto": {
    "en": "This only projects a saved receipt into local post records. It will not send another publication request.",
    "fr": "Ceci reporte uniquement une confirmation enregistrée dans les données locales. Aucune nouvelle demande de publication ne sera envoyée."
  },
  "theAppWillNotContactThePlatform": {
    "en": "The app will not contact the platform or retry the original request.",
    "fr": "L’application ne contactera pas la plateforme et ne réessaiera pas la demande initiale."
  },
  "type": {
    "en": "Type",
    "fr": "Saisissez"
  },
  "toConfirm": {
    "en": "to confirm",
    "fr": "pour confirmer"
  },
  "checkingStatus": {
    "en": "Checking status…",
    "fr": "Vérification du statut…"
  },
  "adoptForRecovery": {
    "en": "Adopt for recovery",
    "fr": "Reprendre pour récupération"
  },
  "recordCheckedOutcome": {
    "en": "Record checked outcome",
    "fr": "Enregistrer le résultat vérifié"
  },
  "thePostCouldNotBeAddedTo": {
    "en": "The post could not be added to the queue. Review it and try again.",
    "fr": "La publication n’a pas pu être ajoutée à la file. Vérifiez-la et réessayez."
  },
  "theQueueResponseCouldNotBeVerified": {
    "en": "The queue response could not be verified. Refresh the post list before retrying.",
    "fr": "La réponse de la file n’a pas pu être vérifiée. Actualisez la liste des publications avant de réessayer."
  },
  "theQueueRequestCouldNotBeConfirmed": {
    "en": "The queue request could not be confirmed. Refresh the post list before retrying.",
    "fr": "La demande de mise en file n’a pas pu être confirmée. Actualisez la liste des publications avant de réessayer."
  },
  "reviewQueuePlacement": {
    "en": "Review queue placement",
    "fr": "Vérifier la mise en file"
  },
  "theNextSavedQueueTimeWillBe": {
    "en": "The next saved queue time will be assigned when you confirm. Approval may be required before the post can publish; the queue will show the time the server allocates.",
    "fr": "Le prochain horaire enregistré sera attribué lors de votre confirmation. Une approbation peut être nécessaire avant la publication ; la file affichera l’horaire attribué."
  },
  "addingToQueue": {
    "en": "Adding to queue…",
    "fr": "Ajout à la file…"
  },
  "postBeingQueued": {
    "en": "Post being queued",
    "fr": "Publication mise en file"
  },
  "noPostText": {
    "en": "No post text",
    "fr": "Aucun texte de publication"
  },
  "pendingDestinations": {
    "en": "Pending destinations",
    "fr": "Destinations en attente"
  },
  "exportPosts": {
    "en": "Export posts",
    "fr": "Exporter les publications"
  },
  "exportMatchingPosts": {
    "en": "Export matching posts",
    "fr": "Exporter les publications correspondantes"
  },
  "preparingCSV": {
    "en": "Preparing CSV…",
    "fr": "Préparation du CSV…"
  },
  "approve": {
    "en": "Approve",
    "fr": "Approuver"
  },
  "reject": {
    "en": "Reject",
    "fr": "Refuser"
  },
  "bulk_selectAll": {
    "en": "Select all posts on this page",
    "fr": "Sélectionner toutes les publications de cette page"
  },
  "bulk_clear": {
    "en": "Clear selection",
    "fr": "Effacer la sélection"
  },
  "bulk_actions_delete": {
    "en": "Delete locally",
    "fr": "Supprimer localement"
  },
  "bulk_actions_duplicate": {
    "en": "Duplicate",
    "fr": "Dupliquer"
  },
  "bulk_actions_reschedule": {
    "en": "Reschedule",
    "fr": "Reprogrammer"
  },
  "bulk_actions_retry": {
    "en": "Retry failed destinations",
    "fr": "Relancer les destinations en échec"
  },
  "bulk_titles_delete": {
    "en": "Delete selected posts locally?",
    "fr": "Supprimer localement les publications sélectionnées ?"
  },
  "bulk_titles_duplicate": {
    "en": "Duplicate selected posts?",
    "fr": "Dupliquer les publications sélectionnées ?"
  },
  "bulk_titles_reschedule": {
    "en": "Reschedule selected posts?",
    "fr": "Reprogrammer les publications sélectionnées ?"
  },
  "bulk_titles_retry": {
    "en": "Retry failed destinations?",
    "fr": "Relancer les destinations en échec ?"
  },
  "bulk_descriptions_delete": {
    "en": "Removes the selected posts from this workspace. Published copies stay on their platforms; delete a post individually to remove it from a platform too.",
    "fr": "Retire les publications sélectionnées de cet espace de travail. Les copies publiées restent sur leurs plateformes ; supprimez une publication individuellement pour la retirer aussi de la plateforme."
  },
  "bulk_descriptions_duplicate": {
    "en": "Creates a new unscheduled draft for each selected post.",
    "fr": "Crée un nouveau brouillon non programmé pour chaque publication sélectionnée."
  },
  "bulk_descriptions_reschedule": {
    "en": "Moves selected posts that are still waiting to publish to the chosen workspace date and time. Other posts are skipped.",
    "fr": "Déplace à la date et à l'heure choisies (fuseau de l'espace de travail) les publications encore en attente. Les autres sont ignorées."
  },
  "bulk_descriptions_retry": {
    "en": "Sends again only to destinations that clearly failed. Destinations with an uncertain or pending result are not sent again; check them first.",
    "fr": "Renvoie uniquement vers les destinations clairement en échec. Les destinations au résultat incertain ou en attente ne sont pas renvoyées ; vérifiez-les d'abord."
  },
  "bulk_date": {
    "en": "Date",
    "fr": "Date"
  },
  "bulk_time": {
    "en": "Time",
    "fr": "Heure"
  },
  "bulk_cancel": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "bulk_confirm": {
    "en": "Confirm",
    "fr": "Confirmer"
  },
  "bulk_working": {
    "en": "Working…",
    "fr": "En cours…"
  },
  "bulk_unconfirmed": {
    "en": "The result could not be confirmed. Refresh Posts and check each post before trying again.",
    "fr": "Le résultat n'a pas pu être confirmé. Actualisez les publications et vérifiez chacune avant de réessayer."
  },
  "bulk_retryOne": {
    "en": "Retry failed destinations",
    "fr": "Relancer les destinations en échec"
  },
  "bulk_whenRequired": {
    "en": "Choose a future date and time.",
    "fr": "Choisissez une date et une heure futures."
  },
  "bulk_tryAgain": {
    "en": "Try again",
    "fr": "Réessayer"
  },
  "saved_heading": {
    "en": "Saved views",
    "fr": "Vues enregistrées"
  },
  "saved_empty": {
    "en": "No saved views yet. Apply filters, then save them here.",
    "fr": "Aucune vue enregistrée. Appliquez des filtres, puis enregistrez-les ici."
  },
  "saved_nameLabel": {
    "en": "View name",
    "fr": "Nom de la vue"
  },
  "saved_save": {
    "en": "Save current view",
    "fr": "Enregistrer la vue actuelle"
  },
  "saved_saving": {
    "en": "Saving…",
    "fr": "Enregistrement…"
  },
  "saved_saved": {
    "en": "View saved.",
    "fr": "Vue enregistrée."
  },
  "saved_remove": {
    "en": "Remove",
    "fr": "Supprimer"
  },
  "saved_removed": {
    "en": "View removed.",
    "fr": "Vue supprimée."
  },
  "saved_loadFailed": {
    "en": "Saved views could not be loaded. Refresh the page and try again.",
    "fr": "Impossible de charger les vues enregistrées. Actualisez la page et réessayez."
  },
  "saved_saveFailed": {
    "en": "The view could not be saved. Check its name and try again.",
    "fr": "La vue n'a pas pu être enregistrée. Vérifiez son nom et réessayez."
  },
  "saved_removeFailed": {
    "en": "The view could not be removed. Refresh and try again.",
    "fr": "La vue n'a pas pu être supprimée. Actualisez et réessayez."
  },
  "saved_nameRequired": {
    "en": "Enter a name for this view.",
    "fr": "Saisissez un nom pour cette vue."
  },
  "saved_limit": {
    "en": "You have reached the saved view limit for this screen. Remove one first.",
    "fr": "Vous avez atteint la limite de vues enregistrées pour cet écran. Supprimez-en une d’abord."
  },
  "saved_invalid": {
    "en": "These filters cannot be saved. Reset the filters and try again.",
    "fr": "Ces filtres ne peuvent pas être enregistrés. Réinitialisez les filtres et réessayez."
  },
  "retry_retry": {
    "en": "Retry failed first comment",
    "fr": "Réessayer le premier commentaire échoué"
  },
  "retry_title": {
    "en": "Retry this first comment?",
    "fr": "Réessayer ce premier commentaire ?"
  },
  "retry_cancel": {
    "en": "Cancel",
    "fr": "Annuler"
  },
  "retry_description": {
    "en": "The platform definitely rejected the previous attempt. Send the saved comment again now, overriding its saved delay. An uncertain result will stay held for review.",
    "fr": "La plateforme a définitivement refusé la tentative précédente. Envoyer à nouveau le commentaire enregistré maintenant, sans attendre le délai prévu. Un résultat incertain restera bloqué pour vérification."
  },
  "retry_confirmation": {
    "en": "Type to confirm",
    "fr": "Saisissez pour confirmer"
  },
  "retry_pending": {
    "en": "Retrying…",
    "fr": "Nouvelle tentative…"
  },
  "retry_failed": {
    "en": "The retry could not be completed. Refresh Posts and review the current comment state.",
    "fr": "La nouvelle tentative a échoué. Actualisez les publications et vérifiez l’état actuel du commentaire."
  },
  "retry_held": {
    "en": "The result is uncertain. Close this dialog and refresh Posts to review the outcome before another action.",
    "fr": "Le résultat est incertain. Fermez cette fenêtre et actualisez les publications pour vérifier le résultat avant toute autre action."
  },
  "retry_sent": {
    "en": "First comment recorded as sent.",
    "fr": "Premier commentaire enregistré comme envoyé."
  },
  "retry_rejected": {
    "en": "The platform rejected the comment again. Review it before making a separately confirmed retry.",
    "fr": "La plateforme a de nouveau refusé le commentaire. Vérifiez-le avant une nouvelle tentative confirmée séparément."
  },
  "retry_status": {
    "en": "First comment failed: the platform rejected it.",
    "fr": "Échec du premier commentaire : la plateforme l’a refusé."
  },
  "retry_unavailable": {
    "en": "Not available",
    "fr": "Non disponible"
  },
  "countdown": {
    "en": "Publishing in {seconds} s",
    "fr": "Publication dans {seconds} s"
  },
  "firstCommentScheduled": {
    "en": "First comment scheduled for {time} ({zone})",
    "fr": "Premier commentaire programmé pour {time} ({zone})"
  },
  "firstCommentWait": {
    "en": "First comment waits {minutes} minutes after publication",
    "fr": "Le premier commentaire attend {minutes} minutes après la publication"
  },
  "firstCommentDeliveryFor": {
    "en": "First comment delivery for {destination}",
    "fr": "Envoi du premier commentaire pour {destination}"
  },
  "thisDestination": {
    "en": "this destination",
    "fr": "cette destination"
  },
  "imageFormat": {
    "en": "this image format",
    "fr": "ce format d’image"
  },
  "noUpload": {
    "en": "{destination} does not currently support local image uploads. Remove the uploaded image or choose another destination.",
    "fr": "{destination} ne permet pas actuellement l’envoi d’images locales. Retirez l’image envoyée ou choisissez une autre destination."
  },
  "uploadType": {
    "en": "{destination} does not accept {format}. Choose another image or destination.",
    "fr": "{destination} n’accepte pas {format}. Choisissez une autre image ou destination."
  },
  "uploadSize": {
    "en": "{destination} accepts images up to {size} MB. Choose another image or destination.",
    "fr": "{destination} accepte les images jusqu’à {size} Mo. Choisissez une autre image ou destination."
  },
  "sendDelayOverride": {
    "en": ", without waiting for its saved delay",
    "fr": ", sans attendre le délai enregistré"
  },
  "externalCheck": {
    "en": "External check for {destination}.",
    "fr": "Vérification externe pour {destination}."
  },
  "chooseOutcome": {
    "en": "choose an outcome first",
    "fr": "choisissez d’abord un résultat"
  },
  "checking": {
    "en": "Checking…",
    "fr": "Vérification…"
  },
  "submitted": {
    "en": "Submitted; awaiting verification",
    "fr": "Envoyée ; en attente de vérification"
  },
  "queued": {
    "en": "Post added to the queue for {time}.",
    "fr": "Publication ajoutée à la file pour {time}."
  },
  "queuedApproval": {
    "en": "Post added to the queue for {time}. It still needs approval before it can publish.",
    "fr": "Publication ajoutée à la file pour {time}. Elle doit encore être approuvée avant de pouvoir être publiée."
  },
  "exportHelp": {
    "en": "Export the complete set of posts matching your applied search, status, and channel filters across all pages, up to {posts} posts and {bytes} bytes. The selected page and view do not limit the export.",
    "fr": "Exportez toutes les publications correspondant aux filtres de recherche, de statut et de canal appliqués, sur toutes les pages, jusqu’à {posts} publications et {bytes} octets. La page et la vue sélectionnées ne limitent pas l’export."
  },
  "postSingular": {
    "en": "post",
    "fr": "publication"
  },
  "postPlural": {
    "en": "posts",
    "fr": "publications"
  },
  "bulk_selected": {
    "en": "{count} selected",
    "fr": "{count} sélectionnée(s)"
  },
  "bulk_summary": {
    "en": "{done} done, {needsReview} need review, {skipped} skipped, {failed} failed.",
    "fr": "{done} terminée(s), {needsReview} à vérifier, {skipped} ignorée(s), {failed} en échec."
  },
  "bulk_retryOneHelp": {
    "en": "{count} destination{suffix} failed and can be sent again.",
    "fr": "{count} destination{suffix} en échec à renvoyer."
  },
  "saved_removeLabel": {
    "en": "Remove saved view {name}",
    "fr": "Supprimer la vue enregistrée {name}"
  },
  "workflow_cancelling": {
    "en": "Cancelling…",
    "fr": "Annulation…"
  },
  "comment_not_requested": { "en": "No first comment requested", "fr": "Aucun premier commentaire demandé" },
  "comment_awaiting_post": { "en": "First comment awaits publication", "fr": "Le premier commentaire attend la publication" },
  "comment_ready": { "en": "First comment has not been sent", "fr": "Le premier commentaire n’a pas été envoyé" },
  "comment_sent": { "en": "First comment recorded as sent", "fr": "Premier commentaire enregistré comme envoyé" },
  "comment_needs_review": { "en": "First comment needs review", "fr": "Le premier commentaire doit être vérifié" },
  "bulk_select": { "en": "Select post {label}", "fr": "Sélectionner la publication {label}" }
,
"bulk_selectedZero": {"en": "{count} selected", "fr": "{count} sélectionnée"},
"bulk_selectedOne": {"en": "{count} selected", "fr": "{count} sélectionnée"},
"bulk_selectedMany": {"en": "{count} selected", "fr": "{count} sélectionnées"},
"bulk_retryOneHelpZero": {"en": "{count} destinations failed and can be sent again.", "fr": "{count} destination en échec peut être renvoyée."},
"bulk_retryOneHelpOne": {"en": "{count} destination failed and can be sent again.", "fr": "{count} destination en échec peut être renvoyée."},
"bulk_retryOneHelpMany": {"en": "{count} destinations failed and can be sent again.", "fr": "{count} destinations en échec peuvent être renvoyées."},
"publication_started": {"en": "started", "fr": "démarrée"},
"publication_uncertain": {"en": "uncertain", "fr": "incertaine"},
"publication_receipt_recorded": {"en": "receipt recorded", "fr": "confirmation enregistrée"},
"publication_projected": {"en": "projected", "fr": "reportée localement"},
"publication_rejected": {"en": "rejected", "fr": "refusée"},
"publication_attested_absent": {"en": "attested absent", "fr": "absence attestée"},
"deletion_local_pending": {"en": "local pending", "fr": "suppression locale en attente"},
"deletion_needs_review": {"en": "needs review", "fr": "à vérifier"},
"deletion_completed": {"en": "completed", "fr": "terminée"},
"deletion_none": {"en": "none", "fr": "aucune"}
};
export type PublishingActionCopy = typeof publishingActionCopy;
export type PublishingActionCopyKey = keyof PublishingActionCopy;
export type PublishingActionText = (key: PublishingActionCopyKey, values?: Record<string, string | number>) => string;
const bilingual = z.object({ en: z.string().min(1).max(4000), fr: z.string().min(1).max(4000) }).strict();
export const publishingActionCopySchema = z.object(Object.fromEntries(Object.keys(publishingActionCopy).map(key => [key, bilingual])) as { [K in PublishingActionCopyKey]: typeof bilingual }).strict().superRefine((catalog, context) => {
  for (const key of Object.keys(publishingActionCopy) as PublishingActionCopyKey[]) {
    const expected = [...publishingActionCopy[key].en.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort().join(',');
    for (const locale of ['en', 'fr'] as const) {
      const actual = [...catalog[key][locale].matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort().join(',');
      if (actual !== expected) context.addIssue({ code: z.ZodIssueCode.custom, path: [key, locale], message: 'Keep the named placeholders from the default copy.' });
    }
  }
});
export function publishingActionText(catalog: PublishingActionCopy, locale: string = 'en'): PublishingActionText {
  const language = locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  return (key, values = {}) => catalog[key][language].replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) => String(values[name] ?? match));
}
export const defaultPublishingActionText = publishingActionText(publishingActionCopy);
export const ACTION_COPY_CONFIG = [entry({ key: 'publishing.actionCopy', group: 'Publishing · Copy', label: 'Publishing action copy', kind: 'json', description: 'English and French publishing actions, recovery dialogs, queue, saved views and export copy. Keep named placeholders.', defaultValue: publishingActionCopy, schema: publishingActionCopySchema, consumption: 'active' })] as const;

export function actionBulkCopy(t: PublishingActionText) {
  const actions = { delete: t('bulk_actions_delete'), duplicate: t('bulk_actions_duplicate'), reschedule: t('bulk_actions_reschedule'), retry: t('bulk_actions_retry') };
  const titles = { delete: t('bulk_titles_delete'), duplicate: t('bulk_titles_duplicate'), reschedule: t('bulk_titles_reschedule'), retry: t('bulk_titles_retry') };
  const descriptions = { delete: t('bulk_descriptions_delete'), duplicate: t('bulk_descriptions_duplicate'), reschedule: t('bulk_descriptions_reschedule'), retry: t('bulk_descriptions_retry') };
  return { select: (label: string) => t('bulk_select', { label }), selectAll: t('bulk_selectAll'), actions, titles, descriptions, date: t('bulk_date'), time: t('bulk_time'), cancel: t('bulk_cancel'), confirm: t('bulk_confirm'), working: t('bulk_working'), clear: t('bulk_clear'), unconfirmed: t('bulk_unconfirmed'), retryOne: t('bulk_retryOne'), whenRequired: t('bulk_whenRequired'), tryAgain: t('bulk_tryAgain'), selected: (count: number) => t(count === 0 ? 'bulk_selectedZero' : count === 1 ? 'bulk_selectedOne' : 'bulk_selectedMany', { count }), summary: (result: { done: number; needsReview: number; skipped: number; failed: number }) => t('bulk_summary', result), retryOneHelp: (count: number) => t(count === 0 ? 'bulk_retryOneHelpZero' : count === 1 ? 'bulk_retryOneHelpOne' : 'bulk_retryOneHelpMany', { count }) };
}
export function actionSavedViewCopy(t: PublishingActionText) {
  return { heading: t('saved_heading'), empty: t('saved_empty'), nameLabel: t('saved_nameLabel'), save: t('saved_save'), saving: t('saved_saving'), saved: t('saved_saved'), remove: t('saved_remove'), removed: t('saved_removed'), loadFailed: t('saved_loadFailed'), saveFailed: t('saved_saveFailed'), removeFailed: t('saved_removeFailed'), nameRequired: t('saved_nameRequired'), limit: t('saved_limit'), invalid: t('saved_invalid'), removeLabel: (name: string) => t('saved_removeLabel', { name }) };
}
