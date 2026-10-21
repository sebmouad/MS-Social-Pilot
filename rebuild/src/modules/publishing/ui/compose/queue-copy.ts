import { catalogGroup, composerCatalogDefaults } from '../../composer-catalog';
export type QueueLocale = 'en' | 'fr';
export const queueCopy = { en: catalogGroup(composerCatalogDefaults, 'queue', 'en'), fr: catalogGroup(composerCatalogDefaults, 'queue', 'fr') };

export const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
