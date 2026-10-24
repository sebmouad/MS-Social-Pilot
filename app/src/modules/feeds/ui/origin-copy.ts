export type OriginLocale = 'en' | 'fr';

/** Wording for recipe-created posts shown inside Publishing (badge, filter, link). The status card reads the Root `feeds.copy` catalog instead. */
export const recipeOriginCopy = {
  en: { badge: 'Recipe', filter: 'Recipe automation', link: 'Article' },
  fr: { badge: 'Recette', filter: 'Automatisation des recettes', link: 'Article' },
} as const;
export type OriginCopyKey = keyof (typeof recipeOriginCopy)['en'];

export function originText(locale: OriginLocale, key: OriginCopyKey): string {
  return recipeOriginCopy[locale][key];
}
