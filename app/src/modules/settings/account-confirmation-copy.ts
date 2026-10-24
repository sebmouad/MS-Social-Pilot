import { z } from 'zod';
const copy = z.object({ more: z.string().min(1), previous: z.string().min(1), title: z.string().min(1), cancel: z.string().min(1), confirm: z.string().min(1), profile: z.string().min(1), password: z.string().min(1), session: z.string().min(1) }).strict();
export const accountConfirmationCopySchema = z.object({ en: copy, fr: copy }).strict();
export type AccountConfirmationCopy = z.infer<typeof copy>;
export const accountConfirmationCopy = {
  en: { more: 'Show more', previous: 'Previous', title: 'Confirm account change', cancel: 'Cancel', confirm: 'Confirm', profile: 'Save this profile name?', password: 'Change your password and sign out other sessions?', session: 'Sign out this session?' },
  fr: { more: 'Afficher plus', previous: 'Précédent', title: 'Confirmer la modification du compte', cancel: 'Annuler', confirm: 'Confirmer', profile: 'Enregistrer ce nom de profil ?', password: 'Changer votre mot de passe et déconnecter les autres sessions ?', session: 'Déconnecter cette session ?' },
};
