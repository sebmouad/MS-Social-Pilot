import { DataTable } from '@/components/DataTable';
import { readRootPlatformPublicationEvidence } from './platform-publication-evidence';
import { requireRootPage } from '@/server/config/access';
import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { installedPublicationRecovery } from '@/server/platforms/publication-recovery';
import { OperationError } from '@/lib/operation-error';

/** Provider-neutral presentation for the evidence schema declared by an installed platform module. */
export async function RootPlatformPublicationEvidence({ providerId, operationId }: { providerId: string; operationId?: string | string[] }) {
  const actor = await requireRootPage();
  if (!installedPublicationRecovery(providerId)?.readEvidence) return null;
  let evidence: Awaited<ReturnType<typeof readRootPlatformPublicationEvidence>> | null = null;
  let errorMessage: string | null = null;
  const selectedOperation = operationId === '' ? undefined : operationId;
  try {
    evidence = await readRootPlatformPublicationEvidence(actor.id, { providerId, ...(selectedOperation === undefined ? {} : { operationId: selectedOperation }) });
  } catch (error) {
    errorMessage = error instanceof OperationError && error.code === 'invalid_request'
      ? 'Enter one operation ID using 1–200 letters, numbers, underscores or hyphens.'
      : error instanceof OperationError ? error.message : 'Platform receipt evidence could not be loaded. Reload this module or check installation storage availability.';
  }
  const filterValue = Array.isArray(operationId) ? operationId.join(', ') : operationId ?? '';
  const filterError = errorMessage !== null && errorMessage.startsWith('Enter one operation ID');
  const action = `/root/platforms/${encodeURIComponent(providerId)}`;
  return <>
    <SidebarDock><section className="root-platform-evidence-filter" aria-label="Publication evidence filter">
      <p className="shell-subnav__label">Platform evidence</p>
      <form noValidate method="get" action={action}>
        <label className="ui-field" htmlFor={`root-platform-operation-${providerId}`}>Publication operation ID
          <input id={`root-platform-operation-${providerId}`} className="ui-input" type="search" name="operationId" maxLength={200} defaultValue={filterValue} placeholder="Exact operation ID" aria-invalid={filterError || undefined} aria-describedby={filterError ? 'root-platform-publication-evidence-error' : undefined} />
        </label>
        <Button type="submit">Apply filter</Button>
      </form>
      <a href={action}>Reset filter</a>
    </section></SidebarDock>
    {errorMessage ? <section className="root-control__notice" role="alert" aria-labelledby="root-platform-publication-evidence-error-title">
      <h2 id="root-platform-publication-evidence-error-title">Publication evidence unavailable</h2>
      <p id="root-platform-publication-evidence-error">{errorMessage}</p>
    </section> : null}
    {errorMessage || !evidence || 'providers' in evidence ? null : <PublicationEvidenceTable evidence={evidence} providerId={providerId} filtered={Boolean(filterValue)} />}
  </>;
}

function PublicationEvidenceTable({ evidence, providerId, filtered }: { evidence: Exclude<Awaited<ReturnType<typeof readRootPlatformPublicationEvidence>>, { providers: unknown }>; providerId: string; filtered: boolean }) {
  const columns = evidence.columns.map(column => ({ key: column.key, label: column.label, render: (row: typeof evidence.items[number]) => {
    const value = row[column.key];
    return value === null || value === undefined ? '—' : typeof value === 'number' ? value : <span className="root-publication-evidence__cell">{value}</span>;
  } }));
  return <section className="root-jobs" aria-labelledby={`root-platform-publication-evidence-${providerId}`}>
    <p className="root-jobs__eyebrow">Platform operations</p>
    <h2 id={`root-platform-publication-evidence-${providerId}`}>{evidence.title}</h2>
    <p>{evidence.description}</p>
    <p>Read-only evidence contains operation and receipt identifiers only. It excludes customer content, credentials and raw provider errors.</p>
    <DataTable rows={evidence.items} columns={columns} rowKey={row => `${providerId}-${JSON.stringify(row)}`} caption={evidence.title} emptyMessage={filtered ? 'No publication evidence is recorded for this operation.' : 'No publication evidence is recorded for this platform.'} />
    {evidence.truncated ? <p role="status">This history is truncated by the platform evidence limit. Use the Platform evidence sidebar filter to narrow the results. Configured limits still apply to a single operation.</p> : null}
  </section>;
}
