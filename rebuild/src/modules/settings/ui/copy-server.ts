import { configOrDefault } from '@/server/config/config-or-default';
import { runtimeConfig } from '@/server/config/store';
import { settingsUiCopySchema } from './copy-catalog';
export async function readSettingsUiCopy() {
  return (await configOrDefault('settings.uiCopy', settingsUiCopySchema));
}
