import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';

export const publishingErrorCopy = {
  "signInWithAnActiveAccountToManagePosts": {
    "en": "Sign in with an active account to manage posts.",
    "fr": "Connectez-vous avec un compte actif pour gérer les publications."
  },
  "publishingAccessIsUnavailableInThisWorkspace": {
    "en": "Publishing access is unavailable in this workspace.",
    "fr": "L’accès aux publications est indisponible dans cet espace."
  },
  "confirmationRequiredRepeatTheCallWithConfirmationExactlyValue0": {
    "en": "Confirmation required. Repeat the call with confirmation exactly: {value0}",
    "fr": "Confirmation requise. Répétez l’appel avec cette confirmation exacte : {value0}"
  },
  "chooseAScheduledAtBeforeChoosingWhereTheScheduleIs": {
    "en": "Choose a scheduledAt before choosing where the schedule is held.",
    "fr": "Choisissez une date de publication avant de choisir où conserver la programmation."
  },
  "unknownPostAction": {
    "en": "Unknown post action.",
    "fr": "Action de publication inconnue."
  },
  "thisPostIsNotReadyForAutomaticSchedulingReview": {
    "en": "This post is not ready for automatic scheduling. Review its content, approval and destinations.",
    "fr": "Cette publication n’est pas prête pour la programmation automatique. Vérifiez son contenu, son approbation et ses destinations."
  },
  "chooseValidDistinctDestinationsChoisissezDesDestinationsDistinctesValides": {
    "en": "Choose valid distinct destinations. / Choisissez des destinations distinctes valides.",
    "fr": "Choisissez des destinations distinctes valides."
  },
  "aDestinationIsOutsideYourChannelAccessUneDestination": {
    "en": "A destination is outside your channel access. / Une destination est hors de votre accès.",
    "fr": "Une destination est hors de votre accès aux canaux."
  },
  "workspaceTimingSettingsAreUnavailableLesParamtresHorairesSont": {
    "en": "Workspace timing settings are unavailable. / Les paramètres horaires sont indisponibles.",
    "fr": "Les paramètres horaires de cet espace sont indisponibles."
  },
  "choosePostsAndAnActionThenConfirm": {
    "en": "Choose posts and an action, then confirm.",
    "fr": "Choisissez des publications et une action, puis confirmez."
  },
  "eachPostCanBeSelectedOnce": {
    "en": "Each post can be selected once.",
    "fr": "Chaque publication ne peut être sélectionnée qu’une fois."
  },
  "confirmTheExactBulkAction": {
    "en": "Confirm the exact bulk action.",
    "fr": "Confirmez l’action groupée exacte."
  },
  "chooseAFutureDateAndTime": {
    "en": "Choose a future date and time.",
    "fr": "Choisissez une date et une heure futures."
  },
  "thisWorkspaceHasNoValidTimeZone": {
    "en": "This workspace has no valid time zone.",
    "fr": "Cet espace n’a pas de fuseau horaire valide."
  },
  "thisPostOrDeletionIsUnavailableInTheCurrent": {
    "en": "This post or deletion is unavailable in the current workspace.",
    "fr": "Cette publication ou suppression est indisponible dans cet espace."
  },
  "chooseAValidPublishingRecord": {
    "en": "Choose a valid publishing record.",
    "fr": "Choisissez un enregistrement de publication valide."
  },
  "thisDeletionHistoryNeedsAdministratorReview": {
    "en": "This deletion history needs administrator review.",
    "fr": "Cet historique de suppression doit être vérifié par un administrateur."
  },
  "youDoNotHavePermissionToPerformThisDeletion": {
    "en": "You do not have permission to perform this deletion.",
    "fr": "Vous n’avez pas l’autorisation d’effectuer cette suppression."
  },
  "aPublishingResultNeedsReviewBeforeThisPostCan": {
    "en": "A publishing result needs review before this post can be removed.",
    "fr": "Un résultat de publication doit être vérifié avant de supprimer cette publication."
  },
  "chooseAValidDeletionOutcome": {
    "en": "Choose a valid deletion outcome.",
    "fr": "Choisissez un résultat de suppression valide."
  },
  "thisDeletionAlreadyHasARecordedOutcome": {
    "en": "This deletion already has a recorded outcome.",
    "fr": "Un résultat est déjà enregistré pour cette suppression."
  },
  "confirmEveryPlatformDeletionBeforeRemovingThisLocalPost": {
    "en": "Confirm every platform deletion before removing this local post.",
    "fr": "Confirmez chaque suppression sur les plateformes avant de retirer cette publication locale."
  },
  "thisDeletionHasTooManyStoredReferencesAskAn": {
    "en": "This deletion has too many stored references. Ask an administrator to review it.",
    "fr": "Cette suppression contient trop de références. Demandez à un administrateur de la vérifier."
  },
  "confirmRecoveryForThisExactPost": {
    "en": "Confirm recovery for this exact post.",
    "fr": "Confirmez la récupération de cette publication précise."
  },
  "verifyThePlatformResultAndConfirmThisExactDeletion": {
    "en": "Verify the platform result and confirm this exact deletion outcome.",
    "fr": "Vérifiez le résultat sur la plateforme et confirmez ce résultat de suppression précis."
  },
  "chooseWhetherToRemoveRemotePublications": {
    "en": "Choose whether to remove remote publications.",
    "fr": "Choisissez si vous souhaitez supprimer les publications sur les plateformes."
  },
  "aDestinationConnectionNeedsReviewBeforeRemoteDeletion": {
    "en": "A destination connection needs review before remote deletion.",
    "fr": "La connexion d’une destination doit être vérifiée avant la suppression sur la plateforme."
  },
  "thisDeletionHasTooManyStoredReferences": {
    "en": "This deletion has too many stored references.",
    "fr": "Cette suppression contient trop de références enregistrées."
  },
  "reconnectEachSelectedDestinationBeforeRemoteDeletionTheLocal": {
    "en": "Reconnect each selected destination before remote deletion. The local post is preserved.",
    "fr": "Reconnectez chaque destination sélectionnée avant la suppression sur les plateformes. La publication locale est conservée."
  },
  "reconnectThisDestinationBeforeRemoteDeletion": {
    "en": "Reconnect this destination before remote deletion.",
    "fr": "Reconnectez cette destination avant la suppression sur la plateforme."
  },
  "thisPublicationHasTooManyStoredReferencesAskAn": {
    "en": "This publication has too many stored references. Ask an administrator to review it.",
    "fr": "Cette publication contient trop de références. Demandez à un administrateur de la vérifier."
  },
  "chooseAValidPostToDuplicate": {
    "en": "Choose a valid post to duplicate.",
    "fr": "Choisissez une publication valide à dupliquer."
  },
  "confirmDuplicationOfThisPostAndProvideAValid": {
    "en": "Confirm duplication of this post and provide a valid request ID.",
    "fr": "Confirmez la duplication de cette publication et fournissez un identifiant de demande valide."
  },
  "thisWorkspaceIsUnavailable": {
    "en": "This workspace is unavailable.",
    "fr": "Cet espace de travail est indisponible."
  },
  "thisPostIsUnavailableInTheCurrentWorkspace": {
    "en": "This post is unavailable in the current workspace.",
    "fr": "Cette publication est indisponible dans cet espace."
  },
  "youDoNotHavePermissionToDuplicatePosts": {
    "en": "You do not have permission to duplicate posts.",
    "fr": "Vous n’avez pas l’autorisation de dupliquer des publications."
  },
  "thisDuplicationRequestIDIsAlreadyInUse": {
    "en": "This duplication request ID is already in use.",
    "fr": "Cet identifiant de demande de duplication est déjà utilisé."
  },
  "theDraftCreatedByThisRequestIsNoLonger": {
    "en": "The draft created by this request is no longer available.",
    "fr": "Le brouillon créé par cette demande n’est plus disponible."
  },
  "thisPostHasAnUncertainOrActivePublishingState": {
    "en": "This post has an uncertain or active publishing state and cannot be duplicated.",
    "fr": "Cette publication est en cours ou son résultat est incertain ; elle ne peut pas être dupliquée."
  },
  "storedPostAttachmentsNeedReviewBeforeDuplication": {
    "en": "Stored post attachments need review before duplication.",
    "fr": "Les pièces jointes enregistrées doivent être vérifiées avant la duplication."
  },
  "thePublishingValue0LimitIsUnavailable": {
    "en": "The Publishing {value0} limit is unavailable.",
    "fr": "La limite de publication {value0} est indisponible."
  },
  "automaticFirstcommentSettingsAreUnavailable": {
    "en": "Automatic first-comment settings are unavailable.",
    "fr": "Les paramètres automatiques du premier commentaire sont indisponibles."
  },
  "youCannotManageFirstComments": {
    "en": "You cannot manage first comments.",
    "fr": "Vous ne pouvez pas gérer les premiers commentaires."
  },
  "thisPublishingRecordIsUnavailable": {
    "en": "This publishing record is unavailable.",
    "fr": "Cet enregistrement de publication est indisponible."
  },
  "thisPublishingDestinationIsUnavailable": {
    "en": "This publishing destination is unavailable.",
    "fr": "Cette destination de publication est indisponible."
  },
  "thePostMustBeConfirmedPublishedBeforeManagingIts": {
    "en": "The post must be confirmed published before managing its first comment.",
    "fr": "La publication doit être confirmée avant de gérer son premier commentaire."
  },
  "onlyADefinitelyRejectedFirstCommentCanBeRetried": {
    "en": "Only a definitely rejected first comment can be retried. Refresh this post and review its current outcome.",
    "fr": "Seul un premier commentaire clairement refusé peut être renvoyé. Actualisez cette publication et vérifiez son résultat actuel."
  },
  "thisFirstCommentWasRejectedUseTheSeparatelyConfirmed": {
    "en": "This first comment was rejected. Use the separately confirmed retry action.",
    "fr": "Ce premier commentaire a été refusé. Utilisez l’action de nouvelle tentative avec une confirmation séparée."
  },
  "thisFirstCommentRequiresAManualDecisionBeforeRetrying": {
    "en": "This first comment requires a manual decision before retrying.",
    "fr": "Ce premier commentaire nécessite une décision manuelle avant de réessayer."
  },
  "thisDestinationCannotSendItsFirstCommentRightNow": {
    "en": "This destination cannot send its first comment right now. Check its connection, then try again.",
    "fr": "Cette destination ne peut pas envoyer son premier commentaire actuellement. Vérifiez sa connexion puis réessayez."
  },
  "reconnectThisDestinationBeforeSendingItsFirstComment": {
    "en": "Reconnect this destination before sending its first comment.",
    "fr": "Reconnectez cette destination avant d’envoyer son premier commentaire."
  },
  "thisPublishingFormatCannotSendAFirstComment": {
    "en": "This publishing format cannot send a first comment.",
    "fr": "Ce format de publication ne permet pas l’envoi d’un premier commentaire."
  },
  "firstCommentReceiptStorageIsUnavailable": {
    "en": "First comment receipt storage is unavailable.",
    "fr": "L’enregistrement des confirmations du premier commentaire est indisponible."
  },
  "thisFirstCommentOrConnectionChangedRefreshBeforeContinuing": {
    "en": "This first comment or connection changed. Refresh before continuing.",
    "fr": "Ce premier commentaire ou cette connexion a changé. Actualisez avant de continuer."
  },
  "theFirstCommentChangedRefreshThisPostBeforeContinuing": {
    "en": "The first comment changed. Refresh this post before continuing.",
    "fr": "Le premier commentaire a changé. Actualisez cette publication avant de continuer."
  },
  "theCommentOutcomeNeedsReview": {
    "en": "The comment outcome needs review.",
    "fr": "Le résultat du commentaire doit être vérifié."
  },
  "chooseOneFailedFirstCommentAndConfirmItsRetry": {
    "en": "Choose one failed first comment and confirm its retry.",
    "fr": "Choisissez un premier commentaire en échec et confirmez sa nouvelle tentative."
  },
  "confirmRetryingThisExactFirstComment": {
    "en": "Confirm retrying this exact first comment.",
    "fr": "Confirmez la nouvelle tentative de ce premier commentaire précis."
  },
  "confirmThisExactFirstcommentOutcome": {
    "en": "Confirm this exact first-comment outcome.",
    "fr": "Confirmez ce résultat précis du premier commentaire."
  },
  "thisFirstCommentAlreadyHasARecordedOutcome": {
    "en": "This first comment already has a recorded outcome.",
    "fr": "Un résultat est déjà enregistré pour ce premier commentaire."
  },
  "thisFirstCommentHasNoUncertainAttemptToReview": {
    "en": "This first comment has no uncertain attempt to review.",
    "fr": "Ce premier commentaire n’a aucune tentative incertaine à vérifier."
  },
  "aSelectedDestinationIsUnavailable": {
    "en": "A selected destination is unavailable.",
    "fr": "Une destination sélectionnée est indisponible."
  },
  "chooseValidDestinationsForThisPost": {
    "en": "Choose valid destinations for this post.",
    "fr": "Choisissez des destinations valides pour cette publication."
  },
  "chooseFewerDestinationsForThisPublishingAction": {
    "en": "Choose fewer destinations for this publishing action.",
    "fr": "Choisissez moins de destinations pour cette action de publication."
  },
  "publishingIsTemporarilyUnavailableContactYourWorkspaceAdministrator": {
    "en": "Publishing is temporarily unavailable. Contact your workspace administrator.",
    "fr": "La publication est temporairement indisponible. Contactez l’administrateur de votre espace."
  },
  "anotherPublishingActionIsRunningForThisDestinationCheck": {
    "en": "Another publishing action is running for this destination. Check its outcome before continuing.",
    "fr": "Une autre action de publication est en cours pour cette destination. Vérifiez son résultat avant de continuer."
  },
  "aPublishingResultNeedsReviewBeforeThisDataOr": {
    "en": "A publishing result needs review before this data or connection can be removed. Check the post status first.",
    "fr": "Un résultat de publication doit être vérifié avant de supprimer ces données ou cette connexion. Vérifiez d’abord le statut de la publication."
  },
  "chooseAValidPost": {
    "en": "Choose a valid post.",
    "fr": "Choisissez une publication valide."
  },
  "anotherActionIsRunningForThisPostCheckIts": {
    "en": "Another action is running for this post. Check its outcome before continuing.",
    "fr": "Une autre action est en cours pour cette publication. Vérifiez son résultat avant de continuer."
  },
  "thisPostIsUnavailable": {
    "en": "This post is unavailable.",
    "fr": "Cette publication est indisponible."
  },
  "youDoNotHaveAccessToOneOrMore": {
    "en": "You do not have access to one or more selected destinations.",
    "fr": "Vous n’avez pas accès à une ou plusieurs destinations sélectionnées."
  },
  "chooseValidLabelDetailsAndConfirmTheExactAction": {
    "en": "Choose valid label details and confirm the exact action.",
    "fr": "Choisissez des informations d’étiquette valides et confirmez l’action exacte."
  },
  "labelsAreTemporarilyUnavailableRefreshAndTryAgain": {
    "en": "Labels are temporarily unavailable. Refresh and try again.",
    "fr": "Les étiquettes sont temporairement indisponibles. Actualisez et réessayez."
  },
  "thisLabelIsUnavailableInTheCurrentWorkspace": {
    "en": "This label is unavailable in the current workspace.",
    "fr": "Cette étiquette est indisponible dans cet espace."
  },
  "theLabelOperationCouldNotBeConfirmedRefreshThe": {
    "en": "The label operation could not be confirmed. Refresh the label list before trying again.",
    "fr": "L’action sur l’étiquette n’a pas pu être confirmée. Actualisez la liste avant de réessayer."
  },
  "aLabelWithThisNameAlreadyExistsInThe": {
    "en": "A label with this name already exists in the current workspace.",
    "fr": "Une étiquette de ce nom existe déjà dans cet espace."
  },
  "yourActiveWorkspaceAccessChangedSignInAgainTo": {
    "en": "Your active workspace access changed. Sign in again to continue.",
    "fr": "Votre accès actif à cet espace a changé. Reconnectez-vous pour continuer."
  },
  "changingOrRemovingALabelAffectsPostsOnEvery": {
    "en": "Changing or removing a label affects posts on every channel. Ask a member with access to all channels.",
    "fr": "Modifier ou supprimer une étiquette affecte les publications de tous les canaux. Contactez un membre ayant accès à tous les canaux."
  },
  "thisWorkspaceHasReachedItsLabelLimit": {
    "en": "This workspace has reached its label limit.",
    "fr": "Cet espace a atteint sa limite d’étiquettes."
  },
  "attachmentsRequireAPublicHTTPSURLWithoutCredentials": {
    "en": "Attachments require a public HTTPS URL without credentials.",
    "fr": "Les pièces jointes nécessitent une URL HTTPS publique sans identifiants de connexion."
  },
  "chooseValidMediaAttachments": {
    "en": "Choose valid media attachments.",
    "fr": "Choisissez des pièces jointes multimédias valides."
  },
  "chooseUpToValue0SupportedMediaAttachments": {
    "en": "Choose up to {value0} supported media attachments.",
    "fr": "Choisissez au maximum {value0} pièces jointes multimédias prises en charge."
  },
  "chooseAValidImageDescription": {
    "en": "Choose a valid image description.",
    "fr": "Choisissez une description d’image valide."
  },
  "imageDescriptionsMustBeValue0CharactersOrFewer": {
    "en": "Image descriptions must be {value0} characters or fewer.",
    "fr": "Les descriptions d’images doivent contenir au maximum {value0} caractères."
  },
  "imageDescriptionsCanOnlyBeUsedWithImages": {
    "en": "Image descriptions can only be used with images.",
    "fr": "Les descriptions d’images s’appliquent uniquement aux images."
  },
  "aSelectedDestinationCannotPublishThisUploadedImageChoose": {
    "en": "A selected destination cannot publish this uploaded image. Choose an image within its supported type and size.",
    "fr": "Une destination sélectionnée ne peut pas publier cette image envoyée. Choisissez une image respectant ses types et tailles pris en charge."
  },
  "youAreNoLongerAMemberOfThisWorkspace": {
    "en": "You are no longer a member of this workspace.",
    "fr": "Vous n’êtes plus membre de cet espace."
  },
  "youDoNotHavePermissionToManagePosts": {
    "en": "You do not have permission to manage posts.",
    "fr": "Vous n’avez pas l’autorisation de gérer les publications."
  },
  "workspacePublishingPolicyIsUnavailable": {
    "en": "Workspace publishing policy is unavailable.",
    "fr": "Les règles de publication de cet espace sont indisponibles."
  },
  "postTextMustBeBetween1AndValue0Characters": {
    "en": "Post text must be between 1 and {value0} characters.",
    "fr": "Le texte de la publication doit contenir entre 1 et {value0} caractères."
  },
  "addPostTextALinkOrMediaBeforeSaving": {
    "en": "Add post text, a link, or media before saving.",
    "fr": "Ajoutez du texte, un lien ou un média avant d’enregistrer."
  },
  "firstCommentMustBeValue0CharactersOrFewer": {
    "en": "First comment must be {value0} characters or fewer.",
    "fr": "Le premier commentaire doit contenir au maximum {value0} caractères."
  },
  "chooseUpToValue0DistinctDestinations": {
    "en": "Choose up to {value0} distinct destinations.",
    "fr": "Choisissez au maximum {value0} destinations distinctes."
  },
  "oneOrMoreDestinationsAreOutsideYourChannelAccess": {
    "en": "One or more destinations are outside your channel access.",
    "fr": "Une ou plusieurs destinations sont hors de votre accès aux canaux."
  },
  "oneOrMoreDestinationsAreUnavailableOrCannotPublish": {
    "en": "One or more destinations are unavailable or cannot publish.",
    "fr": "Une ou plusieurs destinations sont indisponibles ou ne peuvent pas publier."
  },
  "aSelectedDestinationCannotAddAFirstCommentClear": {
    "en": "A selected destination cannot add a first comment. Clear the comment or choose another destination.",
    "fr": "Une destination sélectionnée ne permet pas l’ajout d’un premier commentaire. Retirez le commentaire ou choisissez une autre destination."
  },
  "storedPostAttachmentsNeedReviewBeforeScheduling": {
    "en": "Stored post attachments need review before scheduling.",
    "fr": "Les pièces jointes enregistrées doivent être vérifiées avant la programmation."
  },
  "thisPostIsUnavailableInYourChannelScope": {
    "en": "This post is unavailable in your channel scope.",
    "fr": "Cette publication est hors de votre accès aux canaux."
  },
  "thisPostCannotBeSubmittedForApproval": {
    "en": "This post cannot be submitted for approval.",
    "fr": "Cette publication ne peut pas être soumise pour approbation."
  },
  "chooseApproveOrReject": {
    "en": "Choose approve or reject.",
    "fr": "Choisissez d’approuver ou de refuser."
  },
  "enterAValidReviewNote": {
    "en": "Enter a valid review note.",
    "fr": "Saisissez une note de vérification valide."
  },
  "reviewCouldNotBeCompletedTryAgainLater": {
    "en": "Review could not be completed. Try again later.",
    "fr": "La vérification n’a pas pu être terminée. Réessayez plus tard."
  },
  "keepTheReviewNoteTo500CharactersOrFewer": {
    "en": "Keep the review note to 500 characters or fewer.",
    "fr": "Limitez la note de vérification à 500 caractères."
  },
  "youDoNotHavePermissionToReviewPosts": {
    "en": "You do not have permission to review posts.",
    "fr": "Vous n’avez pas l’autorisation de vérifier les publications."
  },
  "youCannotReviewYourOwnPost": {
    "en": "You cannot review your own post.",
    "fr": "Vous ne pouvez pas vérifier votre propre publication."
  },
  "thisPostIsNoLongerAwaitingApproval": {
    "en": "This post is no longer awaiting approval.",
    "fr": "Cette publication n’est plus en attente d’approbation."
  },
  "chooseAFuturePublishingTime": {
    "en": "Choose a future publishing time.",
    "fr": "Choisissez une heure de publication future."
  },
  "thisPostCannotBeScheduled": {
    "en": "This post cannot be scheduled.",
    "fr": "Cette publication ne peut pas être programmée."
  },
  "chooseAValidDateAndTime": {
    "en": "Choose a valid date and time.",
    "fr": "Choisissez une date et une heure valides."
  },
  "thisPostCannotBeRescheduled": {
    "en": "This post cannot be rescheduled.",
    "fr": "Cette publication ne peut pas être reprogrammée."
  },
  "onlyPostsThatAreStillWaitingToPublishCan": {
    "en": "Only posts that are still waiting to publish can be rescheduled.",
    "fr": "Seules les publications encore en attente peuvent être reprogrammées."
  },
  "thisQueuedPostCanNoLongerBeCancelledLocally": {
    "en": "This queued post can no longer be cancelled locally.",
    "fr": "Cette publication en file ne peut plus être annulée localement."
  },
  "chooseAPublishingTimeBeforeChoosingWhereEachDestination": {
    "en": "Choose a publishing time before choosing where each destination holds its schedule.",
    "fr": "Choisissez une heure de publication avant de choisir où chaque destination conserve sa programmation."
  },
  "chooseAValidPostLabel": {
    "en": "Choose a valid post label.",
    "fr": "Choisissez une étiquette de publication valide."
  },
  "chooseAFuturePublishingTimeAndAtLeastOne": {
    "en": "Choose a future publishing time and at least one destination.",
    "fr": "Choisissez une heure de publication future et au moins une destination."
  },
  "thisPostLabelIsUnavailableInTheCurrentWorkspace": {
    "en": "This post label is unavailable in the current workspace.",
    "fr": "Cette étiquette de publication est indisponible dans cet espace."
  },
  "postLabelLimitsAreTemporarilyUnavailable": {
    "en": "Post label limits are temporarily unavailable.",
    "fr": "Les limites d’étiquettes de publication sont temporairement indisponibles."
  },
  "thisPostCanNoLongerBeEdited": {
    "en": "This post can no longer be edited.",
    "fr": "Cette publication ne peut plus être modifiée."
  },
  "thisVersionExceedsTheCurrentLimitOfValue0Post": {
    "en": "This version exceeds the current limit of {value0} post labels.",
    "fr": "Cette version dépasse la limite actuelle de {value0} étiquettes par publication."
  },
  "aLabelInThisVersionIsNoLongerAvailable": {
    "en": "A label in this version is no longer available. Nothing was changed.",
    "fr": "Une étiquette de cette version n’est plus disponible. Aucune modification n’a été effectuée."
  },
  "noValidContentRemainsEditThePostToAdd": {
    "en": "No valid content remains. Edit the post to add text, a link or compatible media.",
    "fr": "Il ne reste aucun contenu valide. Modifiez la publication pour ajouter du texte, un lien ou un média compatible."
  },
  "theRestoreProposalChangedReviewItAgainBeforeRestoring": {
    "en": "The restore proposal changed. Review it again before restoring.",
    "fr": "La proposition de restauration a changé. Vérifiez-la à nouveau avant de restaurer."
  },
  "theRestoreCouldNotBeConfirmedOpenThePost": {
    "en": "The restore could not be confirmed. Open the post and check its current content before trying again.",
    "fr": "La restauration n’a pas pu être confirmée. Ouvrez la publication et vérifiez son contenu actuel avant de réessayer."
  },
  "thisWorkspaceRequiresApprovalBeforeThisPostCanBe": {
    "en": "This workspace requires approval before this post can be published.",
    "fr": "Cet espace exige une approbation avant l’envoi de cette publication."
  },
  "onlyPostsWithFailedDestinationsCanBeRetried": {
    "en": "Only posts with failed destinations can be retried.",
    "fr": "Seules les publications avec des destinations en échec peuvent être renvoyées."
  },
  "thisPostCannotBePublishedInItsCurrentState": {
    "en": "This post cannot be published in its current state.",
    "fr": "Cette publication ne peut pas être envoyée dans son état actuel."
  },
  "thisPostIsScheduledForAFutureTime": {
    "en": "This post is scheduled for a future time.",
    "fr": "Cette publication est programmée pour une date future."
  },
  "selectAtLeastOneDestinationBeforePublishing": {
    "en": "Select at least one destination before publishing.",
    "fr": "Sélectionnez au moins une destination avant de publier."
  },
  "storedPostMediaNeedsReviewBeforePublishing": {
    "en": "Stored post media needs review before publishing.",
    "fr": "Les médias enregistrés doivent être vérifiés avant la publication."
  },
  "aSelectedDestinationCannotHoldThisPostAtThe": {
    "en": "A selected destination cannot hold this post at the provider. Remove it or publish at the scheduled time.",
    "fr": "Une destination sélectionnée ne peut pas conserver cette publication sur la plateforme. Retirez-la ou publiez à l’heure prévue."
  },
  "onlyWorkspaceManagersCanImportBatchesOfPosts": {
    "en": "Only workspace managers can import batches of posts.",
    "fr": "Seuls les responsables de l’espace peuvent importer des lots de publications."
  },
  "cSVFileMustBeValue0KiBOrSmaller": {
    "en": "CSV file must be {value0} KiB or smaller.",
    "fr": "Le fichier CSV doit faire au maximum {value0} Kio."
  },
  "cSVMustIncludeAHeaderAndContainAtMost": {
    "en": "CSV must include a header and contain at most {value0} posts.",
    "fr": "Le CSV doit inclure un en-tête et contenir au maximum {value0} publications."
  },
  "cSVHeaderMustBeMessagefirstCommentchannelsWithOptionalDestinationFormatsAnd": {
    "en": "CSV header must be message,firstComment,channels with optional destinationFormats and firstCommentDelayMinutes.",
    "fr": "L’en-tête CSV doit être message,firstComment,channels avec les champs facultatifs destinationFormats et firstCommentDelayMinutes."
  },
  "cSVRowValue0MustMatchTheHeaderColumns": {
    "en": "CSV row {value0} must match the header columns.",
    "fr": "La ligne CSV {value0} doit correspondre aux colonnes de l’en-tête."
  },
  "cSVRowValue0NeedsAValidDestinationFormatsJSONObject": {
    "en": "CSV row {value0} needs a valid destinationFormats JSON object.",
    "fr": "La ligne CSV {value0} nécessite un objet JSON destinationFormats valide."
  },
  "cSVHasCharactersAfterAClosingQuote": {
    "en": "CSV has characters after a closing quote.",
    "fr": "Le CSV contient des caractères après un guillemet fermant."
  },
  "cSVContainsAnUnclosedQuotedField": {
    "en": "CSV contains an unclosed quoted field.",
    "fr": "Le CSV contient un champ entre guillemets non fermé."
  },
  "chooseFewerPeopleToNotify": {
    "en": "Choose fewer people to notify.",
    "fr": "Choisissez moins de personnes à notifier."
  },
  "theNotificationRecipientLimitNeedsReview": {
    "en": "The notification recipient limit needs review.",
    "fr": "La limite de destinataires des notifications doit être vérifiée."
  },
  "aRemoteDeletionNeedsReviewBeforeThisPostCan": {
    "en": "A remote deletion needs review before this post can be changed. Check its deletion status first.",
    "fr": "Une suppression sur une plateforme doit être vérifiée avant de modifier cette publication. Vérifiez d’abord son statut de suppression."
  },
  "aRemoteDeletionNeedsReviewBeforeThisDataOr": {
    "en": "A remote deletion needs review before this data or connection can be removed. Check its deletion status first.",
    "fr": "Une suppression sur une plateforme doit être vérifiée avant de supprimer ces données ou cette connexion. Vérifiez d’abord son statut de suppression."
  },
  "thisRemotePostHasADeletionRecordAndCannot": {
    "en": "This remote post has a deletion record and cannot be restored by status sync.",
    "fr": "Cette publication sur une plateforme a un enregistrement de suppression et ne peut pas être restaurée par l’actualisation du statut."
  },
  "aPublicationNeedsReviewBeforeThisPostDataOr": {
    "en": "A publication needs review before this post, data or connection can be changed. Check publication recovery first.",
    "fr": "Une publication doit être vérifiée avant de modifier cette publication, ces données ou cette connexion. Vérifiez d’abord sa récupération."
  },
  "thisPublicationIsUnavailableInTheCurrentWorkspace": {
    "en": "This publication is unavailable in the current workspace.",
    "fr": "Cette publication est indisponible dans cet espace."
  },
  "chooseAValidPublicationRecord": {
    "en": "Choose a valid publication record.",
    "fr": "Choisissez un enregistrement de publication valide."
  },
  "useAValidHTTPSPublicationLinkWithoutCredentials": {
    "en": "Use a valid HTTPS publication link without credentials.",
    "fr": "Utilisez un lien de publication HTTPS valide sans identifiants de connexion."
  },
  "useAShorterPublicationLink": {
    "en": "Use a shorter publication link.",
    "fr": "Utilisez un lien de publication plus court."
  },
  "chooseAPublicationOutcome": {
    "en": "Choose a publication outcome.",
    "fr": "Choisissez un résultat de publication."
  },
  "absentPublicationsCannotIncludeARemoteReceipt": {
    "en": "Absent publications cannot include a remote receipt.",
    "fr": "Une publication absente ne peut pas inclure de confirmation de la plateforme."
  },
  "thisPublicationAlreadyHasARecordedOutcome": {
    "en": "This publication already has a recorded outcome.",
    "fr": "Un résultat est déjà enregistré pour cette publication."
  },
  "thisSubmissionAlreadyHasARemoteIdentityVerifyThat": {
    "en": "This submission already has a remote identity. Verify that exact publication; it cannot be recorded absent or replaced.",
    "fr": "Cet envoi possède déjà un identifiant sur la plateforme. Vérifiez cette publication précise ; elle ne peut pas être déclarée absente ni remplacée."
  },
  "thisPublicationIsAlreadyLinkedToAnotherPostReview": {
    "en": "This publication is already linked to another post. Review its existing record.",
    "fr": "Cette publication est déjà liée à une autre publication. Vérifiez son enregistrement existant."
  },
  "thisPublicationNeedsAConfirmedReceiptBeforeLocalRecovery": {
    "en": "This publication needs a confirmed receipt before local recovery.",
    "fr": "Cette publication nécessite une confirmation vérifiée avant la récupération locale."
  },
  "thisDestinationChangedReviewItsPublicationBeforeContinuing": {
    "en": "This destination changed. Review its publication before continuing.",
    "fr": "Cette destination a changé. Vérifiez sa publication avant de continuer."
  },
  "verifyTheExternalResultAndEnterItsExactConfirmation": {
    "en": "Verify the external result and enter its exact confirmation.",
    "fr": "Vérifiez le résultat externe et saisissez sa confirmation exacte."
  },
  "onlyWorkspaceManagersCanRecordExternalPublicationOutcomes": {
    "en": "Only workspace managers can record external publication outcomes.",
    "fr": "Seuls les responsables de l’espace peuvent enregistrer les résultats de publication vérifiés à l’extérieur."
  },
  "confirmTheExactPublicationToFinishItsLocalUpdate": {
    "en": "Confirm the exact publication to finish its local update.",
    "fr": "Confirmez la publication précise pour terminer sa mise à jour locale."
  },
  "onlyWorkspaceManagersCanFinishPublicationRecovery": {
    "en": "Only workspace managers can finish publication recovery.",
    "fr": "Seuls les responsables de l’espace peuvent terminer la récupération de publication."
  },
  "confirmTheExactDestinationToBeginRecovery": {
    "en": "Confirm the exact destination to begin recovery.",
    "fr": "Confirmez la destination précise pour commencer la récupération."
  },
  "onlyWorkspaceManagersCanBeginPublicationRecovery": {
    "en": "Only workspace managers can begin publication recovery.",
    "fr": "Seuls les responsables de l’espace peuvent commencer la récupération de publication."
  },
  "thisDestinationDoesNotNeedLegacyPublicationRecovery": {
    "en": "This destination does not need legacy publication recovery.",
    "fr": "Cette destination ne nécessite pas de récupération d’ancienne publication."
  },
  "thisDestinationAlreadyHasARecoveryRecordRefreshIts": {
    "en": "This destination already has a recovery record. Refresh its status.",
    "fr": "Cette destination a déjà un enregistrement de récupération. Actualisez son statut."
  },
  "publicationReceiptStorageIsUnavailable": {
    "en": "Publication receipt storage is unavailable.",
    "fr": "L’enregistrement des confirmations de publication est indisponible."
  },
  "thePublicationOutcomeChanged": {
    "en": "The publication outcome changed.",
    "fr": "Le résultat de publication a changé."
  },
  "chooseValidDestinations": {
    "en": "Choose valid destinations.",
    "fr": "Choisissez des destinations valides."
  },
  "chooseAtLeastOneDestinationToSeeItsQueue": {
    "en": "Choose at least one destination to see its queue time.",
    "fr": "Choisissez au moins une destination pour afficher son horaire de file."
  },
  "workspaceSchedulingSettingsAreUnavailable": {
    "en": "Workspace scheduling settings are unavailable.",
    "fr": "Les paramètres de programmation de cet espace sont indisponibles."
  },
  "thisPostIsUnavailableInYourWorkspace": {
    "en": "This post is unavailable in your workspace.",
    "fr": "Cette publication est indisponible dans votre espace."
  },
  "youDoNotHavePermissionToQueuePosts": {
    "en": "You do not have permission to queue posts.",
    "fr": "Vous n’avez pas l’autorisation d’ajouter des publications à la file."
  },
  "thisPostCannotBeQueuedInItsCurrentState": {
    "en": "This post cannot be queued in its current state.",
    "fr": "Cette publication ne peut pas être ajoutée à la file dans son état actuel."
  },
  "storedPostAttachmentsNeedReviewBeforeQueueing": {
    "en": "Stored post attachments need review before queueing.",
    "fr": "Les pièces jointes enregistrées doivent être vérifiées avant la mise en file."
  },
  "yourWorkspaceAccessChangedRefreshAndTryAgain": {
    "en": "Your workspace access changed. Refresh and try again.",
    "fr": "Votre accès à cet espace a changé. Actualisez et réessayez."
  },
  "workspaceSchedulingSettingsChangedRefreshAndTryAgain": {
    "en": "Workspace scheduling settings changed. Refresh and try again.",
    "fr": "Les paramètres de programmation de cet espace ont changé. Actualisez et réessayez."
  },
  "thisPostChangedWhileItWasBeingQueuedRefresh": {
    "en": "This post changed while it was being queued. Refresh and try again.",
    "fr": "Cette publication a changé pendant sa mise en file. Actualisez et réessayez."
  },
  "noQueueTimeIsAvailableForThisPostChange": {
    "en": "No queue time is available for this post. Change the timetable or choose a publishing time.",
    "fr": "Aucun horaire de file n’est disponible pour cette publication. Modifiez le calendrier ou choisissez une heure de publication."
  },
  "value0CheckThePlatformRefreshThePostStatusThen": {
    "en": "{value0} Check the platform, refresh the post status, then try again.",
    "fr": "{value0} Vérifiez la plateforme, actualisez le statut de publication, puis réessayez."
  },
  "value0IsRequired": {
    "en": "{value0} is required.",
    "fr": "{value0} est obligatoire."
  },
  "value0MustBeAnISODatetime": {
    "en": "{value0} must be an ISO date-time.",
    "fr": "{value0} doit être une date et une heure ISO."
  },
  "sendAValidJSONRequest": {
    "en": "Send a valid JSON request.",
    "fr": "Envoyez une demande JSON valide."
  },
  "youHaveReachedTheSavedViewLimitForThis": {
    "en": "You have reached the saved view limit for this screen. Remove one first.",
    "fr": "Vous avez atteint la limite de vues enregistrées pour cet écran. Supprimez-en une d’abord."
  },
  "theViewCouldNotBeSaved": {
    "en": "The view could not be saved.",
    "fr": "La vue n’a pas pu être enregistrée."
  },
  "thisSavedViewIsUnavailable": {
    "en": "This saved view is unavailable.",
    "fr": "Cette vue enregistrée est indisponible."
  },
  "chooseASchedulingPlaceForEachDestination": {
    "en": "Choose a scheduling place for each destination.",
    "fr": "Choisissez où conserver la programmation pour chaque destination."
  },
  "chooseValue0ForEachDestination": {
    "en": "Choose {value0} for each destination.",
    "fr": "Choisissez {value0} pour chaque destination."
  },
  "platformheldSchedulingIsNotAvailableChooseApplicationScheduling": {
    "en": "Platform-held scheduling is not available. Choose application scheduling.",
    "fr": "La programmation sur la plateforme est indisponible. Choisissez la programmation dans l’application."
  },
  "aSchedulingChoiceNamesADestinationThatIsNot": {
    "en": "A scheduling choice names a destination that is not on this post.",
    "fr": "Un choix de programmation désigne une destination absente de cette publication."
  },
  "linkShorteningIsUnavailableTryAgainLater": {
    "en": "Link shortening is unavailable. Try again later.",
    "fr": "Le raccourcissement des liens est indisponible. Réessayez plus tard."
  },
  "thisPublicationConnectionOrAccessChangedRefreshItsStatus": {
    "en": "This publication connection or access changed. Refresh its status before continuing.",
    "fr": "La connexion ou l’accès de cette publication a changé. Actualisez son statut avant de continuer."
  },
  "chooseValidTemplateDetailsAndConfirmTheExactAction": {
    "en": "Choose valid template details and confirm the exact action.",
    "fr": "Choisissez des informations de modèle valides et confirmez l’action exacte."
  },
  "templatesAreTemporarilyUnavailableRefreshAndTryAgain": {
    "en": "Templates are temporarily unavailable. Refresh and try again.",
    "fr": "Les modèles sont temporairement indisponibles. Actualisez et réessayez."
  },
  "thisTemplateIsUnavailableInTheCurrentWorkspace": {
    "en": "This template is unavailable in the current workspace.",
    "fr": "Ce modèle est indisponible dans cet espace."
  },
  "aTemplateWithThisNameAlreadyExistsInThe": {
    "en": "A template with this name already exists in the current workspace.",
    "fr": "Un modèle de ce nom existe déjà dans cet espace."
  },
  "theTemplateOperationCouldNotBeConfirmedRefreshThe": {
    "en": "The template operation could not be confirmed. Refresh the template list before trying again.",
    "fr": "L’action sur le modèle n’a pas pu être confirmée. Actualisez la liste avant de réessayer."
  },
  "theLabelDirectoryIsTooLargeToLoadContact": {
    "en": "The label directory is too large to load. Contact your workspace administrator.",
    "fr": "La liste des étiquettes est trop volumineuse. Contactez l’administrateur de votre espace."
  },
  "chooseALabelFromThisWorkspace": {
    "en": "Choose a label from this workspace.",
    "fr": "Choisissez une étiquette de cet espace."
  },
  "thisWorkspaceHasReachedItsTemplateLimit": {
    "en": "This workspace has reached its template limit.",
    "fr": "Cet espace a atteint sa limite de modèles."
  },
  "theFirstcommentDelayLimitIsUnavailable": {
    "en": "The first-comment delay limit is unavailable.",
    "fr": "La limite de délai du premier commentaire est indisponible."
  },
  "noValidPublishingFormatIsAvailableForACurrent": {
    "en": "No valid publishing format is available for a current destination.",
    "fr": "Aucun format de publication valide n’est disponible pour une destination actuelle."
  },
  "aCurrentDestinationIsOutsideYourPublishingAccess": {
    "en": "A current destination is outside your publishing access.",
    "fr": "Une destination actuelle est hors de votre accès à la publication."
  },
  "aCurrentDestinationIsUnavailable": {
    "en": "A current destination is unavailable.",
    "fr": "Une destination actuelle est indisponible."
  },
  "aCurrentDestinationNeedsReconnectionBeforeRestoring": {
    "en": "A current destination needs reconnection before restoring.",
    "fr": "Une destination actuelle doit être reconnectée avant la restauration."
  },
  "youCannotManagePosts": {
    "en": "You cannot manage posts.",
    "fr": "Vous ne pouvez pas gérer les publications."
  },
  "postIdIsRequired": {
    "en": "postId is required.",
    "fr": "L’identifiant de publication est obligatoire."
  },
  "confirmTheRequestedPostDeletion": {
    "en": "Confirm the requested post deletion.",
    "fr": "Confirmez la suppression demandée."
  },
  "confirmLocalRemovalAfterRemoteDeletion": {
    "en": "Confirm local removal after remote deletion.",
    "fr": "Confirmez la suppression locale après la suppression sur la plateforme."
  },
  "chooseTheVerifiedPlatformOutcome": {
    "en": "Choose the verified platform outcome.",
    "fr": "Choisissez le résultat vérifié sur la plateforme."
  },
  "confirmTheExternallyCheckedPlatformOutcome": {
    "en": "Confirm the externally checked platform outcome.",
    "fr": "Confirmez le résultat vérifié à l’extérieur sur la plateforme."
  },
  "chooseAPostDeletionRecoveryAction": {
    "en": "Choose a post deletion recovery action.",
    "fr": "Choisissez une action de récupération de suppression de publication."
  },
  "theDeletionOutcomeCouldNotBeConfirmedCheckIts": {
    "en": "The deletion outcome could not be confirmed. Check its current status.",
    "fr": "La suppression n’a pas pu être confirmée. Vérifiez son statut actuel."
  },
  "thePostWasNotConfirmedRemovedLocallyCheckDeletion": {
    "en": "The post was not confirmed removed locally. Check deletion status before taking another action.",
    "fr": "La suppression locale n’est pas confirmée. Vérifiez le statut de suppression avant toute autre action."
  },
  "confirmSendingThisFirstComment": {
    "en": "Confirm sending this first comment.",
    "fr": "Confirmez l’envoi de ce premier commentaire."
  },
  "acknowledgeThePossibleDelayedResultBeforeSending": {
    "en": "Acknowledge the possible delayed result before sending.",
    "fr": "Reconnaissez le résultat potentiellement retardé avant d’envoyer."
  },
  "chooseTheResultYouVerifiedOnThePlatform": {
    "en": "Choose the result you verified on the platform.",
    "fr": "Choisissez le résultat que vous avez vérifié sur la plateforme."
  },
  "confirmTheVerifiedCommentResult": {
    "en": "Confirm the verified comment result.",
    "fr": "Confirmez le résultat vérifié du commentaire."
  },
  "acknowledgeTheExternalVerificationAndPossibleLateResult": {
    "en": "Acknowledge the external verification and possible late result.",
    "fr": "Reconnaissez la vérification externe et la possibilité d’un résultat tardif."
  },
  "enterThePlatformCommentIDYouVerified": {
    "en": "Enter the platform comment ID you verified.",
    "fr": "Saisissez l’identifiant du commentaire vérifié sur la plateforme."
  },
  "chooseValidDestinationFormats": {
    "en": "Choose valid destination formats.",
    "fr": "Choisissez des formats de destination valides."
  },
  "submitEitherTheOrderedMediaListOrTheOlder": {
    "en": "Submit either the ordered media list or the older attachment fields, not both.",
    "fr": "Envoyez soit la liste ordonnée de médias, soit les anciens champs de pièces jointes, pas les deux."
  },
  "theResultCouldNotBeConfirmedCheckThisPost": {
    "en": "The result could not be confirmed. Check this post before another action.",
    "fr": "Le résultat n’a pas pu être confirmé. Vérifiez cette publication avant toute autre action."
  },
  "chooseValidPublishingExportFilters": {
    "en": "Choose valid Publishing export filters.",
    "fr": "Choisissez des filtres d’export de publication valides."
  },
  "chooseAValidSavedViewNameAndFilters": {
    "en": "Choose a valid saved view name and filters.",
    "fr": "Choisissez un nom et des filtres de vue enregistrée valides."
  },
  "theSaveResultCouldNotBeConfirmedYourChanges": {
    "en": "The save result could not be confirmed. Your changes are retained; check Posts before trying again.",
    "fr": "L’enregistrement n’a pas pu être confirmé. Vos modifications sont conservées ; vérifiez les publications avant de réessayer."
  },
  "theDeletionResultCouldNotBeConfirmedCheckIts": {
    "en": "The deletion result could not be confirmed. Check its current status before trying again.",
    "fr": "La suppression n’a pas pu être confirmée. Vérifiez son statut actuel avant de réessayer."
  },
  "noActiveDeletionRequestIsRecordedChooseTheDeletion": {
    "en": "No active deletion request is recorded. Choose the deletion request you want to start.",
    "fr": "Aucune demande de suppression active n’est enregistrée. Choisissez la demande à démarrer."
  },
  "remoteDeletionIsConfirmedFinishLocalRemovalWhenAll": {
    "en": "Remote deletion is confirmed. Finish local removal when all destination confirmations are saved.",
    "fr": "La suppression sur la plateforme est confirmée. Terminez la suppression locale lorsque toutes les confirmations de destination sont enregistrées."
  },
  "aDestinationDeletionResultNeedsReviewCheckThePlatform": {
    "en": "A destination deletion result needs review. Check the platform before recording an outcome or trying a new request.",
    "fr": "Le résultat de suppression d’une destination doit être vérifié. Vérifiez la plateforme avant d’enregistrer un résultat ou de lancer une nouvelle demande."
  },
  "thePostWasRemovedLocally": {
    "en": "The post was removed locally.",
    "fr": "La publication a été supprimée localement."
  },
  "aDestinationRefusedTheDeletionRequestCheckItsPlatform": {
    "en": "A destination refused the deletion request. Check its platform state before making a separate new request.",
    "fr": "Une destination a refusé la suppression. Vérifiez son état sur la plateforme avant de lancer une nouvelle demande séparée."
  },
  "theDeletionIsStillInProgressCheckItsStatus": {
    "en": "The deletion is still in progress. Check its status before taking another action.",
    "fr": "La suppression est toujours en cours. Vérifiez son statut avant toute autre action."
  },
  "theSendResultCouldNotBeConfirmedCheckThe": {
    "en": "The send result could not be confirmed. Check the platform and current post before another action.",
    "fr": "L’envoi n’a pas pu être confirmé. Vérifiez la plateforme et la publication actuelle avant toute autre action."
  },
  "theFirstCommentWasRecordedAsSent": {
    "en": "The first comment was recorded as sent.",
    "fr": "Le premier commentaire a été enregistré comme envoyé."
  },
  "theCommentResultCouldNotBeConfirmedCheckIts": {
    "en": "The comment result could not be confirmed. Check its current state before taking another action.",
    "fr": "Le résultat du commentaire n’a pas pu être confirmé. Vérifiez son état actuel avant toute autre action."
  },
  "theOutcomeCouldNotBeConfirmedCheckTheCurrent": {
    "en": "The outcome could not be confirmed. Check the current post before repeating or taking another action.",
    "fr": "Le résultat n’a pas pu être confirmé. Vérifiez la publication actuelle avant de recommencer ou d’effectuer une autre action."
  },
  "theResultCouldNotBeRecordedCheckTheCurrent": {
    "en": "The result could not be recorded. Check the current state before trying again.",
    "fr": "Le résultat n’a pas pu être enregistré. Vérifiez l’état actuel avant de réessayer."
  },
  "youDoNotHavePermissionToCreatePostsFor": {
    "en": "You do not have permission to create posts for one or more selected destinations.",
    "fr": "Vous n’avez pas l’autorisation de créer des publications pour une ou plusieurs destinations sélectionnées."
  },
  "shortenThePostTextToFitTheAllowedCharacter": {
    "en": "Shorten the post text to fit the allowed character limit.",
    "fr": "Raccourcissez le texte de la publication pour respecter la limite de caractères."
  },
  "shortenTheFirstCommentToFitTheAllowedCharacter": {
    "en": "Shorten the first comment to fit the allowed character limit.",
    "fr": "Raccourcissez le premier commentaire pour respecter la limite de caractères."
  },
  "chooseAnAvailableFormatForEachSelectedDestination": {
    "en": "Choose an available format for each selected destination.",
    "fr": "Choisissez un format disponible pour chaque destination sélectionnée."
  },
  "checkYourSelectedDestinationsAndTryAgain": {
    "en": "Check your selected destinations and try again.",
    "fr": "Vérifiez les destinations sélectionnées et réessayez."
  },
  "checkTheAttachmentAndItsDescriptionThenTryAgain": {
    "en": "Check the attachment and its description, then try again.",
    "fr": "Vérifiez la pièce jointe et sa description, puis réessayez."
  },
  "chooseAValidFutureTimeInYourWorkspaceTime": {
    "en": "Choose a valid future time in your workspace time zone and select at least one destination.",
    "fr": "Choisissez une date future valide dans le fuseau de votre espace et au moins une destination."
  },
  "chooseWhetherToSaveADraftOrScheduleThe": {
    "en": "Choose whether to save a draft or schedule the post.",
    "fr": "Choisissez d’enregistrer un brouillon ou de programmer la publication."
  },
  "weCouldNotSaveThisPostYourDetailsAre": {
    "en": "We could not save this post. Your details are still here; please try again.",
    "fr": "Nous n’avons pas pu enregistrer cette publication. Vos informations sont conservées ; réessayez."
  },
"media_invalid_limit": {"en": "Image upload is unavailable right now.", "fr": "L’envoi d’images est indisponible actuellement."},
"media_invalid_form": {"en": "Upload an image using a multipart form.", "fr": "Envoyez une image avec le formulaire de fichier."},
"media_empty_body": {"en": "Choose an image file to upload.", "fr": "Choisissez un fichier image à envoyer."},
"media_invalid_file": {"en": "Choose an image file.", "fr": "Choisissez un fichier image."},
"media_too_large": {"en": "This image exceeds the upload size limit.", "fr": "Cette image dépasse la taille maximale autorisée."},
"media_invalid_type": {"en": "Choose a supported image format.", "fr": "Choisissez un format d’image pris en charge."},
"media_invalid_content": {"en": "The image file could not be read.", "fr": "Le fichier image n’a pas pu être lu."},
"media_invalid_cursor": {"en": "Invalid media cursor.", "fr": "La position dans la liste des médias est invalide."},
"media_invalid_listing_limit": {"en": "Invalid media listing limit.", "fr": "La limite de liste des médias est invalide."},
"media_storage": {"en": "Image storage is temporarily unavailable. Try again later.", "fr": "Le stockage des images est temporairement indisponible. Réessayez plus tard."},
"media_failed": {"en": "The image operation could not be completed. Please try again.", "fr": "L’action sur l’image n’a pas pu être terminée. Réessayez."},
"collaboration_0": {"en":"Choose at most {value0} posts and {value1} labels.","fr":"Choisissez au maximum {value0} publications et {value1} étiquettes."},
"collaboration_1": {"en":"Choose labels from this workspace.","fr":"Choisissez des étiquettes de cet espace."},
"collaboration_2": {"en":"A post can carry at most {value0} labels. Nothing was changed.","fr":"Une publication peut porter au maximum {value0} étiquettes. Aucune modification n’a été effectuée."},
"collaboration_3": {"en":"Content mix is not available yet.","fr":"La répartition du contenu n’est pas encore disponible."},
"collaboration_4": {"en":"This workspace is unavailable.","fr":"Cet espace de travail est indisponible."},
"collaboration_5": {"en":"This workspace is suspended.","fr":"Cet espace de travail est suspendu."},
"collaboration_6": {"en":"Workspace data deletion is in progress.","fr":"La suppression des données de cet espace est en cours."},
"collaboration_7": {"en":"The content-mix setting could not be saved. Refresh and check its current state.","fr":"La répartition du contenu n’a pas pu être enregistrée. Actualisez et vérifiez son état actuel."},
"collaboration_8": {"en":"Use at most {value0} labels and {value1} posts per week for each.","fr":"Utilisez au maximum {value0} étiquettes et {value1} publications par semaine pour chacune."},
"collaboration_9": {"en":"Only workspace owners and admins can change the content mix.","fr":"Seuls les propriétaires et administrateurs de l’espace peuvent modifier la répartition du contenu."},
"collaboration_10": {"en":"This channel is unavailable in the current workspace.","fr":"Ce canal est indisponible dans cet espace."},
"collaboration_11": {"en":"This group is unavailable in the current workspace.","fr":"Ce groupe est indisponible dans cet espace."},
"collaboration_12": {"en":"This action is temporarily unavailable. Refresh and try again.","fr":"Cette action est temporairement indisponible. Actualisez et réessayez."},
"collaboration_13": {"en":"This post is unavailable in the current workspace.","fr":"Cette publication est indisponible dans cet espace."},
"collaboration_14": {"en":"Type the exact confirmation shown to continue.","fr":"Saisissez la confirmation exacte affichée pour continuer."},
"collaboration_15": {"en":"Your active workspace access changed. Sign in again to continue.","fr":"Votre accès actif à cet espace a changé. Reconnectez-vous pour continuer."},
"collaboration_16": {"en":"Only workspace owners and admins can {value0}.","fr":"Seuls les propriétaires et administrateurs de l’espace peuvent {value0}."},
"collaboration_17": {"en":"Changing this affects every channel. Ask a member with access to all channels to {value0}.","fr":"Cette modification affecte tous les canaux. Contactez un membre ayant accès à tous les canaux pour {value0}."},
"collaboration_18": {"en":"You can only change your own posts.","fr":"Vous ne pouvez modifier que vos propres publications."},
"collaboration_19": {"en":"A field with this name already exists in the current workspace.","fr":"Un champ de ce nom existe déjà dans cet espace."},
"collaboration_20": {"en":"This field is unavailable in the current workspace.","fr":"Ce champ est indisponible dans cet espace."},
"collaboration_21": {"en":"The field directory exceeds its current limit. Ask an administrator to review it.","fr":"La liste des champs dépasse sa limite actuelle. Demandez à un administrateur de la vérifier."},
"collaboration_22": {"en":"This workspace has reached its custom field limit.","fr":"Cet espace a atteint sa limite de champs personnalisés."},
"collaboration_23": {"en":"This field has inconsistent related records. Ask an administrator to review them before changing it.","fr":"Ce champ possède des enregistrements associés incohérents. Demandez à un administrateur de les vérifier avant de le modifier."},
"collaboration_25": {"en":"Choose fields from this workspace.","fr":"Choisissez des champs de cet espace."},
"collaboration_26": {"en":"Pick one of the listed options.","fr":"Choisissez l’une des options proposées."},
"collaboration_27": {"en":"Automatic scheduling scan state is unavailable.","fr":"L’état de recherche de programmation automatique est indisponible."},
"collaboration_28": {"en":"Automatic scheduling scan state could not be recorded.","fr":"L’état de recherche de programmation automatique n’a pas pu être enregistré."},
"collaboration_29": {"en":"Automatic scheduling is unavailable until workspace access and publishing lifecycle can be verified.","fr":"La programmation automatique est indisponible tant que l’accès à l’espace et le suivi des publications ne peuvent pas être vérifiés."},
"collaboration_30": {"en":"Invalid workspace ID.","fr":"Identifiant d’espace invalide."},
"collaboration_31": {"en":"The saved recycle policy is outside current workspace limits.","fr":"Les règles de répétition enregistrées dépassent les limites actuelles de l’espace."},
"collaboration_32": {"en":"Labels are temporarily unavailable.","fr":"Les étiquettes sont temporairement indisponibles."},
"collaboration_33": {"en":"The label selection exceeds its current limit. Ask an administrator to review it.","fr":"La sélection d’étiquettes dépasse sa limite actuelle. Demandez à un administrateur de la vérifier."},
"collaboration_34": {"en":"The member directory is too large. Ask an administrator to review its limit.","fr":"La liste des membres est trop volumineuse. Demandez à un administrateur de vérifier sa limite."},
"collaboration_35": {"en":"This post has reached its note limit.","fr":"Cette publication a atteint sa limite de notes."},
"collaboration_36": {"en":"The note save could not be confirmed. Check the current notes before trying again.","fr":"L’enregistrement de la note n’a pas pu être confirmé. Vérifiez les notes actuelles avant de réessayer."},
"collaboration_37": {"en":"This note is unavailable in the current workspace.","fr":"Cette note est indisponible dans cet espace."},
"collaboration_38": {"en":"Search is temporarily unavailable.","fr":"La recherche est temporairement indisponible."},
"collaboration_39": {"en":"The search is too long.","fr":"La recherche est trop longue."},
"collaboration_40": {"en":"Queue times are not available yet.","fr":"Les horaires de file ne sont pas encore disponibles."},
"collaboration_41": {"en":"Use at most {value0} times in one timetable.","fr":"Utilisez au maximum {value0} horaires par calendrier."},
"collaboration_42": {"en":"Only workspace owners and admins can change queue times.","fr":"Seuls les propriétaires et administrateurs de l’espace peuvent modifier les horaires de file."},
"collaboration_43": {"en":"Recycling posts is not available yet.","fr":"La répétition des publications n’est pas encore disponible."},
"collaboration_44": {"en":"This post cannot be repeated in its current state.","fr":"Cette publication ne peut pas être répétée dans son état actuel."},
"collaboration_45": {"en":"This post is already a repeat. Change the original post instead.","fr":"Cette publication est déjà une répétition. Modifiez plutôt la publication d’origine."},
"collaboration_46": {"en":"Choose an interval from 1 to {value0} days.","fr":"Choisissez un intervalle de 1 à {value0} jours."},
"collaboration_47": {"en":"Choose a repeat limit from 1 to {value0}, or leave it unlimited.","fr":"Choisissez une limite de répétitions de 1 à {value0}, ou laissez-la illimitée."},
"collaboration_48": {"en":"Stored alternate wordings need review before repeating can be changed.","fr":"Les variantes de texte enregistrées doivent être vérifiées avant de modifier la répétition."},
"collaboration_49": {"en":"Use at most {value0} alternate wordings of {value1} characters each.","fr":"Utilisez au maximum {value0} variantes de texte de {value1} caractères chacune."},
"collaboration_50": {"en":"Alternate wordings need an editor or above because they are published without a new review.","fr":"Les variantes de texte nécessitent un éditeur ou un rôle supérieur car elles sont publiées sans nouvelle vérification."},
"collaboration_51": {"en":"This post has already used all of its repeats.","fr":"Cette publication a déjà utilisé toutes ses répétitions."},
"collaboration_52": {"en":"Version history is temporarily unavailable.","fr":"L’historique des versions est temporairement indisponible."},
"collaboration_53": {"en":"Restoring earlier versions is not available yet.","fr":"La restauration des versions précédentes n’est pas encore disponible."},
"collaboration_54": {"en":"This post can no longer be edited, so an earlier version cannot be restored.","fr":"Cette publication ne peut plus être modifiée ; une version précédente ne peut donc pas être restaurée."},
"collaboration_55": {"en":"This version is unavailable for the post.","fr":"Cette version est indisponible pour cette publication."},
"collaboration_56": {"en":"The restore could not be confirmed. Open the post and check its current content before trying again.","fr":"La restauration n’a pas pu être confirmée. Ouvrez la publication et vérifiez son contenu actuel avant de réessayer."},
"collaboration_57": {"en":"Check the details and confirm the exact action.","fr":"Vérifiez les informations et confirmez l’action exacte."},
"collaboration_58": {"en":"The action could not be confirmed. Refresh and check the current state before trying again.","fr":"Le résultat n’a pas pu être confirmé. Actualisez avant de réessayer."},
"collaborationFieldOptionsSingle": {"en": "{value0} post uses a value that is not in these options. Clear or change those values first.", "fr": "{value0} publication utilise une valeur absente de ces options. Effacez ou modifiez d’abord ces valeurs."},
"collaborationFieldOptionsMany": {"en": "{value0} posts use a value that is not in these options. Clear or change those values first.", "fr": "{value0} publications utilisent une valeur absente de ces options. Effacez ou modifiez d’abord ces valeurs."},
"actionSharedQueue": {"en": "change the shared queue times", "fr": "modifier les horaires de file partagés"},
"actionContentMix": {"en": "change automatic content-mix scheduling", "fr": "modifier la programmation automatique de répartition du contenu"},
"actionGroupMix": {"en": "change a group content mix", "fr": "modifier la répartition du contenu d’un groupe"},
"actionCustomFields": {"en": "manage custom fields", "fr": "gérer les champs personnalisés"},
"youCannotReschedulePosts": {"en": "You cannot reschedule posts.", "fr": "Vous ne pouvez pas reprogrammer les publications."},
"restoreDestinations": {"en": "Saved destinations cannot be replayed. The current destinations will be kept.", "fr": "Les destinations enregistrées ne peuvent pas être rétablies. Les destinations actuelles seront conservées."},
"restoreFormat": {"en": "The saved format cannot be replayed for this destination. Use {value0}.", "fr": "Le format enregistré ne peut pas être rétabli pour cette destination. Utiliser {value0}."},
"restoreComment": {"en": "The first comment is unsupported by a current destination or format and will be omitted.", "fr": "Le premier commentaire est incompatible avec une destination ou un format actuel et sera omis."},
"restoreDelay": {"en": "The saved first-comment delay is no longer valid. Use {value0} minutes.", "fr": "Le délai du premier commentaire enregistré n’est plus valide. Utiliser {value0} minutes."},
"restoreMedia": {"en": "Unavailable or incompatible media and image descriptions will be omitted; compatible attachments keep their order.", "fr": "Les médias et descriptions indisponibles ou incompatibles seront omis ; les pièces jointes compatibles conserveront leur ordre."},
"restoreUnavailable": {"en": "Not available", "fr": "Non disponible"},
"read_0": {"en":"Choose valid Publishing filters.","fr":"Choisissez des filtres de publication valides."},
"read_1": {"en":"Choose a valid post status.","fr":"Choisissez un statut de publication valide."},
"read_2": {"en":"Choose a valid channel filter.","fr":"Choisissez un filtre de canal valide."},
"read_3": {"en":"Enter valid post search text.","fr":"Saisissez un texte de recherche de publication valide."},
"read_4": {"en":"Search must fit on one line.","fr":"La recherche doit tenir sur une seule ligne."},
"read_5": {"en":"Search must be {value0} characters or fewer.","fr":"La recherche doit contenir au maximum {value0} caractères."},
"read_6": {"en":"Choose a valid result page and size.","fr":"Choisissez une page de résultats et une taille valides."},
"read_7": {"en":"Choose a valid post order.","fr":"Choisissez un ordre de publication valide."},
"read_8": {"en":"Choose a supported calendar date range.","fr":"Choisissez une période de calendrier prise en charge."},
"read_9": {"en":"Choose valid ISO date filters.","fr":"Choisissez des filtres de date ISO valides."},
"read_10": {"en":"Choose valid post statuses.","fr":"Choisissez des statuts de publication valides."},
"read_11": {"en":"The end date must follow the start date.","fr":"La date de fin doit suivre la date de début."},
"read_12": {"en":"This export exceeds the synchronous limit. Narrow your filters and try again.","fr":"Cet export dépasse la limite de traitement immédiat. Affinez les filtres et réessayez."},
"read_13": {"en":"Choose a valid Publishing export result limit.","fr":"Choisissez une limite de résultats d’export valide."},
"read_14": {"en":"Choose a valid post origin.","fr":"Choisissez une origine de publication valide."},
  "chooseValidVariantDetailsAndConfirmTheExactAction": {
    "en": "Choose valid variant details and confirm the exact action.",
    "fr": "Choisissez des détails de variante valides et confirmez l’action exacte."
  },
  "thisVariantIsUnavailableInTheCurrentWorkspace": {
    "en": "This language variant is unavailable in the current workspace.",
    "fr": "Cette variante de langue est indisponible dans cet espace."
  },
  "thisPostAlreadyHasTheMaximumLanguageVariants": {
    "en": "This post already has the maximum number of language variants.",
    "fr": "Cette publication a déjà le nombre maximal de variantes de langue."
  },
  "thisDestinationIsUnavailableInTheCurrentWorkspace": {
    "en": "This destination is unavailable in the current workspace.",
    "fr": "Cette destination est indisponible dans cet espace."
  }
};
export type PublishingErrorCopy = typeof publishingErrorCopy;
export type PublishingErrorKey = keyof PublishingErrorCopy;
export type PublishingErrorText = (key: PublishingErrorKey, values?: Record<string, unknown>) => string;
const bilingual = z.object({ en: z.string().min(1).max(4000), fr: z.string().min(1).max(4000) }).strict();
export const publishingErrorCopySchema = z.object(Object.fromEntries(Object.keys(publishingErrorCopy).map(key => [key, bilingual])) as { [K in PublishingErrorKey]: typeof bilingual }).strict().superRefine((catalog, context) => {
  for (const key of Object.keys(publishingErrorCopy) as PublishingErrorKey[]) {
    const expected = [...publishingErrorCopy[key].en.matchAll(/\{(value\d+)\}/g)].map(match => match[1]).sort().join(',');
    for (const locale of ['en', 'fr'] as const) {
      const actual = [...catalog[key][locale].matchAll(/\{(value\d+)\}/g)].map(match => match[1]).sort().join(',');
      if (actual !== expected) context.addIssue({ code: z.ZodIssueCode.custom, path: [key, locale], message: 'Keep the named placeholders from the default copy.' });
    }
  }
});
export function publishingErrorText(catalog: PublishingErrorCopy, locale = 'en'): PublishingErrorText {
  const language = locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  return (key, values = {}) => catalog[key][language].replace(/\{(value\d+)\}/g, (match, name: string) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
export const defaultPublishingErrorText = publishingErrorText(publishingErrorCopy);

/** Copy metadata stays private; HTTP/MCP serializers still expose the existing code and message only. */
export class PublishingOperationError extends OperationError {
  constructor(code: OperationErrorCode, key: PublishingErrorKey, values: Record<string, unknown> = {}, text: PublishingErrorText = defaultPublishingErrorText) {
    super(code, text(key, values));
    Object.defineProperty(this, 'defaultMessage', { value: defaultPublishingErrorText(key, values), enumerable: false });
  }
}
/** Existing validation classification uses canonical text, independently of Root wording. */
export function publishingErrorClassificationMessage(error: unknown): string {
  return error instanceof PublishingOperationError ? (error as PublishingOperationError & { defaultMessage: string }).defaultMessage : error instanceof Error ? error.message : '';
}
export const ERROR_COPY_CONFIG = [entry({ key: 'publishing.errorCopy', group: 'Publishing · Copy', label: 'Publishing error copy', kind: 'json', description: 'English and French customer-safe service validation and action recovery messages. Keep named placeholders. Service callers without a locale use English.', defaultValue: publishingErrorCopy, schema: publishingErrorCopySchema, consumption: 'active' })] as const;
