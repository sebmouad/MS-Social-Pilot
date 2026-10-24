import { composerCatalogDefaults, composerText } from '../../composer-catalog';
/** Browser-safe defaults; server screens pass the live Root catalog. */
export const composerCopy = { en: composerText(composerCatalogDefaults, 'en'), fr: composerText(composerCatalogDefaults, 'fr') };
