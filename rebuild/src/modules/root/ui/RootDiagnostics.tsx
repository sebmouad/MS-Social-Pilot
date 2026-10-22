import { requireRootPage } from '@/server/config/access';
import { listRootDiagnostics } from '@/server/root/diagnostics';
import { RootDiagnosticsClient } from './RootDiagnosticsClient';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_DIAGNOSTICS_COPY } from '@/lib/config/root-diagnostics-copy';

export async function RootDiagnostics({ scope }: { scope: string }) {
  const actor = await requireRootPage();
  const copy = await runtimeConfig('root.diagnosticsCopy').catch(() => ROOT_DIAGNOSTICS_COPY);
  try { return <RootDiagnosticsClient key={scope} initial={await listRootDiagnostics(actor.id, scope)} copy={copy} />; }
  catch { return <section className="root-control__notice" role="alert"><h2>{copy.unavailableTitle}</h2><p>{copy.unavailableBody}</p></section>; }
}
