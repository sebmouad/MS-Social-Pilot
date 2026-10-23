import { z } from 'zod';

export const COMMAND_COPY = {
  en: {
    trigger: 'Search or jump to…',
    placeholder: 'Search pages, actions and channels…',
    noResults: 'Nothing matches.',
    hint: 'Up and down to move, Enter to open, Esc to close.',
    close: 'Close',
    sectionActions: 'Create',
    sectionPages: 'Pages',
    sectionChannels: 'Channels',
  },
  fr: {
    trigger: 'Rechercher ou aller à…',
    placeholder: 'Rechercher des pages, des actions et des canaux…',
    noResults: 'Aucun résultat.',
    hint: 'Haut et bas pour naviguer, Entrée pour ouvrir, Échap pour fermer.',
    close: 'Fermer',
    sectionActions: 'Créer',
    sectionPages: 'Pages',
    sectionChannels: 'Canaux',
  },
} as const;

const shape = z.object(Object.fromEntries(Object.keys(COMMAND_COPY.en).map(key => [key, z.string().min(1).max(500)])) as { [K in keyof (typeof COMMAND_COPY)['en']]: z.ZodString });
export type CommandCopy = z.infer<typeof shape>;
export const commandCopySchema = z.object({ en: shape, fr: shape }).strict();

const savedText = (value: unknown): string | undefined => typeof value === 'string' && value.length >= 1 && value.length <= 500 ? value : undefined;

/**
 * Stored `home.commandPaletteCopy` catalogs outlive copy additions: wave 1 added
 * the three section titles, so a catalog saved before then lacks them. Merge the
 * saved entries over the shipped locale text instead of rejecting the whole
 * catalog: unknown keys and invalid values are dropped, saved customizations are
 * kept, and shipped text fills every gap. Root saves stay strict; this is the
 * read path only.
 */
export function resolveCommandCopy(saved: unknown): { en: CommandCopy; fr: CommandCopy } {
  const locales = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const resolve = (locale: 'en' | 'fr'): CommandCopy => {
    const shipped = COMMAND_COPY[locale] as unknown as Record<string, string>;
    const group = locales[locale];
    const stored = group && typeof group === 'object' && !Array.isArray(group) ? (group as Record<string, unknown>) : {};
    const out: Record<string, string> = {};
    for (const [key, fallback] of Object.entries(shipped)) out[key] = savedText(stored[key]) ?? fallback;
    return out as unknown as CommandCopy;
  };
  return { en: resolve('en'), fr: resolve('fr') };
}
