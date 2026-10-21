import { configValueOrDefault } from '@/server/config/config-or-default';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import { runtimeConfig } from '@/server/config/store';
import { catalogLanguages, defaultAdsCatalogs, type AdsCatalogs } from '../copy';

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
export function withAdsCopySnapshot<T>(operation: () => Promise<T>): Promise<T> {
  return snapshots.getStore() ? operation() : snapshots.run({}, operation);
}

/** Service/API/MCP failures use the same Root catalog as the customer screens. */
export async function adsServiceText(key: import('../copy').AdsCustomerKey, values: Record<string, string | number> = {}, locale: 'en' | 'fr' = 'en') {
  const { customer } = await loadAdsCopy();
  return customer[key][locale].replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}
