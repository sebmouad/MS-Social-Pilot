import { PageHeader } from '@/components/PageHeader';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { RootDiagnostics } from '@/server/root/RootDiagnostics';
import { RootJobHealth } from '@/server/jobs/RootJobHealth';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_OPERATIONS_COPY } from '@/lib/config/root-operations-copy';

export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const copy = await runtimeConfig('root.operationsCopy').catch(() => ROOT_OPERATIONS_COPY);
  return { title: copy.metadataTitle };
}

export default async function RootOperationsPage() {
  await requireRootPage();
  const copy = await runtimeConfig('root.operationsCopy').catch(() => ROOT_OPERATIONS_COPY);
  return <RootFrame active="/root/operations">
    <PageHeader module="root" title={copy.title} description={<>{copy.intro}</>} />
    {await RootDiagnostics({ scope: 'shared' })}
    {await RootJobHealth()}
  </RootFrame>;
}
