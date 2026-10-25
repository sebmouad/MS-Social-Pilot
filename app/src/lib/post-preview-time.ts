export function formatPostPreviewTime(date: Date, timeZone: string, locale: 'en' | 'fr' = 'en'): string {
  const tag = locale === 'fr' ? 'fr-FR' : 'en-US';
  try {
    return new Intl.DateTimeFormat(tag, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
}
