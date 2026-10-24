import { z } from 'zod';

/**
 * Root-editable text of the media library's server failures (REST and MCP replies), English and French.
 * Source phrases are the catalog identities; `{0}`, `{1}` mark values supplied at the call site.
 * The screens have their own catalog in `./copy`.
 */
const row = (en: string, fr: string) => ({ en, fr });

export const mediaMessages = {
  'This WebP image could not be imported. Use a still PNG or JPEG image instead.': row('This WebP image could not be imported. Use a still PNG or JPEG image instead.', 'Cette image WebP ne peut pas être importée. Utilisez une image PNG ou JPEG fixe.'),
  'Image conversion is busy. Try again shortly.': row('Image conversion is busy. Try again shortly.', 'La conversion d’images est occupée. Réessayez dans un instant.'),
  'Sign in with an active account to continue.': row('Sign in with an active account to continue.', 'Connectez-vous avec un compte actif pour continuer.'),
  'Sign in to an authorized workspace.': row('Sign in to an authorized workspace.', 'Connectez-vous à un espace autorisé.'),
  'This feature is unavailable in this workspace.': row('This feature is unavailable in this workspace.', 'Cette fonctionnalité n’est pas disponible dans cet espace.'),
  'Your active workspace access changed. Sign in again to continue.': row('Your active workspace access changed. Sign in again to continue.', 'Votre accès à l’espace a changé. Reconnectez-vous pour continuer.'),
  'Renaming media requires access to all channels.': row('Renaming media requires access to all channels.', 'Renommer un média nécessite un accès à toutes les chaînes.'),
  'Choose a supported media action.': row('Choose a supported media action.', 'Choisissez une action média prise en charge.'),
  'Choose valid filters.': row('Choose valid filters.', 'Choisissez des filtres valides.'),
  'Choose valid media details and confirm the exact action.': row('Choose valid media details and confirm the exact action.', 'Indiquez des informations média valides et confirmez l’action exacte.'),
  'Enter a valid web address.': row('Enter a valid web address.', 'Saisissez une adresse web valide.'),
  'Confirm the exact media deletion.': row('Confirm the exact media deletion.', 'Confirmez la suppression exacte du média.'),
  'Shorten the search.': row('Shorten the search.', 'Raccourcissez la recherche.'),
  'This file is not an accepted image, or it is larger than the allowed size.': row('This file is not an accepted image, or it is larger than the allowed size.', 'Ce fichier n’est pas une image acceptée, ou il dépasse la taille autorisée.'),
  'That address did not return a file.': row('That address did not return a file.', 'Cette adresse n’a renvoyé aucun fichier.'),
  'That address does not return a supported image or video.': row('That address does not return a supported image or video.', 'Cette adresse ne renvoie pas d’image ou de vidéo prise en charge.'),
  'That video is not an accepted type or is larger than the allowed size.': row('That video is not an accepted type or is larger than the allowed size.', 'Cette vidéo n’est pas d’un type accepté ou dépasse la taille autorisée.'),
  'The media library is temporarily unavailable. Refresh and try again.': row('The media library is temporarily unavailable. Refresh and try again.', 'La médiathèque est momentanément indisponible. Actualisez puis réessayez.'),
  'The media operation could not be confirmed. Refresh the library before trying again.': row('The media operation could not be confirmed. Refresh the library before trying again.', 'L’opération sur le média n’a pas pu être confirmée. Actualisez la médiathèque avant de réessayer.'),
  'Media storage is not available. Try again later.': row('Media storage is not available. Try again later.', 'Le stockage des médias n’est pas disponible. Réessayez plus tard.'),
  'This workspace has reached its media storage limit. Delete unused media and try again.': row('This workspace has reached its media storage limit. Delete unused media and try again.', 'Cet espace a atteint sa limite de stockage de médias. Supprimez les médias inutilisés puis réessayez.'),
  'Deleting media can affect posts on every channel. Ask a member with access to all channels.': row('Deleting media can affect posts on every channel. Ask a member with access to all channels.', 'Supprimer un média peut affecter les publications de tous les canaux. Demandez à un membre ayant accès à tous les canaux.'),
  'This media is unavailable in the current workspace.': row('This media is unavailable in the current workspace.', 'Ce média n’est pas disponible dans l’espace actuel.'),
  'This media is used by 1 post. Remove it from that post first, or confirm deleting it anyway.': row('This media is used by 1 post. Remove it from that post first, or confirm deleting it anyway.', 'Ce média est utilisé par 1 publication. Retirez-le d’abord de cette publication, ou confirmez sa suppression malgré tout.'),
  'This media is used by {0} posts. Remove it from those posts first, or confirm deleting it anyway.': row('This media is used by {0} posts. Remove it from those posts first, or confirm deleting it anyway.', 'Ce média est utilisé par {0} publications. Retirez-le d’abord de ces publications, ou confirmez sa suppression malgré tout.'),
  'This media is used by many posts. Remove it from those posts first, or confirm deleting it anyway.': row('This media is used by many posts. Remove it from those posts first, or confirm deleting it anyway.', 'Ce média est utilisé par de nombreuses publications. Retirez-le d’abord de ces publications, ou confirmez sa suppression malgré tout.'),
  'This media is used by posts that are scheduled, publishing or awaiting approval. Change those posts first.': row('This media is used by posts that are scheduled, publishing or awaiting approval. Change those posts first.', 'Ce média est utilisé par des publications programmées, en cours de publication ou en attente de validation. Modifiez d’abord ces publications.'),
  'The media library could not be loaded.': row('The media library could not be loaded.', 'La médiathèque n’a pas pu être chargée.'),
  'The media could not be imported.': row('The media could not be imported.', 'Le média n’a pas pu être importé.'),
  'The media could not be deleted.': row('The media could not be deleted.', 'Le média n’a pas pu être supprimé.'),
  'This media is now in use. Refresh and review before deleting.': row('This media is now in use. Refresh and review before deleting.', 'Ce média est désormais utilisé. Actualisez et vérifiez avant de le supprimer.'),
};

export type MediaMessages = { [K in keyof typeof mediaMessages]: { en: string; fr: string } };
export const mediaMessagesSchema = z.object(Object.fromEntries(Object.keys(mediaMessages).map(key => [key, z.object({ en: z.string().trim().min(1).max(1000), fr: z.string().trim().min(1).max(1000) }).strict()])) as { [K in keyof MediaMessages]: z.ZodObject<{ en: z.ZodString; fr: z.ZodString }, 'strict'> }).strict();
