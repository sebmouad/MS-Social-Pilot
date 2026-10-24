import { headers } from 'next/headers';

export type SettingsLocale = 'en' | 'fr';

/** Same Accept-Language rule the Account and Connections screens already use. */
export async function settingsLocale(): Promise<SettingsLocale> {
  return /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
}
