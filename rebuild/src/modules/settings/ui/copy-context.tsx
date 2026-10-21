'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { settingsUiCopy, type SettingsUiCopy } from './copy-catalog';
const CopyContext = createContext<SettingsUiCopy>(settingsUiCopy);
export function SettingsCopyProvider({ copy, children }: { copy: SettingsUiCopy; children: ReactNode }) {
  return <CopyContext.Provider value={copy}>{children}</CopyContext.Provider>;
}
export function useSettingsCopy<K extends keyof SettingsUiCopy>(key: K, locale: 'en' | 'fr'): SettingsUiCopy[K]['en'] {
  return useContext(CopyContext)[key][locale];
}
