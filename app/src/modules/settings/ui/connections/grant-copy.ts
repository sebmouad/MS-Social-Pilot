/** Customer wording for the grouped permission chips; the group labels come from the platform module. */
export const grantChipCopy = {
  en: { summary: '{allowed} of {total} permissions', allowed: 'Allowed', missing: 'Not allowed', unknown: 'Not recorded', details: 'Show permission details', list: 'Permission details' },
  fr: { summary: '{allowed} autorisations sur {total}', allowed: 'Autorisé', missing: 'Non autorisé', unknown: 'Non enregistré', details: 'Afficher le détail des autorisations', list: 'Détail des autorisations' },
} as const;
export type GrantChipLocale = keyof typeof grantChipCopy;
