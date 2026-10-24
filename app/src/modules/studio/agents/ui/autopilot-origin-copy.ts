export type AutopilotOriginLocale = 'en' | 'fr';

/** Wording for autopilot-scheduled posts shown inside Publishing (badge, filter, link). */
export const autopilotOriginCopy = {
  en: { badge: 'Autopilot', filter: 'Scheduled by autopilot', link: 'Run history' },
  fr: { badge: 'Pilotage auto', filter: 'Programmé par le pilotage automatique', link: 'Historique' },
} as const;
export type AutopilotOriginCopyKey = keyof (typeof autopilotOriginCopy)['en'];

export function autopilotOriginText(locale: AutopilotOriginLocale, key: AutopilotOriginCopyKey): string {
  return autopilotOriginCopy[locale][key];
}
