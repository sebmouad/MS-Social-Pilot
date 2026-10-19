/** Media library customer copy in both shipped languages; keys mirror legacy `media.*`. */
export const mediaLibraryCopy = {
  en: {
    usage: '{files} images · {size} stored',
    unused: '{files} unused ({size}) can be deleted',
    usedBy: 'Used by {count} posts',
    usedByOne: 'Used by 1 post',
    notGoneOut: 'Not published yet',
    hiddenPosts: '{count} more you can’t see',
    unusedBadge: 'Unused',
    untitled: 'Untitled post',
  },
  fr: {
    usage: '{files} images · {size} stockés',
    unused: '{files} inutilisées ({size}) peuvent être supprimées',
    usedBy: 'Utilisée dans {count} publications',
    usedByOne: 'Utilisée dans 1 publication',
    notGoneOut: 'Pas encore publiée',
    hiddenPosts: '{count} autres que vous ne pouvez pas voir',
    unusedBadge: 'Inutilisée',
    untitled: 'Publication sans texte',
  },
} as const;
export type MediaLibraryLocale = keyof typeof mediaLibraryCopy;
export function mediaLibraryText(locale: MediaLibraryLocale, key: keyof typeof mediaLibraryCopy.en, values: Record<string, string | number> = {}): string {
  return (mediaLibraryCopy[locale][key] as string).replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}
