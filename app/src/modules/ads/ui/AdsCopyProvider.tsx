'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { customerText, localizeAdsMessage, defaultAdsCatalogs, type AdsCatalogs, type AdsCustomerKey } from '../copy';
const Context = createContext({ catalogs: defaultAdsCatalogs, locale: 'en' as 'en' | 'fr' });
export function AdsCopyProvider({ catalogs, locale, children }: { catalogs: AdsCatalogs; locale: 'en' | 'fr'; children: ReactNode }) { return <Context.Provider value={{ catalogs, locale }}>{children}</Context.Provider>; }
export function useAdsCatalogs() { return useContext(Context); }
export function useAdsText(preferredLocale?: 'en' | 'fr') { const { catalogs, locale } = useAdsCatalogs(); return (key: AdsCustomerKey, values?: Record<string, string | number>) => customerText(catalogs.customer, preferredLocale ?? locale, key, values); }

export function useAdsMessage() { const { catalogs, locale } = useAdsCatalogs(); return (message: string) => localizeAdsMessage(catalogs, locale, message); }
