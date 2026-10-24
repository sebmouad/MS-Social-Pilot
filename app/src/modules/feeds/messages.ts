import { z } from 'zod';

/**
 * Root-editable text of the content feeds' server failures (REST and MCP replies), English and French.
 * Source phrases are the catalog identities; `{0}`, `{1}` mark values supplied at the call site.
 * The screens have their own catalogs in `./copy` and `./copy-recipes`.
 */
const row = (en: string, fr: string) => ({ en, fr });

export const feedsMessages = {
  'Sign in with an active account to continue.': row('Sign in with an active account to continue.', 'Connectez-vous avec un compte actif pour continuer.'),
  'Sign in to an authorized workspace.': row('Sign in to an authorized workspace.', 'Connectez-vous à un espace autorisé.'),
  'This feature is unavailable in this workspace.': row('This feature is unavailable in this workspace.', 'Cette fonctionnalité n’est pas disponible dans cet espace.'),
  'You do not have permission to manage feeds.': row('You do not have permission to manage feeds.', 'Vous n’avez pas l’autorisation de gérer les flux.'),
  'Your active workspace access changed. Sign in again to continue.': row('Your active workspace access changed. Sign in again to continue.', 'Votre accès à l’espace a changé. Reconnectez-vous pour continuer.'),
  'Choose a supported feed action.': row('Choose a supported feed action.', 'Choisissez une action de flux prise en charge.'),
  'Choose valid filters.': row('Choose valid filters.', 'Choisissez des filtres valides.'),
  'Choose valid feed details and confirm the exact action.': row('Choose valid feed details and confirm the exact action.', 'Indiquez des informations de flux valides et confirmez l’action exacte.'),
  'Content feeds are temporarily unavailable. Refresh and try again.': row('Content feeds are temporarily unavailable. Refresh and try again.', 'Les flux de contenu sont momentanément indisponibles. Actualisez puis réessayez.'),
  'This feed is unavailable in the current workspace.': row('This feed is unavailable in the current workspace.', 'Ce flux n’est pas disponible dans l’espace actuel.'),
  'A feed with this address already exists in the current workspace.': row('A feed with this address already exists in the current workspace.', 'Un flux avec cette adresse existe déjà dans l’espace actuel.'),
  'The feed operation could not be confirmed. Refresh the list before trying again.': row('The feed operation could not be confirmed. Refresh the list before trying again.', 'L’opération sur le flux n’a pas pu être confirmée. Actualisez la liste avant de réessayer.'),
  'This workspace has reached its feed limit.': row('This workspace has reached its feed limit.', 'Cet espace a atteint sa limite de flux.'),
  'This feed is turned off. Turn it on to check it.': row('This feed is turned off. Turn it on to check it.', 'Ce flux est désactivé. Activez-le pour le vérifier.'),
  'This feed was checked moments ago. Wait a little before checking again.': row('This feed was checked moments ago. Wait a little before checking again.', 'Ce flux vient d’être vérifié. Patientez un peu avant de le vérifier à nouveau.'),
  'Choose at least one channel for this feed.': row('Choose at least one channel for this feed.', 'Choisissez au moins un canal pour ce flux.'),
  'Enter a valid feed address.': row('Enter a valid feed address.', 'Saisissez une adresse de flux valide.'),
  'Choose at least one channel for this feed before it creates posts.': row('Choose at least one channel for this feed before it creates posts.', 'Choisissez au moins un canal pour ce flux avant qu’il ne crée des publications.'),
  'This feed was turned off. Turn it on to create posts.': row('This feed was turned off. Turn it on to create posts.', 'Ce flux a été désactivé. Activez-le pour créer des publications.'),
  'This feed changed while it was being read.': row('This feed changed while it was being read.', 'Ce flux a changé pendant sa lecture.'),
  'Workspace scheduling settings are unavailable.': row('Workspace scheduling settings are unavailable.', 'Les réglages de planification de l’espace sont indisponibles.'),
  'The feed address is not valid.': row('The feed address is not valid.', 'L’adresse du flux n’est pas valide.'),
  'The feed address must use https.': row('The feed address must use https.', 'L’adresse du flux doit utiliser https.'),
  'This feed address cannot be read.': row('This feed address cannot be read.', 'Cette adresse de flux ne peut pas être lue.'),
  'This site is not allowed for feeds.': row('This site is not allowed for feeds.', 'Ce site n’est pas autorisé pour les flux.'),
  'The feed redirected too many times.': row('The feed redirected too many times.', 'Le flux a effectué trop de redirections.'),
  'The feed is larger than the allowed size.': row('The feed is larger than the allowed size.', 'Le flux dépasse la taille autorisée.'),
  'The feed took too long to respond.': row('The feed took too long to respond.', 'Le flux a mis trop de temps à répondre.'),
  'The feed did not return a usable response.': row('The feed did not return a usable response.', 'Le flux n’a pas renvoyé de réponse exploitable.'),
  'The feed could not be reached.': row('The feed could not be reached.', 'Le flux n’a pas pu être atteint.'),
  'The feed could not be read.': row('The feed could not be read.', 'Le flux n’a pas pu être lu.'),
  'Recipe planning is temporarily unavailable. Refresh and try again.': row('Recipe planning is temporarily unavailable. Refresh and try again.', 'La planification des recettes est momentanément indisponible. Actualisez puis réessayez.'),
  'Recipe planning is not available right now.': row('Recipe planning is not available right now.', 'La planification des recettes n’est pas disponible pour le moment.'),
  'No recipe source is set up in this workspace.': row('No recipe source is set up in this workspace.', 'Aucune source de recettes n’est configurée dans cet espace.'),
  'One or more channels are unavailable. Refresh and choose again.': row('One or more channels are unavailable. Refresh and choose again.', 'Un ou plusieurs canaux sont indisponibles. Actualisez puis choisissez à nouveau.'),
  'The recipe library could not be reached. Try again later.': row('The recipe library could not be reached. Try again later.', 'La bibliothèque de recettes est injoignable. Réessayez plus tard.'),
  'The recipe library could not be read. Try again later.': row('The recipe library could not be read. Try again later.', 'La bibliothèque de recettes n’a pas pu être lue. Réessayez plus tard.'),
  'This recipe source is paused. Resume it to plan posts.': row('This recipe source is paused. Resume it to plan posts.', 'Cette source de recettes est en pause. Reprenez-la pour planifier des publications.'),
  'Planning could not be completed. Check the planned posts before trying again.': row('Planning could not be completed. Check the planned posts before trying again.', 'La planification n’a pas pu être terminée. Vérifiez les publications planifiées avant de réessayer.'),
  'Choose at least one channel for this recipe source.': row('Choose at least one channel for this recipe source.', 'Choisissez au moins un canal pour cette source de recettes.'),
  'Choose at least one channel, or use all channels.': row('Choose at least one channel, or use all channels.', 'Choisissez au moins un canal, ou utilisez tous les canaux.'),
  'Enter the recipe site address, starting with https://': row('Enter the recipe site address, starting with https://', 'Saisissez l’adresse du site de recettes, en commençant par https://'),
  'Choose pause or resume and confirm.': row('Choose pause or resume and confirm.', 'Choisissez la pause ou la reprise, puis confirmez.'),
  'Enter valid recipe source details.': row('Enter valid recipe source details.', 'Saisissez des informations valides pour la source de recettes.'),
  'Confirm the planning run.': row('Confirm the planning run.', 'Confirmez l’exécution de la planification.'),
  'Enter valid feed details.': row('Enter valid feed details.', 'Saisissez des informations de flux valides.'),
  'Choose a valid feed check.': row('Choose a valid feed check.', 'Choisissez une vérification de flux valide.'),
  'The recipe source could not be changed.': row('The recipe source could not be changed.', 'La source de recettes n’a pas pu être modifiée.'),
  'The recipe source could not be loaded.': row('The recipe source could not be loaded.', 'La source de recettes n’a pas pu être chargée.'),
  'The recipe source could not be saved.': row('The recipe source could not be saved.', 'La source de recettes n’a pas pu être enregistrée.'),
  'The upcoming recipes could not be previewed.': row('The upcoming recipes could not be previewed.', 'Les prochaines recettes n’ont pas pu être prévisualisées.'),
  'Planning could not be completed.': row('Planning could not be completed.', 'La planification n’a pas pu être terminée.'),
  'Feeds could not be loaded.': row('Feeds could not be loaded.', 'Les flux n’ont pas pu être chargés.'),
  'The feed could not be saved.': row('The feed could not be saved.', 'Le flux n’a pas pu être enregistré.'),
  'The feed could not be deleted.': row('The feed could not be deleted.', 'Le flux n’a pas pu être supprimé.'),
  'The feed could not be checked.': row('The feed could not be checked.', 'Le flux n’a pas pu être vérifié.'),
};

export type FeedsMessages = { [K in keyof typeof feedsMessages]: { en: string; fr: string } };
export const feedsMessagesSchema = z.object(Object.fromEntries(Object.keys(feedsMessages).map(key => [key, z.object({ en: z.string().trim().min(1).max(1000), fr: z.string().trim().min(1).max(1000) }).strict()])) as { [K in keyof FeedsMessages]: z.ZodObject<{ en: z.ZodString; fr: z.ZodString }, 'strict'> }).strict();
