import type { KitLocale } from '../kit/copy';

/** Neutral wording for the origin filter. Provider-specific words (badge, link) come from the provider. */
export const originCopy: Record<KitLocale, { createdBy: string; anyOrigin: string; filterLabel: string; sourceLabel: string }> = {
  en: { createdBy: 'Created by', anyOrigin: 'Anyone', filterLabel: 'Created by', sourceLabel: 'Source' },
  fr: { createdBy: 'Créé par', anyOrigin: 'Tout le monde', filterLabel: 'Créé par', sourceLabel: 'Source' },
};
