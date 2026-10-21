'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { publishingCopyDefaults, resolvePublishingCopy, type PublishingCopyCatalog, type KitLocale } from './copy';
const LocaleContext = createContext<KitLocale>('en');
const CopyContext = createContext<PublishingCopyCatalog>(publishingCopyDefaults);
export function PublishingCopyProvider({ catalog, locale = 'en', children }: { catalog: PublishingCopyCatalog; locale?: KitLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}><CopyContext.Provider value={catalog}>{children}</CopyContext.Provider></LocaleContext.Provider>;
}
export function usePublishingCopy(locale?: KitLocale) {
  const requestLocale = useContext(LocaleContext);
  return resolvePublishingCopy(useContext(CopyContext))[locale ?? requestLocale];
}

export function usePublishingLocale() { return useContext(LocaleContext); }
