export const responseTimeCopyDefaults = {
  unavailable: { en: 'Not available', fr: 'Non disponible' },
  minutes: { en: '{0} min', fr: '{0} min' }, hoursMinutes: { en: '{0} h {1} min', fr: '{0} h {1} min' }, hours: { en: '{0} h', fr: '{0} h' }, days: { en: '{0} days', fr: '{0} jours' },
  sun: { en: 'Sun', fr: 'Dim' }, mon: { en: 'Mon', fr: 'Lun' }, tue: { en: 'Tue', fr: 'Mar' }, wed: { en: 'Wed', fr: 'Mer' }, thu: { en: 'Thu', fr: 'Jeu' }, fri: { en: 'Fri', fr: 'Ven' }, sat: { en: 'Sat', fr: 'Sam' },
  outside: { en: 'Outside the app', fr: 'En dehors de l’application' }, former: { en: 'Former member', fr: 'Ancien membre' },
};
export type ResponseTimeCopy = typeof responseTimeCopyDefaults;
export function responseText(copy: ResponseTimeCopy, locale: 'en' | 'fr', key: keyof ResponseTimeCopy, ...values: Array<string | number>) { return copy[key][locale].replace(/\{(\d+)\}/g, (match, index: string) => String(values[Number(index)] ?? match)); }
