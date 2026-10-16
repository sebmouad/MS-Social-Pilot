import { requireRootPage } from '@/server/config/access';
import { listRootDiagnostics } from './diagnostics';
import { RootDiagnosticsClient } from './RootDiagnosticsClient';

export async function RootDiagnostics({ scope }: { scope: string }) {
  const actor = await requireRootPage();
  try { return <RootDiagnosticsClient key={scope} initial={await listRootDiagnostics(actor.id, scope)} />; }
  catch { return <section className="root-control__notice" role="alert"><h2>Diagnostics unavailable</h2><p>History could not be loaded. Check service availability and reload this section.</p></section>; }
}
