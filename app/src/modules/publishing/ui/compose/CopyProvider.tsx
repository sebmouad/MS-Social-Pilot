'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { composerCatalogDefaults, catalogGroup, type ComposerCatalog } from '../../composer-catalog';
const Context = createContext({ catalog: composerCatalogDefaults, locale: 'en' as 'en' | 'fr' });
export function ComposerCopyProvider({ catalog, locale, children }: { catalog: ComposerCatalog; locale: 'en' | 'fr'; children: ReactNode }) {
  const value = useMemo(() => ({ catalog, locale }), [catalog, locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useComposerCatalog() { return useContext(Context); }
export function useCollaborationCopy() { const { catalog, locale } = useComposerCatalog(); return useMemo(() => catalogGroup(catalog, 'collab', locale), [catalog, locale]); }
export function useAttachmentCopy() { const { catalog, locale } = useComposerCatalog(); return useMemo(() => catalogGroup(catalog, 'attachments', locale), [catalog, locale]); }
