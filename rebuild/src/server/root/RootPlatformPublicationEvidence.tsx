import { readRootPlatformPublicationEvidence } from './platform-publication-evidence';
import { requireRootPage } from '@/server/config/access';
import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { installedPublicationRecovery } from '@/server/platforms/publication-recovery';
import { OperationError } from '@/lib/operation-error';
import { RootPlatformPublicationTable } from './RootPlatformPublicationTable';

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
    {errorMessage || !evidence || 'providers' in evidence ? null : <RootPlatformPublicationTable evidence={evidence} providerId={providerId} filtered={Boolean(filterValue)} scopeKey={`${providerId}:${filterValue}`} />}
  </>;
}
