import { runtimeConfigBatch } from '@/server/config/store';
import { ClientErrorReporter } from './ClientErrorReporter';

/** Mounts the browser reporter only while Root has recording and browser reports switched on. A failing setting read never breaks a page. */
export async function ClientErrorReporterGate() {
  try {
    const values = await runtimeConfigBatch(['errors.recordingEnabled', 'errors.clientReportsEnabled', 'errors.clientMaxPerPageLoad']);
    if (!values['errors.recordingEnabled'] || !values['errors.clientReportsEnabled']) return null;
    return <ClientErrorReporter maxReports={Number(values['errors.clientMaxPerPageLoad'])} />;
  } catch { return null; }
}
