import { runtimeConfig } from '@/server/config/store';
import { settingsUiCopySchema } from './copy-catalog';
export async function readSettingsUiCopy() {
  return settingsUiCopySchema.parse(await runtimeConfig('settings.uiCopy'));
}
