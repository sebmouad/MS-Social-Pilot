import { cache } from 'react';
import { headers } from 'next/headers';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_INTERFACE_COPY, type RootInterfaceCatalog, type RootInterfaceCopy } from '@/lib/config/root-interface-copy';

export type RootInterfaceText = RootInterfaceCopy;
import { rootCopyLocale } from '@/modules/root/server/admin/copy';

/** One Root interface catalog read shared by server components in the current render request. */
export const loadRootInterfaceCopy = cache(async () => {
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const catalog = await runtimeConfig('root.interfaceCopy').catch(() => ROOT_INTERFACE_COPY);
  return (catalog as RootInterfaceCatalog)[locale];
});
