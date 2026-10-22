import { cache } from 'react';
import { headers } from 'next/headers';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_INTERFACE_COPY, type RootInterfaceCatalog, type RootInterfaceCopy } from '@/lib/config/root-interface-copy';

export type RootInterfaceText = RootInterfaceCopy;
import { rootCopyLocale } from '@/modules/root/server/admin/copy';

/** One Root interface catalog read shared by server components in the current render request. */
export const loadRootInterfaceCopy = cache(async () => {
  const locale = await loadRootLocale();
  const catalog = await runtimeConfig('root.interfaceCopy').catch(() => ROOT_INTERFACE_COPY);
  // A catalog saved before newer keys existed still reads; missing entries use the shipped text.
  return { ...ROOT_INTERFACE_COPY[locale], ...(catalog as RootInterfaceCatalog)[locale] };
});

export const loadRootLocale = cache(async () => rootCopyLocale((await headers()).get('accept-language')));

/** Fills named placeholders such as {count}. */
export function rootText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}

/** Root dates in the request language, always in UTC so the server's own time zone never leaks in. */
export async function loadRootDates() {
  const [locale, copy] = await Promise.all([loadRootLocale(), loadRootInterfaceCopy()]);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  return {
    dateTime: (value: Date | string) => rootText(copy.timeUtc, { time: dateTime.format(new Date(value)) }),
    date: (value: Date | string) => date.format(new Date(value)),
  };
}
