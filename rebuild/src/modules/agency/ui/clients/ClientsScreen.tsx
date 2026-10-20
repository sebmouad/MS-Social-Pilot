import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { agencySearchLimit, listAgencyClients } from '@/modules/agency/server/agency';
import { ClientFilters } from '@/modules/agency/ui/AgencyFilters';
import { AgencyHeading, AgencyShell, formatDate } from '@/modules/agency/ui/AgencyChrome';
import { WorkspaceAction } from '@/modules/agency/ui/WorkspaceAction';
import { DataTable, Badge, EmptyState } from '@/components';
import { IconUsersGroup } from '@tabler/icons-react';
import styles from '@/modules/agency/ui/agency.module.css';

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
        ? <EmptyState title={result.filtered ? 'No workspaces match this search.' : 'You do not own or administer any workspace with Agency access yet.'} icon={<IconUsersGroup />} action={<a href={result.filtered ? '/agency/clients' : '/settings/team'}>{result.filtered ? 'Reset filters' : 'View team'}</a>} />
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
                  <DataTable caption={item.workspaceName} rows={item.clients} rowKey={client => client.userId} columns={[{ key: 'name', label: 'Client', render: client => <strong>{client.name}</strong> }, { key: 'email', label: 'Email', render: client => client.email }]} /></>}
                {item.invitationsAvailable
                  ? item.invitations.length > 0 && <><h3>Pending invitations</h3><DataTable caption="Pending invitations" rows={item.invitations} rowKey={invite => invite.id} columns={[{ key: 'email', label: 'Email', render: invite => invite.email }, { key: 'status', label: 'Status', render: invite => <Badge tone={invite.status === 'expired' ? 'warning' : 'module'}>{invite.status === 'expired' ? 'Expired' : 'Pending'}</Badge> }, { key: 'expires', label: 'Expires', render: invite => formatDate(invite.expiresAt) }]} /></>
                  : <p className={styles.help}>Invitations cannot be shown here. Manage them from the workspace team settings.</p>}
              </>}
        </section>)}
    </AgencyShell>;
  } catch (error) {
    return <AgencyShell><AgencyHeading description="Client accounts across your workspaces." /><RouteNotice error focusKey="agency-load-error">{error instanceof OperationError ? error.message : 'Client accounts could not be loaded. Refresh and try again.'}</RouteNotice></AgencyShell>;
  }
}
