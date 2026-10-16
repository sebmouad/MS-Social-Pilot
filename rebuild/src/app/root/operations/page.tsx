import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { RootDiagnostics } from '@/server/root/RootDiagnostics';
import { RootJobHealth } from '@/server/jobs/RootJobHealth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operations · Root' };

export default async function RootOperationsPage() {
  await requireRootPage();
  return <RootFrame active="/root/operations">
    <header className="root-control__heading"><p className="root-config__eyebrow">Root · Control center</p><h1>Operations</h1><p>Background worker heartbeat and recorded sync attempts.</p></header>
    {await RootDiagnostics({ scope: 'shared' })}
    {await RootJobHealth()}
  </RootFrame>;
}
