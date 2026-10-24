import { PageHeader } from '@/components/PageHeader';
import { LinkTabs } from '@/components/Tabs';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { RootDiagnostics } from '@/modules/root/ui/RootDiagnostics';
import { RootMonitoring } from '@/modules/root/ui/RootMonitoring';
import { RootJobHealth } from '@/modules/root/ui/RootJobHealth';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_INTERFACE_COPY, type RootInterfaceCatalog } from '@/lib/config/root-interface-copy';
import { rootCopyLocale } from '@/modules/root/server/admin/copy';
import { headers } from 'next/headers';
import { ROOT_OPERATIONS_COPY } from '@/lib/config/root-operations-copy';

export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const copy = await runtimeConfig('root.operationsCopy').catch(() => ROOT_OPERATIONS_COPY);
  return { title: copy.metadataTitle };
}

export default async function RootOperationsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requireRootPage();
  const [copy, interfaceCatalog, query] = await Promise.all([
    runtimeConfig('root.operationsCopy').catch(() => ROOT_OPERATIONS_COPY),
    runtimeConfig('root.interfaceCopy').catch(() => ROOT_INTERFACE_COPY),
    searchParams ?? Promise.resolve({} as { tab?: string | string[] }),
  ]);
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const interfaceCopy = (interfaceCatalog as RootInterfaceCatalog)[locale];
  const tab = query.tab === 'diagnostics' ? 'diagnostics' : 'jobs';
  return <RootFrame active="/root/operations">
    <PageHeader module="root" title={copy.title} description={<>{copy.intro}</>} />
    <LinkTabs label={interfaceCopy.sectionTabs} moreLabel={interfaceCopy.moreSections} activeId={tab} items={[
      { id: 'jobs', href: '/root/operations?tab=jobs', label: interfaceCopy.tabJobs },
      { id: 'diagnostics', href: '/root/operations?tab=diagnostics', label: interfaceCopy.tabDiagnostics },
    ]} />
    {tab === 'diagnostics' ? await RootDiagnostics({ scope: 'shared' }) : <>{await RootJobHealth()}{await RootMonitoring()}</>}
  </RootFrame>;
}
