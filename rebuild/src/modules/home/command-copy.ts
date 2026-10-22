import { z } from 'zod';

export const COMMAND_COPY = {
  en: {
    trigger: 'Search or jump to…',
    placeholder: 'Search pages…',
    noResults: 'Nothing matches.',
    hint: 'Up and down to move, Enter to open, Esc to close.',
    close: 'Close',
  },
  fr: {
    trigger: 'Rechercher ou aller à…',
    placeholder: 'Rechercher des pages…',
    noResults: 'Aucun résultat.',
    hint: 'Haut et bas pour naviguer, Entrée pour ouvrir, Échap pour fermer.',
    close: 'Fermer',
  },
} as const;

const shape = z.object(Object.fromEntries(Object.keys(COMMAND_COPY.en).map(key => [key, z.string().min(1).max(500)])) as { [K in keyof (typeof COMMAND_COPY)['en']]: z.ZodString });
export type CommandCopy = z.infer<typeof shape>;
export const commandCopySchema = z.object({ en: shape, fr: shape }).strict();
