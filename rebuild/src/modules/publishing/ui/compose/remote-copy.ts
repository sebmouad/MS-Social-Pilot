import type { PublishingFormatDescriptor } from '@/platforms/types';

/** Customer copy for the "where is this post held until it goes out" choice. Operator terms stay out of it. */
export const remoteScheduleCopy = {
  en: {
    legend: 'Where to hold the schedule',
    application: 'In the app',
    applicationHint: 'We publish at the chosen time. You can still edit the post until then.',
    remote: 'On the platform',
    remoteHint: 'The post is sent now and the platform publishes it at the chosen time, even if this app is offline. To change its content you cancel the schedule and schedule again.',
    window: 'Allowed between {min} and {max} ahead.',
    appOnly: 'Published by the app instead: {names}.',
    perDestination: 'Choose for each destination',
    perDestinationHint: 'Each destination can hold its schedule in the app or on its platform.',
    sameAsAbove: 'Same as above',
    minutes: '{n} minutes', hours: '{n} hours', days: '{n} days',
  },
  fr: {
    legend: 'Où conserver la programmation',
    application: 'Dans l’application',
    applicationHint: 'Nous publions à l’heure choisie. Vous pouvez encore modifier la publication jusque-là.',
    remote: 'Sur la plateforme',
    remoteHint: 'La publication est envoyée maintenant et la plateforme la publie à l’heure choisie, même si cette application est hors ligne. Pour modifier son contenu, annulez la programmation puis reprogrammez.',
    window: 'Possible entre {min} et {max} à l’avance.',
    appOnly: 'Publié par l’application à la place : {names}.',
    perDestination: 'Choisir pour chaque destination',
    perDestinationHint: 'Chaque destination peut conserver sa programmation dans l’application ou sur sa plateforme.',
    sameAsAbove: 'Comme ci-dessus',
    minutes: '{n} minutes', hours: '{n} heures', days: '{n} jours',
  },
} as const;

export type RemoteScheduleLocale = keyof typeof remoteScheduleCopy;

export function holdsRemotely(format: Pick<PublishingFormatDescriptor, 'scheduling'> | undefined): boolean {
  return Boolean(format?.scheduling.native && format.scheduling.nativeLeadSeconds);
}

/** "10 minutes", "36 hours", "75 days": the coarsest whole unit. */
export function leadLabel(seconds: number, locale: RemoteScheduleLocale): string {
  const copy = remoteScheduleCopy[locale];
  const days = seconds / 86400, hours = seconds / 3600;
  const unit = (template: string, n: number) => (n === 1 ? template.replace(/s$/, '') : template).replace('{n}', String(n));
  if (Number.isInteger(days) && days >= 1) return unit(copy.days, days);
  if (Number.isInteger(hours) && hours >= 1) return unit(copy.hours, hours);
  return unit(copy.minutes, Math.max(1, Math.round(seconds / 60)));
}
