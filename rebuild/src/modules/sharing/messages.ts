import { z } from 'zod';

/**
 * Root-editable text of the sharing module's server failures and replies (REST and MCP), English and French.
 * Source phrases are the catalog identities; `{0}` marks a value supplied at the call site.
 * The signed-in screens use `./ui/owner-copy`; the signed-out pages use `./ui/copy`.
 */
const row = (en: string, fr: string) => ({ en, fr });

export const sharingMessages = {
  // Authorization and availability
  'Sign in with an active workspace account.': row('Sign in with an active workspace account.', 'Connectez-vous avec un compte d’espace actif.'),
  'Sign in with an active account to manage sharing.': row('Sign in with an active account to manage sharing.', 'Connectez-vous avec un compte actif pour gérer le partage.'),
  'Sharing is available to workspace owners and admins.': row('Sharing is available to workspace owners and admins.', 'Le partage est réservé aux propriétaires et administrateurs de l’espace.'),
  'This workspace is suspended.': row('This workspace is suspended.', 'Cet espace est suspendu.'),
  'Sharing is unavailable in this workspace.': row('Sharing is unavailable in this workspace.', 'Le partage n’est pas disponible dans cet espace.'),
  'This workspace is unavailable.': row('This workspace is unavailable.', 'Cet espace n’est pas disponible.'),
  'Your active workspace access changed. Sign in again to continue.': row('Your active workspace access changed. Sign in again to continue.', 'Votre accès à l’espace a changé. Reconnectez-vous pour continuer.'),
  'Workspace data deletion is in progress.': row('Workspace data deletion is in progress.', 'La suppression des données de l’espace est en cours.'),
  'The change could not be recorded, so it was not saved.': row('The change could not be recorded, so it was not saved.', 'La modification n’a pas pu être consignée ; elle n’a donc pas été enregistrée.'),
  'Sharing is temporarily unavailable. Try again later.': row('Sharing is temporarily unavailable. Try again later.', 'Le partage est momentanément indisponible. Réessayez plus tard.'),
  'This item is unavailable in the current workspace.': row('This item is unavailable in the current workspace.', 'Cet élément n’est pas disponible dans l’espace actuel.'),
  'The sharing operation could not be confirmed. Refresh before trying again.': row('The sharing operation could not be confirmed. Refresh before trying again.', 'L’opération de partage n’a pas pu être confirmée. Actualisez avant de réessayer.'),
  'This address is already in use.': row('This address is already in use.', 'Cette adresse est déjà utilisée.'),

  // Requests
  'Choose valid sharing details and confirm the exact action.': row('Choose valid sharing details and confirm the exact action.', 'Indiquez des informations de partage valides et confirmez l’action exacte.'),
  'Choose a supported sharing action.': row('Choose a supported sharing action.', 'Choisissez une action de partage prise en charge.'),
  'This action takes no arguments.': row('This action takes no arguments.', 'Cette action n’accepte aucun paramètre.'),
  'Choose a valid result page.': row('Choose a valid result page.', 'Choisissez une page de résultats valide.'),
  'Choose a valid link.': row('Choose a valid link.', 'Choisissez un lien valide.'),
  'Reload the link before editing it.': row('Reload the link before editing it.', 'Rechargez le lien avant de le modifier.'),

  // Share links
  'You need Publishing access to share posts.': row('You need Publishing access to share posts.', 'Vous avez besoin de l’accès à Publication pour partager des publications.'),
  'You need approval permission to create a link that lets clients decide.': row('You need approval permission to create a link that lets clients decide.', 'Vous avez besoin de l’autorisation d’approbation pour créer un lien qui laisse les clients décider.'),
  'You need approval permission to change a link that lets clients decide.': row('You need approval permission to change a link that lets clients decide.', 'Vous avez besoin de l’autorisation d’approbation pour modifier un lien qui laisse les clients décider.'),
  'You can only share channels you have access to.': row('You can only share channels you have access to.', 'Vous ne pouvez partager que les canaux auxquels vous avez accès.'),
  'This workspace has reached its share link limit. Delete old links first.': row('This workspace has reached its share link limit. Delete old links first.', 'Cet espace a atteint sa limite de liens de partage. Supprimez d’abord d’anciens liens.'),
  'The share link could not be created.': row('The share link could not be created.', 'Le lien de partage n’a pas pu être créé.'),
  'A share link could not be created.': row('A share link could not be created.', 'Un lien de partage n’a pas pu être créé.'),
  'The link could not be updated.': row('The link could not be updated.', 'Le lien n’a pas pu être mis à jour.'),
  'The link could not be rotated.': row('The link could not be rotated.', 'Le lien n’a pas pu être renouvelé.'),
  'This link was changed by someone else. Reload it to see the latest settings, then make your change again.': row('This link was changed by someone else. Reload it to see the latest settings, then make your change again.', 'Ce lien a été modifié par quelqu’un d’autre. Rechargez-le pour voir les derniers réglages, puis refaites votre modification.'),
  'This link was revoked and stays revoked. Create a new link to share again.': row('This link was revoked and stays revoked. Create a new link to share again.', 'Ce lien a été révoqué et le reste. Créez un nouveau lien pour partager à nouveau.'),
  'Only an active link can be rotated. Create a new link instead.': row('Only an active link can be rotated. Create a new link instead.', 'Seul un lien actif peut être renouvelé. Créez plutôt un nouveau lien.'),
  'Choose at least one channel for this link.': row('Choose at least one channel for this link.', 'Choisissez au moins un canal pour ce lien.'),
  'Choose channels that are enabled in this workspace.': row('Choose channels that are enabled in this workspace.', 'Choisissez des canaux activés dans cet espace.'),
  'Calendar links cannot approve posts.': row('Calendar links cannot approve posts.', 'Les liens de calendrier ne peuvent pas approuver de publications.'),
  'Only a link that lets clients decide can approve posts automatically.': row('Only a link that lets clients decide can approve posts automatically.', 'Seul un lien qui laisse le client décider peut approuver les publications automatiquement.'),
  'Automatic approval can wait at most {0} hours.': row('Automatic approval can wait at most {0} hours.', 'L’approbation automatique peut attendre {0} heures au maximum.'),
  'The title or message is too long.': row('The title or message is too long.', 'Le titre ou le message est trop long.'),
  'Nothing was changed.': row('Nothing was changed.', 'Rien n’a été modifié.'),
  'Links can last at most {0} days.': row('Links can last at most {0} days.', 'Un lien peut durer {0} jours au maximum.'),
  'A link can show at most {0} days back.': row('A link can show at most {0} days back.', 'Un lien peut afficher {0} jours passés au maximum.'),
  'A link can show at most {0} days ahead.': row('A link can show at most {0} days ahead.', 'Un lien peut afficher {0} jours à venir au maximum.'),
  'Choose at most {0} channels for one link.': row('Choose at most {0} channels for one link.', 'Choisissez {0} canaux au maximum pour un même lien.'),
  'Changing access replaces the link address. Confirm with: {0}': row('Changing access replaces the link address. Confirm with: {0}', 'Modifier l’accès remplace l’adresse du lien. Confirmez avec : {0}'),

  // Bio page
  'That address is taken. Choose another.': row('That address is taken. Choose another.', 'Cette adresse est déjà prise. Choisissez-en une autre.'),
  'The bio page could not be saved.': row('The bio page could not be saved.', 'La page de liens n’a pas pu être enregistrée.'),
  'This workspace has no bio page.': row('This workspace has no bio page.', 'Cet espace n’a pas de page de liens.'),
  'Use a secure (https) picture address.': row('Use a secure (https) picture address.', 'Utilisez une adresse d’image sécurisée (https).'),
  'Each link needs a short label and a valid web address.': row('Each link needs a short label and a valid web address.', 'Chaque lien nécessite un libellé court et une adresse web valide.'),

  // Visitor answers
  'This link is not available.': row('This link is not available.', 'Ce lien n’est pas disponible.'),
  'Enter your name and a valid answer.': row('Enter your name and a valid answer.', 'Saisissez votre nom et une réponse valide.'),
  'Your name or comment is too long.': row('Your name or comment is too long.', 'Votre nom ou votre commentaire est trop long.'),
  'Tell the team what to change.': row('Tell the team what to change.', 'Indiquez à l’équipe ce qu’il faut modifier.'),
  'Write a comment first.': row('Write a comment first.', 'Écrivez d’abord un commentaire.'),
  'Comments are switched off for this link.': row('Comments are switched off for this link.', 'Les commentaires sont désactivés pour ce lien.'),
  'Your answer could not be stored.': row('Your answer could not be stored.', 'Votre réponse n’a pas pu être enregistrée.'),
  'Your answer could not be confirmed. Reload the page to see whether it was received before trying again.': row('Your answer could not be confirmed. Reload the page to see whether it was received before trying again.', 'Votre réponse n’a pas pu être confirmée. Rechargez la page pour vérifier si elle a été reçue avant de réessayer.'),
  'This post is no longer waiting for your decision.': row('This post is no longer waiting for your decision.', 'Cette publication n’attend plus votre décision.'),
  'Approved. Thank you.': row('Approved. Thank you.', 'Approuvée. Merci.'),
  'Changes requested. The team has been told.': row('Changes requested. The team has been told.', 'Modifications demandées. L’équipe a été prévenue.'),
  'Comment sent to the team.': row('Comment sent to the team.', 'Commentaire envoyé à l’équipe.'),
  'Your answer was sent to the team, who will make the final call.': row('Your answer was sent to the team, who will make the final call.', 'Votre réponse a été transmise à l’équipe, qui prendra la décision finale.'),
};

/** Reminder next to the visitor answer form, in both languages. */
export const answerNoticeDefault = {
  en: 'Your name and answer are shared with the team that sent you this link.',
  fr: 'Votre nom et votre réponse sont communiqués à l’équipe qui vous a envoyé ce lien.',
};
const notice = z.string().trim().max(300);
/** One notice per language. The earlier single-string setting is still accepted: its text is the English notice and French uses the shipped French one. */
export const answerNoticeSchema = z.union([
  z.object({ en: notice, fr: notice }).strict(),
  notice.transform(en => ({ en, fr: answerNoticeDefault.fr })),
]);

export type SharingMessages ={ [K in keyof typeof sharingMessages]: { en: string; fr: string } };
export const sharingMessagesSchema = z.object(Object.fromEntries(Object.keys(sharingMessages).map(key => [key, z.object({ en: z.string().trim().min(1).max(1000), fr: z.string().trim().min(1).max(1000) }).strict()])) as { [K in keyof SharingMessages]: z.ZodObject<{ en: z.ZodString; fr: z.ZodString }, 'strict'> }).strict();
