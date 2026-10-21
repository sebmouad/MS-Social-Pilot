import { configValueOrDefault } from '@/server/config/config-or-default';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import { catalogLanguages, defaultAdsCatalogs, type AdsCatalogs } from '../copy';
import { headers } from 'next/headers';
import { adsLocale } from '../analysis/copy';
import { platformAdsLocale, withPlatformAdsLocale } from '@/server/platforms/host';

const snapshots = new AsyncLocalStorage<{ copy?: Promise<AdsCatalogs> }>();
const readAdsCopy = cache(async (): Promise<AdsCatalogs> => {
  try {
    const [customer, analysis, creative] = await Promise.all([configValueOrDefault('ads.customerCopy'), configValueOrDefault('ads.analysisCopy'), configValueOrDefault('ads.creativeCopy')]);
    return { customer, analysis: catalogLanguages(analysis), creative: catalogLanguages(creative) };
  } catch {
    // Copy availability cannot replace an intentional product error with a storage exception.
    return defaultAdsCatalogs;
  }
});

/** React renders and standalone UI/API/MCP service operations share a single coherent snapshot. */
export function loadAdsCopy(): Promise<AdsCatalogs> {
  const request = snapshots.getStore();
  if (!request) return readAdsCopy();
  return request.copy ??= readAdsCopy();
}

/** Nested public services reuse their caller's snapshot; independent requests remain isolated. */
export async function withAdsCopySnapshot<T>(operation: () => Promise<T>): Promise<T> {
  if (snapshots.getStore()) return operation();
  let locale = platformAdsLocale();
  // UI/REST request language; standalone MCP callers retain their host locale scope.
  try { const language = (await headers()).get('accept-language'); if (language) locale = adsLocale(language); } catch { /* no HTTP request scope */ }
  return withPlatformAdsLocale(locale, () => snapshots.run({}, operation));
}

/** Service/API/MCP failures use the same Root catalog as the customer screens. */
export async function adsServiceText(key: import('../copy').AdsCustomerKey, values: Record<string, string | number> = {}, locale: 'en' | 'fr' = platformAdsLocale()) {
  const { customer } = await loadAdsCopy();
  return customer[key][locale].replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}
