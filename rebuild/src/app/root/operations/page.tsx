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
    <header className="root-control__heading"><p className="root-config__eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.intro}</p></header>
    {await RootDiagnostics({ scope: 'shared' })}
    {await RootJobHealth()}
  </RootFrame>;
}
