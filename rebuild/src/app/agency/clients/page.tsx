import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { agencySearchLimit, listAgencyClients } from '@/modules/agency/server/agency';
import { ClientFilters } from '../AgencyFilters';
import { AgencyHeading, AgencyShell, formatDate } from '../AgencyChrome';
import { WorkspaceAction } from '../WorkspaceAction';
import styles from '../agency.module.css';

export default async function AgencyClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ channelScoped: true });
  const params = await searchParams;
  if (Object.entries(params).some(([key, value]) => key !== 'q' || typeof value !== 'string')) {
    return <AgencyShell><AgencyHeading description="Review your filters." /><RouteNotice error focusKey="agency-filter-error">Choose valid filters and try again.</RouteNotice><a href="/agency/clients">Reset filters</a></AgencyShell>;
  }
  const q = String(params.q ?? '');
  try {
    const searchLimit = await agencySearchLimit();
    const result = await listAgencyClients({ userId: viewer.user.id }, q ? { q } : {});
    return <AgencyShell>
      <AgencyHeading description="Client accounts and pending client invitations in workspaces you own or administer." />
      <ClientFilters q={q} searchLimit={searchLimit} />
      {result.truncated && <RouteNotice focusKey="agency-truncated">
        {result.filtered ? `More than ${result.limit} workspaces match this search; only the first ${result.limit} by name are shown. Search for more of the name to narrow them.`
          : `You manage more than ${result.limit} workspaces; only the first ${result.limit} by name are shown. Search by workspace name to find another.`}
      </RouteNotice>}
      {result.filtered && result.workspaces.length > 0 && <p className={styles.help}>Search matches workspace names only. All client accounts and pending invitations are listed for the matching workspaces.</p>}
      {result.workspaces.length === 0
        ? <p className={styles.empty}>{result.filtered ? 'No workspaces match this search.' : 'You do not own or administer any workspace with Agency access yet.'} {result.filtered && <a href="/agency/clients">Reset filters</a>}</p>
        : result.workspaces.map(item => <section key={item.workspaceId} className={styles.section} aria-labelledby={`client-${item.workspaceId}`}>
          <div className={styles.sectionHead}>
            <h2 id={`client-${item.workspaceId}`}>{item.workspaceName}</h2>
            {item.state === 'available' && <WorkspaceAction workspaceId={item.workspaceId} workspaceName={item.workspaceName} href="/settings/team" label="Manage team" />}
          </div>
          {item.state !== 'available'
            ? <p className={styles.help}>{item.state === 'suspended' ? 'This workspace is suspended, so its clients are not shown.' : 'Data deletion is in progress for this workspace.'}</p>
            : item.clientCount === null
              ? <p className={styles.help}>Client accounts are not shown because you cannot view this workspace&apos;s team.</p>
              : <>
                {item.clients.length === 0 ? <p className={styles.help}>{result.filtered ? 'No client accounts match this search.' : 'No client accounts yet.'}</p> : <>
                  <p className={styles.help}>{item.clientCount > item.clients.length ? `Showing ${item.clients.length} of ${item.clientCount} ${result.filtered ? 'matching ' : ''}client accounts.` : `${item.clientCount} ${result.filtered ? 'matching ' : ''}client ${item.clientCount === 1 ? 'account' : 'accounts'}.`}</p>
                  <ul className={styles.list}>{item.clients.map(client => <li key={client.userId}><strong>{client.name}</strong> <span className={styles.meta}>{client.email}</span></li>)}</ul></>}
                {item.invitationsAvailable
                  ? item.invitations.length > 0 && <><h3>Pending invitations</h3><ul className={styles.list}>{item.invitations.map(invite => <li key={invite.id}>{invite.email} <span className={styles.flag} data-tone={invite.status === 'expired' ? 'warn' : 'ok'}>{invite.status === 'expired' ? 'Expired' : 'Pending'}</span> <span className={styles.meta}>Until {formatDate(invite.expiresAt)}</span></li>)}</ul></>
                  : <p className={styles.help}>Invitations cannot be shown here. Manage them from the workspace team settings.</p>}
              </>}
        </section>)}
    </AgencyShell>;
  } catch (error) {
    return <AgencyShell><AgencyHeading description="Client accounts across your workspaces." /><RouteNotice error focusKey="agency-load-error">{error instanceof OperationError ? error.message : 'Client accounts could not be loaded. Refresh and try again.'}</RouteNotice></AgencyShell>;
  }
}
