import { configOrDefault } from '@/server/config/config-or-default';
import { runtimeConfig } from '@/server/config/store';
import { settingsUiCopySchema } from './copy-catalog';
import { sectionsCopySchema, type SectionsCopy } from './sections-copy';
export async function readSettingsUiCopy() {
  return (await configOrDefault('settings.uiCopy', settingsUiCopySchema));
}
/** Design v2 B6 labels (tabs, Workspace cards, Channels cards) for one locale. */
export async function readSectionsCopy(locale: 'en' | 'fr'): Promise<SectionsCopy> {
  return (await configOrDefault('settings.sectionsCopy', sectionsCopySchema))[locale];
}
