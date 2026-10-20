import { ROOT_EVIDENCE_POLICY } from '@/lib/config/root-evidence-policy';
import { readRootPlatformPublicationEvidence, loadRootEvidencePolicy, loadRootEvidenceCopy } from './platform-publication-evidence';
import { requireRootPage } from '@/server/config/access';
import { SidebarDock } from '@/components/SidebarDock';
import { Button } from '@/components/Button';
import { installedPublicationRecovery } from '@/server/platforms/publication-recovery';
import { OperationError } from '@/lib/operation-error';
import { RootPlatformPublicationTable } from './RootPlatformPublicationTable';
import { evidenceCopyText } from '@/lib/config/root-evidence-copy';

/** Provider-neutral presentation for the evidence schema declared by an installed platform module. */
export async function RootPlatformPublicationEvidence({ providerId, operationId }: { providerId: string; operationId?: string | string[] }) {
  const actor = await requireRootPage();
  if (!installedPublicationRecovery(providerId)?.readEvidence) return null;
  let evidence: Awaited<ReturnType<typeof readRootPlatformPublicationEvidence>> | null = null;
  let errorMessage: string | null = null;
  let filterError = false;
  let policy: Awaited<ReturnType<typeof loadRootEvidencePolicy>> | null = null;
  const copy = await loadRootEvidenceCopy();
  const selectedOperation = operationId === '' ? undefined : operationId;
  try {
    policy = await loadRootEvidencePolicy(copy);
    evidence = await readRootPlatformPublicationEvidence(actor.id, { providerId, ...(selectedOperation === undefined ? {} : { operationId: selectedOperation }) }, policy, copy);
  } catch (error) {
    filterError = error instanceof OperationError && error.code === 'invalid_request';
    errorMessage = error instanceof OperationError && error.code === 'invalid_request'
      ? evidenceCopyText(copy.invalidOperationId, { limit: policy?.operationIdCharacters ?? ROOT_EVIDENCE_POLICY.operationIdCharacters })
      : error instanceof OperationError ? error.message : copy.unavailable;
  }
  const filterValue = Array.isArray(operationId) ? operationId.join(', ') : operationId ?? '';
  const action = `/root/platforms/${encodeURIComponent(providerId)}`;
  return <>
    <SidebarDock><section className="root-platform-evidence-filter" aria-label={copy.filter}>
      <p className="shell-subnav__label">{copy.platformEvidence}</p>
      <form noValidate method="get" action={action}>
        <label className="ui-field" htmlFor={`root-platform-operation-${providerId}`}>{copy.operationId}
          <input id={`root-platform-operation-${providerId}`} className="ui-input" type="search" name="operationId" maxLength={policy?.operationIdCharacters ?? ROOT_EVIDENCE_POLICY.operationIdCharacters} defaultValue={filterValue} placeholder={copy.exactOperationId} aria-invalid={filterError || undefined} aria-describedby={filterError ? 'root-platform-publication-evidence-error' : undefined} />
        </label>
        <Button type="submit">{copy.applyFilter}</Button>
      </form>
      <a href={action}>{copy.resetFilter}</a>
    </section></SidebarDock>
    {errorMessage ? <section className="root-control__notice" role="alert" aria-labelledby="root-platform-publication-evidence-error-title">
      <h2 id="root-platform-publication-evidence-error-title">{copy.unavailableTitle}</h2>
      <p id="root-platform-publication-evidence-error">{errorMessage}</p>
    </section> : null}
    {errorMessage || !evidence || !policy || 'providers' in evidence ? null : <RootPlatformPublicationTable evidence={evidence} providerId={providerId} filtered={Boolean(filterValue)} policy={policy} copy={copy} scopeKey={`${providerId}:${filterValue}`} />}
  </>;
}
