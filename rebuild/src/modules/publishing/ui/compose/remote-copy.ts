import type { PublishingFormatDescriptor } from '@/platforms/types';
import { catalogGroup, composerCatalogDefaults, type ComposerCatalog } from '../../composer-catalog';
export const remoteScheduleCopy = { en: catalogGroup(composerCatalogDefaults, 'remote', 'en'), fr: catalogGroup(composerCatalogDefaults, 'remote', 'fr') };

export type RemoteScheduleLocale = keyof typeof remoteScheduleCopy;

export function holdsRemotely(format: Pick<PublishingFormatDescriptor, 'scheduling'> | undefined): boolean {
  return Boolean(format?.scheduling.native && format.scheduling.nativeLeadSeconds);
}

/** "10 minutes", "36 hours", "75 days": the coarsest whole unit. */
export function leadLabel(seconds: number, locale: RemoteScheduleLocale, catalog: ComposerCatalog = composerCatalogDefaults): string {
  const copy = catalogGroup(catalog, 'remote', locale);
  const days = seconds / 86400, hours = seconds / 3600;
  const unit = (template: string, n: number) => (n === 1 ? template.replace(/s$/, '') : template).replace('{n}', String(n));
  if (Number.isInteger(days) && days >= 1) return unit(copy.days, days);
  if (Number.isInteger(hours) && hours >= 1) return unit(copy.hours, hours);
  return unit(copy.minutes, Math.max(1, Math.round(seconds / 60)));
}
